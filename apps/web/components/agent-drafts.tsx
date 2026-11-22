"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { ProfileDraft } from "@workspace/contract"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible"
import { Field, FieldLabel } from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Switch } from "@workspace/ui/components/switch"
import { Textarea } from "@workspace/ui/components/textarea"
import { cn } from "@workspace/ui/lib/utils"
import { CheckIcon, ChevronDownIcon, ClockIcon, PlugIcon, Trash2Icon } from "lucide-react"
import { errorMessage } from "@/lib/errors"
import { client, orpc } from "@/lib/orpc"

const short = (id: string) => id.replace(/^(skill|mcp|cli)\./, "")

export interface DraftState {
  draft: ProfileDraft
  created: boolean
}

/** One drafted agent: editable name, purpose, crons (off by default) and SOUL. */
export function AgentDraftCard({
  value,
  onChange,
  onRemove,
}: {
  value: DraftState
  onChange: (next: DraftState) => void
  onRemove: () => void
}) {
  const queryClient = useQueryClient()
  const { draft, created } = value
  const create = useMutation(
    orpc.profiles.create.mutationOptions({
      onSuccess: () => {
        onChange({ ...value, created: true })
        void queryClient.invalidateQueries({ queryKey: orpc.profiles.key() })
      },
    }),
  )
  const set = (patch: Partial<ProfileDraft>) =>
    onChange({ ...value, draft: { ...draft, ...patch } })
  const id = `agent-${draft.slug}`

  return (
    <article
      aria-label={draft.name}
      data-created={created}
      className={cn(
        "flex flex-col gap-4 rounded-xl border bg-card p-4 sm:p-5",
        created && "border-emerald-600/30 bg-emerald-50/30 dark:bg-emerald-950/10",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-sm uppercase"
        >
          {draft.name.slice(0, 2)}
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          {created ? (
            <h3 className="font-medium">{draft.name}</h3>
          ) : (
            <Input
              aria-label="Agent name"
              value={draft.name}
              onChange={(e) => set({ name: e.target.value })}
              className="h-8 font-medium"
            />
          )}
          <p className="font-mono text-muted-foreground text-xs">
            {draft.slug} · {draft.role}
          </p>
        </div>
        {created ? (
          <Badge variant="outline" className="gap-1 text-emerald-700 dark:text-emerald-400">
            <CheckIcon className="size-3" aria-hidden />
            Created
          </Badge>
        ) : null}
      </div>

      {created ? (
        <p className="text-sm">{draft.purpose}</p>
      ) : (
        <Field>
          <FieldLabel htmlFor={`${id}-purpose`}>Purpose</FieldLabel>
          <Textarea
            id={`${id}-purpose`}
            value={draft.purpose}
            onChange={(e) => set({ purpose: e.target.value })}
            className="min-h-16"
          />
        </Field>
      )}

      {draft.skills.length + draft.mcps.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {draft.skills.map((t) => (
            <Badge key={t} variant="secondary" className="font-normal">
              {short(t)}
            </Badge>
          ))}
          {draft.mcps.map((t) => (
            <Badge key={t} variant="outline" className="gap-1 font-normal">
              <PlugIcon className="size-3" aria-hidden />
              {short(t)}
              <span className="sr-only">(MCP server)</span>
            </Badge>
          ))}
        </div>
      ) : null}

      {draft.crons.length > 0 ? (
        <ul className="space-y-2 rounded-lg border bg-muted/30 p-3">
          {draft.crons.map((c, i) => {
            const cid = `${id}-cron-${i}`
            return (
              <li key={c.name} className="flex items-start gap-3">
                <ClockIcon className="mt-0.5 size-4 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <Label htmlFor={cid} className="font-medium text-sm">
                    {c.name}
                  </Label>
                  <p className="text-muted-foreground text-xs">
                    <span className="font-mono">{c.schedule}</span> · {c.prompt}
                  </p>
                </div>
                <Switch
                  id={cid}
                  size="sm"
                  checked={c.enabled}
                  disabled={created}
                  onCheckedChange={(v) =>
                    set({ crons: draft.crons.map((x, j) => (j === i ? { ...x, enabled: v } : x)) })
                  }
                />
              </li>
            )
          })}
          <li className="text-muted-foreground text-xs">
            Schedules are off until you turn them on.
          </li>
        </ul>
      ) : null}

      {!created ? (
        <Collapsible>
          <CollapsibleTrigger className="group flex items-center gap-1 rounded text-muted-foreground text-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            Edit SOUL
            <ChevronDownIcon className="size-4 transition-transform group-data-[state=open]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <Textarea
              aria-label={`SOUL for ${draft.name}`}
              value={draft.soul}
              onChange={(e) => set({ soul: e.target.value })}
              className="min-h-40 font-mono text-xs"
            />
          </CollapsibleContent>
        </Collapsible>
      ) : null}

      {!created ? (
        <div className="mt-auto flex flex-wrap items-center gap-2">
          <Button
            onClick={() => create.mutate(draft)}
            disabled={create.isPending || !draft.name.trim()}
          >
            <CheckIcon />
            Create agent
          </Button>
          <Button variant="ghost" onClick={onRemove}>
            <Trash2Icon />
            Discard
          </Button>
          {create.isError ? (
            <span className="text-destructive text-sm" role="alert">
              {errorMessage(create.error)}
            </span>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

/** Creates every draft that is not created yet, one by one. */
export function useAcceptAll(drafts: DraftState[], setDrafts: (d: DraftState[]) => void) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const next = [...drafts]
      for (const [i, d] of next.entries()) {
        if (d.created) continue
        await client.profiles.create(d.draft)
        next[i] = { ...d, created: true }
        setDrafts([...next])
      }
      await queryClient.invalidateQueries({ queryKey: orpc.profiles.key() })
    },
  })
}
