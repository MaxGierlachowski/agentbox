// Validates the curated catalog in catalog/:
//
//   items/*.yaml     CatalogItemsFile (zod), unique ids, resolvable requires/auth.from, env usage
//   bundles/*.yaml   Bundle (zod), file name = id, every referenced id exists with the right kind
//   skills/*/        agentskills frontmatter, one catalog item per skill, known API procedures
//   soul/*.md        required templates, placeholders from SoulPlaceholder and documented
//
// `bun scripts/catalog-validate.ts [--hermes-repo <path>]` (exit 1 on errors). With
// --hermes-repo, every hermes-builtin skill path is checked against the pinned Hermes tag.
import { existsSync } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import { basename, join } from "node:path"
import { parse } from "yaml"
import {
  Bundle,
  type CatalogItem,
  CatalogItemsFile,
  Role,
  SOUL_GENERATED_END,
  SOUL_GENERATED_START,
  SoulPlaceholder,
  SoulRole,
} from "../packages/contract/src/catalog"

/** Procedures the agentbox skills may call through `agentbox api <procedure>`. */
export const AGENTBOX_API_PROCEDURES = [
  "system.info",
  "system.doctor",
  "onboarding.get",
  "catalog.search",
  "catalog.get",
  "toolkit.apply",
  "runs.get",
  "clis.status",
  "clis.authStart",
  "ssh.status",
  "ssh.generate",
  "ssh.register",
  "repos.list",
  "repos.clone",
  "profiles.list",
  "profiles.create",
  "browser.status",
  "browser.setLock",
  "devices.list",
  "devices.pairStart",
] as const

export interface CatalogValidation {
  errors: string[]
  items: CatalogItem[]
  bundles: Bundle[]
  skills: string[]
}

/** Structural so this script does not need zod itself (it is a dependency of the contract). */
interface Issues {
  issues: { path: readonly PropertyKey[]; message: string }[]
}
const zodIssues = (file: string, error: Issues) =>
  error.issues.map((i) => `${file}: ${i.path.map(String).join(".") || "(root)"}: ${i.message}`)

const yamlFiles = async (dir: string) =>
  existsSync(dir)
    ? (await readdir(dir)).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml")).sort()
    : []

/** Splits `---\n<yaml>\n---\n<body>`; returns null when there is no frontmatter. */
export const splitFrontmatter = (text: string) => {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  return m ? { frontmatter: m[1] ?? "", body: m[2] ?? "" } : null
}

const placeholdersIn = (text: string) =>
  [...text.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)].map((m) => m[1] ?? "")

/** `${NAME}` references in install values. */
const refsIn = (value: unknown): string[] => {
  if (typeof value === "string") return [...value.matchAll(/\$\{([^}]+)\}/g)].map((m) => m[1] ?? "")
  if (Array.isArray(value)) return value.flatMap(refsIn)
  if (value && typeof value === "object") return Object.values(value).flatMap(refsIn)
  return []
}

const BAD_LICENCES = new Set(["", "unknown", "todo", "tbd", "none", "noassertion"])

export async function validateCatalog(
  root: string,
  opts: { hermesRepo?: string } = {},
): Promise<CatalogValidation> {
  const errors: string[] = []
  const catalog = join(root, "catalog")

  // ── items ──────────────────────────────────────────────────────────────────────────
  const items: CatalogItem[] = []
  const itemFiles = await yamlFiles(join(catalog, "items"))
  if (itemFiles.length === 0) errors.push("catalog/items: no YAML files")
  for (const f of itemFiles) {
    const rel = `catalog/items/${f}`
    let raw: unknown
    try {
      raw = parse(await readFile(join(catalog, "items", f), "utf8"))
    } catch (e) {
      errors.push(`${rel}: invalid YAML: ${(e as Error).message}`)
      continue
    }
    const parsed = CatalogItemsFile.safeParse(raw)
    if (!parsed.success) errors.push(...zodIssues(rel, parsed.error))
    else items.push(...parsed.data.items)
  }

  const byId = new Map<string, CatalogItem>()
  for (const item of items) {
    if (byId.has(item.id)) errors.push(`${item.id}: duplicate id`)
    byId.set(item.id, item)
  }

  for (const item of items) {
    const at = item.id
    if (BAD_LICENCES.has(item.licence.trim().toLowerCase())) errors.push(`${at}: licence not set`)
    for (const req of item.requires) {
      if (!byId.has(req)) errors.push(`${at}: requires unknown item ${req}`)
      if (req === item.id) errors.push(`${at}: requires itself`)
    }
    if (item.auth.from && !byId.has(item.auth.from)) {
      errors.push(`${at}: auth.from unknown item ${item.auth.from}`)
    }
    if ("cli" in item.install && item.install.cli.plan !== item.id) {
      errors.push(`${at}: install.cli.plan must equal the item id`)
    }
    if ("skill" in item.install) {
      const s = item.install.skill
      if (s.source === "agentbox" && !existsSync(join(root, s.path, "SKILL.md"))) {
        errors.push(`${at}: ${s.path}/SKILL.md does not exist`)
      }
      if (basename(s.path) !== item.id.slice("skill.".length)) {
        errors.push(`${at}: id must be skill.<folder name> (${basename(s.path)})`)
      }
    }
    // Every ${…} must be an env entry or the token of a CLI this item derives from or requires.
    const envNames = new Set(item.env.map((e) => e.name))
    const refs = refsIn(item.install)
    for (const ref of refs) {
      const token = /^([a-z0-9-]+)\.token$/.exec(ref)
      if (token) {
        const cli = `cli.${token[1]}`
        if (item.auth.from !== cli && !item.requires.includes(cli)) {
          errors.push(`${at}: \${${ref}} needs auth.from or requires ${cli}`)
        }
      } else if (!envNames.has(ref)) {
        errors.push(`${at}: \${${ref}} is not declared in env`)
      }
    }
    for (const name of envNames) {
      if (!refs.includes(name)) errors.push(`${at}: env ${name} is never used in install`)
    }
    if (item.env.some((e) => e.secret) && item.auth.type === "none") {
      errors.push(`${at}: has secret env but auth.type none`)
    }
  }

  // ── bundles ────────────────────────────────────────────────────────────────────────
  const bundles: Bundle[] = []
  for (const f of await yamlFiles(join(catalog, "bundles"))) {
    const rel = `catalog/bundles/${f}`
    let raw: unknown
    try {
      raw = parse(await readFile(join(catalog, "bundles", f), "utf8"))
    } catch (e) {
      errors.push(`${rel}: invalid YAML: ${(e as Error).message}`)
      continue
    }
    const parsed = Bundle.safeParse(raw)
    if (!parsed.success) {
      errors.push(...zodIssues(rel, parsed.error))
      continue
    }
    const b = parsed.data
    bundles.push(b)
    if (f.replace(/\.ya?ml$/, "") !== b.id) errors.push(`${rel}: file name must be ${b.id}.yaml`)
    const lists = { skills: "skill", mcps: "mcp", clis: "cli" } as const
    const listed = new Set<string>()
    for (const [key, kind] of Object.entries(lists) as [keyof typeof lists, string][]) {
      const seen = new Set<string>()
      for (const id of b[key]) {
        if (seen.has(id)) errors.push(`${rel}: ${key} lists ${id} twice`)
        seen.add(id)
        listed.add(id)
        const item = byId.get(id)
        if (!item) errors.push(`${rel}: ${key} references unknown item ${id}`)
        else if (item.kind !== kind) errors.push(`${rel}: ${id} is a ${item.kind}, not a ${kind}`)
      }
    }
    for (const id of b.opt_in) {
      if (!listed.has(id)) errors.push(`${rel}: opt_in ${id} is not in skills, mcps or clis`)
    }
    for (const cron of b.suggested_crons) {
      for (const id of cron.skills) {
        if (byId.get(id)?.kind !== "skill") errors.push(`${rel}: cron ${cron.name}: unknown ${id}`)
      }
    }
  }
  const bundleIds = new Set<string>()
  for (const b of bundles) {
    if (bundleIds.has(b.id)) errors.push(`bundle ${b.id}: duplicate id`)
    bundleIds.add(b.id)
  }
  const base = bundles.find((b) => b.id === "base")
  if (!base) errors.push("catalog/bundles: base.yaml is missing")
  else if (base.roles.length > 0) errors.push("bundle base: roles must be empty (always included)")
  for (const role of Role.options.filter((r) => r !== "custom")) {
    if (!bundles.some((b) => b.roles.includes(role))) errors.push(`no bundle for role ${role}`)
  }

  // ── agentbox skills ────────────────────────────────────────────────────────────────
  const skills: string[] = []
  const skillsDir = join(catalog, "skills")
  const known = new Set<string>(AGENTBOX_API_PROCEDURES)
  const dirs = existsSync(skillsDir)
    ? (await readdir(skillsDir, { withFileTypes: true })).filter((d) => d.isDirectory())
    : []
  for (const dir of dirs.map((d) => d.name).sort()) {
    const rel = `catalog/skills/${dir}/SKILL.md`
    const file = join(skillsDir, dir, "SKILL.md")
    if (!existsSync(file)) {
      errors.push(`${rel}: missing`)
      continue
    }
    skills.push(dir)
    const split = splitFrontmatter(await readFile(file, "utf8"))
    if (!split) {
      errors.push(`${rel}: no YAML frontmatter`)
      continue
    }
    let fm: Record<string, unknown>
    try {
      fm = (parse(split.frontmatter) ?? {}) as Record<string, unknown>
    } catch (e) {
      errors.push(`${rel}: invalid frontmatter: ${(e as Error).message}`)
      continue
    }
    if (fm.name !== dir) errors.push(`${rel}: name must equal the folder name ${dir}`)
    if (
      typeof fm.name !== "string" ||
      !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(fm.name) ||
      fm.name.length > 64
    ) {
      errors.push(`${rel}: name must be 1-64 lowercase letters, digits and single hyphens`)
    }
    if (typeof fm.description !== "string" || !fm.description.trim()) {
      errors.push(`${rel}: description is required`)
    } else if (fm.description.length > 1024) {
      errors.push(`${rel}: description is longer than 1024 characters`)
    }
    if (!split.body.trim()) errors.push(`${rel}: no instructions after the frontmatter`)
    for (const m of split.body.matchAll(/agentbox api ([A-Za-z.]+)/g)) {
      const proc = (m[1] ?? "").replace(/\.$/, "")
      if (!known.has(proc) && proc !== "<procedure>")
        errors.push(`${rel}: unknown procedure ${proc}`)
    }
    for (const m of split.body.matchAll(/`([a-z]+\.[A-Za-z]+) (\{[^`]*\})`/g)) {
      if (!known.has(m[1] ?? "")) errors.push(`${rel}: unknown procedure ${m[1]}`)
    }
    const item = byId.get(`skill.${dir}`)
    if (!item || !("skill" in item.install) || item.install.skill.source !== "agentbox") {
      errors.push(`${rel}: needs a catalog item skill.${dir} with install.skill.source agentbox`)
    }
  }

  // ── SOUL templates ─────────────────────────────────────────────────────────────────
  const soulDir = join(catalog, "soul")
  const required = ["soul-base.md", "box-facts.md", ...SoulRole.options.map((r) => `role-${r}.md`)]
  for (const f of required) {
    if (!existsSync(join(soulDir, f))) errors.push(`catalog/soul/${f}: missing`)
  }
  const allowed = new Set<string>(SoulPlaceholder.options)
  const readmePath = join(soulDir, "README.md")
  const readme = existsSync(readmePath) ? await readFile(readmePath, "utf8") : ""
  if (!readme) errors.push("catalog/soul/README.md: missing")
  const documented = new Set(placeholdersIn(readme))
  for (const p of allowed) {
    if (readme && !documented.has(p)) errors.push(`catalog/soul/README.md: {{${p}}} undocumented`)
  }
  const soulFiles = existsSync(soulDir)
    ? (await readdir(soulDir)).filter((f) => f.endsWith(".md") && f !== "README.md")
    : []
  for (const f of soulFiles) {
    const text = await readFile(join(soulDir, f), "utf8")
    for (const p of placeholdersIn(text)) {
      if (!allowed.has(p)) errors.push(`catalog/soul/${f}: unknown placeholder {{${p}}}`)
    }
    const starts = text.split(SOUL_GENERATED_START).length - 1
    const ends = text.split(SOUL_GENERATED_END).length - 1
    if (starts !== ends) errors.push(`catalog/soul/${f}: unbalanced agentbox:generated markers`)
  }
  const boxFacts = soulFiles.includes("box-facts.md")
    ? await readFile(join(soulDir, "box-facts.md"), "utf8")
    : ""
  if (boxFacts && !boxFacts.trimStart().startsWith(SOUL_GENERATED_START)) {
    errors.push("catalog/soul/box-facts.md: must be one generated block")
  }

  // ── Hermes built-in skills against the pinned tag (optional) ──────────────────────────
  if (opts.hermesRepo) {
    for (const item of items) {
      if (!("skill" in item.install) || item.install.skill.source !== "hermes-builtin") continue
      const tag = item.pinned_version
      if (!tag) {
        errors.push(`${item.id}: hermes-builtin skills need pinned_version (the Hermes tag)`)
        continue
      }
      const spec = `${tag}:${item.install.skill.path}/SKILL.md`
      const proc = Bun.spawnSync(["git", "-C", opts.hermesRepo, "show", spec])
      if (proc.exitCode !== 0) {
        errors.push(`${item.id}: ${spec} not found in ${opts.hermesRepo}`)
        continue
      }
      const split = splitFrontmatter(proc.stdout.toString())
      const fm = split ? (parse(split.frontmatter) as Record<string, unknown>) : {}
      if (fm.name !== item.id.slice("skill.".length)) {
        errors.push(`${item.id}: upstream skill is named ${String(fm.name)}`)
      }
    }
  }

  return { errors: [...new Set(errors)], items, bundles, skills }
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const i = args.indexOf("--hermes-repo")
  const hermesRepo = i >= 0 ? args[i + 1] : process.env.HERMES_REPO
  const root = join(import.meta.dir, "..")
  const { errors, items, bundles, skills } = await validateCatalog(root, { hermesRepo })
  const count = (kind: string) => items.filter((it) => it.kind === kind).length
  console.log(
    `catalog: ${items.length} items (${count("skill")} skills, ${count("mcp")} MCP servers, ` +
      `${count("cli")} CLIs), ${bundles.length} bundles, ${skills.length} agentbox skills` +
      (hermesRepo ? `, Hermes paths checked in ${hermesRepo}` : ""),
  )
  if (errors.length > 0) {
    for (const e of errors) console.error(`  ✗ ${e}`)
    console.error(`${errors.length} error(s)`)
    process.exit(1)
  }
  console.log("ok")
}
