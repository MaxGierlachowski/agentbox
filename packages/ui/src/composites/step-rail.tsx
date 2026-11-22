"use client"

import { cn } from "@workspace/ui/lib/utils"
import { CheckIcon, MinusIcon } from "lucide-react"

export interface StepRailStep {
  id: string
  title: string
  description?: string
}

export interface StepRailProps {
  steps: readonly StepRailStep[]
  current: string
  completed?: readonly string[]
  skipped?: readonly string[]
  onSelect?: (id: string) => void
  /** `vertical` for the desktop rail, `compact` for a one-line mobile header. */
  variant?: "vertical" | "compact"
  className?: string
}

type StepState = "current" | "done" | "skipped" | "todo"

function stateOf(id: string, p: StepRailProps): StepState {
  if (id === p.current) return "current"
  if (p.completed?.includes(id)) return "done"
  if (p.skipped?.includes(id)) return "skipped"
  return "todo"
}

const stateLabel: Record<StepState, string> = {
  current: "current step",
  done: "done",
  skipped: "skipped",
  todo: "not started",
}

/** Progress rail for multi-step flows. Every step is reachable; state is shown, not enforced. */
export function StepRail(props: StepRailProps) {
  const { steps, current, onSelect, variant = "vertical", className } = props
  const index = Math.max(
    0,
    steps.findIndex((s) => s.id === current),
  )

  if (variant === "compact") {
    const step = steps[index]
    return (
      <nav aria-label="Progress" className={cn("space-y-2", className)} data-slot="step-rail">
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="font-medium">{step?.title}</span>
          <span className="text-muted-foreground tabular-nums">
            Step {index + 1} of {steps.length}
          </span>
        </div>
        <ol className="flex gap-1">
          {steps.map((s) => {
            const st = stateOf(s.id, props)
            return (
              <li key={s.id} className="flex-1">
                <button
                  type="button"
                  onClick={() => onSelect?.(s.id)}
                  aria-label={`${s.title} (${stateLabel[st]})`}
                  aria-current={st === "current" ? "step" : undefined}
                  className={cn(
                    "block h-1.5 w-full rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                    st === "current" && "bg-primary",
                    st === "done" && "bg-primary/60",
                    st === "skipped" && "bg-muted-foreground/30",
                    st === "todo" && "bg-muted",
                  )}
                />
              </li>
            )
          })}
        </ol>
      </nav>
    )
  }

  return (
    <nav aria-label="Progress" className={className} data-slot="step-rail">
      <ol className="relative space-y-1">
        {steps.map((s, i) => {
          const st = stateOf(s.id, props)
          return (
            <li key={s.id} className="relative">
              {i < steps.length - 1 ? (
                <span
                  aria-hidden
                  className={cn(
                    "absolute top-9 left-[1.4rem] h-[calc(100%-1.75rem)] w-px",
                    st === "done" ? "bg-primary/40" : "bg-border",
                  )}
                />
              ) : null}
              <button
                type="button"
                onClick={() => onSelect?.(s.id)}
                aria-current={st === "current" ? "step" : undefined}
                className={cn(
                  "group flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring",
                  st === "current" && "bg-muted",
                )}
              >
                <span
                  className={cn(
                    "relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border font-medium text-xs tabular-nums transition-colors",
                    st === "current" && "border-primary bg-primary text-primary-foreground",
                    st === "done" && "border-primary/40 bg-background text-primary",
                    st === "skipped" &&
                      "border-muted-foreground/40 border-dashed bg-background text-muted-foreground",
                    st === "todo" && "bg-background text-muted-foreground",
                  )}
                >
                  {st === "done" ? (
                    <CheckIcon className="size-3.5" aria-hidden />
                  ) : st === "skipped" ? (
                    <MinusIcon className="size-3.5" aria-hidden />
                  ) : (
                    i + 1
                  )}
                </span>
                <span className="min-w-0 pt-0.5">
                  <span
                    className={cn(
                      "block truncate text-sm",
                      st === "current" ? "font-medium" : "text-muted-foreground",
                      st === "done" && "text-foreground",
                    )}
                  >
                    {s.title}
                  </span>
                  {s.description && st === "current" ? (
                    <span className="block text-muted-foreground text-xs">{s.description}</span>
                  ) : null}
                  <span className="sr-only">({stateLabel[st]})</span>
                </span>
              </button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
