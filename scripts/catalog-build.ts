// Bundles catalog/ into apps/agentbox/src/catalog/catalog.gen.json, which the compiled binary
// embeds: items, bundles, agentbox skill files and SOUL templates. Validates first.
//
//   bun scripts/catalog-build.ts
import { readdir, readFile } from "node:fs/promises"
import { join, relative } from "node:path"
import { Bundle, CatalogItemsFile } from "@workspace/contract"
import { parse } from "yaml"

const root = join(import.meta.dir, "..")
const catalog = join(root, "catalog")
const out = join(root, "apps/agentbox/src/catalog/catalog.gen.json")

async function yamlFiles(dir: string) {
  return (await readdir(dir)).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml")).sort()
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) files.push(...(await walk(p)))
    else files.push(p)
  }
  return files.sort()
}

const items = []
for (const f of await yamlFiles(join(catalog, "items")))
  items.push(
    ...CatalogItemsFile.parse(parse(await readFile(join(catalog, "items", f), "utf8"))).items,
  )

const bundles = []
for (const f of await yamlFiles(join(catalog, "bundles")))
  bundles.push(Bundle.parse(parse(await readFile(join(catalog, "bundles", f), "utf8"))))

/** catalog/skills/<name>/** → { "catalog/skills/<name>": { "SKILL.md": "…" } } */
const skills: Record<string, Record<string, string>> = {}
for (const file of await walk(join(catalog, "skills"))) {
  const rel = relative(root, file)
  const [, , name, ...rest] = rel.split("/")
  const key = `catalog/skills/${name}`
  skills[key] ??= {}
  ;(skills[key] as Record<string, string>)[rest.join("/")] = await readFile(file, "utf8")
}

const soul: Record<string, string> = {}
for (const f of (await readdir(join(catalog, "soul"))).filter(
  (f) => f.endsWith(".md") && f !== "README.md",
))
  soul[f.replace(/\.md$/, "")] = await readFile(join(catalog, "soul", f), "utf8")

await Bun.write(out, `${JSON.stringify({ items, bundles, skills, soul })}\n`)
console.log(
  `catalog: ${items.length} items, ${bundles.length} bundles, ${Object.keys(skills).length} skills, ${Object.keys(soul).length} SOUL templates → ${relative(root, out)}`,
)
