import { existsSync, readFileSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { hostname } from "node:os"
import { dirname, join } from "node:path"
import { SOUL_GENERATED_END, SOUL_GENERATED_START, type SoulPlaceholder } from "@workspace/contract"
import { writeFileAtomic } from "@workspace/infra/fs"
import type { CatalogData } from "../catalog/service"

export type SoulValues = Record<SoulPlaceholder, string>

/** Replaces `{{name}}` placeholders; unknown names stay visible so tests catch them. */
export function render(template: string, values: Partial<SoulValues>) {
  return template.replace(/\{\{\s*([a-z.]+)\s*\}\}/g, (m, key: string) => {
    const v = values[key as SoulPlaceholder]
    return v === undefined ? m : v.trim() || "none"
  })
}

/** First line of every SOUL agentbox composed; anything without it is not ours (e.g. Hermes' stock SOUL). */
export const SOUL_MARKER = "<!-- agentbox:soul -->"

/** base + box facts + role + optional purpose section. */
export function compose(
  templates: CatalogData["soul"],
  role: string,
  values: Partial<SoulValues>,
  purpose?: string,
) {
  const parts = [
    templates["soul-base"],
    templates["box-facts"],
    templates[`role-${role}`] ?? templates["role-orchestrator"],
  ]
  if (purpose) parts.push(`# Your purpose\n${purpose.trim()}`)
  return `${SOUL_MARKER}\n${parts
    .filter(Boolean)
    .map((p) => render(p as string, values).trim())
    .join("\n\n")}\n`
}

const blockRe = () =>
  new RegExp(`${escapeRe(SOUL_GENERATED_START)}[\\s\\S]*?${escapeRe(SOUL_GENERATED_END)}`, "g")
function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Rewrites only the generated blocks; user edits elsewhere survive. */
export function refreshGenerated(markdown: string, freshBlock: string) {
  if (!blockRe().test(markdown)) return `${markdown.trimEnd()}\n\n${freshBlock.trim()}\n`
  return markdown.replace(blockRe(), freshBlock.trim())
}

export function generatedBlock(templates: CatalogData["soul"], values: Partial<SoulValues>) {
  const facts = render(templates["box-facts"] ?? "", values)
  return facts.match(blockRe())?.[0] ?? facts.trim()
}

export class SoulService {
  constructor(
    private readonly deps: {
      hermesHome: string
      templates: CatalogData["soul"]
      /** Current box facts (user, accounts, repos, CLIs, MCPs…). */
      values: () => Promise<SoulValues>
      /** Role template for the default profile. */
      role: () => string
    },
  ) {}

  private file(profile: string | null = null) {
    return profile
      ? join(this.deps.hermesHome, "profiles", profile, "SOUL.md")
      : join(this.deps.hermesHome, "SOUL.md")
  }

  /** Our SOUL if agentbox wrote one; null for none or Hermes' stock SOUL. */
  private ours(profile: string | null = null) {
    const file = this.file(profile)
    if (!existsSync(file)) return null
    const text = readFileSync(file, "utf8")
    return text.startsWith(SOUL_MARKER) ? text : null
  }

  async get() {
    const values = await this.deps.values()
    const generated = generatedBlock(this.deps.templates, values)
    const markdown = this.ours() ?? compose(this.deps.templates, this.deps.role(), values)
    return { markdown, generated }
  }

  async save(markdown: string, profile: string | null = null) {
    const file = this.file(profile)
    await mkdir(dirname(file), { recursive: true })
    await writeFileAtomic(file, markdown.endsWith("\n") ? markdown : `${markdown}\n`, 0o644)
    return this.get()
  }

  /** Re-renders the generated blocks (or composes from scratch when there is no SOUL yet). */
  async regenerate(_ai: boolean) {
    const values = await this.deps.values()
    const current = this.ours()
    const file = this.file()
    // Hermes writes a stock SOUL on first start: keep it next to ours, then take over.
    if (!current && existsSync(file))
      await writeFileAtomic(`${file}.hermes-default`, readFileSync(file, "utf8"), 0o644)
    const markdown = current
      ? refreshGenerated(current, generatedBlock(this.deps.templates, values))
      : compose(this.deps.templates, this.deps.role(), values)
    return this.save(markdown)
  }

  /** Composes a profile SOUL (agent profiles on onboarding screen 8). */
  async composeProfile(role: string, name: string, purpose: string) {
    const values = { ...(await this.deps.values()), "agent.name": name }
    return compose(this.deps.templates, role, values, purpose)
  }

  /** Refreshes box facts in every SOUL on the box after a change (accounts, repos, MCPs). */
  async refreshAll(profiles: string[]) {
    const block = generatedBlock(this.deps.templates, await this.deps.values())
    for (const p of [null, ...profiles]) {
      const current = this.ours(p)
      if (current) await writeFileAtomic(this.file(p), refreshGenerated(current, block), 0o644)
    }
  }
}

export const boxHostname = () => hostname()
