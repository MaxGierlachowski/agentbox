"use client"

import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react"
import type { ReactNode } from "react"
import { STEPS } from "@/lib/onboarding"
import { useWizard } from "./context"

export interface StepLayoutProps {
  title: string
  description: ReactNode
  children: ReactNode
  /** Extra header actions (right of the title). */
  actions?: ReactNode
  onContinue?: () => void | Promise<void>
  continueLabel?: string
  continueDisabled?: boolean
  /** The step's own work is running (saving, suggesting …). */
  pending?: boolean
  /** Hint left of the buttons (e.g. why Continue is disabled). */
  hint?: ReactNode
  hideSkip?: boolean
}

export function StepLayout({
  title,
  description,
  children,
  actions,
  onContinue,
  continueLabel = "Continue",
  continueDisabled,
  pending,
  hint,
  hideSkip,
}: StepLayoutProps) {
  const w = useWizard()
  const index = STEPS.findIndex((s) => s.id === w.step)
  const busy = pending || w.busy

  return (
    <section aria-labelledby="step-title" className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl space-y-1.5">
          <p className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
            Step {index + 1} of {STEPS.length}
          </p>
          <h1 id="step-title" className="font-semibold text-2xl tracking-tight">
            {title}
          </h1>
          <p className="text-muted-foreground">{description}</p>
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {children}
      <footer className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/90 backdrop-blur supports-backdrop-filter:bg-background/75">
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-3 lg:pl-[calc(15rem+4rem)]">
          {index > 0 ? (
            <Button variant="ghost" onClick={w.back} disabled={busy} aria-label="Previous step">
              <ArrowLeftIcon />
              <span className="hidden sm:inline">Back</span>
            </Button>
          ) : null}
          <div className="hidden min-w-0 flex-1 truncate text-muted-foreground text-sm sm:block">
            {hint}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {!hideSkip ? (
              <Button variant="ghost" onClick={() => void w.skip()} disabled={busy}>
                Skip this step
              </Button>
            ) : null}
            <Button
              onClick={() => void (onContinue ? onContinue() : w.advance())}
              disabled={continueDisabled || busy}
              data-testid="continue"
            >
              {busy ? <Spinner /> : null}
              {continueLabel}
              {!busy ? <ArrowRightIcon /> : null}
            </Button>
          </div>
        </div>
      </footer>
    </section>
  )
}
