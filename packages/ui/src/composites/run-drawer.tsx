"use client"

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@workspace/ui/components/sheet"
import { LogTerminal } from "@workspace/ui/composites/log-terminal"
import { type Status, StatusBadge } from "@workspace/ui/composites/status-badge"
import type { ReactNode } from "react"

export interface RunDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  status: Status
  /** Terminal chunks of the run log (ANSI allowed). */
  chunks: readonly string[]
  streamKey: string
  /** Buttons in the header (cancel, open run page …). */
  actions?: ReactNode
}

/** Bottom drawer with the live log of a long job (installs, clones). Closing keeps it running. */
export function RunDrawer({
  open,
  onOpenChange,
  title,
  description,
  status,
  chunks,
  streamKey,
  actions,
}: RunDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[85svh] gap-0 rounded-t-2xl"
        data-slot="run-drawer"
      >
        <SheetHeader className="flex-row flex-wrap items-center gap-x-3 gap-y-1 border-b pr-12">
          <SheetTitle className="flex items-center gap-2">{title}</SheetTitle>
          <StatusBadge status={status} />
          {description ? (
            <SheetDescription className="basis-full sm:basis-auto">{description}</SheetDescription>
          ) : (
            <SheetDescription className="sr-only">Live log</SheetDescription>
          )}
          {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
        </SheetHeader>
        <div className="p-3 sm:p-4">
          <LogTerminal chunks={chunks} streamKey={streamKey} className="h-[50svh]" />
        </div>
      </SheetContent>
    </Sheet>
  )
}
