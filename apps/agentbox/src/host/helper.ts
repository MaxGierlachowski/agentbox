import { execOk } from "../exec"

/**
 * Root actions the service user may trigger, through
 * `/etc/sudoers.d/agentbox`: `agentbox ALL=(root) NOPASSWD: /usr/local/bin/agentbox host apply *`.
 * `host apply` only accepts the fixed action ids below, never free-form commands.
 */
export type HostAction =
  | {
      action: "restart"
      unit: "hermes" | "hermes-ui" | "paseo" | "chrome" | "kasmvnc" | "caddy" | "iroh"
    }
  | { action: "cli"; id: string }

export function hostActionArgs(a: HostAction): string[] {
  switch (a.action) {
    case "restart":
      return ["restart", a.unit]
    case "cli":
      return ["cli", a.id]
  }
}

export async function hostApply(a: HostAction, onLine?: (line: string) => void) {
  return execOk(["sudo", "-n", "/usr/local/bin/agentbox", "host", "apply", ...hostActionArgs(a)], {
    timeoutMs: 15 * 60_000,
    onLine: onLine ? (l) => onLine(l) : undefined,
  })
}
