import {
  ONBOARDING_STEPS,
  type OnboardingPatch,
  type OnboardingState,
  type OnboardingStep,
} from "@workspace/contract"
import type { Kv } from "../kv"

const KEY = "onboarding"

export function defaultOnboarding(): OnboardingState {
  return {
    step: "ai",
    completed: [],
    skipped: [],
    roles: [],
    about: "",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    language: "English",
    selection: { skills: [], mcps: [], clis: [] },
    firstTask: "",
    firstTaskAlternatives: [],
    suggestedSites: [],
    finishedAt: null,
  }
}

/** First step that is neither completed nor skipped, or the last step. */
export function nextStep(completed: OnboardingStep[], skipped: OnboardingStep[]): OnboardingStep {
  return (
    ONBOARDING_STEPS.find((s) => !completed.includes(s) && !skipped.includes(s)) ??
    (ONBOARDING_STEPS.at(-1) as OnboardingStep)
  )
}

export class OnboardingService {
  constructor(private readonly kv: Kv) {}

  get(): OnboardingState {
    return { ...defaultOnboarding(), ...(this.kv.get<OnboardingState>(KEY) ?? {}) }
  }

  save(patch: OnboardingPatch): OnboardingState {
    const current = this.get()
    const next: OnboardingState = { ...current, ...patch }
    next.completed = [...new Set(next.completed)]
    next.skipped = [...new Set(next.skipped)].filter((s) => !next.completed.includes(s))
    // An explicit step wins (the user navigated back); otherwise follow progress.
    if (!patch.step) next.step = nextStep(next.completed, next.skipped)
    this.kv.set(KEY, next)
    return next
  }

  complete() {
    const state = this.get()
    this.kv.set(KEY, { ...state, finishedAt: new Date().toISOString() })
    const compose = state.firstTask.trim()
    return { redirect: compose ? `/hermes/?compose=${encodeURIComponent(compose)}` : "/hermes/" }
  }
}
