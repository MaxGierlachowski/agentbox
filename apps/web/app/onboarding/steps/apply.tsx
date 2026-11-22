"use client"

import { useMutation, useQuery } from "@tanstack/react-query"
import type { RunStatus } from "@workspace/contract"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Label } from "@workspace/ui/components/label"
import { toast } from "@workspace/ui/components/sonner"
import { Spinner } from "@workspace/ui/components/spinner"
import { Textarea } from "@workspace/ui/components/textarea"
import { cn } from "@workspace/ui/lib/utils"
import { CircleCheckIcon, PackageCheckIcon, SmartphoneIcon } from "lucide-react"
import { useState } from "react"
import { PairPanel } from "@/components/pair-device"
import { InlineRunLog } from "@/components/run-log"
import { selectionIds } from "@/lib/catalog"
import { errorMessage } from "@/lib/errors"
import { orpc } from "@/lib/orpc"
import { useWizard } from "../context"
import { StepLayout } from "../step-layout"

const short = (id: string) => id.replace(/^(skill|mcp|cli)\./, "")

export function ApplyStep() {
  const w = useWizard()
  const toolkit = useQuery(orpc.toolkit.get.queryOptions())
  const profiles = useQuery(orpc.profiles.list.queryOptions())
  const repos = useQuery(orpc.repos.local.queryOptions())
  const [runId, setRunId] = useState<string | null>(null)
  const [result, setResult] = useState<RunStatus | null>(null)
  const [task, setTask] = useState(w.state.firstTask)
  const [pairing, setPairing] = useState(false)
  const apply = useMutation(
    orpc.toolkit.apply.mutationOptions({
      onSuccess: (r) => setRunId(r.id),
      onError: (e) => toast.error("Could not start the install", { description: errorMessage(e) }),
    }),
  )

  const installed = new Set(toolkit.data ? selectionIds(toolkit.data.installed) : [])
  const wanted = selectionIds(w.state.selection)
  const todo = wanted.filter((id) => !installed.has(id))
  const groups = [
    { title: "Skills", ids: w.state.selection.skills },
    { title: "MCP servers", ids: w.state.selection.mcps },
    { title: "CLIs", ids: w.state.selection.clis },
  ]
  const alternatives = [w.state.firstTask, ...w.state.firstTaskAlternatives].filter(
    (t, i, all) => t && all.indexOf(t) === i,
  )
  const running = apply.isPending || (runId !== null && result === null)

  async function openHermes() {
    await w.save({
      firstTask: task.trim(),
      completed: w.state.completed.includes("apply")
        ? w.state.completed
        : [...w.state.completed, "apply"],
    })
    await w.openHermes()
  }

  return (
    <StepLayout
      title="Install & hand-off"
      description="One run installs your toolkit and restarts Hermes. Then you're in Hermes UI with your first task ready to send."
      onContinue={openHermes}
      continueLabel="Open Hermes UI"
      hideSkip
      hint={
        running
          ? "Installing… you can open Hermes UI any time; the install keeps running."
          : result === "succeeded"
            ? todo.length
              ? `Installed. ${todo.length} item${todo.length === 1 ? " waits" : "s wait"} for a sign-in or key; add ${todo.length === 1 ? "it" : "them"} again under Toolkit once connected.`
              : "Everything is installed."
            : undefined
      }
    >
      <div className="grid gap-4 xl:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PackageCheckIcon className="size-4 text-muted-foreground" aria-hidden />
                What gets installed
              </CardTitle>
              <CardDescription>
                {todo.length
                  ? `${todo.length} of ${wanted.length} items are new.`
                  : wanted.length
                    ? "Everything you picked is already installed."
                    : "Nothing picked. Hermes works with the basics."}
                {profiles.data
                  ? ` · ${profiles.data.length} agent${profiles.data.length === 1 ? "" : "s"}`
                  : ""}
                {repos.data?.length
                  ? ` · ${repos.data.length} repo${repos.data.length === 1 ? "" : "s"} cloned`
                  : ""}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="space-y-3">
                {groups.map((g) => (
                  <div key={g.title} className="grid gap-1.5 sm:grid-cols-[7rem_1fr]">
                    <dt className="text-muted-foreground text-sm">
                      {g.title} <span className="tabular-nums">({g.ids.length})</span>
                    </dt>
                    <dd className="flex flex-wrap gap-1">
                      {g.ids.length ? (
                        g.ids.map((id) => (
                          <Badge
                            key={id}
                            variant={installed.has(id) ? "outline" : "secondary"}
                            className="font-normal"
                          >
                            {installed.has(id) ? (
                              <CircleCheckIcon
                                className="size-3 text-emerald-600"
                                aria-label="installed"
                              />
                            ) : null}
                            {short(id)}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-muted-foreground text-sm">none</span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
              {runId ? (
                <InlineRunLog
                  runId={runId}
                  title="Installing your toolkit"
                  onFinished={(status) => {
                    setResult(status)
                    void toolkit.refetch()
                  }}
                />
              ) : (
                <Button
                  size="lg"
                  onClick={() => apply.mutate({ add: todo, remove: [] })}
                  disabled={apply.isPending || todo.length === 0}
                  data-testid="install"
                >
                  {apply.isPending ? <Spinner /> : null}
                  {todo.length
                    ? `Install ${todo.length} item${todo.length === 1 ? "" : "s"}`
                    : "Nothing to install"}
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Your first task</CardTitle>
              <CardDescription>
                Hermes UI opens with this in the composer. Nothing is sent until you press Send.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Label htmlFor="first-task" className="sr-only">
                First task
              </Label>
              <Textarea
                id="first-task"
                value={task}
                onChange={(e) => setTask(e.target.value)}
                className="min-h-20"
              />
              {alternatives.length > 1 ? (
                <fieldset className="flex flex-wrap gap-2">
                  <legend className="sr-only">Suggested first tasks</legend>
                  {alternatives.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTask(t)}
                      aria-pressed={t === task}
                      className={cn(
                        "rounded-full border px-3 py-1 text-left text-xs outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
                        t === task && "border-primary/50 bg-primary/5",
                      )}
                    >
                      {t}
                    </button>
                  ))}
                </fieldset>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <Card className="self-start">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <SmartphoneIcon className="size-4 text-muted-foreground" aria-hidden />
              Pair your phone
            </CardTitle>
            <CardDescription>
              Use Hermes from anywhere. Optional; also under Devices.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {pairing ? (
              <PairPanel />
            ) : (
              <Button variant="outline" className="w-full" onClick={() => setPairing(true)}>
                Show pairing code
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </StepLayout>
  )
}
