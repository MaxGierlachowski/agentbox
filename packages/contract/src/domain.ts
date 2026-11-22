import { z } from "zod"

// Shared domain types for the config UI, the CLI (`agentbox api`) and the agentbox-* skills.
// Secrets are write-only everywhere: outputs carry at most `set` and `last4`.

export const RoleId = z.enum([
  "developer",
  "manager",
  "founder-ops",
  "data",
  "devops",
  "support",
  "designer-marketer",
  "custom",
])
export type RoleId = z.infer<typeof RoleId>

export const ListenMode = z.enum(["lan", "local"])

export const SystemInfo = z.object({
  version: z.string(),
  hostname: z.string(),
  platform: z.string(),
  arch: z.string(),
  startedAt: z.iso.datetime(),
  listen: ListenMode,
  /** e.g. https://192.168.1.50:8443 in LAN mode, null in local mode. */
  lanUrl: z.string().nullable(),
  /** SHA-256 fingerprint of the LAN TLS certificate (colon-separated hex). */
  certFingerprint: z.string().nullable(),
  /** Public Hermes UI PWA used in phone pairing links. */
  pwaUrl: z.string(),
})
export type SystemInfo = z.infer<typeof SystemInfo>

export const Check = z.object({
  id: z.string(),
  level: z.enum(["ok", "warn", "fail"]),
  message: z.string(),
})
export type Check = z.infer<typeof Check>

export const ServiceStatus = z.object({
  id: z.string(),
  unit: z.string(),
  label: z.string(),
  active: z.boolean(),
  healthy: z.boolean(),
  message: z.string(),
})
export type ServiceStatus = z.infer<typeof ServiceStatus>

export const Identity = z.object({
  login: z.string(),
  name: z.string().nullable(),
  via: z.enum(["session", "device", "cli"]),
})
export type Identity = z.infer<typeof Identity>

// ---------------------------------------------------------------------------------------------
// Onboarding

export const OnboardingStep = z.enum([
  "ai",
  "role",
  "toolkit",
  "soul",
  "accounts",
  "repos",
  "agents",
  "browser",
  "apply",
])
export type OnboardingStep = z.infer<typeof OnboardingStep>
export const ONBOARDING_STEPS = OnboardingStep.options

export const Selection = z.object({
  skills: z.array(z.string()),
  mcps: z.array(z.string()),
  clis: z.array(z.string()),
})
export type Selection = z.infer<typeof Selection>

export const OnboardingState = z.object({
  /** Step the user should see next. */
  step: OnboardingStep,
  completed: z.array(OnboardingStep),
  skipped: z.array(OnboardingStep),
  roles: z.array(RoleId),
  about: z.string(),
  timezone: z.string(),
  language: z.string(),
  selection: Selection,
  /** Text prefilled in the Hermes UI composer after hand-off. */
  firstTask: z.string(),
  firstTaskAlternatives: z.array(z.string()),
  suggestedSites: z.array(z.string()),
  finishedAt: z.iso.datetime().nullable(),
})
export type OnboardingState = z.infer<typeof OnboardingState>

export const OnboardingPatch = OnboardingState.omit({ finishedAt: true }).partial()
export type OnboardingPatch = z.infer<typeof OnboardingPatch>

// ---------------------------------------------------------------------------------------------
// AI accounts

export const ClaudeAccount = z.object({
  slug: z.string(),
  label: z.string(),
  status: z.enum(["pending", "ready", "error"]),
  email: z.string().nullable(),
  message: z.string().nullable(),
  /** True for the account Paseo agents use by default. */
  isDefault: z.boolean(),
})
export type ClaudeAccount = z.infer<typeof ClaudeAccount>

export const ApiKeyProvider = z.enum(["anthropic", "openai", "openrouter"])
export type ApiKeyProvider = z.infer<typeof ApiKeyProvider>

export const ApiKeyStatus = z.object({
  provider: ApiKeyProvider,
  set: z.boolean(),
  last4: z.string().nullable(),
})

export const HermesModel = z.object({
  /** Where Hermes gets its model from. */
  source: z.enum(["claude-account", "api-key", "none"]),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  ready: z.boolean(),
  message: z.string().nullable(),
})

export const AiStatus = z.object({
  accounts: z.array(ClaudeAccount),
  apiKeys: z.array(ApiKeyStatus),
  hermes: HermesModel,
  /** Models offered in the picker, per provider. */
  models: z.record(z.string(), z.array(z.string())),
})
export type AiStatus = z.infer<typeof AiStatus>

export const LoginFlow = z.object({
  flowId: z.string(),
  /** URL the user opens in their own browser. */
  url: z.string().nullable(),
  /** Device code to enter on that page (gh/glab), null when the page returns a code instead (claude). */
  code: z.string().nullable(),
  /** Whether the user must paste a code back (claude). */
  needsPaste: z.boolean(),
  state: z.enum(["starting", "waiting", "done", "error", "cancelled"]),
  message: z.string().nullable(),
  /** Account / user the flow signed in, once done. */
  user: z.string().nullable(),
})
export type LoginFlow = z.infer<typeof LoginFlow>

// ---------------------------------------------------------------------------------------------
// Catalog (search results; the full item schema lives in catalog.ts)

export const CatalogKind = z.enum(["skill", "mcp", "cli"])
export type CatalogKind = z.infer<typeof CatalogKind>

export const CatalogHit = z.object({
  id: z.string(),
  kind: CatalogKind,
  name: z.string(),
  summary: z.string(),
  tier: z.enum(["T0", "T1", "T2", "T3"]),
  source: z.array(z.string()),
  licence: z.string().nullable(),
  roles: z.array(z.string()),
  needsAuth: z.boolean(),
  /** Why the item was suggested (role bundle, AI refinement). */
  reason: z.string().nullable(),
  installed: z.boolean(),
  homepage: z.string().nullable(),
})
export type CatalogHit = z.infer<typeof CatalogHit>

export const Suggestion = z.object({
  selection: Selection,
  reasons: z.record(z.string(), z.string()),
  firstTask: z.string(),
  firstTaskAlternatives: z.array(z.string()),
  suggestedSites: z.array(z.string()),
  /** Items in the selection, resolved for display. */
  items: z.array(CatalogHit),
})
export type Suggestion = z.infer<typeof Suggestion>

// ---------------------------------------------------------------------------------------------
// CLIs, SSH, repos

export const CliId = z.enum(["gh", "glab"])
export const CliStatus = z.object({
  id: CliId,
  installed: z.boolean(),
  version: z.string().nullable(),
  authed: z.boolean(),
  user: z.string().nullable(),
  host: z.string(),
})
export type CliStatus = z.infer<typeof CliStatus>

export const GitHost = z.enum(["github.com", "gitlab.com"])
export const SshStatus = z.object({
  publicKey: z.string().nullable(),
  fingerprint: z.string().nullable(),
  registered: z.object({ "github.com": z.boolean(), "gitlab.com": z.boolean() }),
})
export type SshStatus = z.infer<typeof SshStatus>

export const GitIdentity = z.object({ name: z.string(), email: z.string() })

export const RemoteRepo = z.object({
  host: GitHost,
  fullName: z.string(),
  sshUrl: z.string(),
  description: z.string().nullable(),
  pushedAt: z.string().nullable(),
  private: z.boolean(),
  cloned: z.boolean(),
})
export type RemoteRepo = z.infer<typeof RemoteRepo>

export const LocalRepo = z.object({ path: z.string(), fullName: z.string(), host: z.string() })

// ---------------------------------------------------------------------------------------------
// SOUL and agent profiles

export const Soul = z.object({
  markdown: z.string(),
  /** Read-only facts block rendered by agentbox (between agentbox:generated markers). */
  generated: z.string(),
})

export const ProfileDraft = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  name: z.string(),
  role: z.string(),
  purpose: z.string(),
  skills: z.array(z.string()),
  mcps: z.array(z.string()),
  crons: z
    .array(
      z.object({
        name: z.string(),
        schedule: z.string(),
        prompt: z.string(),
        enabled: z.boolean(),
      }),
    )
    .default([]),
  /** Empty: composed from the role template. */
  soul: z.string().default(""),
})
export type ProfileDraft = z.infer<typeof ProfileDraft>

export const Profile = z.object({
  slug: z.string(),
  name: z.string(),
  role: z.string(),
  purpose: z.string(),
  isDefault: z.boolean(),
})
export type Profile = z.infer<typeof Profile>

// ---------------------------------------------------------------------------------------------
// Browser and devices

export const BrowserStatus = z.object({
  running: z.boolean(),
  cdp: z.boolean(),
  locked: z.boolean(),
  /** Path of the streamed desktop (KasmVNC web client) on this origin. */
  path: z.string(),
})

export const Device = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["phone", "laptop", "other"]),
  irohId: z.string(),
  createdAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime().nullable(),
})
export type Device = z.infer<typeof Device>

export const PairingWindow = z.object({
  endpointId: z.string(),
  code: z.string(),
  expiresAt: z.iso.datetime(),
  /** Phone: opens the Hermes UI PWA, which pairs over iroh. */
  pwaLink: z.string(),
  /** Laptop: run this command. */
  connectCommand: z.string(),
})
export type PairingWindow = z.infer<typeof PairingWindow>
