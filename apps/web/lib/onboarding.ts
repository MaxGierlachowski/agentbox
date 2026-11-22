import { ONBOARDING_STEPS, type OnboardingStep } from "@workspace/contract"

export const STEPS: { id: OnboardingStep; title: string; description: string }[] = [
  { id: "ai", title: "Connect AI", description: "Claude accounts and API keys" },
  { id: "role", title: "Who are you?", description: "Roles shape your toolkit" },
  { id: "toolkit", title: "Your toolkit", description: "Skills, MCP servers, CLIs" },
  { id: "soul", title: "Your SOUL", description: "How Hermes behaves" },
  { id: "accounts", title: "Connect accounts", description: "GitHub, GitLab, git identity" },
  { id: "repos", title: "SSH & repos", description: "Keys and clones" },
  { id: "agents", title: "Your agents", description: "Profiles drafted for you" },
  { id: "browser", title: "Browser logins", description: "Sign in once, share with agents" },
  { id: "apply", title: "Install & hand-off", description: "Apply and open Hermes" },
]

export const isStep = (v: string | null | undefined): v is OnboardingStep =>
  !!v && (ONBOARDING_STEPS as readonly string[]).includes(v)

export function nextStep(step: OnboardingStep): OnboardingStep | null {
  const i = ONBOARDING_STEPS.indexOf(step)
  return ONBOARDING_STEPS[i + 1] ?? null
}

export function prevStep(step: OnboardingStep): OnboardingStep | null {
  const i = ONBOARDING_STEPS.indexOf(step)
  return i > 0 ? (ONBOARDING_STEPS[i - 1] ?? null) : null
}

export const without = <T>(list: readonly T[], item: T) => list.filter((x) => x !== item)
export const withItem = <T>(list: readonly T[], item: T) =>
  list.includes(item) ? [...list] : [...list, item]

/** Catalog ids are kind-prefixed (`cli.gh`); the CLI procedures take the bare id. */
export const AUTH_CLIS = { "cli.gh": "gh", "cli.glab": "glab" } as const
