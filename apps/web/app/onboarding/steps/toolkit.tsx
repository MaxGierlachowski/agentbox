"use client"

import { useMutation, useQuery } from "@tanstack/react-query"
import type { CatalogHit, CatalogKind, Selection } from "@workspace/contract"
import { Badge } from "@workspace/ui/components/badge"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { toast } from "@workspace/ui/components/sonner"
import { CatalogItemRow } from "@workspace/ui/composites/catalog-item"
import { CatalogSearch } from "@workspace/ui/composites/catalog-search"
import { BlocksIcon, PlugIcon, TerminalIcon } from "lucide-react"
import { useState } from "react"
import { selectionIds, toSelection, useCatalogHits } from "@/lib/catalog"
import { AUTH_CLIS } from "@/lib/onboarding"
import { client, orpc } from "@/lib/orpc"
import { useWizard } from "../context"
import { StepLayout } from "../step-layout"

const COLUMNS: {
  kind: CatalogKind
  key: keyof Selection
  title: string
  icon: typeof BlocksIcon
}[] = [
  { kind: "skill", key: "skills", title: "Skills", icon: BlocksIcon },
  { kind: "mcp", key: "mcps", title: "MCP servers", icon: PlugIcon },
  { kind: "cli", key: "clis", title: "CLIs", icon: TerminalIcon },
]

export function ToolkitStep() {
  const w = useWizard()
  const suggestion = useQuery({
    ...orpc.catalog.suggest.queryOptions({
      input: { roles: w.state.roles, about: w.state.about || undefined, refine: false },
    }),
    staleTime: Infinity,
  })
  const installed = useQuery(orpc.toolkit.get.queryOptions())
  const apply = useMutation(orpc.toolkit.apply.mutationOptions())
  const [picked, setPicked] = useState<string[] | null>(null)
  const [extra, setExtra] = useState<CatalogHit[]>([])

  const saved = selectionIds(w.state.selection)
  const selected =
    picked ??
    (saved.length ? saved : suggestion.data ? selectionIds(suggestion.data.selection) : [])
  const known = [...(suggestion.data?.items ?? []), ...extra]
  const hits = useCatalogHits(selected, known)
  const listed = [...new Set([...known.map((h) => h.id), ...selected])]

  const toggle = (id: string) =>
    setPicked(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id])

  const search = (q: string) => client.catalog.search({ q, roles: w.state.roles, limit: 20 })

  async function onContinue() {
    const selection = toSelection(selected)
    // gh/glab install right away, so the device flows on "Connect accounts" don't wait for apt.
    const already = new Set(installed.data ? selectionIds(installed.data.installed) : [])
    const clis = selection.clis.filter((id) => id in AUTH_CLIS && !already.has(id))
    if (clis.length) {
      apply
        .mutateAsync({ add: clis, remove: [] })
        .then(() =>
          toast.message(
            `Installing ${clis.map((c) => c.slice(4)).join(" and ")} in the background`,
          ),
        )
        .catch(() => {})
    }
    await w.advance({ selection })
  }

  return (
    <StepLayout
      title="Your toolkit"
      description="Suggested from your roles. Untick what you don't want, add anything from the library. Nothing is installed until the last step."
      onContinue={onContinue}
      hint={`${selected.length} items selected`}
    >
      <CatalogSearch
        search={search}
        selected={selected}
        onToggle={(item) => {
          if (!known.some((h) => h.id === item.id)) setExtra((e) => [...e, item])
          toggle(item.id)
        }}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        {COLUMNS.map((col) => {
          const ids = listed.filter((id) => id.startsWith(`${col.kind}.`))
          const count = ids.filter((id) => selected.includes(id)).length
          return (
            <section
              key={col.kind}
              aria-labelledby={`col-${col.kind}`}
              className="flex min-w-0 flex-col rounded-xl border bg-card"
            >
              <header className="flex items-center gap-2 border-b px-4 py-3">
                <col.icon className="size-4 text-muted-foreground" aria-hidden />
                <h2 id={`col-${col.kind}`} className="font-medium text-sm">
                  {col.title}
                </h2>
                <Badge variant="secondary" className="ml-auto tabular-nums">
                  {count} selected
                </Badge>
              </header>
              <ul className="max-h-[32rem] divide-y overflow-y-auto px-4">
                {suggestion.isPending && !ids.length
                  ? [1, 2, 3].map((i) => (
                      <li key={i} className="py-3">
                        <Skeleton className="h-10" />
                      </li>
                    ))
                  : null}
                {ids.map((id) => {
                  const hit = hits.get(id)
                  const cb = `pick-${id}`
                  return (
                    <li key={id}>
                      {hit ? (
                        <label htmlFor={cb} className="block cursor-pointer">
                          <CatalogItemRow
                            item={hit}
                            action={
                              <Checkbox
                                id={cb}
                                checked={selected.includes(id)}
                                onCheckedChange={() => toggle(id)}
                                aria-label={hit.name}
                              />
                            }
                          />
                        </label>
                      ) : (
                        <Skeleton className="my-3 h-10" />
                      )}
                    </li>
                  )
                })}
                {!suggestion.isPending && ids.length === 0 ? (
                  <li className="py-6 text-center text-muted-foreground text-sm">
                    Nothing yet. Search the library above.
                  </li>
                ) : null}
              </ul>
            </section>
          )
        })}
      </div>
    </StepLayout>
  )
}
