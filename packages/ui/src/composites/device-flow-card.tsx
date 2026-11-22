"use client"

import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { cn } from "@workspace/ui/lib/utils"
import {
  CheckIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  RotateCcwIcon,
} from "lucide-react"
import { type ReactNode, useState } from "react"

export type DeviceFlowState =
  | "idle"
  | "starting"
  | "waiting"
  | "done"
  | "error"
  | "cancelled"
  | "unavailable"

export interface DeviceFlowCardProps {
  title: string
  description?: ReactNode
  icon?: ReactNode
  state: DeviceFlowState
  /** Device code the user types on the provider's page. */
  code?: string | null
  url?: string | null
  /** Who signed in, once done. */
  user?: string | null
  message?: string | null
  onStart?: () => void
  onCancel?: () => void
  startLabel?: string
  /** Shown below the card body (PAT fallback, host field …). */
  footer?: ReactNode
  className?: string
}

/**
 * A CLI device-flow login (gh, glab …) as a card: big code, Copy, Open link, a spinner while
 * the CLI waits, and the signed-in user once it exits.
 */
export function DeviceFlowCard({
  title,
  description,
  icon,
  state,
  code,
  url,
  user,
  message,
  onStart,
  onCancel,
  startLabel = "Sign in",
  footer,
  className,
}: DeviceFlowCardProps) {
  const [copied, setCopied] = useState(false)
  const host = url ? safeHost(url) : null

  return (
    <section
      aria-label={title}
      data-slot="device-flow-card"
      data-state={state}
      className={cn(
        "flex flex-col gap-4 rounded-xl border bg-card p-4 text-card-foreground transition-colors sm:p-5",
        state === "done" && "border-emerald-600/30 bg-emerald-50/40 dark:bg-emerald-950/20",
        className,
      )}
    >
      <header className="flex items-start gap-3">
        {icon ? (
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background [&_svg]:size-5">
            {icon}
          </div>
        ) : null}
        <div className="min-w-0 flex-1">
          <h3 className="font-medium leading-tight">{title}</h3>
          {description ? (
            <p className="mt-0.5 text-muted-foreground text-sm">{description}</p>
          ) : null}
        </div>
        {state === "done" ? (
          <CircleCheckIcon className="size-5 shrink-0 text-emerald-600" aria-hidden />
        ) : null}
      </header>

      {state === "waiting" && code ? (
        <div className="space-y-3" aria-live="polite">
          <p className="text-muted-foreground text-sm">
            Open {host ?? "the sign-in page"} and enter this code:
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <output
              className="rounded-lg border bg-muted/50 px-4 py-2 font-mono font-semibold text-2xl tracking-[0.2em] sm:text-3xl"
              aria-label={`Device code ${code.split("").join(" ")}`}
            >
              {code}
            </output>
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                await navigator.clipboard.writeText(code)
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              }}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
              {copied ? "Copied" : "Copy"}
            </Button>
            {url ? (
              <Button asChild>
                <a href={url} target="_blank" rel="noopener noreferrer">
                  Open {host ?? "link"}
                  <ExternalLinkIcon />
                </a>
              </Button>
            ) : null}
          </div>
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Spinner className="size-4" />
            <span>Waiting for you to approve…</span>
            {onCancel ? (
              <Button type="button" variant="link" size="sm" className="ml-auto" onClick={onCancel}>
                Cancel
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {state === "starting" || (state === "waiting" && !code) ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm" aria-live="polite">
          <Spinner className="size-4" />
          {message ?? "Starting…"}
        </div>
      ) : null}

      {state === "done" ? (
        <p
          className="font-medium text-emerald-700 text-sm dark:text-emerald-400"
          aria-live="polite"
        >
          <CheckIcon className="mr-1 inline size-4 align-[-3px]" aria-hidden />
          Signed in{user ? ` as ${user.startsWith("@") ? user : `@${user}`}` : ""}
        </p>
      ) : null}

      {state === "error" || state === "cancelled" ? (
        <div className="flex flex-wrap items-center gap-3">
          <p
            className={cn(
              "flex items-center gap-1.5 text-sm",
              state === "error" ? "text-destructive" : "text-muted-foreground",
            )}
            role={state === "error" ? "alert" : undefined}
          >
            {state === "error" ? <CircleAlertIcon className="size-4" aria-hidden /> : null}
            {message ?? (state === "error" ? "Sign-in failed" : "Cancelled")}
          </p>
          {onStart ? (
            <Button type="button" variant="outline" size="sm" onClick={onStart}>
              <RotateCcwIcon />
              Try again
            </Button>
          ) : null}
        </div>
      ) : null}

      {state === "idle" ? (
        <div>
          <Button type="button" onClick={onStart} disabled={!onStart}>
            {startLabel}
          </Button>
        </div>
      ) : null}

      {state === "unavailable" ? (
        <p className="flex items-center gap-2 text-muted-foreground text-sm" aria-live="polite">
          <Spinner className="size-4" />
          {message ?? "Not available yet"}
        </p>
      ) : null}

      {footer}
    </section>
  )
}

function safeHost(url: string) {
  try {
    return new URL(url).host
  } catch {
    return null
  }
}
