import { z } from "zod"

/**
 * Curated catalog: skills, MCP servers and CLIs, plus the role bundles that preselect them.
 * Source files live in `catalog/` at the repo root (YAML), validated by
 * `bun scripts/catalog-validate.ts`. See `catalog/README.md` for the format.
 */

/** Role cards on onboarding screen 3. */
export const Role = z.enum([
  "developer",
  "manager",
  "founder-ops",
  "data",
  "devops",
  "support",
  "designer-marketer",
  "custom",
])
export type Role = z.infer<typeof Role>

/** Kinds a search result can have. Curated items are skill | mcp | cli; bundles are separate. */
export const CatalogKind = z.enum(["skill", "mcp", "cli", "bundle"])
export type CatalogKind = z.infer<typeof CatalogKind>

export const CatalogItemKind = z.enum(["skill", "mcp", "cli"])
export type CatalogItemKind = z.infer<typeof CatalogItemKind>

export const CatalogSource = z.enum(["curated", "mcp-registry", "anthropics-skills", "hermes"])
export type CatalogSource = z.infer<typeof CatalogSource>

/**
 * Trust tier. T0 agentbox-curated and tested, T1 official vendor or upstream, T2 popular
 * community entry with an OSI licence, T3 everything else (hidden unless toggled).
 */
export const CatalogTier = z.enum(["T0", "T1", "T2", "T3"])
export type CatalogTier = z.infer<typeof CatalogTier>

/** Where an item is registered: Hermes, Paseo agents (Claude Code via Paseo), plain Claude Code. */
export const CatalogTarget = z.enum(["hermes", "paseo", "claude"])
export type CatalogTarget = z.infer<typeof CatalogTarget>

/** `skill.<name>`, `mcp.<name>`, `cli.<name>`: lowercase, digits and dashes after the prefix. */
export const CatalogItemId = z
  .string()
  .regex(
    /^(skill|mcp|cli)\.[a-z0-9][a-z0-9-]*$/,
    "Use skill.<name>, mcp.<name> or cli.<name> (lowercase)",
  )
export type CatalogItemId = z.infer<typeof CatalogItemId>

export const CatalogAuthType = z.enum(["none", "api_key", "oauth", "device", "derived"])
export type CatalogAuthType = z.infer<typeof CatalogAuthType>

/**
 * How the item authenticates. `derived` reuses the login of another item (`from`), e.g. the
 * GitHub MCP reads `gh auth token` at render time.
 */
export const CatalogAuth = z
  .object({
    type: CatalogAuthType,
    from: CatalogItemId.optional(),
  })
  .refine((a) => (a.type === "derived") === (a.from !== undefined), {
    message: "`from` is required for derived auth and only allowed there",
    path: ["from"],
  })
export type CatalogAuth = z.infer<typeof CatalogAuth>

/**
 * A value the user supplies on screen 6. Secrets go to the secret store and are rendered into
 * the server's env at apply time; they never appear in specs, logs or API responses.
 */
export const CatalogEnvVar = z.object({
  name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Use an environment variable name"),
  secret: z.boolean(),
  required: z.boolean().default(true),
  help_url: z.url().optional(),
  description: z.string().optional(),
})
export type CatalogEnvVar = z.infer<typeof CatalogEnvVar>

/**
 * Values in `args`, `env`, `url`, `headers` and `oauth` may reference `${NAME}` (an entry in
 * the item's `env`) or `${<cli>.token}` (token of an authenticated CLI, e.g. `${gh.token}`).
 */
export const McpStdioInstall = z.object({
  transport: z.literal("stdio"),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).optional(),
})
export type McpStdioInstall = z.infer<typeof McpStdioInstall>

export const McpHttpInstall = z.object({
  transport: z.literal("http"),
  url: z.string().regex(/^https?:\/\/\S+$/, "Use an http(s) URL"),
  headers: z.record(z.string(), z.string()).optional(),
  /** Pre-registered OAuth client for servers without dynamic client registration. */
  oauth: z
    .object({
      client_id: z.string().optional(),
      client_secret: z.string().optional(),
      scopes: z.array(z.string()).optional(),
    })
    .optional(),
})
export type McpHttpInstall = z.infer<typeof McpHttpInstall>

export const McpInstall = z.discriminatedUnion("transport", [McpStdioInstall, McpHttpInstall])
export type McpInstall = z.infer<typeof McpInstall>

/**
 * `hermes-builtin`: a skill shipped in the pinned Hermes tag (`path` relative to the Hermes
 * repo, e.g. `skills/productivity/pdf`). `git`: a folder of `repo` at commit `sha`.
 * `agentbox`: a skill shipped in this repo (`path` relative to the repo root).
 */
export const SkillInstall = z
  .object({
    source: z.enum(["hermes-builtin", "git", "agentbox"]),
    repo: z.url().optional(),
    sha: z
      .string()
      .regex(/^[0-9a-f]{40}$/, "Use a full commit SHA")
      .optional(),
    path: z.string().min(1),
    category: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .optional(),
  })
  .refine((s) => s.source !== "git" || (s.repo !== undefined && s.sha !== undefined), {
    message: "git skills need repo and sha",
  })
export type SkillInstall = z.infer<typeof SkillInstall>

/** A host install plan the agentbox host installer implements (`cli.gh`, `cli.glab`, …). */
export const CliInstall = z.object({
  plan: CatalogItemId.refine((id) => id.startsWith("cli."), "CLI plans are cli.<name>"),
})
export type CliInstall = z.infer<typeof CliInstall>

export const CatalogInstall = z.union([
  z.object({ mcp: McpInstall }).strict(),
  z.object({ skill: SkillInstall }).strict(),
  z.object({ cli: CliInstall }).strict(),
])
export type CatalogInstall = z.infer<typeof CatalogInstall>

export const CatalogItem = z
  .object({
    id: CatalogItemId,
    kind: CatalogItemKind,
    name: z.string().trim().min(1),
    summary: z.string().trim().min(1).max(200),
    source: z.array(CatalogSource).min(1),
    tier: CatalogTier,
    /** SPDX id, or `Proprietary` for vendor-hosted services. */
    licence: z.string().trim().min(1),
    roles: z.array(Role).default([]),
    install: CatalogInstall,
    auth: CatalogAuth.default({ type: "none" }),
    env: z.array(CatalogEnvVar).default([]),
    targets: z.array(CatalogTarget).min(1),
    /** Exact version/tag/SHA the install is pinned to; null for hosted or distro packages. */
    pinned_version: z.string().nullable(),
    homepage: z.url().optional(),
    icon: z.string().optional(),
    /** Other catalog items this one needs on the box, e.g. `cli.uv` for `uvx` servers. */
    requires: z.array(CatalogItemId).default([]),
    tags: z.array(z.string()).default([]),
    /** Caveats shown in the UI (account requirements, unverified details, …). */
    notes: z.string().optional(),
  })
  .superRefine((item, ctx) => {
    if (!item.id.startsWith(`${item.kind}.`)) {
      ctx.addIssue({ code: "custom", path: ["id"], message: `id must start with ${item.kind}.` })
    }
    if (!(item.kind in item.install)) {
      ctx.addIssue({
        code: "custom",
        path: ["install"],
        message: `install must be { ${item.kind} }`,
      })
    }
    if (item.auth.type === "derived" && item.auth.from === item.id) {
      ctx.addIssue({ code: "custom", path: ["auth", "from"], message: "cannot derive from itself" })
    }
  })
export type CatalogItem = z.infer<typeof CatalogItem>

/** A file in `catalog/items/`. */
export const CatalogItemsFile = z.object({ items: z.array(CatalogItem).min(1) })
export type CatalogItemsFile = z.infer<typeof CatalogItemsFile>

/** Role templates in `catalog/soul/role-<id>.md`. */
export const SoulRole = z.enum([
  "orchestrator",
  "developer",
  "manager",
  "ops",
  "support",
  "data",
  "designer",
])
export type SoulRole = z.infer<typeof SoulRole>

/**
 * Every Mustache placeholder the SOUL templates may use. Filled from onboarding state by the
 * profile composer; documented in `catalog/soul/README.md`.
 */
export const SoulPlaceholder = z.enum([
  "agent.name",
  "user.name",
  "user.language",
  "user.timezone",
  "user.about",
  "user.roles",
  "box.hostname",
  "paseo.accounts",
  "paseo.default",
  "repos.list",
  "browser.sites",
  "clis.authed",
  "git.name",
  "git.email",
  "mcps.list",
  "delivery.home",
  "delivery.targets",
])
export type SoulPlaceholder = z.infer<typeof SoulPlaceholder>

/** Marks the blocks the composer rewrites; user edits outside them survive regeneration. */
export const SOUL_GENERATED_START = "<!-- agentbox:generated -->"
export const SOUL_GENERATED_END = "<!-- /agentbox:generated -->"

export const SuggestedSite = z.object({
  name: z.string().trim().min(1),
  url: z.url(),
})
export type SuggestedSite = z.infer<typeof SuggestedSite>

/**
 * A Hermes cron suggestion. Always created disabled. `deliver`: `home` = the profile's home
 * channel (Slack if connected), `origin` = where it was created, `local` = files only.
 */
export const SuggestedCron = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  schedule: z.string().trim().min(1),
  prompt: z.string().trim().min(1),
  deliver: z.enum(["home", "origin", "local"]),
  skills: z.array(CatalogItemId).default([]),
  enabled: z.literal(false),
})
export type SuggestedCron = z.infer<typeof SuggestedCron>

export const BundleId = z.string().regex(/^[a-z][a-z0-9-]*$/)
export type BundleId = z.infer<typeof BundleId>

export const Bundle = z.object({
  id: BundleId,
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  /** Roles that select this bundle; empty for `base`, which is always included. */
  roles: z.array(Role),
  skills: z.array(CatalogItemId),
  mcps: z.array(CatalogItemId),
  clis: z.array(CatalogItemId),
  /** Shown in the bundle but not preselected. Each id must also be listed above. */
  opt_in: z.array(CatalogItemId).default([]),
  soul_role: SoulRole,
  first_task: z.string().trim().min(1),
  first_task_alternatives: z.tuple([z.string().min(1), z.string().min(1), z.string().min(1)]),
  suggested_sites: z.array(SuggestedSite).default([]),
  suggested_crons: z.array(SuggestedCron).default([]),
})
export type Bundle = z.infer<typeof Bundle>
