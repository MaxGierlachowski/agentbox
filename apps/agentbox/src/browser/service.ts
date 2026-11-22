import { existsSync } from "node:fs"
import { rm, writeFile } from "node:fs/promises"
import { exec } from "../exec"

export const CDP_URL = "http://127.0.0.1:9333"

/**
 * The box's one shared Chrome (KasmVNC display :1, CDP on loopback). Agents attach to it; humans
 * see it through /browser/. The lock file asks agents to pause while a human is logging in.
 */
export class BrowserService {
  constructor(private readonly lockPath: string) {}

  private async cdp() {
    try {
      const res = await fetch(`${CDP_URL}/json/version`, { signal: AbortSignal.timeout(2000) })
      return res.ok
    } catch {
      return false
    }
  }

  async status() {
    const unit = await exec(["systemctl", "is-active", "agentbox-chrome.service"], {
      timeoutMs: 5000,
    })
    return {
      running: unit.stdout.trim() === "active",
      cdp: await this.cdp(),
      locked: existsSync(this.lockPath),
      // KasmVNC client settings: websocket under our prefix, connect at once, and resize the
      // box's screen to the viewer (phones get a portrait desktop).
      path: "/browser/?path=browser/websockify&autoconnect=1&resize=remote",
    }
  }

  async setLock(locked: boolean) {
    if (locked) await writeFile(this.lockPath, `${new Date().toISOString()}\n`, { mode: 0o644 })
    else await rm(this.lockPath, { force: true })
    return this.status()
  }

  /** Opens a tab in the box's Chrome, e.g. an OAuth URL whose callback hits localhost. */
  async open(url: string) {
    const u = new URL(url)
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("Only http(s) URLs")
    const res = await fetch(`${CDP_URL}/json/new?${encodeURI(url)}`, { method: "PUT" })
    return { ok: res.ok, message: res.ok ? null : `Chrome answered ${res.status}` }
  }
}
