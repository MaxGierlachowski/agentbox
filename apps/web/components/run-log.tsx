"use client"

import { useMutation } from "@tanstack/react-query"
import type { RunStatus } from "@workspace/contract"
import { Button } from "@workspace/ui/components/button"
import { LogTerminal } from "@workspace/ui/composites/log-terminal"
import { RunDrawer } from "@workspace/ui/composites/run-drawer"
import { StatusBadge } from "@workspace/ui/composites/status-badge"
import { cn } from "@workspace/ui/lib/utils"
import { ExternalLinkIcon, SquareIcon } from "lucide-react"
import Link from "next/link"
import { orpc } from "@/lib/orpc"
import { type RunStreamState, useRunEvents } from "@/lib/use-run-events"

export const runStatus = (s: RunStreamState): RunStatus =>
  s.status === "connecting" ? "pending" : s.status

function CancelButton({ runId, status }: { runId: string; status: RunStatus }) {
  const cancel = useMutation(orpc.runs.cancel.mutationOptions())
  if (status !== "running" && status !== "pending") return null
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => cancel.mutate({ id: runId })}
      disabled={cancel.isPending}
    >
      <SquareIcon />
      Cancel
    </Button>
  )
}

/** A run's live log in the bottom drawer. Closing the drawer does not stop the run. */
export function RunLogDrawer({
  runId,
  title,
  open,
  onOpenChange,
}: {
  runId: string | null
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const stream = useRunEvents(runId)
  const status = runStatus(stream)
  if (!runId) return null
  return (
    <RunDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      status={status}
      chunks={stream.chunks}
      streamKey={runId}
      description={stream.error ? `Log stream interrupted: ${stream.error}` : undefined}
      actions={
        <>
          <CancelButton runId={runId} status={status} />
          <Button size="sm" variant="ghost" asChild>
            <Link href={`/runs/?id=${runId}`}>
              Run page
              <ExternalLinkIcon />
            </Link>
          </Button>
        </>
      }
    />
  )
}

/** Inline live log with a status line, for pages where the run is the main content. */
export function InlineRunLog({
  runId,
  title,
  className,
  onFinished,
}: {
  runId: string
  title: string
  className?: string
  onFinished?: (status: RunStatus) => void
}) {
  const stream = useRunEvents(runId, onFinished)
  const status = runStatus(stream)
  return (
    <div className={cn("space-y-2", className)} data-testid="run-log" data-status={status}>
      <div className="flex items-center gap-2">
        <span className="font-medium text-sm">{title}</span>
        <StatusBadge status={status} />
        <div className="ml-auto">
          <CancelButton runId={runId} status={status} />
        </div>
      </div>
      <LogTerminal chunks={stream.chunks} streamKey={runId} className="h-72" />
    </div>
  )
}
