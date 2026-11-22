import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { HermesFiles, quoteEnv } from "./config"

const GH_REF = ["Bearer $", "{AGENTBOX_GH_TOKEN}"].join("")

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "hermes-files-"))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

test("MCP servers merge into config.yaml without losing comments", async () => {
  await writeFile(join(dir, "config.yaml"), "# my comment\nmodel:\n  default: x\n")
  const f = new HermesFiles(dir)
  await f.setMcpServer("github", {
    url: "https://api.githubcopilot.com/mcp/",
    headers: { Authorization: "Bearer ${AGENTBOX_GH_TOKEN}" },
    enabled: true,
  })
  const text = await readFile(join(dir, "config.yaml"), "utf8")
  expect(text).toContain("# my comment")
  expect(f.mcpServers().github?.headers).toEqual({ Authorization: GH_REF })
  await f.removeMcpServer("github")
  expect(f.mcpServers().github).toBeUndefined()
  expect((f.readConfig().model as { default: string }).default).toBe("x")
})

test(".env values are replaced in place and the file stays 0600", async () => {
  await writeFile(join(dir, ".env"), "KEEP=1\nTOKEN=old\n")
  const f = new HermesFiles(dir)
  await f.setEnv({ TOKEN: "new value", OTHER: "a$b" })
  const text = await readFile(join(dir, ".env"), "utf8")
  expect(text).toBe('KEEP=1\nTOKEN="new value"\nOTHER="a\\$b"\n')
  expect((await stat(join(dir, ".env"))).mode & 0o777).toBe(0o600)
  expect(quoteEnv("ghp_abc123")).toBe("ghp_abc123")
})
