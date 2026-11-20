"use client"

import { useMutation, useQuery } from "@tanstack/react-query"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@workspace/ui/components/empty"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { toast } from "@workspace/ui/components/sonner"
import { KeyValueList } from "@workspace/ui/composites/key-value-list"
import { PageHeader } from "@workspace/ui/composites/page-header"
import { PlayIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { AppCards } from "@/components/app-cards"
import { RunsTable } from "@/components/runs-table"
import { orpc } from "@/lib/orpc"

export default function OverviewPage() {
  const router = useRouter()
  const info = useQuery(orpc.system.info.queryOptions())
  const runs = useQuery(orpc.runs.list.queryOptions({ input: { limit: 5 } }))
  const demo = useMutation(
    orpc.runs.demo.mutationOptions({
      onSuccess: (run) => router.push(`/runs/?id=${run.id}`),
      onError: (err) => toast.error("Could not start run", { description: err.message }),
    }),
  )

  return (
    <>
      <PageHeader
        title="Overview"
        description="State of this agentbox host and its workspace."
        actions={
          <Button onClick={() => demo.mutate({})} disabled={demo.isPending}>
            <PlayIcon />
            Start demo run
          </Button>
        }
      />
      <AppCards />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Host</CardTitle>
            <CardDescription>The service answering this page</CardDescription>
          </CardHeader>
          <CardContent>
            {info.data ? (
              <KeyValueList
                items={[
                  { label: "Hostname", value: info.data.hostname },
                  { label: "Platform", value: `${info.data.platform}/${info.data.arch}` },
                  { label: "Version", value: info.data.version },
                  { label: "Up since", value: new Date(info.data.startedAt).toLocaleString() },
                ]}
              />
            ) : (
              <Skeleton className="h-24" />
            )}
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recent runs</CardTitle>
            <CardDescription>Plans, applies and verifies from the UI and the CLI</CardDescription>
          </CardHeader>
          <CardContent>
            {runs.data && runs.data.length > 0 ? (
              <RunsTable runs={runs.data} />
            ) : runs.data ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>No runs yet</EmptyTitle>
                  <EmptyDescription>
                    Start a demo run to see the live log pipeline.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <Skeleton className="h-24" />
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
