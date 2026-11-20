"use client"

import { useQuery } from "@tanstack/react-query"
import type { AppInfo } from "@workspace/contract"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { type Status, StatusBadge } from "@workspace/ui/composites/status-badge"
import { ExternalLinkIcon } from "lucide-react"
import Link from "next/link"
import { orpc } from "@/lib/orpc"
import { appIcons } from "./app-icons"

const STATE: Record<AppInfo["state"], { status: Status; label: string }> = {
  not_configured: { status: "pending", label: "Not configured" },
  pending_apply: { status: "pending", label: "Waiting for apply" },
  ready: { status: "ok", label: "Running" },
  unreachable: { status: "fail", label: "Unreachable" },
}

/** One card per tool with an "Open" button that opens the tool's web UI in a new tab. */
export function AppCards() {
  const status = useQuery({ ...orpc.tools.status.queryOptions(), refetchInterval: 15_000 })
  if (!status.data) return <Skeleton className="h-36" />
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {status.data.apps.map((app) => {
        const Icon = appIcons[app.id]
        const state = STATE[app.state]
        return (
          <Card key={app.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Icon className="size-4 shrink-0" />
                <span className="truncate">{app.name}</span>
              </CardTitle>
              <CardDescription>{app.description}</CardDescription>
              <div>
                <StatusBadge status={state.status} label={state.label} />
              </div>
            </CardHeader>
            <CardFooter className="gap-2">
              {app.url && app.state === "ready" ? (
                <Button asChild size="sm">
                  <a href={app.url} target="_blank" rel="noopener noreferrer">
                    Open
                    <ExternalLinkIcon />
                  </a>
                </Button>
              ) : app.url ? (
                <Button size="sm" disabled>
                  Open
                  <ExternalLinkIcon />
                </Button>
              ) : (
                <span className="text-muted-foreground text-xs">
                  URL available once Tailscale is connected.
                </span>
              )}
              {app.state === "not_configured" ? (
                <Button asChild size="sm" variant="outline">
                  <Link href="/tools/">Configure</Link>
                </Button>
              ) : null}
            </CardFooter>
          </Card>
        )
      })}
    </div>
  )
}
