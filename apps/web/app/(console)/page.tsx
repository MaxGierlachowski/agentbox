"use client"

import { useQuery } from "@tanstack/react-query"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { KeyValueList } from "@workspace/ui/composites/key-value-list"
import { StatusBadge } from "@workspace/ui/composites/status-badge"
import { formatDistanceToNow } from "date-fns"
import { ArrowUpRightIcon, MessageSquareIcon, MonitorIcon, SmartphoneIcon } from "lucide-react"
import Link from "next/link"
import { RunsTable } from "@/components/runs-table"
import { orpc } from "@/lib/orpc"

export default function OverviewPage() {
  const info = useQuery(orpc.system.info.queryOptions())
  const services = useQuery({ ...orpc.system.services.queryOptions(), refetchInterval: 15_000 })
  const runs = useQuery(orpc.runs.list.queryOptions({ input: { limit: 5 } }))
  const me = useQuery(orpc.auth.me.queryOptions())
  const healthy = services.data?.filter((s) => s.healthy).length ?? 0

  return (
    <>
      <section className="relative overflow-hidden rounded-2xl border bg-card p-6 sm:p-8">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-[radial-gradient(circle,var(--color-muted),transparent_70%)]"
        />
        <div className="relative space-y-4">
          <div className="space-y-1">
            <p className="text-muted-foreground text-sm">
              {info.data ? info.data.hostname : <Skeleton className="inline-block h-4 w-24" />}
            </p>
            <h1 className="font-semibold text-2xl tracking-tight sm:text-3xl">
              {me.data?.name
                ? `Hi ${me.data.name.split(" ")[0]}, your box is ready.`
                : "Your box is ready."}
            </h1>
            <p className="max-w-xl text-muted-foreground">
              Daily work happens in Hermes UI. This console is for setting the box up and keeping it
              healthy.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="lg" asChild>
              <a href="/hermes/">
                <MessageSquareIcon />
                Open Hermes UI
                <ArrowUpRightIcon />
              </a>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/desktop/">
                <MonitorIcon />
                Browser
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/devices/?pair=1">
                <SmartphoneIcon />
                Pair a device
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Services</CardTitle>
            <CardDescription>
              {services.data ? `${healthy} of ${services.data.length} healthy` : "Checking…"}
            </CardDescription>
            <CardAction>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/settings/#doctor">Doctor</Link>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            {services.data ? (
              <ul className="divide-y">
                {services.data.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm">{s.label}</p>
                      <p className="truncate font-mono text-muted-foreground text-xs">{s.unit}</p>
                    </div>
                    <span className="hidden text-muted-foreground text-xs sm:inline">
                      {s.message}
                    </span>
                    <StatusBadge
                      status={!s.active ? "fail" : s.healthy ? "ok" : "warn"}
                      label={!s.active ? "Stopped" : s.healthy ? "Healthy" : "Degraded"}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <Skeleton className="h-40" />
            )}
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>This box</CardTitle>
          </CardHeader>
          <CardContent>
            {info.data ? (
              <KeyValueList
                items={[
                  { label: "Version", value: info.data.version },
                  { label: "Platform", value: `${info.data.platform}/${info.data.arch}` },
                  { label: "Reachable at", value: info.data.lanUrl ?? "localhost only" },
                  {
                    label: "Up since",
                    value: formatDistanceToNow(new Date(info.data.startedAt), { addSuffix: true }),
                  },
                  ...(info.data.certFingerprint
                    ? [
                        {
                          label: "TLS SHA-256",
                          value: (
                            <span title={info.data.certFingerprint}>
                              {info.data.certFingerprint}
                            </span>
                          ),
                        },
                      ]
                    : []),
                ]}
              />
            ) : (
              <Skeleton className="h-28" />
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent runs</CardTitle>
          <CardDescription>Installs, clones and checks</CardDescription>
          <CardAction>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/runs/">All runs</Link>
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {runs.data?.length ? (
            <RunsTable runs={runs.data} />
          ) : runs.data ? (
            <p className="py-6 text-center text-muted-foreground text-sm">No runs yet.</p>
          ) : (
            <Skeleton className="h-24" />
          )}
        </CardContent>
      </Card>
    </>
  )
}
