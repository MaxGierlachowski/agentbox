"use client"

import { useMutation, useQuery } from "@tanstack/react-query"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent } from "@workspace/ui/components/card"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { LogTerminal } from "@workspace/ui/composites/log-terminal"
import { PageHeader } from "@workspace/ui/composites/page-header"
import { StatusBadge } from "@workspace/ui/composites/status-badge"
import { ArrowLeftIcon, SquareIcon } from "lucide-react"
import Link from "next/link"
import { parseAsString, useQueryState } from "nuqs"
import { RunsTable } from "@/components/runs-table"
import { orpc } from "@/lib/orpc"
import { useRunEvents } from "@/lib/use-run-events"

export function RunsView() {
  const [id] = useQueryState("id", parseAsString)
  return id ? <RunDetail id={id} /> : <RunList />
}

function RunList() {
  const runs = useQuery(orpc.runs.list.queryOptions({ input: { limit: 100 } }))
  return (
    <>
      <PageHeader title="Runs" description="History of plans, applies and verifies." />
      <Card>
        <CardContent>
          {runs.data ? <RunsTable runs={runs.data} /> : <Skeleton className="h-40" />}
        </CardContent>
      </Card>
    </>
  )
}

function RunDetail({ id }: { id: string }) {
  const run = useQuery(orpc.runs.get.queryOptions({ input: { id } }))
  const stream = useRunEvents(id)
  const cancel = useMutation(orpc.runs.cancel.mutationOptions())
  const status = stream.status === "connecting" ? (run.data?.status ?? "pending") : stream.status

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            Run <span className="font-mono text-base">{id.slice(0, 8)}</span>
            <StatusBadge status={status} />
          </span>
        }
        description={run.data ? `${run.data.kind} by ${run.data.actor}` : undefined}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/runs/">
                <ArrowLeftIcon />
                All runs
              </Link>
            </Button>
            {status === "running" ? (
              <Button variant="destructive" onClick={() => cancel.mutate({ id })}>
                <SquareIcon />
                Cancel
              </Button>
            ) : null}
          </>
        }
      />
      {stream.error ? (
        <Alert variant="destructive">
          <AlertTitle>Log stream interrupted</AlertTitle>
          <AlertDescription>{stream.error}</AlertDescription>
        </Alert>
      ) : null}
      <LogTerminal chunks={stream.chunks} streamKey={id} className="h-[60vh]" />
    </>
  )
}
