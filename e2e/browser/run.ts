// End-to-end check of the browser capability, the way an agent uses it inside the VM:
//
// 1. build an Ubuntu 24.04 image with the browser Dockerfile fragment (as the image provider will)
// 2. run agentbox's verify check (browser-check.mjs) as the unprivileged image user
// 3. start a dev server inside the container on localhost:3000
// 4. connect over MCP stdio exactly like Claude Code would, navigate, read the console, take a
//    screenshot that comes back as an image
// 5. use the agentbox-screenshot fallback CLI
//
// Screenshots land in --out (default e2e/browser/.out) so a human or an AI can look at them.
//
//   bun run --cwd e2e browser [--out dir] [--keep]
import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { parseArgs } from "node:util"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import {
  BROWSER_CONTEXT_DIR,
  browserBuildContext,
  browserDockerfile,
  browserVerifyCommand,
  parseBrowserCheck,
} from "@workspace/providers/browser"
import { $ } from "bun"

const { values } = parseArgs({
  options: {
    out: { type: "string", default: join(import.meta.dir, ".out") },
    keep: { type: "boolean", default: false },
    platform: { type: "string" },
  },
})
const out = values.out
const image = "agentbox/browser-e2e:local"
const container = `agentbox-browser-e2e-${process.pid}`
const failures: string[] = []
const step = (msg: string) => console.log(`\n\x1b[1m▶ ${msg}\x1b[0m`)
const expectOk = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? "\x1b[32mOK\x1b[0m" : "\x1b[31mFAIL\x1b[0m"} ${msg}`)
  if (!ok) failures.push(msg)
}

await rm(out, { recursive: true, force: true })
await mkdir(out, { recursive: true })

/** Follows the snapshot link in a tool result and reads the file, as an agent would. */
async function readSnapshot(toolText: string) {
  const path = toolText.match(/\[Snapshot\]\(([^)]+\.yml)\)/)?.[1]
  if (!path) return toolText
  return $`docker exec ${container} cat ${path}`.nothrow().text()
}

// --- 1. image ------------------------------------------------------------------------------
step("build Ubuntu 24.04 image with the browser fragment")
const ctx = join(out, "context")
await mkdir(join(ctx, BROWSER_CONTEXT_DIR), { recursive: true })
for (const [name, content] of Object.entries(browserBuildContext())) {
  await writeFile(join(ctx, BROWSER_CONTEXT_DIR, name), content)
}
const dockerfile = [
  "# syntax=docker/dockerfile:1",
  "FROM ubuntu:24.04",
  "RUN userdel -r ubuntu && groupadd -g 10001 agent && useradd -m -u 10001 -g 10001 -s /bin/bash agent",
  "RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \\",
  " && rm -rf /var/lib/apt/lists/*",
  "ENV MISE_DATA_DIR=/mise MISE_CONFIG_DIR=/mise MISE_CACHE_DIR=/mise/cache MISE_YES=1 PATH=/mise/shims:$PATH",
  "RUN curl -fsSL https://mise.run | MISE_INSTALL_PATH=/usr/local/bin/mise sh && mise use -g node@24",
  ...browserDockerfile(),
  "USER agent",
  "WORKDIR /home/agent",
].join("\n")
await writeFile(join(ctx, "Dockerfile"), dockerfile)
const platform = values.platform ? ["--platform", values.platform] : []
await $`docker buildx build ${platform} --load -t ${image} ${ctx}`

// --- 2. verify check ------------------------------------------------------------------------
step("agentbox verify: browser-check.mjs as user agent")
await $`docker run -d --name ${container} --shm-size 1g ${image} sleep infinity`.quiet()
try {
  const check = await $`docker exec ${container} ${browserVerifyCommand}`.nothrow().text()
  const result = parseBrowserCheck(check)
  for (const c of result.checks) expectOk(c.status === "ok", `${c.id}: ${c.message}`)
  if (result.screenshot)
    await $`docker cp ${container}:${result.screenshot} ${join(out, "1-browser-check.png")}`.quiet()

  // --- 3. dev server inside the container ----------------------------------------------------
  step("start a dev server on localhost:3000 inside the container")
  const app = `require("http").createServer((q,s)=>{s.setHeader("content-type","text/html; charset=utf-8");s.end(\`<!doctype html><title>Todo</title><body style="font-family:sans-serif;padding:32px"><h1>Todos</h1><ul><li>Write spec ✅</li><li>Ship agentbox 🚀</li></ul><button id=add onclick="document.querySelector('ul').insertAdjacentHTML('beforeend','<li>Added by the agent</li>')">Add</button><script>console.error("demo console error")</script></body>\`)}).listen(3000)`
  await $`docker exec -d ${container} node -e ${app}`.quiet()
  await Bun.sleep(500)

  // --- 4. MCP like a coding agent -------------------------------------------------------------
  step("MCP: connect to agentbox-browser-mcp over stdio, like Claude Code")
  const client = new Client({ name: "agentbox-e2e", version: "0.0.0" })
  await client.connect(
    new StdioClientTransport({
      command: "docker",
      args: ["exec", "-i", container, "agentbox-browser-mcp"],
    }),
  )
  const tools = (await client.listTools()).tools.map((t) => t.name)
  for (const tool of [
    "browser_navigate",
    "browser_take_screenshot",
    "browser_click",
    "browser_console_messages",
  ]) {
    expectOk(tools.includes(tool), `tool ${tool} available`)
  }

  const nav = await client.callTool({
    name: "browser_navigate",
    arguments: { url: "http://localhost:3000" },
  })
  const navText = JSON.stringify(nav.content)
  const snapshot = await readSnapshot(navText)
  expectOk(
    !nav.isError && navText.includes("Page Title: Todo"),
    "navigate to http://localhost:3000",
  )
  expectOk(snapshot.includes("Todos"), "read the page snapshot from the linked file")
  if (!snapshot.includes("Todos")) console.log(navText.slice(0, 2500))

  const ref = snapshot.match(/button "Add" \[ref=(e\d+)\]/)?.[1]
  if (ref) {
    const click = await client.callTool({
      name: "browser_click",
      arguments: { element: "Add button", target: ref },
    })
    const after = await client.callTool({ name: "browser_snapshot", arguments: {} })
    expectOk(
      !click.isError &&
        (await readSnapshot(JSON.stringify(after.content))).includes("Added by the agent"),
      "click updates the page",
    )
  } else {
    expectOk(false, "found the Add button in the accessibility snapshot")
  }

  const consoleMessages = await client.callTool({
    name: "browser_console_messages",
    arguments: { level: "error" },
  })
  expectOk(
    JSON.stringify(consoleMessages.content).includes("demo console error"),
    "console errors are visible to the agent",
  )

  const shot = await client.callTool({
    name: "browser_take_screenshot",
    arguments: { type: "png" },
  })
  const imageBlock = (shot.content as { type: string; data?: string; mimeType?: string }[]).find(
    (c) => c.type === "image",
  )
  expectOk(
    Boolean(imageBlock?.data),
    `screenshot returned to the model as ${imageBlock?.mimeType ?? "no image"}`,
  )
  if (imageBlock?.data)
    await writeFile(join(out, "2-mcp-screenshot.png"), Buffer.from(imageBlock.data, "base64"))
  await client.close()

  // --- 5. fallback CLI --------------------------------------------------------------------
  step("agentbox-screenshot fallback CLI")
  const cli =
    await $`docker exec ${container} agentbox-screenshot http://localhost:3000 /tmp/agentbox-browser/cli.png --full-page`
      .nothrow()
      .text()
  const summary = JSON.parse(cli) as { ok: boolean; status: number; consoleErrors: string[] }
  expectOk(
    summary.ok && summary.status === 200,
    `HTTP ${summary.status}, ${summary.consoleErrors.length} console error(s) reported`,
  )
  await $`docker cp ${container}:/tmp/agentbox-browser/cli.png ${join(out, "3-cli-screenshot.png")}`.quiet()
} finally {
  if (!values.keep) await $`docker rm -f ${container}`.quiet().nothrow()
}

console.log(`\nScreenshots: ${out}`)
if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`)
  process.exit(1)
}
console.log("\nAll browser checks passed")
