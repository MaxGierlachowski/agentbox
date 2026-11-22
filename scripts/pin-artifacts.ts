// Pins the companion components to their own GitHub releases: downloads each asset, computes its
// sha256 and writes apps/agentbox/src/host/artifacts.json (embedded in the binary).
//
//   bun scripts/pin-artifacts.ts
import { createHash } from "node:crypto"
import { join } from "node:path"

const OWNER = "https://github.com/MaxGierlachowski"
const PINS = [
  { name: "paseo-mcp", tag: "v0.5.0-rc.1", file: "paseo-mcp-0.5.0-rc.1.tgz", dir: "paseo-mcp" },
  {
    name: "paseo-multi-account",
    tag: "v1.1.0",
    file: "paseo-multi-account-1.1.0.tgz",
    dir: "paseo-multi-account",
  },
  {
    name: "hermes-paseo-bridge",
    tag: "v0.1.0",
    file: "hermes-paseo-bridge-0.1.0.tar.gz",
    dir: "hermes-paseo-bridge",
  },
  { name: "hermes-ui", tag: "v0.3.0", file: "hermes-ui-0.3.0.tgz", dir: "hermes-ui" },
] as const

const out = []
for (const p of PINS) {
  const url = `${OWNER}/${p.name}/releases/download/${p.tag}/${p.file}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  const sha256 = createHash("sha256").update(bytes).digest("hex")
  // Cross-check with the release's own .sha256 file.
  const published = (await (await fetch(`${url}.sha256`)).text()).trim().split(/\s+/)[0]
  if (published !== sha256) throw new Error(`${p.file}: sha256 differs from the published .sha256`)
  out.push({ name: p.name, version: p.tag.replace(/^v/, ""), url, sha256, dir: p.dir })
  console.log(`${p.name} ${p.tag} ${sha256.slice(0, 12)}…`)
}
await Bun.write(
  join(import.meta.dir, "../apps/agentbox/src/host/artifacts.json"),
  `${JSON.stringify(out, null, 2)}\n`,
)
