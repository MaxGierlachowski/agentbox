"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { Device } from "@workspace/contract"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@workspace/ui/components/alert-dialog"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent } from "@workspace/ui/components/card"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { toast } from "@workspace/ui/components/sonner"
import { PageHeader } from "@workspace/ui/composites/page-header"
import { formatDistanceToNow } from "date-fns"
import { LaptopIcon, MonitorSmartphoneIcon, PlusIcon, SmartphoneIcon } from "lucide-react"
import { parseAsBoolean, useQueryState } from "nuqs"
import { PairDialog } from "@/components/pair-device"
import { errorMessage } from "@/lib/errors"
import { orpc } from "@/lib/orpc"

const icons = { phone: SmartphoneIcon, laptop: LaptopIcon, other: MonitorSmartphoneIcon }

export function DevicesView() {
  // Hermes UI links here with ?pair=1 (HERMES_UI_PAIRING_URL).
  const [pair, setPair] = useQueryState("pair", parseAsBoolean.withDefault(false))
  const devices = useQuery(orpc.devices.list.queryOptions())

  return (
    <>
      <PageHeader
        title="Devices"
        description="Phones and laptops paired with this box. They connect end-to-end encrypted over iroh, from anywhere."
        actions={
          <Button onClick={() => void setPair(true)}>
            <PlusIcon />
            Pair a device
          </Button>
        }
      />
      {devices.isPending ? (
        <Skeleton className="h-40" />
      ) : devices.data?.length ? (
        <Card className="py-0">
          <CardContent className="px-0">
            <ul className="divide-y">
              {devices.data.map((d) => (
                <DeviceRow key={d.id} device={d} />
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SmartphoneIcon />
            </EmptyMedia>
            <EmptyTitle>No paired devices</EmptyTitle>
            <EmptyDescription>
              Pair your phone to use Hermes UI on the go, or a laptop to reach the box without a
              VPN.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => void setPair(true)}>Pair a device</Button>
          </EmptyContent>
        </Empty>
      )}
      <PairDialog open={pair} onOpenChange={(o) => void setPair(o ? true : null)} />
    </>
  )
}

function DeviceRow({ device }: { device: Device }) {
  const queryClient = useQueryClient()
  const revoke = useMutation(
    orpc.devices.revoke.mutationOptions({
      onSuccess: () => {
        toast.success(`${device.name} can no longer connect`)
        void queryClient.invalidateQueries({ queryKey: orpc.devices.key() })
      },
      onError: (e) => toast.error("Could not revoke", { description: errorMessage(e) }),
    }),
  )
  const Icon = icons[device.kind]
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
      <span className="flex size-9 items-center justify-center rounded-lg bg-muted">
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-sm">{device.name}</p>
        <p className="truncate text-muted-foreground text-xs">
          Paired {formatDistanceToNow(new Date(device.createdAt), { addSuffix: true })}
          {device.lastSeenAt
            ? ` · seen ${formatDistanceToNow(new Date(device.lastSeenAt), { addSuffix: true })}`
            : " · never seen"}
          {" · "}
          <span className="font-mono" title={device.irohId}>
            {device.irohId.slice(0, 10)}…
          </span>
        </p>
      </div>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="outline" size="sm">
            Revoke
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke {device.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              It is disconnected on its next request and has to be paired again to come back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => revoke.mutate({ id: device.id })}
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  )
}
