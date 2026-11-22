"use client"

import { useQuery } from "@tanstack/react-query"
import { ApiKeysCard, ClaudeAccountsCard, HermesModelCard } from "@/components/ai-settings"
import { orpc } from "@/lib/orpc"
import { StepLayout } from "../step-layout"

export function AiStep() {
  const ai = useQuery(orpc.ai.status.queryOptions())
  const ready = ai.data?.hermes.ready === true
  return (
    <StepLayout
      title="Connect your AI"
      description="Sign in with your Claude subscription, add API keys, or both. Hermes needs one working model; everything else is optional."
      hint={
        ready ? "Hermes has a model." : "Pick a model for Hermes below, or come back to it later."
      }
    >
      <div className="grid gap-4 xl:grid-cols-2">
        <ClaudeAccountsCard />
        <ApiKeysCard />
      </div>
      <HermesModelCard />
    </StepLayout>
  )
}
