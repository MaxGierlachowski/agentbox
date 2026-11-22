import type { LoginFlow } from "@workspace/contract"
import { childEnv } from "../exec"
import { log } from "../log"

const ESC = String.fromCharCode(27)
const BEL = String.fromCharCode(7)
// CSI, OSC (incl. OSC 8 hyperlinks), DCS/APC/PM/SOS strings, two-byte escapes, and CR.
const ANSI = new RegExp(
  [
    `${ESC}\\[[0-?]*[ -/]*[@-~]`,
    `${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`,
    `${ESC}[PX^_][^${ESC}]*${ESC}\\\\`,
    `${ESC}[@-Z\\\\-_]`,
    "\r",
  ].join("|"),
  "g",
)

/** Replies to terminal queries: cursor position (DSR), background colour (OSC 11), device attributes. */
const TERMINAL_ANSWERS: [string, string][] = [
  [`${ESC}[6n`, `${ESC}[1;1R`],
  [`${ESC}]11;?`, `${ESC}]11;rgb:0000/0000/0000${ESC}\\`],
  [`${ESC}[c`, `${ESC}[?62;22c`],
]

/** Strips ANSI escape sequences and carriage returns from PTY output. */
export function stripAnsi(s: string) {
  return s.replace(ANSI, "")
}

export interface FlowParser {
  /** Extracts what the UI needs from the accumulated (ANSI-stripped) output. */
  parse(output: string): { url?: string; code?: string; needsPaste?: boolean }
  /** Prompts to answer automatically, e.g. "Press Enter to open github.com in your browser". */
  autoAnswers?: { match: RegExp; send: string }[]
  /** Runs after a successful exit; returns the signed-in user. */
  verify?: () => Promise<string | null>
}

interface Entry {
  flow: LoginFlow
  proc: ReturnType<typeof Bun.spawn> | null
  output: string
  answered: Set<number>
  onDone?: (flow: LoginFlow) => Promise<void> | void
  timer: ReturnType<typeof setTimeout>
}

const FLOW_TTL_MS = 15 * 60 * 1000

/**
 * Interactive CLI logins (claude, gh, glab) driven in a PTY. The UI polls `flows.get`; only
 * the URL and the one-time code leave this process, never the raw transcript.
 */
export class FlowRegistry {
  private readonly flows = new Map<string, Entry>()

  start(
    argv: string[],
    parser: FlowParser,
    opts: { env?: Record<string, string | undefined>; cwd?: string; onDone?: Entry["onDone"] } = {},
  ): LoginFlow {
    const flowId = crypto.randomUUID()
    const flow: LoginFlow = {
      flowId,
      url: null,
      code: null,
      needsPaste: false,
      state: "starting",
      message: null,
      user: null,
    }
    const entry: Entry = {
      flow,
      proc: null,
      output: "",
      answered: new Set(),
      onDone: opts.onDone,
      timer: setTimeout(() => this.expire(flowId), FLOW_TTL_MS),
    }
    this.flows.set(flowId, entry)
    const decoder = new TextDecoder()
    entry.proc = Bun.spawn(argv, {
      cwd: opts.cwd,
      env: childEnv({ TERM: "xterm-256color", BROWSER: "/bin/true", ...opts.env }),
      terminal: {
        cols: 200,
        rows: 50,
        data: (term, data) => {
          const raw = decoder.decode(data, { stream: true })
          // gh/glab wait ~5 s for answers to terminal queries before printing anything.
          for (const [query, answer] of TERMINAL_ANSWERS)
            if (raw.includes(query)) term.write(answer)
          entry.output += stripAnsi(raw)
          if (entry.output.length > 64_000) entry.output = entry.output.slice(-32_000)
          this.onOutput(entry, parser)
        },
      },
    })
    void entry.proc.exited.then((code) => this.onExit(entry, parser, code))
    return { ...flow }
  }

  private onOutput(entry: Entry, parser: FlowParser) {
    const found = parser.parse(entry.output)
    if (found.url) entry.flow.url = found.url
    if (found.code) entry.flow.code = found.code
    if (found.needsPaste !== undefined) entry.flow.needsPaste = found.needsPaste
    if (entry.flow.state === "starting" && (entry.flow.url || entry.flow.code))
      entry.flow.state = "waiting"
    parser.autoAnswers?.forEach((a, i) => {
      if (!entry.answered.has(i) && a.match.test(entry.output)) {
        entry.answered.add(i)
        entry.proc?.terminal?.write(a.send)
      }
    })
  }

  private async onExit(entry: Entry, parser: FlowParser, code: number) {
    if (entry.flow.state === "cancelled") return
    if (code === 0) {
      try {
        entry.flow.user = (await parser.verify?.()) ?? entry.flow.user
        entry.flow.state = "done"
      } catch (err) {
        entry.flow.state = "error"
        entry.flow.message = (err as Error).message
      }
    } else {
      entry.flow.state = "error"
      const tail = entry.output.trim().split("\n").filter(Boolean).slice(-3).join(" ")
      entry.flow.message = tail ? tail.slice(0, 400) : `exited with ${code}`
      log.warn({ code }, "login flow failed")
    }
    if (entry.flow.state === "done") {
      try {
        await entry.onDone?.(entry.flow)
      } catch (err) {
        entry.flow.state = "error"
        entry.flow.message = (err as Error).message
      }
    }
  }

  /** Types text into the flow's terminal (paste codes). */
  write(flowId: string, text: string) {
    const entry = this.require(flowId)
    if (entry.flow.state !== "waiting" && entry.flow.state !== "starting")
      throw new Error(`This login is ${entry.flow.state}`)
    entry.proc?.terminal?.write(text)
  }

  /** Waits until the flow leaves the waiting state or `ms` passes. */
  settle(flowId: string, ms: number) {
    return this.settleUntil(flowId, (f) => ["done", "error", "cancelled"].includes(f.state), ms)
  }

  /** Waits until `done(flow)` holds or `ms` passes, then returns the flow. */
  async settleUntil(flowId: string, done: (flow: LoginFlow) => boolean, ms: number) {
    const until = Date.now() + ms
    while (Date.now() < until && !done(this.require(flowId).flow)) await Bun.sleep(200)
    return this.get(flowId)
  }

  get(flowId: string): LoginFlow {
    return { ...this.require(flowId).flow }
  }

  cancel(flowId: string) {
    const entry = this.flows.get(flowId)
    if (!entry) return { ok: false }
    entry.flow.state = "cancelled"
    entry.proc?.kill("SIGTERM")
    // glab ignores SIGTERM/SIGINT while it waits for authorization.
    setTimeout(() => {
      if (entry.proc && entry.proc.exitCode === null) entry.proc.kill("SIGKILL")
    }, 2000)
    return { ok: true }
  }

  private require(flowId: string) {
    const entry = this.flows.get(flowId)
    if (!entry) throw new Error("Unknown or expired login flow")
    return entry
  }

  private expire(flowId: string) {
    const entry = this.flows.get(flowId)
    if (!entry) return
    if (entry.flow.state === "waiting" || entry.flow.state === "starting")
      entry.proc?.kill("SIGTERM")
    this.flows.delete(flowId)
  }

  stop() {
    for (const id of [...this.flows.keys()]) this.cancel(id)
  }
}
