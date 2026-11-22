"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@workspace/ui/components/button"
import { Label } from "@workspace/ui/components/label"
import { toast } from "@workspace/ui/components/sonner"
import { Switch } from "@workspace/ui/components/switch"
import { cn } from "@workspace/ui/lib/utils"
import { ExternalLinkIcon, HandIcon, MonitorOffIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { errorMessage } from "@/lib/errors"
import { orpc } from "@/lib/orpc"

/** "Take control": agents pause while the lock exists (best effort, see the browser skill). */
export function TakeControlToggle({ className }: { className?: string }) {
  const queryClient = useQueryClient()
  const status = useQuery(orpc.browser.status.queryOptions())
  const setLock = useMutation(
    orpc.browser.setLock.mutationOptions({
      onSuccess: (s) => queryClient.setQueryData(orpc.browser.status.queryKey(), s),
      onError: (err) => toast.error("Could not change control", { description: errorMessage(err) }),
    }),
  )
  const locked = status.data?.locked ?? false
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Switch
        id="take-control"
        checked={locked}
        disabled={!status.data || setLock.isPending}
        onCheckedChange={(v) => setLock.mutate({ locked: v })}
      />
      <Label htmlFor="take-control" className="font-normal">
        Take control
      </Label>
    </div>
  )
}

/**
 * The box's Chrome, streamed by KasmVNC at /browser/ on this origin. Logins made here are
 * shared with every agent on the box.
 */
export function BrowserFrame({ className }: { className?: string }) {
  const status = useQuery(orpc.browser.status.queryOptions())
  const path = status.data?.path ?? "/browser/"
  const locked = status.data?.locked ?? false
  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-xl border bg-muted/30",
        locked && "ring-2 ring-amber-500/60",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-card px-3 py-2">
        <TakeControlToggle />
        <p className="flex-1 text-muted-foreground text-xs">
          {locked ? (
            <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
              <HandIcon className="size-3.5" aria-hidden />
              You have control. Agents wait until you hand it back.
            </span>
          ) : (
            "Agents may use this browser at the same time. Take control while you sign in."
          )}
        </p>
        <Button size="sm" variant="ghost" asChild>
          <a href={path} target="_blank" rel="noopener noreferrer">
            Open full screen
            <ExternalLinkIcon />
          </a>
        </Button>
      </div>
      {status.data && !status.data.running ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-10 text-center text-muted-foreground text-sm">
          <MonitorOffIcon className="size-8" aria-hidden />
          The browser is not running. Check Settings → Doctor.
        </div>
      ) : (
        <ScaledDesktop src={path} />
      )}
    </div>
  )
}

/** The box's desktop size (KasmVNC `desktop.resolution`, set by agentbox up). */
const DESKTOP = { width: 1600, height: 900 }

/**
 * Shows the whole box desktop in a smaller panel: the client renders at the desktop's native size
 * and is scaled down with CSS (pointer input maps through the transform).
 */
function ScaledDesktop({ src }: { src: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState({ scale: 0, x: 0, y: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const { width, height } = entry.contentRect
      const scale = Math.min(width / DESKTOP.width, height / DESKTOP.height)
      setFit({
        scale,
        x: (width - DESKTOP.width * scale) / 2,
        y: (height - DESKTOP.height * scale) / 2,
      })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return (
    <div ref={ref} className="relative min-h-0 w-full flex-1 overflow-hidden bg-neutral-900">
      <iframe
        src={src}
        title="The box's browser"
        className="absolute top-0 left-0 origin-top-left border-0 bg-white"
        style={{
          width: DESKTOP.width,
          height: DESKTOP.height,
          transform: `translate(${fit.x}px, ${fit.y}px) scale(${fit.scale})`,
          visibility: fit.scale ? "visible" : "hidden",
        }}
        allow="clipboard-read; clipboard-write; fullscreen"
      />
    </div>
  )
}
