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
