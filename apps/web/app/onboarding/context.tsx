"use client"

import type { OnboardingPatch, OnboardingState, OnboardingStep } from "@workspace/contract"
import { createContext, useContext } from "react"

export interface WizardApi {
  state: OnboardingState
  step: OnboardingStep
  /** Onboarding was finished before: steps are re-run from Settings. */
  rerun: boolean
  save: (patch: OnboardingPatch) => Promise<OnboardingState>
  /** Marks the current step done (optionally saving more) and moves on. */
  advance: (patch?: OnboardingPatch) => Promise<void>
  skip: () => Promise<void>
  goto: (step: OnboardingStep) => void
  back: () => void
  /** Finishes onboarding and opens Hermes UI (full page load). */
  openHermes: () => Promise<void>
  busy: boolean
}

export const WizardContext = createContext<WizardApi | null>(null)

export function useWizard(): WizardApi {
  const ctx = useContext(WizardContext)
  if (!ctx) throw new Error("useWizard outside <Wizard>")
  return ctx
}
