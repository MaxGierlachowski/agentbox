"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ONBOARDING_STEPS, type OnboardingPatch, type OnboardingStep } from "@workspace/contract"
import { Button } from "@workspace/ui/components/button"
import { toast } from "@workspace/ui/components/sonner"
import { Spinner } from "@workspace/ui/components/spinner"
import { StepRail } from "@workspace/ui/composites/step-rail"
import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react"
import Link from "next/link"
import { parseAsStringLiteral, useQueryState } from "nuqs"
import { type ComponentType, useState } from "react"
import { Brand } from "@/components/brand"
import { FullPageSpinner } from "@/components/gate"
import { go } from "@/lib/api"
import { errorMessage } from "@/lib/errors"
import { nextStep, prevStep, STEPS, withItem, without } from "@/lib/onboarding"
import { orpc } from "@/lib/orpc"
import { type WizardApi, WizardContext } from "./context"
import { AccountsStep } from "./steps/accounts"
import { AgentsStep } from "./steps/agents"
import { AiStep } from "./steps/ai"
import { ApplyStep } from "./steps/apply"
import { BrowserStep } from "./steps/browser"
import { ReposStep } from "./steps/repos"
import { RoleStep } from "./steps/role"
import { SoulStep } from "./steps/soul"
import { ToolkitStep } from "./steps/toolkit"

const screens: Record<OnboardingStep, ComponentType> = {
  ai: AiStep,
  role: RoleStep,
  toolkit: ToolkitStep,
  soul: SoulStep,
  accounts: AccountsStep,
  repos: ReposStep,
  agents: AgentsStep,
  browser: BrowserStep,
  apply: ApplyStep,
}

export function Wizard() {
  const queryClient = useQueryClient()
  const onboarding = useQuery(orpc.onboarding.get.queryOptions())
  const [param, setParam] = useQueryState(
    "step",
    parseAsStringLiteral(ONBOARDING_STEPS).withOptions({ history: "push", scroll: true }),
  )
  const [leaving, setLeaving] = useState(false)

  const saveMutation = useMutation(
    orpc.onboarding.save.mutationOptions({
      onSuccess: (s) => queryClient.setQueryData(orpc.onboarding.get.queryKey(), s),
    }),
  )
  const complete = useMutation(orpc.onboarding.complete.mutationOptions())

  const state = onboarding.data
  if (!state) return <FullPageSpinner />

  // A reload without ?step= resumes where the server says the user left off.
  const step: OnboardingStep = param ?? state.step
  const rerun = state.finishedAt !== null

  const save = (patch: OnboardingPatch) => saveMutation.mutateAsync(patch)

  const moveTo = async (target: OnboardingStep | null, patch: OnboardingPatch) => {
    try {
      await save({ ...patch, ...(target ? { step: target } : {}) })
      if (target) await setParam(target)
    } catch (err) {
      toast.error("Could not save your progress", { description: errorMessage(err) })
      throw err
    }
  }

  const api: WizardApi = {
    state,
    step,
    rerun,
    busy: saveMutation.isPending || leaving,
    save,
    advance: (patch = {}) =>
      moveTo(nextStep(step), {
        ...patch,
        completed: withItem(state.completed, step),
        skipped: without(state.skipped, step),
      }),
    skip: () =>
      moveTo(nextStep(step), {
        skipped: state.completed.includes(step) ? state.skipped : withItem(state.skipped, step),
      }),
    goto: (target) => void setParam(target),
    back: () => {
      const prev = prevStep(step)
      if (prev) void setParam(prev)
    },
    openHermes: async () => {
      setLeaving(true)
      try {
        const { redirect } = await complete.mutateAsync({})
        await queryClient.invalidateQueries({ queryKey: orpc.onboarding.key() })
        go(redirect)
      } catch (err) {
        setLeaving(false)
        toast.error("Could not finish onboarding", { description: errorMessage(err) })
      }
    },
  }

  const Screen = screens[step]
  return (
    <WizardContext value={api}>
      <div className="flex min-h-svh flex-col">
        <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur supports-backdrop-filter:bg-background/70">
          <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
            <Brand subtitle={rerun ? "Settings · onboarding" : "Setup"} />
            <div className="ml-auto flex items-center gap-1">
              {rerun ? (
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/settings/">
                    <ArrowLeftIcon />
                    Back to console
                  </Link>
                </Button>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void api.openHermes()}
                disabled={leaving}
                data-testid="skip-to-hermes"
              >
                {leaving ? <Spinner /> : null}
                <span className="hidden sm:inline">Skip →</span> Open Hermes UI
                <ArrowRightIcon className="sm:hidden" />
              </Button>
            </div>
          </div>
        </header>
        <div className="mx-auto grid w-full max-w-6xl flex-1 gap-6 px-4 pt-5 pb-28 lg:grid-cols-[15rem_1fr] lg:gap-12 lg:pt-10">
          <aside className="hidden lg:block">
            <div className="sticky top-24">
              <StepRail
                steps={STEPS}
                current={step}
                completed={state.completed}
                skipped={state.skipped}
                onSelect={(id) => api.goto(id as OnboardingStep)}
              />
            </div>
          </aside>
          <StepRail
            className="lg:hidden"
            variant="compact"
            steps={STEPS}
            current={step}
            completed={state.completed}
            skipped={state.skipped}
            onSelect={(id) => api.goto(id as OnboardingStep)}
          />
          <main className="min-w-0" key={step}>
            <Screen />
          </main>
        </div>
      </div>
    </WizardContext>
  )
}
