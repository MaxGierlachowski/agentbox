"use client"

import { useQuery } from "@tanstack/react-query"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Spinner } from "@workspace/ui/components/spinner"
import { CheckCheckIcon, SparklesIcon } from "lucide-react"
import { useState } from "react"
import { AgentDraftCard, type DraftState, useAcceptAll } from "@/components/agent-drafts"
import { orpc } from "@/lib/orpc"
import { StepLayout } from "../step-layout"

export function AgentsStep() {
  const drafted = useQuery({
    ...orpc.profiles.draft.queryOptions(),
    staleTime: Number.POSITIVE_INFINITY,
  })
  const profiles = useQuery(orpc.profiles.list.queryOptions())
  const [edited, setDrafts] = useState<DraftState[] | null>(null)
  const existing = new Set(profiles.data?.map((p) => p.slug))
  const drafts =
    edited ??
    drafted.data?.profiles.map((draft) => ({ draft, created: existing.has(draft.slug) })) ??
    []
  const acceptAll = useAcceptAll(drafts, setDrafts)
  const open = drafts.filter((d) => !d.created).length

  return (
    <StepLayout
      title="Your agents"
      description="Besides Hermes, specialised agents with their own SOUL and a narrower toolset. Drafted from your roles; edit or discard freely."
      actions={
        open > 1 ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => acceptAll.mutate()}
            disabled={acceptAll.isPending}
          >
            {acceptAll.isPending ? <Spinner /> : <CheckCheckIcon />}
            Create all
          </Button>
        ) : null
      }
      hint={drafts.length ? `${drafts.length - open} of ${drafts.length} created` : undefined}
    >
      <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-sm">
        {drafted.data ? (
          <Badge variant="outline" className="gap-1 font-normal">
            <SparklesIcon className="size-3" aria-hidden />
            {drafted.data.source === "ai" ? "Drafted by your AI" : "Drafted from templates"}
          </Badge>
        ) : null}
        {profiles.data?.length ? (
          <span>
            On this box:{" "}
            {profiles.data.map((p) => `${p.name}${p.isDefault ? " (default)" : ""}`).join(", ")}
          </span>
        ) : null}
      </div>
      {drafted.isPending ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
        </div>
      ) : drafts.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {drafts.map((d, i) => (
            <AgentDraftCard
              key={d.draft.slug}
              value={d}
              onChange={(next) => setDrafts(drafts.map((x, j) => (j === i ? next : x)))}
              onRemove={() => setDrafts(drafts.filter((_, j) => j !== i))}
            />
          ))}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed p-6 text-center text-muted-foreground text-sm">
          No drafts left. Hermes alone is fine; you can draft agents later under Agents.
        </p>
      )}
    </StepLayout>
  )
}
