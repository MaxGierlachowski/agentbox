import type {
  AiStatus,
  CliStatus,
  Device,
  LoginFlow,
  OnboardingState,
  PairingWindow,
  Profile,
  RunEvent,
  RunSummary,
  Selection,
} from "@workspace/contract"

export const CLAIM_OTP = "river-lamp-oak-mint-fold-acre"
export const RESET_OTP = "stone-pine-hill-wave-fern-dust"
export const DEMO_PASSWORD = "correct-horse-battery-staple"

export type Preset = "fresh" | "claimed" | "onboarded"

export interface FlowEntry {
  flow: LoginFlow
  kind: "claude" | "gh" | "glab" | "oauth"
  /** Polls left until the flow completes on its own (gh/glab) or after the paste (claude). */
  pollsLeft: number
  pasted: boolean
  label?: string
  slug?: string
  host?: string
  item?: string
}

export interface RunEntry {
  summary: RunSummary
  events: RunEvent[]
  cancelled: boolean
}

export interface MockState {
  claimed: boolean
  owner: { name: string; email: string; password: string } | null
  sessions: Set<string>
  onboarding: OnboardingState
  ai: AiStatus
  apiKeyValues: Map<string, string>
  flows: Map<string, FlowEntry>
  clis: Record<"gh" | "glab", CliStatus>
  git: { name: string; email: string } | null
  ssh: { publicKey: string | null; fingerprint: string | null; registered: Record<string, boolean> }
  cloned: Set<string>
  profiles: Profile[]
  browserLocked: boolean
  devices: Device[]
  pairing: PairingWindow | null
  runs: Map<string, RunEntry>
  installed: Selection
  soulUser: string
  /** OAuth MCPs that finished `toolkit.connect`. */
  oauth: Set<string>
  /** Item id → env names supplied with `toolkit.apply` (values are dropped). */
  envSet: Map<string, string[]>
}

const emptySelection = (): Selection => ({ skills: [], mcps: [], clis: [] })

export const MODELS: Record<string, string[]> = {
  anthropic: ["claude-sonnet-5", "claude-opus-5", "claude-haiku-5"],
  openai: ["gpt-5.2", "gpt-5.2-mini"],
  openrouter: ["anthropic/claude-sonnet-5", "openai/gpt-5.2", "meta/llama-5-70b"],
}

export function createState(preset: Preset = "fresh"): MockState {
  const claimed = preset !== "fresh"
  const onboarded = preset === "onboarded"
  const tz = "Europe/Berlin"
  const state: MockState = {
    claimed,
    owner: claimed
      ? { name: "Ada Example", email: "ada@example.org", password: DEMO_PASSWORD }
      : null,
    sessions: new Set(),
    onboarding: {
      step: onboarded ? "apply" : "ai",
      completed: onboarded ? ["ai", "role", "toolkit", "soul"] : [],
      skipped: onboarded ? ["accounts", "repos", "agents", "browser", "apply"] : [],
      roles: onboarded ? ["developer"] : [],
      about: "",
      timezone: tz,
      language: "English",
      selection: emptySelection(),
      firstTask: "",
      firstTaskAlternatives: [],
      suggestedSites: [],
      finishedAt: onboarded ? new Date().toISOString() : null,
    },
    ai: {
      accounts: onboarded
        ? [
            {
              slug: "personal",
              label: "Personal",
              status: "ready",
              email: "ada@example.org",
              message: null,
              isDefault: true,
            },
          ]
        : [],
      apiKeys: [
        { provider: "anthropic", set: false, last4: null },
        { provider: "openai", set: false, last4: null },
        { provider: "openrouter", set: false, last4: null },
      ],
      hermes: onboarded
        ? {
            source: "claude-account",
            provider: "anthropic",
            model: "claude-sonnet-5",
            ready: true,
            message: null,
          }
        : { source: "none", provider: null, model: null, ready: false, message: "No model yet" },
      models: MODELS,
    },
    apiKeyValues: new Map(),
    flows: new Map(),
    clis: {
      gh: {
        id: "gh",
        installed: onboarded,
        version: onboarded ? "2.105.0" : null,
        authed: false,
        user: null,
        host: "github.com",
      },
      glab: {
        id: "glab",
        installed: false,
        version: null,
        authed: false,
        user: null,
        host: "gitlab.com",
      },
    },
    git: null,
    ssh: {
      publicKey: null,
      fingerprint: null,
      registered: { "github.com": false, "gitlab.com": false },
    },
    cloned: new Set(),
    profiles: [
      {
        slug: "default",
        name: "Hermes",
        role: "orchestrator",
        purpose: "Plans your work and delegates coding to Paseo agents",
        isDefault: true,
      },
    ],
    browserLocked: false,
    devices: onboarded
      ? [
          {
            id: "dev_laptop",
            name: "Ada's laptop",
            kind: "laptop",
            irohId: "b5e0f3c2a1d94e7f8a6b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f",
            createdAt: new Date(Date.now() - 6 * 86400_000).toISOString(),
            lastSeenAt: new Date(Date.now() - 3600_000).toISOString(),
          },
        ]
      : [],
    pairing: null,
    runs: new Map(),
    installed: emptySelection(),
    soulUser: "",
    oauth: new Set(),
    envSet: new Map(),
  }
  return state
}
