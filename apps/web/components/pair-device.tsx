"use client"

import { useMutation, useQuery } from "@tanstack/react-query"
import type { PairingWindow } from "@workspace/contract"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"
import { CopyField } from "@workspace/ui/composites/copy-field"
import { QrCode } from "@workspace/ui/composites/qr-code"
import { CircleCheckIcon, LaptopIcon, RefreshCwIcon, SmartphoneIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { errorMessage } from "@/lib/errors"
import { orpc } from "@/lib/orpc"

type Kind = "phone" | "laptop"

function useCountdown(expiresAt: string | undefined) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!expiresAt) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [expiresAt])
  if (!expiresAt) return null
  return Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000))
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`

/**
 * Opens a pairing window and shows the phone link as a QR code and the laptop command, with a
 * countdown. Watches the device list and reports the new device once it pairs.
 */
export function PairPanel({ initialKind = "phone" }: { initialKind?: Kind }) {
  const [kind, setKind] = useState<Kind>(initialKind)
  const [window_, setWindow] = useState<PairingWindow | null>(null)
  const [baseline, setBaseline] = useState<string[] | null>(null)
  const start = useMutation(
    orpc.devices.pairStart.mutationOptions({ onSuccess: (w) => setWindow(w) }),
  )
  const devices = useQuery({
    ...orpc.devices.list.queryOptions(),
    refetchInterval: window_ ? 2000 : false,
  })
  const remaining = useCountdown(window_?.expiresAt)
  const expired = remaining === 0

  // One window serves both kinds; open it once when the panel mounts.
  const { mutate } = start
  useEffect(() => {
    mutate({ kind: initialKind })
  }, [mutate, initialKind])

  const ids = devices.data?.map((d) => d.id)
  if (ids && baseline === null && window_) setBaseline(ids)
  const paired = baseline ? devices.data?.find((d) => !baseline.includes(d.id)) : undefined

  if (paired) {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center" aria-live="polite">
        <CircleCheckIcon className="size-10 text-emerald-600" aria-hidden />
        <p className="font-medium">{paired.name} is paired</p>
        <p className="text-muted-foreground text-sm">
          It reaches this box from anywhere now, end-to-end encrypted over iroh.
        </p>
      </div>
    )
  }

  if (start.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription className="space-y-2">
          <p>Could not open a pairing window: {errorMessage(start.error)}</p>
          <Button size="sm" variant="outline" onClick={() => start.mutate({ kind })}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <Tabs value={kind} onValueChange={(v) => setKind(v as Kind)} className="gap-4">
      <TabsList className="w-full">
        <TabsTrigger value="phone">
          <SmartphoneIcon />
          Phone
        </TabsTrigger>
        <TabsTrigger value="laptop">
          <LaptopIcon />
          Laptop
        </TabsTrigger>
      </TabsList>
      {!window_ ? (
        <Skeleton className="mx-auto aspect-square w-56" />
      ) : expired ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <p className="text-muted-foreground text-sm">This pairing code expired.</p>
          <Button
            onClick={() => {
              setWindow(null)
              start.mutate({ kind })
            }}
          >
            <RefreshCwIcon />
            New code
          </Button>
        </div>
      ) : (
        <>
          <TabsContent value="phone" className="space-y-4">
            <div className="flex justify-center">
              <QrCode
                value={window_.pwaLink}
                label="QR code that opens Hermes UI on your phone and pairs it with this box"
                className="w-56 border p-1"
              />
            </div>
            <ol className="list-decimal space-y-1 pl-5 text-muted-foreground text-sm">
              <li>Scan the code with your phone's camera.</li>
              <li>Hermes UI opens and pairs with this box. Add it to your home screen.</li>
            </ol>
            <CopyField value={window_.pwaLink} />
          </TabsContent>
          <TabsContent value="laptop" className="space-y-3">
            <p className="text-muted-foreground text-sm">
              Install agentbox on the laptop, then run this. It serves the box on{" "}
              <code className="font-mono text-xs">http://localhost:8080</code>.
            </p>
            <CopyField value={window_.connectCommand} />
          </TabsContent>
          <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2 text-sm">
            <span>
              Code <span className="font-mono font-semibold tracking-widest">{window_.code}</span>
            </span>
            <span className="text-muted-foreground tabular-nums" aria-live="off">
              expires in {remaining !== null ? mmss(remaining) : "…"}
            </span>
          </div>
        </>
      )}
    </Tabs>
  )
}

export function PairDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Pair a device</DialogTitle>
          <DialogDescription>
            Paired devices reach this box from anywhere, without opening a port.
          </DialogDescription>
        </DialogHeader>
        {open ? <PairPanel /> : null}
      </DialogContent>
    </Dialog>
  )
}
