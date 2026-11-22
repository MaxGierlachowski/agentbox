"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { Profile } from "@workspace/contract"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@workspace/ui/components/alert-dialog"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { toast } from "@workspace/ui/components/sonner"
import { Spinner } from "@workspace/ui/components/spinner"
import { PageHeader } from "@workspace/ui/composites/page-header"
import { SparklesIcon, Trash2Icon } from "lucide-react"
import { useState } from "react"
import { AgentDraftCard, type DraftState } from "@/components/agent-drafts"
import { errorMessage } from "@/lib/errors"
import { orpc } from "@/lib/orpc"

export function AgentsView() {
  const profiles = useQuery(orpc.profiles.list.queryOptions())
  const [drafts, setDrafts] = useState<DraftState[]>([])
  const draft = useMutation(
    orpc.profiles.draft.mutationOptions({
      onSuccess: (r) => {
        const existing = new Set(profiles.data?.map((p) => p.slug))
        const fresh = r.profiles.filter((p) => !existing.has(p.slug))
        if (!fresh.length) toast.message("No new suggestions right now")
        setDrafts(fresh.map((d) => ({ draft: d, created: false })))
      },
      onError: (e) => toast.error("Could not draft agents", { description: errorMessage(e) }),
    }),
  )

  return (
    <>
      <PageHeader
        title="Agents"
        description="Hermes profiles with their own SOUL, tools and schedules. Hermes itself is the default."
        actions={
          <Button variant="outline" onClick={() => draft.mutate({})} disabled={draft.isPending}>
            {draft.isPending ? <Spinner /> : <SparklesIcon />}
            Suggest agents
          </Button>
        }
      />
      {profiles.isPending ? <Skeleton className="h-32" /> : null}
      <ul className="grid gap-3 md:grid-cols-2">
        {profiles.data?.map((p) => (
          <ProfileCard key={p.slug} profile={p} />
        ))}
      </ul>
      {drafts.length ? (
        <section aria-labelledby="drafts" className="space-y-3">
          <h2 id="drafts" className="font-medium">
            Suggestions
          </h2>
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
        </section>
      ) : null}
    </>
  )
}

function ProfileCard({ profile }: { profile: Profile }) {
  const queryClient = useQueryClient()
  const remove = useMutation(
    orpc.profiles.remove.mutationOptions({
      onSuccess: () => void queryClient.invalidateQueries({ queryKey: orpc.profiles.key() }),
      onError: (e) => toast.error("Could not remove", { description: errorMessage(e) }),
    }),
  )
  return (
    <li className="flex items-start gap-3 rounded-xl border bg-card p-4">
      <span
        aria-hidden
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-sm uppercase"
      >
        {profile.name.slice(0, 2)}
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          {profile.name}
          {profile.isDefault ? <Badge variant="secondary">Default</Badge> : null}
        </p>
        <p className="font-mono text-muted-foreground text-xs">
          {profile.slug} · {profile.role}
        </p>
        <p className="text-sm">{profile.purpose}</p>
      </div>
      {!profile.isDefault ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label={`Remove ${profile.name}`}>
              <Trash2Icon />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove {profile.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                Its SOUL, settings and schedules are deleted. Conversations in Hermes UI stay.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => remove.mutate({ slug: profile.slug })}
              >
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </li>
  )
}
