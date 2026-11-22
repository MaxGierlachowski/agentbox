import type {
  Bundle,
  CatalogHit,
  CatalogItem,
  RoleId,
  Selection,
  Suggestion,
} from "@workspace/contract"
import type { Kv } from "../kv"
import { log } from "../log"
import data from "./catalog.gen.json" with { type: "json" }

export interface CatalogData {
  items: CatalogItem[]
  bundles: Bundle[]
  /** "catalog/skills/<name>" → relative file path → content */
  skills: Record<string, Record<string, string>>
  /** SOUL template name (without .md) → content */
  soul: Record<string, string>
}

export const CATALOG = data as unknown as CatalogData

const REGISTRY = "https://registry.modelcontextprotocol.io/v0.1/servers"
const REGISTRY_TTL_MS = 24 * 60 * 60 * 1000
const TIER_WEIGHT = { T0: 4, T1: 3, T2: 2, T3: 0 } as const

const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)

/** Text match: name hits weigh most, then id/tags, then summary. Prefix matches count. */
export function textScore(item: Pick<CatalogItem, "id" | "name" | "summary" | "tags">, q: string) {
  const terms = words(q)
  if (terms.length === 0) return 1
  const name = words(item.name)
  const ident = [...words(item.id), ...(item.tags ?? []).flatMap(words)]
  const summary = words(item.summary)
  let score = 0
  for (const t of terms) {
    const hit = (list: string[]) =>
      list.some((w) => w === t) ? 1 : list.some((w) => w.startsWith(t)) ? 0.6 : 0
    const s = hit(name) * 3 + hit(ident) * 2 + hit(summary)
    if (s === 0) return 0
    score += s
  }
  return score
}

interface RegistryServer {
  server: {
    name: string
    description?: string
    version?: string
    repository?: { url?: string }
    websiteUrl?: string
    remotes?: { type: string; url: string }[]
    packages?: {
      registryType: string
      identifier: string
      version?: string
      transport?: { type: string }
    }[]
  }
  _meta?: Record<string, unknown>
}

/** Maps an MCP Registry entry to a catalog item we can install, or null. */
export function registryItem(s: RegistryServer["server"]): CatalogItem | null {
  const slug = s.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
  const base = {
    id: `mcp.r-${slug}`,
    kind: "mcp" as const,
    name: s.name.split("/").pop() ?? s.name,
    summary: (s.description ?? s.name).slice(0, 200),
    source: ["mcp-registry" as const],
    // Verified namespaces (io.github.<owner>, reverse-DNS) count as vendor entries.
    tier: (/^(io\.github\.|com\.|io\.|ai\.|dev\.)/.test(s.name) ? "T2" : "T3") as "T2" | "T3",
    licence: "unknown",
    roles: [],
    auth: { type: "none" as const },
    env: [],
    targets: ["hermes" as const],
    pinned_version: s.version ?? null,
    homepage: s.websiteUrl ?? s.repository?.url,
    requires: [],
    tags: ["registry"],
    notes: "From the official MCP Registry; not reviewed by agentbox.",
  }
  const remote = s.remotes?.find((r) => r.type === "streamable-http" || r.type === "sse")
  if (remote)
    return { ...base, install: { mcp: { transport: "http", url: remote.url } } } as CatalogItem
  const npm = s.packages?.find(
    (p) => p.registryType === "npm" && (!p.transport || p.transport.type === "stdio"),
  )
  if (npm?.version)
    return {
      ...base,
      install: {
        mcp: {
          transport: "stdio",
          command: "npx",
          args: ["-y", `${npm.identifier}@${npm.version}`],
        },
      },
    } as CatalogItem
  const pypi = s.packages?.find(
    (p) => p.registryType === "pypi" && (!p.transport || p.transport.type === "stdio"),
  )
  if (pypi?.version)
    return {
      ...base,
      requires: ["cli.uv"],
      install: {
        mcp: { transport: "stdio", command: "uvx", args: [`${pypi.identifier}==${pypi.version}`] },
      },
    } as CatalogItem
  return null
}

export class CatalogService {
  private readonly byId = new Map<string, CatalogItem>()

  constructor(
    private readonly kv: Kv,
    private readonly installed: () => Set<string>,
    readonly data: CatalogData = CATALOG,
  ) {
    for (const item of data.items) this.byId.set(item.id, item)
  }

  item(id: string): CatalogItem | null {
    return this.byId.get(id) ?? this.kv.get<CatalogItem>(`catalog.registry.${id}`)
  }

  bundle(id: string) {
    return this.data.bundles.find((b) => b.id === id) ?? null
  }

  private hit(item: CatalogItem, reason: string | null = null): CatalogHit {
    return {
      id: item.id,
      kind: item.kind,
      name: item.name,
      summary: item.summary,
      tier: item.tier,
      source: item.source,
      licence: item.licence,
      roles: item.roles,
      needsAuth: item.auth.type !== "none" || item.env.some((e) => e.secret),
      reason,
      installed: this.installed().has(item.id),
      homepage: item.homepage ?? null,
    }
  }

  async search(input: {
    q: string
    kind?: "skill" | "mcp" | "cli"
    roles?: RoleId[]
    limit: number
  }) {
    const roles = new Set(input.roles ?? [])
    const scored = this.data.items
      .filter((i) => !input.kind || i.kind === input.kind)
      .map((item) => {
        const text = textScore(item, input.q)
        const affinity = item.roles.some((r) => roles.has(r)) ? 1.5 : 1
        return { item, score: text * TIER_WEIGHT[item.tier] * affinity }
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name))
    const hits = scored.slice(0, input.limit).map((s) => this.hit(s.item))
    if (
      (input.kind === undefined || input.kind === "mcp") &&
      input.q.trim().length >= 2 &&
      hits.length < input.limit
    ) {
      const seen = new Set(hits.map((h) => h.name.toLowerCase()))
      for (const item of await this.registrySearch(input.q)) {
        if (hits.length >= input.limit) break
        if (seen.has(item.name.toLowerCase())) continue
        hits.push(this.hit(item))
      }
    }
    return hits
  }

  /** Live MCP Registry search, cached for a day; silently empty when offline. */
  private async registrySearch(q: string): Promise<CatalogItem[]> {
    const key = `catalog.search.${q.trim().toLowerCase()}`
    const cached = this.kv.get<{ at: number; ids: string[] }>(key)
    if (cached && Date.now() - cached.at < REGISTRY_TTL_MS)
      return cached.ids.map((id) => this.item(id)).filter((i): i is CatalogItem => Boolean(i))
    try {
      const res = await fetch(`${REGISTRY}?search=${encodeURIComponent(q.trim())}&limit=15`, {
        signal: AbortSignal.timeout(4000),
      })
      if (!res.ok) return []
      const body = (await res.json()) as { servers?: RegistryServer[] }
      const items = (body.servers ?? [])
        .map((s) => registryItem(s.server))
        .filter((i): i is CatalogItem => Boolean(i) && i?.tier !== "T3")
      for (const item of items) this.kv.set(`catalog.registry.${item.id}`, item)
      this.kv.set(key, { at: Date.now(), ids: items.map((i) => i.id) })
      return items
    } catch (err) {
      log.debug({ err: (err as Error).message }, "registry search unavailable")
      return []
    }
  }

  get(id: string) {
    const item = this.item(id)
    if (!item) throw new Error(`Unknown catalog item ${id}`)
    return {
      ...this.hit(item),
      detail: {
        auth: item.auth,
        env: item.env.map((e) => ({
          name: e.name,
          secret: e.secret,
          required: e.required,
          help_url: e.help_url,
          description: e.description,
        })),
        requires: item.requires,
        notes: item.notes ?? null,
        targets: item.targets,
        pinned_version: item.pinned_version,
      },
    }
  }

  /** `base` plus the bundles of the chosen roles, opt-in items excluded. */
  suggest(input: { roles: RoleId[]; about?: string; refine: boolean }): Suggestion {
    const chosen = this.data.bundles.filter(
      (b) => b.id === "base" || b.roles.some((r) => input.roles.includes(r)),
    )
    const selection: Selection = { skills: [], mcps: [], clis: [] }
    const reasons: Record<string, string> = {}
    for (const b of chosen) {
      const optIn = new Set(b.opt_in)
      for (const [key, ids] of [
        ["skills", b.skills],
        ["mcps", b.mcps],
        ["clis", b.clis],
      ] as const) {
        for (const id of ids) {
          if (optIn.has(id) || selection[key].includes(id)) continue
          selection[key].push(id)
          reasons[id] = b.id === "base" ? "Part of every box" : `${b.name} bundle`
        }
      }
    }
    const roleBundles = chosen.filter((b) => b.id !== "base")
    const lead = roleBundles[0] ?? this.bundle("base")
    const alternatives = [
      ...(lead?.first_task_alternatives ?? []),
      ...roleBundles.slice(1).map((b) => b.first_task),
    ].slice(0, 3)
    const sites = [
      ...new Map(roleBundles.flatMap((b) => b.suggested_sites).map((s) => [s.url, s])).values(),
    ]
    const items = [...selection.skills, ...selection.mcps, ...selection.clis]
      .map((id) => this.item(id))
      .filter((i): i is CatalogItem => Boolean(i))
      .map((i) => this.hit(i, reasons[i.id] ?? null))
    // Opt-in items of the chosen bundles are offered, not preselected.
    const offered = roleBundles
      .flatMap((b) => b.opt_in.map((id) => ({ id, bundle: b.name })))
      .filter((o) => !reasons[o.id])
      .map((o) => {
        const item = this.item(o.id)
        return item ? this.hit(item, `Optional in the ${o.bundle} bundle`) : null
      })
      .filter((h): h is CatalogHit => Boolean(h))
    return {
      selection,
      reasons,
      firstTask: lead?.first_task ?? "",
      firstTaskAlternatives: alternatives,
      suggestedSites: sites.map((s) => s.url),
      items: [
        ...items,
        ...offered.filter((o, i, all) => all.findIndex((x) => x.id === o.id) === i),
      ],
    }
  }

  /** Items plus everything they require (`cli.uv` for uvx servers, …), without duplicates. */
  withRequirements(ids: string[]) {
    const out: string[] = []
    const visit = (id: string) => {
      if (out.includes(id)) return
      const item = this.item(id)
      for (const r of item?.requires ?? []) visit(r)
      out.push(id)
    }
    for (const id of ids) visit(id)
    return out
  }
}
