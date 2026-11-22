// Builds an agentbox release into apps/agentbox/dist/release/:
//   - companion tarballs (hermes-ui, paseo-multi-account, hermes-paseo-bridge) from sibling repos,
//     paseo-mcp from its own GitHub release
//   - apps/agentbox/src/host/artifacts.json pointing at them (+ sha256)
//   - agentbox binaries (linux x64/arm64 for the box, darwin/windows for `agentbox connect`)
//   - install.sh with the version baked in, SHA256SUMS
//
//   bun scripts/release.ts                     full build (needs ../hermes-ui etc. checked out)
//   bun scripts/release.ts --local             only artifacts with file:///artifacts URLs (VM tests)
//   bun scripts/release.ts --skip-web --targets linux-arm64
import { createHash } from "node:crypto"
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { basename, join } from "node:path"
import { parseArgs } from "node:util"
import { $ } from "bun"
import pkg from "../apps/agentbox/package.json" with { type: "json" }

const { values } = parseArgs({
  options: {
    local: { type: "boolean", default: false },
    "skip-web": { type: "boolean", default: false },
    "skip-build": { type: "boolean", default: false },
    targets: { type: "string", default: "linux-x64,linux-arm64,darwin-arm64,darwin-x64" },
  },
})

const root = join(import.meta.dir, "..")
const out = join(root, "apps/agentbox/dist/release")
const siblings = join(root, "..")
const PASEO_MCP = {
  version: "0.5.0-rc.1",
  url: "https://github.com/MaxGierlachowski/paseo-mcp/releases/download/v0.5.0-rc.1/paseo-mcp-0.5.0-rc.1.tgz",
}

const sha256 = async (file: string) =>
  createHash("sha256")
    .update(await readFile(file))
    .digest("hex")

await rm(out, { recursive: true, force: true })
await mkdir(out, { recursive: true })

interface Built {
  name: string
  version: string
  file: string
  dir: string
}

async function buildSibling(repo: string, cmd: string[], dir: string): Promise<Built> {
  const path = join(siblings, repo)
  if (!values["skip-build"]) await $`${cmd}`.cwd(path).quiet()
  const files = (await readdir(join(path, "dist"))).filter((f) => /\.(tgz|tar\.gz)$/.test(f)).sort()
  const file = files.at(-1)
  if (!file) throw new Error(`${repo}: no tarball in dist/`)
  await copyFile(join(path, "dist", file), join(out, file))
  const version = file.replace(`${repo}-`, "").replace(/\.(tgz|tar\.gz)$/, "")
  return { name: repo, version, file, dir }
}

const built: Built[] = [
  await buildSibling("hermes-ui", ["npm", "run", "release:tarball"], "hermes-ui"),
  await buildSibling(
    "paseo-multi-account",
    ["npm", "run", "release:tarball"],
    "paseo-multi-account",
  ),
  await buildSibling(
    "hermes-paseo-bridge",
    ["./scripts/release-tarball.sh"],
    "hermes-paseo-bridge",
  ),
]
const mcpFile = basename(PASEO_MCP.url)
await $`curl -fsSL -o ${join(out, mcpFile)} ${PASEO_MCP.url}`
built.unshift({ name: "paseo-mcp", version: PASEO_MCP.version, file: mcpFile, dir: "paseo-mcp" })

const artifacts = []
for (const b of built) {
  const url = values.local
    ? `file:///artifacts/${b.file}`
    : b.name === "paseo-mcp"
      ? PASEO_MCP.url
      : `release:${b.file}`
  artifacts.push({
    name: b.name,
    version: b.version,
    url,
    sha256: await sha256(join(out, b.file)),
    dir: b.dir,
  })
}
const manifest = `${JSON.stringify(artifacts, null, 2)}\n`
if (values.local) {
  await writeFile(join(out, "artifacts.local.json"), manifest)
  console.log(
    `local artifacts in ${out} (mount as /artifacts, AGENTBOX_ARTIFACTS=/artifacts/artifacts.local.json)`,
  )
} else {
  await writeFile(join(root, "apps/agentbox/src/host/artifacts.json"), manifest)
}

const targets = values.targets.split(",").filter(Boolean)
await $`bun run scripts/compile.ts ${values["skip-web"] ? ["--skip-web"] : []} ${targets.flatMap((t) => ["--target", t])}`.cwd(
  join(root, "apps/agentbox"),
)
for (const t of targets)
  await copyFile(join(root, `apps/agentbox/dist/agentbox-${t}`), join(out, `agentbox-${t}`))

const install = (await readFile(join(root, "scripts/install.sh"), "utf8")).replace(
  /^AGENTBOX_VERSION=.*$/m,
  `AGENTBOX_VERSION="\${AGENTBOX_VERSION:-${pkg.version}}"`,
)
await writeFile(join(out, "install.sh"), install, { mode: 0o755 })

const files = (await readdir(out)).filter((f) => f !== "SHA256SUMS" && !f.endsWith(".json")).sort()
const sums = await Promise.all(files.map(async (f) => `${await sha256(join(out, f))}  ${f}`))
await writeFile(join(out, "SHA256SUMS"), `${sums.join("\n")}\n`)
console.log(`release ${pkg.version} in ${out}:\n  ${files.join("\n  ")}`)
