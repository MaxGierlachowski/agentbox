import { writeFile } from "node:fs/promises"
import pc from "picocolors"
import type { Config } from "../config"

export interface AccessInfo {
  otp: string
  expiresAt: string
  path: "/setup/" | "/reset/"
}

/** The block `agentbox up` / `agentbox otp` print, also written to first-run.txt (root, 0600). */
export function accessBlock(config: Config, info: AccessInfo, sshUser = "<you>") {
  const words = info.otp
  const frag = `#otp=${words.replaceAll(" ", "-")}`
  const lines: string[] = []
  const host = config.lanUrl ? new URL(config.lanUrl).hostname : "<vm-ip>"
  if (config.lanUrl) {
    lines.push(`  Open:  ${pc.bold(`${config.lanUrl}${info.path}${frag}`)}`)
    if (config.certFingerprint)
      lines.push(pc.dim(`         (self-signed certificate, SHA-256 ${config.certFingerprint})`))
    lines.push(
      `  or:    ssh -L 8080:127.0.0.1:8080 ${sshUser}@${host}  →  http://localhost:8080${info.path}${frag}`,
    )
  } else {
    lines.push(`  Tunnel: ssh -L 8080:127.0.0.1:8080 ${sshUser}@${host}`)
    lines.push(`  Open:   ${pc.bold(`http://localhost:8080${info.path}${frag}`)}`)
  }
  const mins = Math.round((new Date(info.expiresAt).getTime() - Date.now()) / 60000)
  const cmd = info.path === "/setup/" ? "sudo agentbox otp" : "sudo agentbox reset-owner"
  lines.push(
    `  One-time code: ${pc.bold(words)}   ${pc.dim(`(valid ${mins} min · new code: ${cmd})`)}`,
  )
  return lines.join("\n")
}

export async function writeFirstRun(file: string, text: string) {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: strip colors for the file copy
  await writeFile(file, `${text.replace(/\u001b\[[0-9;]*m/g, "")}\n`, { mode: 0o600 })
}
