import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { validateCatalog } from "../../../scripts/catalog-validate"
import { Bundle, CatalogItem } from "./catalog"

const item = {
  id: "mcp.example",
  kind: "mcp",
  name: "Example",
  summary: "An example server.",
  source: ["curated"],
  tier: "T0",
  licence: "MIT",
  install: { mcp: { transport: "http", url: "https://mcp.example.com/mcp" } },
  targets: ["hermes"],
  pinned_version: null,
}

describe("CatalogItem", () => {
  test("accepts a minimal hosted MCP and fills defaults", () => {
    const parsed = CatalogItem.parse(item)
    expect(parsed.auth).toEqual({ type: "none" })
    expect(parsed.env).toEqual([])
    expect(parsed.roles).toEqual([])
  })

  test("rejects an id whose prefix does not match the kind", () => {
    expect(CatalogItem.safeParse({ ...item, id: "skill.example" }).success).toBe(false)
  })

  test("rejects an install variant of another kind", () => {
    const install = { cli: { plan: "cli.example" } }
    expect(CatalogItem.safeParse({ ...item, install }).success).toBe(false)
  })

  test("derived auth needs `from`", () => {
    expect(CatalogItem.safeParse({ ...item, auth: { type: "derived" } }).success).toBe(false)
    const ok = { ...item, auth: { type: "derived", from: "cli.gh" } }
    expect(CatalogItem.safeParse(ok).success).toBe(true)
  })

  test("git skills need repo and sha", () => {
    const skill = {
      ...item,
      id: "skill.example",
      kind: "skill",
      install: { skill: { source: "git", path: "skills/example" } },
    }
    expect(CatalogItem.safeParse(skill).success).toBe(false)
  })
})

describe("Bundle", () => {
  test("suggested crons must stay disabled", () => {
    const bundle = {
      id: "x",
      name: "X",
      description: "d",
      roles: [],
      skills: [],
      mcps: [],
      clis: [],
      soul_role: "orchestrator",
      first_task: "t",
      first_task_alternatives: ["a", "b", "c"],
      suggested_crons: [
        { name: "c", schedule: "0 8 * * *", prompt: "p", deliver: "home", enabled: true },
      ],
    }
    expect(Bundle.safeParse(bundle).success).toBe(false)
  })
})

test("the curated catalog in catalog/ is valid", async () => {
  const result = await validateCatalog(join(import.meta.dir, "../../.."))
  expect(result.errors).toEqual([])
  expect(result.items.length).toBeGreaterThanOrEqual(60)
  expect(result.bundles.map((b) => b.id).sort()).toEqual([
    "base",
    "data",
    "designer-marketer",
    "developer",
    "devops",
    "founder-ops",
    "manager",
    "support",
  ])
})
