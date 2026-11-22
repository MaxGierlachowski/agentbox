// Builds the agentbox binary: Next.js static export embedded as assets, the curated catalog
// embedded as JSON, and iroh-fetch's native addon for the target platform (for `agentbox connect`).
//
//   bun run compile                       host platform
//   bun run compile --target linux-x64 --target linux-arm64 --target darwin-arm64
//   bun run compile --skip-web            reuse an existing apps/web/out
import { existsSync, readFileSync } from "node:fs"
import { cp, mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { parseArgs } from "node:util"
import { $ } from "bun"

const { values } = parseArgs({
  options: {
    target: { type: "string", multiple: true },
    "skip-web": { type: "boolean", default: false },
  },
})

const root = join(import.meta.dir, "..")
const repo = join(root, "../..")
const webDir = join(root, "../web")
const stage = join(root, ".build")
const dist = join(root, "dist")
const IROH_FETCH_VERSION = "0.6.4"

/** Bun compile target → iroh-fetch prebuild package suffix. */
const ADDON_TAG: Record<string, string> = {
  "linux-x64": "linux-x64-gnu",
  "linux-arm64": "linux-arm64-gnu",
  "darwin-arm64": "darwin-arm64",
  "darwin-x64": "darwin-x64",
  "windows-x64": "win32-x64-msvc",
}

const hostTarget = () => {
  const os = process.platform === "win32" ? "windows" : process.platform
  return `${os}-${process.arch}`
}

/** Downloads (npm pack) the target's prebuilt addon once; returns the .node path. */
async function irohAddon(target: string) {
  const tag = ADDON_TAG[target]
  if (!tag) throw new Error(`No iroh-fetch addon for target ${target}`)
  const dir = join(stage, "..", ".cache", "iroh-addons", `${tag}-${IROH_FETCH_VERSION}`)
  const file = join(dir, "package", `iroh-fetch.${tag}.node`)
  if (!existsSync(file)) {
    await mkdir(dir, { recursive: true })
    const tgz = (await $`npm pack iroh-fetch-${tag}@${IROH_FETCH_VERSION} --silent`.cwd(dir).text()).trim()
    await $`tar xzf ${tgz}`.cwd(dir)
  }
  return file
}

if (!values["skip-web"]) {
  await $`bun run build`.cwd(webDir).env({ ...process.env, NEXT_TELEMETRY_DISABLED: "1" })
}
if (!(await Bun.file(join(webDir, "out/index.html")).exists())) {
  throw new Error("apps/web/out is missing, run without --skip-web")
}
await $`bun ${join(repo, "scripts/catalog-build.ts")}`

await rm(stage, { recursive: true, force: true })
await mkdir(stage, { recursive: true })
// Assets keep paths relative to the working directory: web/ ends up at /$bunfs/root/web.
await cp(join(webDir, "out"), join(stage, "web"), { recursive: true })
await mkdir(dist, { recursive: true })

const targets = values.target?.length ? values.target : [hostTarget()]
for (const target of targets) {
  const addon = await irohAddon(target)
  const outfile = join(dist, values.target?.length ? `agentbox-${target}` : "agentbox")
  const cwd = process.cwd()
  process.chdir(stage)
  const result = await Bun.build({
    entrypoints: [join(root, "src/main.ts")],
    compile: {
      target: `bun-${target}` as Bun.Build.CompileTarget,
      outfile,
      assets: ["web"],
      autoloadDotenv: false,
      autoloadBunfig: false,
    },
    minify: true,
    sourcemap: "linked",
    bytecode: true,
    format: "esm",
    plugins: [
      {
        name: "iroh-native-static",
        setup(build) {
          build.onLoad({ filter: /iroh-fetch[\\/]src[\\/]native\.js$/ }, (args) => {
            const src = readFileSync(args.path, "utf8")
            const out = src.replace(
              "const backend = wrap(require(id));",
              `const backend = wrap(require(${JSON.stringify(addon)}));`,
            )
            if (out === src) throw new Error("iroh-fetch native.js changed; update the patch in compile.ts")
            return { contents: out, loader: "js" }
          })
        },
      },
    ],
  })
  process.chdir(cwd)
  if (!result.success) {
    for (const l of result.logs) console.error(l)
    throw new Error(`build failed for ${target}`)
  }
  console.log(`built ${outfile}`)
}

await rm(stage, { recursive: true, force: true })
