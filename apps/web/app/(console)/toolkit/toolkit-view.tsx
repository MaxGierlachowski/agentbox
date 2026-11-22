"use client"

import { useMutation, useQuery } from "@tanstack/react-query"
import type { CatalogHit } from "@workspace/contract"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { toast } from "@workspace/ui/components/sonner"
import { Spinner } from "@workspace/ui/components/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"
import { CatalogItemRow } from "@workspace/ui/composites/catalog-item"
import { CatalogSearch } from "@workspace/ui/composites/catalog-search"
import { PageHeader } from "@workspace/ui/composites/page-header"
import { cn } from "@workspace/ui/lib/utils"
import { PlayIcon, Undo2Icon, XIcon } from "lucide-react"
import { useState } from "react"
import { RunLogDrawer } from "@/components/run-log"
import { selectionIds, useCatalogHits } from "@/lib/catalog"
import { errorMessage } from "@/lib/errors"
import { client, orpc } from "@/lib/orpc"

const KINDS = [
  { kind: "skill", title: "Skills" },
  { kind: "mcp", title: "MCP servers" },
  { kind: "cli", title: "CLIs" },
] as const

export function ToolkitView() {
  const toolkit = useQuery(orpc.toolkit.get.queryOptions())
  const onboarding = useQuery(orpc.onboarding.get.queryOptions())
  const [add, setAdd] = useState<CatalogHit[]>([])
  const [remove, setRemove] = useState<string[]>([])
  const [runId, setRunId] = useState<string | null>(null)
  const [drawer, setDrawer] = useState(false)
  const installedIds = toolkit.data ? selectionIds(toolkit.data.installed) : []
  const hits = useCatalogHits(installedIds, add)
  const apply = useMutation(
    orpc.toolkit.apply.mutationOptions({
      onSuccess: (run) => {
        setRunId(run.id)
        setDrawer(true)
        setAdd([])
        setRemove([])
      },
      onError: (e) => toast.error("Could not apply", { description: errorMessage(e) }),
    }),
  )
  const pending = add.length + remove.length
  const selected = [...installedIds.filter((id) => !remove.includes(id)), ...add.map((h) => h.id)]

  return (
    <>
      <PageHeader
        title="Toolkit"
        description="Skills, MCP servers and CLIs installed for Hermes and your agents."
        actions={
          pending ? (
            <>
              <Button
                variant="ghost"
                onClick={() => {
                  setAdd([])
                  setRemove([])
                }}
              >
                <Undo2Icon />
                Discard
              </Button>
              <Button
                onClick={() => apply.mutate({ add: add.map((h) => h.id), remove })}
                disabled={apply.isPending}
              >
                {apply.isPending ? <Spinner /> : <PlayIcon />}
                Apply {pending} change{pending === 1 ? "" : "s"}
              </Button>
            </>
          ) : null
        }
      />
      <CatalogSearch
        search={(q) => client.catalog.search({ q, roles: onboarding.data?.roles, limit: 20 })}
        selected={selected}
        onToggle={(item) => {
          if (installedIds.includes(item.id)) {
            setRemove((r) =>
              r.includes(item.id) ? r.filter((x) => x !== item.id) : [...r, item.id],
            )
          } else {
            setAdd((a) =>
              a.some((h) => h.id === item.id) ? a.filter((h) => h.id !== item.id) : [...a, item],
            )
          }
        }}
      />
      {add.length ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">To add:</span>
          {add.map((h) => (
            <Badge key={h.id} variant="secondary" className="gap-1">
              {h.name}
              <button
                type="button"
                aria-label={`Don't add ${h.name}`}
                className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => setAdd((a) => a.filter((x) => x.id !== h.id))}
              >
                <XIcon className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      ) : null}
      <Tabs defaultValue="skill">
        <TabsList>
          {KINDS.map((k) => (
            <TabsTrigger key={k.kind} value={k.kind}>
              {k.title}
              <span className="text-muted-foreground tabular-nums">
                {installedIds.filter((id) => id.startsWith(`${k.kind}.`)).length}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
        {KINDS.map((k) => {
          const ids = installedIds.filter((id) => id.startsWith(`${k.kind}.`))
          return (
            <TabsContent key={k.kind} value={k.kind}>
              <div className="rounded-xl border bg-card px-4">
                {toolkit.isPending ? <Skeleton className="my-4 h-24" /> : null}
                {toolkit.data && ids.length === 0 ? (
                  <p className="py-8 text-center text-muted-foreground text-sm">
                    Nothing installed yet. Search the library above.
                  </p>
                ) : null}
                <ul className="divide-y">
                  {ids.map((id) => {
                    const hit = hits.get(id)
                    const removing = remove.includes(id)
                    return (
                      <li
                        key={id}
                        className={cn("flex items-center gap-3", removing && "opacity-60")}
                      >
                        {hit ? (
                          <CatalogItemRow item={hit} className="flex-1" />
                        ) : (
                          <Skeleton className="my-3 h-10 flex-1" />
                        )}
                        <Button
                          size="sm"
                          variant={removing ? "secondary" : "ghost"}
                          onClick={() =>
                            setRemove((r) => (removing ? r.filter((x) => x !== id) : [...r, id]))
                          }
                          aria-label={
                            removing ? `Keep ${hit?.name ?? id}` : `Remove ${hit?.name ?? id}`
                          }
                        >
                          {removing ? "Keep" : "Remove"}
                        </Button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            </TabsContent>
          )
        })}
      </Tabs>
      <RunLogDrawer
        runId={runId}
        title="Applying toolkit changes"
        open={drawer}
        onOpenChange={setDrawer}
      />
    </>
  )
}
