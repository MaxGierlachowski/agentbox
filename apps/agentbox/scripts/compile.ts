// Builds the agentbox binary: Next.js static export embedded via `--asset`.
//
//   bun run compile                       host platform
//   bun run compile --target linux-x64 --target linux-arm64
//   bun run compile --skip-web            reuse an existing apps/web/out
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
const webDir = join(root, "../web")
const stage = join(root, ".build")
const dist = join(root, "dist")

if (!values["skip-web"]) {
  await $`bun run build`.cwd(webDir).env({ ...process.env, NEXT_TELEMETRY_DISABLED: "1" })
}
if (!(await Bun.file(join(webDir, "out/index.html")).exists())) {
  throw new Error("apps/web/out is missing, run without --skip-web")
}

await rm(stage, { recursive: true, force: true })
await mkdir(stage, { recursive: true })
// `--asset` keeps paths relative to the working directory: web/ ends up at /$bunfs/root/web.
await cp(join(webDir, "out"), join(stage, "web"), { recursive: true })
await mkdir(dist, { recursive: true })

// dockerode -> docker-modem -> ssh2 optionally requires these native modules inside try/catch.
// We only talk to Docker over the local socket, so they stay out of the binary (they also crash
// compiled Bun binaries when present).
const NATIVE_EXTERNALS = ["--external", "cpu-features", "--external", "*.node"]

const targets = values.target?.length ? values.target : [null]
for (const target of targets) {
  const name = target ? `agentbox-${target}` : "agentbox"
  const outfile = join(dist, name)
  const targetFlag = target ? [`--target=bun-${target}`] : []
  await $`bun build --compile --minify --sourcemap --bytecode --format=esm ${targetFlag} --no-compile-autoload-dotenv --no-compile-autoload-bunfig ${NATIVE_EXTERNALS} --asset web ../src/main.ts --outfile ${outfile}`.cwd(
    stage,
  )
  console.log(`built ${outfile}`)
}

await rm(stage, { recursive: true, force: true })
