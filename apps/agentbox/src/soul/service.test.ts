import { expect, test } from "bun:test"
import { SOUL_GENERATED_END, SOUL_GENERATED_START } from "@workspace/contract"
import { CATALOG } from "../catalog/service"
import { compose, generatedBlock, refreshGenerated, render } from "./service"

const values = {
  "agent.name": "Hermes",
  "user.name": "Ada",
  "user.language": "English",
  "user.timezone": "Europe/Berlin",
  "user.about": "",
  "user.roles": "developer",
  "box.hostname": "box",
  "paseo.accounts": "work",
  "paseo.default": "work",
  "repos.list": "acme/api",
  "browser.sites": "github.com",
  "clis.authed": "gh (ada)",
  "git.name": "Ada",
  "git.email": "ada@example.com",
  "mcps.list": "Paseo",
  "delivery.home": "none",
  "delivery.targets": "local",
} as const

test("render fills placeholders and turns empty values into 'none'", () => {
  expect(render("{{user.name}} / {{user.about}}", values)).toBe("Ada / none")
})

test("compose is deterministic and leaves no placeholders", () => {
  const a = compose(CATALOG.soul, "orchestrator", values)
  expect(a).toBe(compose(CATALOG.soul, "orchestrator", values))
  expect(a).not.toMatch(/\{\{/)
  expect(a).toContain(SOUL_GENERATED_START)
  expect(a).toContain("acme/api")
})

test("regeneration rewrites only the generated block", () => {
  const original = compose(CATALOG.soul, "developer", values)
  const edited = original.replace("# Who you are", "# Who you are\nMy own note.")
  const next = refreshGenerated(
    edited,
    generatedBlock(CATALOG.soul, { ...values, "repos.list": "acme/web" }),
  )
  expect(next).toContain("My own note.")
  expect(next).toContain("acme/web")
  expect(next).not.toContain("acme/api")
  expect(next.split(SOUL_GENERATED_END)).toHaveLength(2)
})

test("regenerate takes over Hermes' stock SOUL and keeps it as a backup", async () => {
  const { mkdtemp, readFile, writeFile } = await import("node:fs/promises")
  const { tmpdir } = await import("node:os")
  const { join } = await import("node:path")
  const { SoulService, SOUL_MARKER } = await import("./service")
  const dir = await mkdtemp(join(tmpdir(), "soul-"))
  await writeFile(join(dir, "SOUL.md"), "You are Hermes Agent, built by Nous Research.\n")
  const soul = new SoulService({
    hermesHome: dir,
    templates: CATALOG.soul,
    values: async () => values,
    role: () => "orchestrator",
  })
  const { markdown } = await soul.regenerate(false)
  expect(markdown.startsWith(SOUL_MARKER)).toBe(true)
  expect(markdown).toContain("Ada")
  expect(await readFile(join(dir, "SOUL.md.hermes-default"), "utf8")).toContain("Nous Research")
  // A second regenerate keeps user edits outside the generated block.
  await soul.save(markdown.replace("# Who you are", "# Who you are\nMy note."))
  expect((await soul.regenerate(false)).markdown).toContain("My note.")
})
