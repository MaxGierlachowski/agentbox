import { expect, test } from "bun:test"
import { openDb } from "@workspace/infra/db"
import { Kv } from "../kv"
import { CatalogService, registryItem, textScore } from "./service"

const catalog = () => new CatalogService(new Kv(openDb(":memory:")), () => new Set(["skill.pdf"]))

test("search ranks name matches first and marks installed items", async () => {
  const c = catalog()
  const hits = await c.search({ q: "github", kind: "mcp", limit: 5 })
  expect(hits[0]?.id).toBe("mcp.github")
  const pdf = await c.search({ q: "pdf", kind: "skill", limit: 5 })
  expect(pdf.find((h) => h.id === "skill.pdf")?.installed).toBe(true)
  expect(
    textScore({ id: "mcp.x", name: "Linear", summary: "Issues", tags: [] }, "lin"),
  ).toBeGreaterThan(0)
  expect(textScore({ id: "mcp.x", name: "Linear", summary: "Issues", tags: [] }, "zzz")).toBe(0)
})

test("suggest merges base and role bundles, leaves opt-in items unselected", () => {
  const s = catalog().suggest({ roles: ["developer"], refine: false })
  expect(s.selection.skills).toContain("skill.agentbox-browser")
  expect(s.selection.mcps).toContain("mcp.github")
  expect(s.selection.mcps).not.toContain("mcp.playwright")
  expect(s.items.find((i) => i.id === "mcp.playwright")?.reason).toMatch(/^Optional/)
  expect(s.firstTask.length).toBeGreaterThan(10)
  expect(s.firstTaskAlternatives).toHaveLength(3)
})

test("every bundle id resolves and requirements come first", () => {
  const c = catalog()
  for (const b of c.data.bundles)
    for (const id of [...b.skills, ...b.mcps, ...b.clis]) expect(c.item(id)).not.toBeNull()
  const uvx = c.data.items.find((i) => i.requires.includes("cli.uv"))
  if (uvx) expect(c.withRequirements([uvx.id])).toEqual(["cli.uv", uvx.id])
})

test("registry entries map to installable items", () => {
  const remote = registryItem({
    name: "io.github.acme/notes",
    description: "Notes",
    remotes: [{ type: "streamable-http", url: "https://mcp.acme.dev/mcp" }],
  })
  expect(remote?.install).toEqual({ mcp: { transport: "http", url: "https://mcp.acme.dev/mcp" } })
  const npm = registryItem({
    name: "io.github.acme/cli",
    packages: [{ registryType: "npm", identifier: "@acme/mcp", version: "1.2.3" }],
  })
  expect(npm?.install).toEqual({
    mcp: { transport: "stdio", command: "npx", args: ["-y", "@acme/mcp@1.2.3"] },
  })
  expect(
    registryItem({ name: "x", packages: [{ registryType: "npm", identifier: "y" }] }),
  ).toBeNull()
})
