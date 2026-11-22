import { eventIterator, oc } from "@orpc/contract"
import { z } from "zod"
import {
  AiStatus,
  ApiKeyProvider,
  BrowserStatus,
  CatalogHit,
  CatalogKind,
  Check,
  CliId,
  CliStatus,
  Device,
  GitHost,
  GitIdentity,
  Identity,
  LocalRepo,
  LoginFlow,
  OnboardingPatch,
  OnboardingState,
  PairingWindow,
  Profile,
  ProfileDraft,
  RemoteRepo,
  RoleId,
  Selection,
  ServiceStatus,
  Soul,
  SshStatus,
  Suggestion,
  SystemInfo,
} from "./domain"
import { RunEvent, RunStatus } from "./events"

const RunSummary = z.object({
  id: z.string(),
  kind: z.enum(["plan", "apply", "verify"]),
  title: z.string(),
  status: RunStatus,
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  actor: z.string(),
})

const Ok = z.object({ ok: z.boolean(), message: z.string().nullable().optional() })
const get = () => oc.route({ method: "GET" })

/**
 * The agentbox API. The config UI calls it over `/api/rpc`, the CLI and the agentbox-* skills
 * through `agentbox api <group.procedure> --json '<input>'`.
 *
 * Cookie-setting flows are plain Hono routes and not part of this contract:
 * `POST /api/setup/claim`, `POST /api/auth/login`, `POST /auth/logout`, `GET /api/auth/check`
 * (Caddy forward_auth) and `POST /api/devices/pair/redeem` (devices pairing over iroh).
 */
export const contract = {
  system: {
    info: get().output(SystemInfo),
    doctor: get().output(z.object({ checks: z.array(Check) })),
    services: get().output(z.array(ServiceStatus)),
  },
  auth: {
    me: get().output(Identity),
    changePassword: oc
      .input(z.object({ current: z.string(), next: z.string().min(12) }))
      .output(Ok),
  },
  /** Root-only helpers, callable with the CLI token. */
  admin: {
    issueOtp: oc
      .input(z.object({ purpose: z.enum(["claim", "reset"]).default("claim") }))
      .output(z.object({ otp: z.string(), expiresAt: z.iso.datetime() })),
  },
  onboarding: {
    get: get().output(OnboardingState),
    save: oc.input(OnboardingPatch).output(OnboardingState),
    /** Marks onboarding finished; returns where to send the user (Hermes UI with composer prefilled). */
    complete: oc.output(z.object({ redirect: z.string() })),
  },
  ai: {
    status: get().output(AiStatus),
    /** Starts `claude auth login --claudeai` for a new account in a PTY. */
    accountLoginStart: oc.input(z.object({ label: z.string().min(1).max(40) })).output(LoginFlow),
    /** Writes the code the user copied from the Claude page into the waiting login. */
    accountLoginFinish: oc
      .input(z.object({ flowId: z.string(), code: z.string().min(4) }))
      .output(LoginFlow),
    accountRemove: oc.input(z.object({ slug: z.string() })).output(Ok),
    accountSetDefault: oc.input(z.object({ slug: z.string() })).output(Ok),
    setApiKey: oc.input(z.object({ provider: ApiKeyProvider, key: z.string().min(8) })).output(Ok),
    removeApiKey: oc.input(z.object({ provider: ApiKeyProvider })).output(Ok),
    /** Chooses Hermes' model. `source=claude-account` reuses a Claude account's login. */
    setHermesModel: oc
      .input(
        z.object({
          source: z.enum(["claude-account", "api-key"]),
          provider: z.string(),
          model: z.string(),
          account: z.string().optional(),
        }),
      )
      .output(AiStatus),
    /** Sends a tiny prompt through Hermes; ok when it answers. */
    probe: oc.output(
      z.object({ ok: z.boolean(), reply: z.string().nullable(), message: z.string().nullable() }),
    ),
  },
  flows: {
    /** Poll a login flow (claude, gh, glab). */
    get: get()
      .input(z.object({ flowId: z.string() }))
      .output(LoginFlow),
    cancel: oc.input(z.object({ flowId: z.string() })).output(Ok),
  },
  catalog: {
    search: get()
      .input(
        z.object({
          q: z.string().max(200),
          kind: CatalogKind.optional(),
          roles: z.array(RoleId).optional(),
          limit: z.number().int().min(1).max(50).default(20),
        }),
      )
      .output(z.array(CatalogHit)),
    get: get()
      .input(z.object({ id: z.string() }))
      .output(CatalogHit.extend({ detail: z.unknown() })),
    /** Merges the role bundles (plus `base`) and optionally refines them with the user's AI. */
    suggest: oc
      .input(
        z.object({
          roles: z.array(RoleId),
          about: z.string().max(2000).optional(),
          refine: z.boolean().default(false),
        }),
      )
      .output(Suggestion),
  },
  toolkit: {
    get: get().output(z.object({ selection: Selection, installed: Selection })),
    /** Installs/removes skills, MCP servers and CLIs; returns the run to follow. */
    apply: oc
      .input(
        z.object({
          add: z.array(z.string()),
          remove: z.array(z.string()).default([]),
          /** Values for items' `env` (API keys etc.), keyed by item id then variable name. Write-only. */
          env: z.record(z.string(), z.record(z.string(), z.string())).optional(),
        }),
      )
      .output(RunSummary),
    /**
     * Signs an installed OAuth MCP server in (Gmail, Slack, …): the consent page opens in the box's
     * browser (embed `/browser/`), so the localhost callback lands on the box.
     */
    connect: oc.input(z.object({ id: z.string() })).output(LoginFlow),
  },
  soul: {
    get: get().output(Soul),
    save: oc.input(z.object({ markdown: z.string().max(100_000) })).output(Soul),
    /** Re-renders from templates; `ai` lets the user's model polish the user sections. */
    regenerate: oc.input(z.object({ ai: z.boolean().default(false) })).output(Soul),
  },
  clis: {
    status: get().output(z.array(CliStatus)),
    /** Starts a device flow (`gh auth login --web`, `glab auth login --device`). */
    authStart: oc.input(z.object({ cli: CliId, host: z.string().optional() })).output(LoginFlow),
    /** Personal access token fallback (e.g. self-hosted GitLab < 17.9). */
    setToken: oc
      .input(z.object({ cli: CliId, host: z.string(), token: z.string().min(8) }))
      .output(CliStatus),
  },
  git: {
    identity: get().output(GitIdentity.nullable()),
    setIdentity: oc.input(GitIdentity).output(GitIdentity),
  },
  ssh: {
    status: get().output(SshStatus),
    generate: oc.output(SshStatus),
    register: oc.input(z.object({ host: GitHost })).output(SshStatus),
  },
  repos: {
    list: get()
      .input(z.object({ host: GitHost }))
      .output(z.array(RemoteRepo)),
    local: get().output(z.array(LocalRepo)),
    clone: oc.input(z.object({ repos: z.array(z.string()).min(1) })).output(RunSummary),
  },
  profiles: {
    list: get().output(z.array(Profile)),
    /** Drafts 1–3 agent profiles with the user's AI (template fallback). */
    draft: oc.output(
      z.object({ profiles: z.array(ProfileDraft), source: z.enum(["ai", "template"]) }),
    ),
    create: oc.input(ProfileDraft).output(Profile),
    remove: oc.input(z.object({ slug: z.string() })).output(Ok),
  },
  browser: {
    status: get().output(BrowserStatus),
    setLock: oc.input(z.object({ locked: z.boolean() })).output(BrowserStatus),
    /** Opens a URL in the box's Chrome (used for OAuth callbacks that land on localhost). */
    open: oc.input(z.object({ url: z.url() })).output(Ok),
  },
  devices: {
    list: get().output(z.array(Device)),
    pairStart: oc
      .input(z.object({ kind: z.enum(["phone", "laptop", "other"]).default("phone") }))
      .output(PairingWindow),
    revoke: oc.input(z.object({ id: z.string() })).output(Ok),
  },
  runs: {
    list: get()
      .input(z.object({ limit: z.number().int().min(1).max(200).default(50) }))
      .output(z.array(RunSummary)),
    get: get()
      .input(z.object({ id: z.string() }))
      .output(RunSummary),
    cancel: oc.input(z.object({ id: z.string() })).output(Ok),
    events: oc.input(z.object({ id: z.string() })).output(eventIterator(RunEvent)),
  },
}

export type Contract = typeof contract
export type RunSummary = z.infer<typeof RunSummary>
