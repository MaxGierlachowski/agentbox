import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { COMPONENTS, SCRIPTS } from "@workspace/providers"
import { exec } from "../exec"
import { debArch } from "./system"

/** Units the service may restart through sudo (`agentbox host apply restart <id>`). */
const RESTARTABLE: Record<string, string> = {
  hermes: "agentbox-hermes.service",
  "hermes-ui": "agentbox-hermes-ui.service",
  paseo: "agentbox-paseo.service",
  chrome: "agentbox-chrome.service",
  kasmvnc: "agentbox-kasmvnc.service",
  caddy: "agentbox-caddy.service",
  iroh: "agentbox-iroh.service",
}

async function runScript(name: keyof typeof SCRIPTS, args: string[]) {
  const dir = await mkdtemp(join(tmpdir(), "agentbox-apply-"))
  try {
    const file = join(dir, `${name}.sh`)
    await writeFile(file, SCRIPTS[name], { mode: 0o700 })
    const r = await exec(["bash", file, ...args], {
      env: { DEBIAN_FRONTEND: "noninteractive" },
      timeoutMs: 20 * 60_000,
      onLine: (l) => console.log(l),
    })
    if (r.code !== 0) throw new Error(`${name} ${args.join(" ")} failed (exit ${r.code})`)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/**
 * Root-only actions with fixed ids (the sudoers rule allows exactly this command). Nothing here
 * accepts free-form commands, paths or URLs.
 */
export async function hostApplyAction(action: string, target: string) {
  if (process.getuid?.() !== 0) throw new Error("host apply must run as root (through sudo)")
  if (action === "restart") {
    const unit = RESTARTABLE[target]
    if (!unit) throw new Error(`Unknown unit "${target}"`)
    const r = await exec(["systemctl", "restart", unit], { timeoutMs: 120_000 })
    if (r.code !== 0) throw new Error(`restart ${unit} failed: ${r.stderr.trim()}`)
    console.log(`restarted ${unit}`)
    return
  }
  if (action === "cli") {
    if (!/^cli\.[a-z0-9-]+$/.test(target)) throw new Error(`Invalid CLI plan "${target}"`)
    if (target === "cli.gh" || target === "cli.glab") {
      const name = target === "cli.gh" ? "gh" : "glab"
      const c = COMPONENTS[name]
      const arch = debArch()
      await runScript("deb", [name, c.version, c.url(arch), c.sha256[arch]])
      return
    }
    await runScript("cli", [target])
    return
  }
  throw new Error(`Unknown action "${action}" (restart | cli)`)
}
