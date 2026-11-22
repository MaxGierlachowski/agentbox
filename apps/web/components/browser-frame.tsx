"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@workspace/ui/components/button"
import { Label } from "@workspace/ui/components/label"
import { toast } from "@workspace/ui/components/sonner"
import { Switch } from "@workspace/ui/components/switch"
import { cn } from "@workspace/ui/lib/utils"
import { ExternalLinkIcon, HandIcon, MonitorOffIcon } from "lucide-react"
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
        <iframe
          src={path}
          title="The box's browser"
          className="min-h-0 w-full flex-1 bg-white"
          allow="clipboard-read; clipboard-write; fullscreen"
        />
      )}
    </div>
  )
}
