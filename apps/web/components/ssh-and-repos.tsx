"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { RemoteRepo } from "@workspace/contract"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Input } from "@workspace/ui/components/input"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { toast } from "@workspace/ui/components/sonner"
import { Spinner } from "@workspace/ui/components/spinner"
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"
import { CopyField } from "@workspace/ui/composites/copy-field"
import { formatDistanceToNow } from "date-fns"
import { CircleCheckIcon, DownloadIcon, KeyRoundIcon, LockIcon, SearchIcon } from "lucide-react"
import { useState } from "react"
import { RunLogDrawer } from "@/components/run-log"
import { errorMessage } from "@/lib/errors"
import { orpc } from "@/lib/orpc"

type Host = "github.com" | "gitlab.com"
const HOSTS: { host: Host; cli: "gh" | "glab"; name: string }[] = [
  { host: "github.com", cli: "gh", name: "GitHub" },
  { host: "gitlab.com", cli: "glab", name: "GitLab" },
]

export function SshKeyCard() {
  const queryClient = useQueryClient()
  const ssh = useQuery(orpc.ssh.status.queryOptions())
  const clis = useQuery(orpc.clis.status.queryOptions())
  const setData = (d: unknown) => queryClient.setQueryData(orpc.ssh.status.queryKey(), d as never)
  const generate = useMutation(orpc.ssh.generate.mutationOptions({ onSuccess: setData }))
  const register = useMutation(
    orpc.ssh.register.mutationOptions({
      onSuccess: (d, v) => {
        setData(d)
        toast.success(`Key added to ${v.host}`)
      },
      onError: (e) => toast.error("Could not add the key", { description: errorMessage(e) }),
    }),
  )
  const key = ssh.data?.publicKey

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRoundIcon className="size-4 text-muted-foreground" aria-hidden />
          SSH key
        </CardTitle>
        <CardDescription>
          The box's own ed25519 key for git over SSH. The private half never leaves it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {ssh.isPending ? <Skeleton className="h-10" /> : null}
        {ssh.data && !key ? (
          <Button onClick={() => generate.mutate({})} disabled={generate.isPending}>
            {generate.isPending ? <Spinner /> : null}
            Generate ed25519 key
          </Button>
        ) : null}
        {key ? (
          <>
            <div className="space-y-1.5">
              <CopyField value={key} />
              <p className="font-mono text-muted-foreground text-xs">{ssh.data?.fingerprint}</p>
            </div>
            <ul className="flex flex-wrap gap-2">
              {HOSTS.map(({ host, cli, name }) => {
                const done = ssh.data?.registered[host]
                const authed = clis.data?.find((c) => c.id === cli)?.authed
                return (
                  <li key={host}>
                    {done ? (
                      <Badge
                        variant="outline"
                        className="h-8 gap-1.5 px-3 text-emerald-700 dark:text-emerald-400"
                      >
                        <CircleCheckIcon className="size-3.5" aria-hidden />
                        Added to {name}
                      </Badge>
                    ) : (
                      <Button
                        variant="outline"
                        disabled={!authed || register.isPending}
                        title={authed ? undefined : `Sign in to ${name} first`}
                        onClick={() => register.mutate({ host })}
                      >
                        {register.isPending && register.variables?.host === host ? (
                          <Spinner />
                        ) : null}
                        Add to {name}
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
            {!clis.data?.some((c) => c.authed) ? (
              <p className="text-muted-foreground text-xs">
                Not signed in to GitHub or GitLab? Copy the key and add it in their SSH settings.
              </p>
            ) : null}
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}

export function RepoPicker() {
  const clis = useQuery(orpc.clis.status.queryOptions())
  const authedHosts = HOSTS.filter((h) => clis.data?.find((c) => c.id === h.cli)?.authed)
  const [hostChoice, setHost] = useState<Host | null>(null)
  const host = hostChoice ?? authedHosts[0]?.host ?? null
  const repos = useQuery({
    ...orpc.repos.list.queryOptions({ input: { host: host ?? "github.com" } }),
    enabled: !!host,
  })
  const [filter, setFilter] = useState("")
  const [picked, setPicked] = useState<string[]>([])
  const [runId, setRunId] = useState<string | null>(null)
  const [drawer, setDrawer] = useState(false)
  const clone = useMutation(
    orpc.repos.clone.mutationOptions({
      onSuccess: (run) => {
        setRunId(run.id)
        setDrawer(true)
        setPicked([])
      },
      onError: (e) => toast.error("Could not start the clone", { description: errorMessage(e) }),
    }),
  )

  const sorted = [...(repos.data ?? [])]
    .filter((r) => !filter || r.fullName.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => (b.pushedAt ?? "").localeCompare(a.pushedAt ?? ""))

  return (
    <Card>
      <CardHeader>
        <CardTitle>Repositories</CardTitle>
        <CardDescription>
          Cloned to{" "}
          <code className="font-mono text-xs">~/work/&lt;host&gt;/&lt;owner&gt;/&lt;repo&gt;</code>{" "}
          in the background.
        </CardDescription>
        {picked.length ? (
          <CardAction>
            <Button onClick={() => clone.mutate({ repos: picked })} disabled={clone.isPending}>
              {clone.isPending ? <Spinner /> : <DownloadIcon />}
              Clone {picked.length} repo{picked.length === 1 ? "" : "s"}
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {clis.data && authedHosts.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-muted-foreground text-sm">
            Sign in to GitHub or GitLab on “Connect accounts” to pick repositories here.
          </p>
        ) : null}
        {authedHosts.length > 1 ? (
          <Tabs value={host ?? undefined} onValueChange={(v) => setHost(v as Host)}>
            <TabsList>
              {authedHosts.map((h) => (
                <TabsTrigger key={h.host} value={h.host}>
                  {h.name}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        ) : null}
        {host ? (
          <>
            <div className="relative">
              <SearchIcon
                className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter repositories"
                aria-label="Filter repositories"
                className="pl-8"
              />
            </div>
            <ul
              className="max-h-96 divide-y overflow-y-auto rounded-lg border"
              aria-label="Repositories"
            >
              {repos.isPending
                ? [1, 2, 3].map((i) => (
                    <li key={i} className="p-3">
                      <Skeleton className="h-8" />
                    </li>
                  ))
                : null}
              {sorted.map((r) => (
                <RepoRow
                  key={r.sshUrl}
                  repo={r}
                  checked={picked.includes(r.sshUrl)}
                  onToggle={() =>
                    setPicked((p) =>
                      p.includes(r.sshUrl) ? p.filter((x) => x !== r.sshUrl) : [...p, r.sshUrl],
                    )
                  }
                />
              ))}
              {repos.data && sorted.length === 0 ? (
                <li className="p-6 text-center text-muted-foreground text-sm">
                  No repositories found.
                </li>
              ) : null}
            </ul>
          </>
        ) : null}
      </CardContent>
      <RunLogDrawer
        runId={runId}
        title="Cloning repositories"
        open={drawer}
        onOpenChange={setDrawer}
      />
    </Card>
  )
}

function RepoRow({
  repo,
  checked,
  onToggle,
}: {
  repo: RemoteRepo
  checked: boolean
  onToggle: () => void
}) {
  const id = `repo-${repo.sshUrl}`
  return (
    <li>
      <label
        htmlFor={id}
        className="flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-muted/40 has-disabled:cursor-default has-disabled:opacity-70"
      >
        <Checkbox
          id={id}
          className="mt-0.5"
          checked={checked || repo.cloned}
          disabled={repo.cloned}
          onCheckedChange={onToggle}
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5 font-medium text-sm">
            {repo.fullName}
            {repo.private ? (
              <LockIcon className="size-3 text-muted-foreground" aria-label="Private" />
            ) : null}
            {repo.cloned ? (
              <Badge variant="secondary" className="h-5 px-1.5 font-normal text-[0.7rem]">
                Cloned
              </Badge>
            ) : null}
          </span>
          {repo.description ? (
            <span className="block truncate text-muted-foreground text-xs">{repo.description}</span>
          ) : null}
        </span>
        {repo.pushedAt ? (
          <span className="shrink-0 text-muted-foreground text-xs">
            {formatDistanceToNow(new Date(repo.pushedAt), { addSuffix: true })}
          </span>
        ) : null}
      </label>
    </li>
  )
}
