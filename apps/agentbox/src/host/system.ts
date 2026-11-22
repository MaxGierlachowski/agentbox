import { createHash, randomBytes } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { chmod, chown, mkdir, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { type ExecOptions, exec, execOk } from "../exec"

export const SVC_USER = "agentbox"
export const SVC_HOME = "/home/agentbox"

export type Arch = "amd64" | "arm64"

export function debArch(): Arch {
  if (process.arch === "x64") return "amd64"
  if (process.arch === "arm64") return "arm64"
  throw new Error(`Unsupported architecture ${process.arch}: agentbox runs on x86_64 and arm64`)
}

export function osRelease() {
  const text = existsSync("/etc/os-release") ? readFileSync("/etc/os-release", "utf8") : ""
  const get = (k: string) => text.match(new RegExp(`^${k}="?([^"\\n]*)"?`, "m"))?.[1] ?? ""
  return { id: get("ID"), version: get("VERSION_ID"), pretty: get("PRETTY_NAME") }
}

const uidCache = new Map<string, number>()
async function ids(user: string) {
  if (!uidCache.has(user)) {
    const uid = Number((await execOk(["id", "-u", user])).stdout.trim())
    uidCache.set(user, uid)
    uidCache.set(`${user}:g`, Number((await execOk(["id", "-g", user])).stdout.trim()))
  }
  return { uid: uidCache.get(user) as number, gid: uidCache.get(`${user}:g`) as number }
}

/** Writes a file only when its content changes. Returns true if it changed. */
export async function writeIfChanged(
  path: string,
  content: string,
  opts: { mode?: number; owner?: string; group?: string } = {},
) {
  const current = existsSync(path) ? readFileSync(path, "utf8") : null
  const mode = opts.mode ?? 0o644
  await mkdir(dirname(path), { recursive: true })
  const changed = current !== content
  if (changed) await writeFile(path, content, { mode })
  await chmod(path, mode)
  if (opts.owner || opts.group) {
    const uid = opts.owner ? (await ids(opts.owner)).uid : -1
    const gid = opts.group
      ? (await ids(opts.group)).gid
      : opts.owner
        ? (await ids(opts.owner)).gid
        : -1
    await chown(path, uid, gid)
  }
  return changed
}

/** Runs a command as the service user with its HOME. */
export function asUser(argv: string[], opts: ExecOptions = {}) {
  return exec(
    ["runuser", "-u", SVC_USER, "--", "env", `HOME=${SVC_HOME}`, ...envArgs(opts.env), ...argv],
    {
      ...opts,
      env: undefined,
      cwd: opts.cwd ?? "/",
    },
  )
}

export async function asUserOk(argv: string[], opts: ExecOptions = {}) {
  const r = await asUser(argv, opts)
  if (r.code !== 0)
    throw new Error(
      `${argv.join(" ")} failed: ${(r.stderr || r.stdout).trim().split("\n").slice(-5).join("\n")}`,
    )
  return r
}

function envArgs(env?: Record<string, string | undefined>) {
  return Object.entries(env ?? {})
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v}`)
}

/** A random secret, kept across runs in a root-only file. */
export async function persistentSecret(path: string, bytes = 32) {
  if (existsSync(path)) {
    const v = readFileSync(path, "utf8").trim()
    if (v) return v
  }
  const v = randomBytes(bytes).toString("base64url")
  await writeIfChanged(path, `${v}\n`, { mode: 0o600 })
  return v
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex")

export async function systemctl(...args: string[]) {
  return exec(["systemctl", ...args], { timeoutMs: 120_000 })
}

/** Primary IPv4 (source of the default route) and whether the host has any public address. */
export async function networkFacts() {
  const route = await exec(["ip", "-4", "route", "get", "1.1.1.1"])
  const primary = route.stdout.match(/\bsrc (\d+\.\d+\.\d+\.\d+)/)?.[1] ?? null
  const addrs = (await exec(["ip", "-o", "addr", "show", "scope", "global"])).stdout
    .split("\n")
    .filter((l) => l.trim() && !/\b(docker\d*|br-[0-9a-f]+|veth\w*|virbr\d*)\b/.test(l))
    .map((l) => l.match(/inet6? ([0-9a-f.:]+)\//)?.[1])
    .filter((a): a is string => Boolean(a))
  return { primary, addrs, hasPublic: addrs.some((a) => !isPrivate(a)) }
}

export function isPrivate(addr: string) {
  if (addr.includes(":")) return /^(f[cd]|fe8)/i.test(addr) // ULA, link-local
  const [a, b] = addr.split(".").map(Number) as [number, number]
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT (e.g. some home routers)
    a === 127 ||
    (a === 169 && b === 254)
  )
}
