"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AutomationSettings, type AutomationStatus, type AutomationTask } from "@workspace/contract"
import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@workspace/ui/components/empty"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { toast } from "@workspace/ui/components/sonner"
import { Spinner } from "@workspace/ui/components/spinner"
import { Switch } from "@workspace/ui/components/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import { PageHeader } from "@workspace/ui/composites/page-header"
import { type Status, StatusBadge } from "@workspace/ui/composites/status-badge"
import { formatDistanceToNow } from "date-fns"
import { CircleAlertIcon, PlusIcon, RefreshCwIcon, SaveIcon, Trash2Icon } from "lucide-react"
import { useEffect } from "react"
import { Controller, useFieldArray, useForm } from "react-hook-form"
import type { z } from "zod"
import { orpc } from "@/lib/orpc"

type FormValues = z.input<typeof AutomationSettings>

const TASK_STATUS: Record<AutomationTask["status"], { status: Status; label: string }> = {
  running: { status: "running", label: "In progress" },
  review: { status: "ok", label: "In review" },
  failed: { status: "fail", label: "Failed" },
  interrupted: { status: "warn", label: "Interrupted" },
}

export function AutomationView() {
  const status = useQuery({ ...orpc.automation.status.queryOptions(), refetchInterval: 10_000 })
  const queryClient = useQueryClient()
  const pollNow = useMutation(
    orpc.automation.pollNow.mutationOptions({
      onSuccess: (next) => queryClient.setQueryData(orpc.automation.status.queryKey(), next),
      onError: (err) => toast.error("Poll failed", { description: err.message }),
    }),
  )
  return (
    <>
      <PageHeader
        title="Automation"
        description="Open Plane work items labelled for Claude are started as Claude Code sessions in CloudCLI, moved to In Progress, and to In Review with a summary when done."
        actions={
          <Button
            variant="outline"
            onClick={() => pollNow.mutate({})}
            disabled={pollNow.isPending || !status.data?.active}
          >
            {pollNow.isPending ? <Spinner /> : <RefreshCwIcon />}
            Check Plane now
          </Button>
        }
      />
      {status.data ? (
        <>
          <StateBanner status={status.data} />
          <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <TasksCard tasks={status.data.tasks} />
            <SettingsCard status={status.data} />
          </div>
        </>
      ) : (
        <Skeleton className="h-96" />
      )}
    </>
  )
}

function StateBanner({ status }: { status: AutomationStatus }) {
  if (status.lastError) {
    return (
      <Alert variant="destructive">
        <CircleAlertIcon />
        <AlertTitle>Last poll failed</AlertTitle>
        <AlertDescription>{status.lastError}</AlertDescription>
      </Alert>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <StatusBadge
        status={status.active ? "running" : "pending"}
        label={status.active ? "Active" : "Inactive"}
      />
      <span className="text-muted-foreground">
        {status.blockedBy ??
          (status.lastPollAt
            ? `Last checked ${formatDistanceToNow(new Date(status.lastPollAt), { addSuffix: true })}`
            : "Waiting for the first check")}
      </span>
    </div>
  )
}

function TasksCard({ tasks }: { tasks: AutomationTask[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Work items</CardTitle>
        <CardDescription>
          Most recent first. Links open Plane and the CloudCLI session.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {tasks.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>Nothing picked up yet</EmptyTitle>
              <EmptyDescription>
                Add the label to an open work item in Plane to hand it to Claude.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Repo</TableHead>
                <TableHead>Session</TableHead>
                <TableHead className="text-right">Started</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="max-w-72">
                    <div className="truncate">
                      {t.issueUrl ? (
                        <a
                          href={t.issueUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-xs underline-offset-4 hover:underline"
                        >
                          {t.key}
                        </a>
                      ) : (
                        <span className="font-mono text-xs">{t.key}</span>
                      )}{" "}
                      {t.title}
                    </div>
                    {t.error ? (
                      <div className="truncate text-destructive text-xs">{t.error}</div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <StatusBadge
                      status={TASK_STATUS[t.status].status}
                      label={TASK_STATUS[t.status].label}
                    />
                    {t.attempt > 1 ? (
                      <span className="ml-2 text-muted-foreground text-xs">run {t.attempt}</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{t.repo}</TableCell>
                  <TableCell>
                    {t.sessionUrl ? (
                      <a
                        href={t.sessionUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm underline-offset-4 hover:underline"
                      >
                        Open
                      </a>
                    ) : (
                      <span className="text-muted-foreground text-xs">–</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground text-xs">
                    {formatDistanceToNow(new Date(t.startedAt), { addSuffix: true })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

function SettingsCard({ status }: { status: AutomationStatus }) {
  const queryClient = useQueryClient()
  const form = useForm<FormValues>({
    resolver: zodResolver(AutomationSettings),
    defaultValues: status.settings,
  })
  const projects = useFieldArray({ control: form.control, name: "projects" })
  useEffect(() => {
    form.reset(status.settings)
  }, [status.settings, form])
  const save = useMutation(
    orpc.automation.save.mutationOptions({
      onSuccess: (next) => {
        queryClient.setQueryData(orpc.automation.status.queryKey(), next)
        toast.success("Automation settings saved")
      },
      onError: (err) => toast.error("Could not save", { description: err.message }),
    }),
  )

  const number = (
    name: "pollSeconds" | "maxParallel" | "timeoutMinutes",
    label: string,
    description: string,
  ) => (
    <Controller
      name={name}
      control={form.control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={name}>{label}</FieldLabel>
          <Input
            id={name}
            type="number"
            value={field.value ?? ""}
            onChange={(e) =>
              field.onChange(e.target.value === "" ? undefined : Number(e.target.value))
            }
            aria-invalid={fieldState.invalid}
          />
          <FieldDescription>{description}</FieldDescription>
          {fieldState.error ? <FieldError errors={[fieldState.error]} /> : null}
        </Field>
      )}
    />
  )

  return (
    <Card>
      <form onSubmit={form.handleSubmit((v) => save.mutate(AutomationSettings.parse(v)))}>
        <CardHeader>
          <CardTitle>Settings</CardTitle>
          <CardDescription>Changes apply immediately.</CardDescription>
        </CardHeader>
        <CardContent className="py-6">
          <FieldGroup>
            <Controller
              name="enabled"
              control={form.control}
              render={({ field }) => (
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldLabel htmlFor="enabled">Automation on</FieldLabel>
                    <FieldDescription>
                      Switch off to pause; running sessions continue.
                    </FieldDescription>
                  </FieldContent>
                  <Switch
                    id="enabled"
                    checked={field.value ?? false}
                    onCheckedChange={field.onChange}
                  />
                </Field>
              )}
            />
            <Controller
              name="label"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="label">Label</FieldLabel>
                  <Input id="label" {...field} value={field.value ?? ""} className="font-mono" />
                  <FieldDescription>
                    Work items with this label are handed to Claude.
                  </FieldDescription>
                  {fieldState.error ? <FieldError errors={[fieldState.error]} /> : null}
                </Field>
              )}
            />
            <Controller
              name="stateGroups"
              control={form.control}
              render={({ field }) => (
                <FieldSet>
                  <FieldLegend variant="label">Pick up items in</FieldLegend>
                  {(["unstarted", "backlog"] as const).map((group) => (
                    <Field key={group} orientation="horizontal">
                      <Checkbox
                        id={`group-${group}`}
                        checked={field.value?.includes(group) ?? false}
                        onCheckedChange={(on) =>
                          field.onChange(
                            on
                              ? [...(field.value ?? []), group]
                              : (field.value ?? []).filter((g) => g !== group),
                          )
                        }
                      />
                      <FieldLabel htmlFor={`group-${group}`}>
                        {group === "unstarted" ? "Todo" : "Backlog"}
                      </FieldLabel>
                    </Field>
                  ))}
                </FieldSet>
              )}
            />
            {number(
              "pollSeconds",
              "Check every (seconds)",
              "15–3600. Plane allows 120 API calls per minute.",
            )}
            {number("maxParallel", "Sessions at the same time", "1–4.")}
            {number(
              "timeoutMinutes",
              "Timeout (minutes)",
              "A session running longer counts as failed.",
            )}
            <FieldSet>
              <FieldLegend variant="label">Plane project → repository</FieldLegend>
              {projects.fields.map((row, i) => (
                <div key={row.id} className="flex items-start gap-2">
                  <Controller
                    name={`projects.${i}.plane`}
                    control={form.control}
                    render={({ field, fieldState }) => (
                      <Input
                        {...field}
                        placeholder="SHOP"
                        className="font-mono"
                        aria-label="Plane project identifier"
                        aria-invalid={fieldState.invalid}
                        onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                      />
                    )}
                  />
                  <Controller
                    name={`projects.${i}.repo`}
                    control={form.control}
                    render={({ field, fieldState }) => (
                      <Input
                        {...field}
                        placeholder="shop-api"
                        className="font-mono"
                        aria-label="Repository"
                        aria-invalid={fieldState.invalid}
                      />
                    )}
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label="Remove"
                    onClick={() => projects.remove(i)}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => projects.append({ plane: "", repo: "" })}
              >
                <PlusIcon />
                Add mapping
              </Button>
            </FieldSet>
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? <Spinner /> : <SaveIcon />}
            Save
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
