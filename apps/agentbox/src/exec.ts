import { log } from "./log"

/** PATH for every child process: vendored wrappers live in /usr/local/bin. */
export const CHILD_PATH = "/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin"

export interface ExecOptions {
  env?: Record<string, string | undefined>
  cwd?: string
  /** Written to stdin, then stdin is closed. Use this for secrets, never argv. */
  stdin?: string
  timeoutMs?: number
  signal?: AbortSignal
  /** Called for every output line (already split), e.g. to stream into a run. */
  onLine?: (line: string, stream: "stdout" | "stderr") => void
}

export interface ExecResult {
  code: number
  stdout: string
  stderr: string
}

export class ExecError extends Error {
  constructor(
    readonly argv: string[],
    readonly result: ExecResult,
  ) {
    const tail = (result.stderr || result.stdout).trim().split("\n").slice(-5).join("\n")
    super(`${argv[0]} exited with ${result.code}${tail ? `: ${tail}` : ""}`)
  }
}

export function childEnv(extra: Record<string, string | undefined> = {}) {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries({ ...process.env, PATH: CHILD_PATH, ...extra }))
    if (v !== undefined) env[k] = v
  return env
}

async function pump(
  stream: ReadableStream<Uint8Array>,
  name: "stdout" | "stderr",
  onLine?: ExecOptions["onLine"],
) {
  const decoder = new TextDecoder()
  let all = ""
  let partial = ""
  for await (const chunk of stream) {
    const text = decoder.decode(chunk, { stream: true })
    all += text
    if (onLine) {
      partial += text
      const lines = partial.split("\n")
      partial = lines.pop() ?? ""
      for (const line of lines) onLine(line, name)
    }
  }
  if (onLine && partial) onLine(partial, name)
  return all
}

/** Runs a command without a shell. Never throws on non-zero exit; see `execOk`. */
export async function exec(argv: string[], opts: ExecOptions = {}): Promise<ExecResult> {
  const proc = Bun.spawn(argv, {
    cwd: opts.cwd,
    env: childEnv(opts.env),
    stdin: opts.stdin !== undefined ? "pipe" : "ignore",
    stdout: "pipe",
    stderr: "pipe",
    signal: opts.signal,
  })
  if (opts.stdin !== undefined && proc.stdin) {
    proc.stdin.write(opts.stdin)
    await proc.stdin.end()
  }
  const timer = opts.timeoutMs
    ? setTimeout(() => {
        log.warn({ cmd: argv[0] }, "command timed out")
        proc.kill("SIGTERM")
      }, opts.timeoutMs)
    : null
  const [stdout, stderr, code] = await Promise.all([
    pump(proc.stdout, "stdout", opts.onLine),
    pump(proc.stderr, "stderr", opts.onLine),
    proc.exited,
  ])
  if (timer) clearTimeout(timer)
  return { code, stdout, stderr }
}

/** Like `exec`, but throws an ExecError on a non-zero exit. */
export async function execOk(argv: string[], opts: ExecOptions = {}) {
  const result = await exec(argv, opts)
  if (result.code !== 0) throw new ExecError(argv, result)
  return result
}

export async function which(bin: string) {
  return Bun.which(bin, { PATH: CHILD_PATH })
}
