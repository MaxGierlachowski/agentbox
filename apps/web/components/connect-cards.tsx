"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { CatalogHit, LoginFlow } from "@workspace/contract"
import { Button } from "@workspace/ui/components/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible"
import { Field, FieldDescription, FieldLabel } from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { toast } from "@workspace/ui/components/sonner"
import { Spinner } from "@workspace/ui/components/spinner"
import { TierBadge } from "@workspace/ui/composites/catalog-item"
import { DeviceFlowCard, type DeviceFlowState } from "@workspace/ui/composites/device-flow-card"
import {
  ChevronDownIcon,
  CircleCheckIcon,
  ExternalLinkIcon,
  GitBranchIcon,
  KeyRoundIcon,
  PlugZapIcon,
} from "lucide-react"
import { type FormEvent, useEffect, useState } from "react"
import { PasswordInput } from "@/components/password-field"
import { errorMessage } from "@/lib/errors"
import { orpc } from "@/lib/orpc"
import { useLoginFlow } from "@/lib/use-login-flow"
import { useRunEvents } from "@/lib/use-run-events"
import { BrowserFrame } from "./browser-frame"

// ---------------------------------------------------------------------------------------------
// gh / glab device flows

const CLI_META = {
  gh: { title: "GitHub", tool: "GitHub CLI (gh)", defaultHost: "github.com" },
  glab: { title: "GitLab", tool: "GitLab CLI (glab)", defaultHost: "gitlab.com" },
} as const

function GitHubMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden fill="currentColor">
      <path d="M12 .5a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.2.5-2.3 1.2-3.1-.1-.4-.5-1.6.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.6 18.3 5 18.3 5c.7 1.6.3 2.8.1 3.2.8.8 1.2 1.9 1.2 3.1 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .5Z" />
    </svg>
  )
}

function GitLabMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden fill="currentColor">
      <path d="m23.6 9.6-.03-.09-3.25-8.48a.85.85 0 0 0-1.62.06l-2.2 6.72H7.5L5.3 1.09a.85.85 0 0 0-1.62-.06L.43 9.5l-.03.09a6.03 6.03 0 0 0 2 6.97l.01.01.03.02 4.95 3.71 2.45 1.85 1.49 1.13a1 1 0 0 0 1.21 0l1.49-1.13 2.45-1.85 4.98-3.73.01-.01a6.03 6.03 0 0 0 2-6.96Z" />
    </svg>
  )
}

export function CliLoginCard({ cli }: { cli: "gh" | "glab" }) {
  const meta = CLI_META[cli]
  const queryClient = useQueryClient()
  const [flowStart, setFlowStart] = useState<LoginFlow | null>(null)
  const [host, setHost] = useState<string>(meta.defaultHost)
  const status = useQuery({
    ...orpc.clis.status.queryOptions(),
    refetchInterval: (q) => (q.state.data?.find((c) => c.id === cli)?.installed ? false : 2000),
  })
  const flow = useLoginFlow(flowStart?.flowId ?? null, flowStart)
  const start = useMutation(
    orpc.clis.authStart.mutationOptions({
      onSuccess: setFlowStart,
      onError: (e) =>
        toast.error(`Could not start the ${meta.title} sign-in`, { description: errorMessage(e) }),
    }),
  )
  const cancel = useMutation(
    orpc.flows.cancel.mutationOptions({ onSettled: () => void flow.refetch() }),
  )
  const s = status.data?.find((c) => c.id === cli)
  const f = flow.data

  const flowDone = f?.state === "done"
  useEffect(() => {
    if (flowDone) void queryClient.invalidateQueries({ queryKey: orpc.clis.key() })
  }, [flowDone, queryClient])

  let state: DeviceFlowState = "idle"
  if (!s?.installed) state = "unavailable"
  else if (s.authed) state = "done"
  else if (start.isPending) state = "starting"
  else if (f) state = f.state

  return (
    <DeviceFlowCard
      title={meta.title}
      description={
        s?.authed
          ? `${meta.tool} on ${s.host}`
          : `Signs in ${meta.tool} on the box. Agents use it for PRs, issues and SSH keys.`
      }
      icon={cli === "gh" ? <GitHubMark /> : <GitLabMark />}
      state={state}
      code={f?.code}
      url={f?.url}
      user={s?.user ?? f?.user}
      message={
        state === "unavailable"
          ? s
            ? `Installing ${cli} on the box…`
            : "Checking…"
          : (f?.message ?? null)
      }
      startLabel={`Sign in to ${meta.title}`}
      onStart={() => start.mutate({ cli, host: host === meta.defaultHost ? undefined : host })}
      onCancel={f ? () => cancel.mutate({ flowId: f.flowId }) : undefined}
      footer={state === "done" ? null : <TokenFallback cli={cli} host={host} setHost={setHost} />}
    />
  )
}

function TokenFallback({
  cli,
  host,
  setHost,
}: {
  cli: "gh" | "glab"
  host: string
  setHost: (h: string) => void
}) {
  const queryClient = useQueryClient()
  const [token, setToken] = useState("")
  const save = useMutation(
    orpc.clis.setToken.mutationOptions({
      onSuccess: () => {
        setToken("")
        void queryClient.invalidateQueries({ queryKey: orpc.clis.key() })
      },
    }),
  )
  return (
    <Collapsible className="border-t pt-3">
      <CollapsibleTrigger className="group flex items-center gap-1 rounded text-muted-foreground text-xs outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
        {cli === "glab"
          ? "Self-hosted GitLab or a personal access token"
          : "Use a personal access token instead"}
        <ChevronDownIcon className="size-3.5 transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <form
          className="mt-3 grid gap-3 sm:grid-cols-2"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            if (token.length >= 8) save.mutate({ cli, host, token })
          }}
        >
          <Field>
            <FieldLabel htmlFor={`${cli}-host`}>Host</FieldLabel>
            <Input
              id={`${cli}-host`}
              value={host}
              onChange={(e) => setHost(e.target.value.trim())}
            />
            {cli === "glab" ? (
              <FieldDescription>Device sign-in needs GitLab 17.9 or newer.</FieldDescription>
            ) : null}
          </Field>
          <Field>
            <FieldLabel htmlFor={`${cli}-token`}>Token</FieldLabel>
            <PasswordInput
              id={`${cli}-token`}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="off"
              className="font-mono"
            />
          </Field>
          <div className="flex items-center gap-3 sm:col-span-2">
            <Button
              type="submit"
              variant="outline"
              size="sm"
              disabled={token.length < 8 || save.isPending}
            >
              {save.isPending ? <Spinner /> : null}
              Save token
            </Button>
            {save.isError ? (
              <span className="text-destructive text-xs" role="alert">
                {errorMessage(save.error)}
              </span>
            ) : null}
          </div>
        </form>
      </CollapsibleContent>
    </Collapsible>
  )
}

// ---------------------------------------------------------------------------------------------
// Catalog items with env (API keys) or OAuth

interface EnvVar {
  name: string
  secret: boolean
  required?: boolean
  help_url?: string
  description?: string
}
export interface ItemDetail {
  auth?: { type: "none" | "api_key" | "oauth" | "device" | "derived"; from?: string }
  env?: EnvVar[]
  notes?: string
}
export const asDetail = (d: unknown): ItemDetail =>
  d && typeof d === "object" ? (d as ItemDetail) : {}

function ItemHeader({ hit, icon }: { hit: CatalogHit; icon: React.ReactNode }) {
  return (
    <header className="flex items-start gap-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background [&_svg]:size-4">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="flex flex-wrap items-center gap-1.5 font-medium leading-tight">
          {hit.name}
          <TierBadge tier={hit.tier} />
        </h3>
        <p className="mt-0.5 text-muted-foreground text-sm">{hit.summary}</p>
      </div>
    </header>
  )
}

/**
 * Values for an item's env (API keys …). They go straight to the server with an install of
 * that item and are never shown again.
 */
export function EnvCard({ hit, env, done }: { hit: CatalogHit; env: EnvVar[]; done: boolean }) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [runId, setRunId] = useState<string | null>(null)
  const run = useRunEvents(runId)
  const apply = useMutation(
    orpc.toolkit.apply.mutationOptions({
      onSuccess: (r) => {
        setValues({})
        setRunId(r.id)
      },
    }),
  )
  const missing = env.filter((v) => v.required !== false && !values[v.name]?.trim())
  const saved = done || run.status === "succeeded"

  return (
    <section
      aria-label={hit.name}
      className="flex flex-col gap-4 rounded-xl border bg-card p-4 data-[done=true]:border-emerald-600/30 sm:p-5"
      data-done={saved}
    >
      <ItemHeader hit={hit} icon={<KeyRoundIcon />} />
      {saved ? (
        <p className="flex items-center gap-1.5 font-medium text-emerald-700 text-sm dark:text-emerald-400">
          <CircleCheckIcon className="size-4" aria-hidden />
          Saved and installed
        </p>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            if (missing.length) return
            const clean = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim()))
            apply.mutate({ add: [hit.id], remove: [], env: { [hit.id]: clean } })
          }}
        >
          {env.map((v) => {
            const id = `${hit.id}-${v.name}`
            const props = {
              id,
              value: values[v.name] ?? "",
              onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                setValues((s) => ({ ...s, [v.name]: e.target.value })),
              autoComplete: "off",
              spellCheck: false,
              className: "font-mono",
            }
            return (
              <Field key={v.name}>
                <div className="flex items-baseline justify-between gap-2">
                  <FieldLabel htmlFor={id} className="font-mono text-xs">
                    {v.name}
                    {v.required === false ? (
                      <span className="font-sans text-muted-foreground"> (optional)</span>
                    ) : null}
                  </FieldLabel>
                  {v.help_url ? (
                    <a
                      href={v.help_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-muted-foreground text-xs underline-offset-4 hover:text-foreground hover:underline"
                    >
                      Get it
                      <ExternalLinkIcon className="size-3" aria-hidden />
                    </a>
                  ) : null}
                </div>
                {v.secret ? <PasswordInput {...props} /> : <Input {...props} />}
                {v.description ? <FieldDescription>{v.description}</FieldDescription> : null}
              </Field>
            )
          })}
          <div className="flex items-center gap-3">
            <Button
              type="submit"
              variant="outline"
              disabled={missing.length > 0 || apply.isPending || run.status === "running"}
            >
              {apply.isPending || run.status === "running" ? <Spinner /> : null}
              Save &amp; install
            </Button>
            {apply.isError ? (
              <span className="text-destructive text-sm" role="alert">
                {errorMessage(apply.error)}
              </span>
            ) : run.status === "failed" ? (
              <span className="text-destructive text-sm" role="alert">
                Install failed. See Runs for the log.
              </span>
            ) : (
              <span className="text-muted-foreground text-xs">
                Stored encrypted; never shown again.
              </span>
            )}
          </div>
        </form>
      )}
    </section>
  )
}

/**
 * OAuth MCP (Gmail, Slack, Linear …): the consent page opens inside the box's browser, so the
 * callback lands on the box. Installs the item first when needed.
 */
export function OAuthCard({ hit, installed }: { hit: CatalogHit; installed: boolean }) {
  const [runId, setRunId] = useState<string | null>(null)
  const [flowStart, setFlowStart] = useState<LoginFlow | null>(null)
  const flow = useLoginFlow(flowStart?.flowId ?? null, flowStart)
  const connect = useMutation(
    orpc.toolkit.connect.mutationOptions({
      onSuccess: setFlowStart,
      onError: (e) =>
        toast.error(`Could not connect ${hit.name}`, { description: errorMessage(e) }),
    }),
  )
  const install = useMutation(
    orpc.toolkit.apply.mutationOptions({ onSuccess: (r) => setRunId(r.id) }),
  )
  const run = useRunEvents(runId, (status) => {
    if (status === "succeeded") connect.mutate({ id: hit.id })
  })
  const f = flow.data
  const installing =
    install.isPending || run.status === "running" || (runId !== null && run.status === "connecting")
  const waiting = f?.state === "waiting" || f?.state === "starting"

  const start = () => {
    if (installed || run.status === "succeeded") connect.mutate({ id: hit.id })
    else install.mutate({ add: [hit.id], remove: [] })
  }

  return (
    <section
      aria-label={hit.name}
      className="flex flex-col gap-4 rounded-xl border bg-card p-4 data-[done=true]:border-emerald-600/30 sm:p-5"
      data-done={f?.state === "done"}
    >
      <ItemHeader hit={hit} icon={<PlugZapIcon />} />
      {f?.state === "done" ? (
        <p
          className="flex items-center gap-1.5 font-medium text-emerald-700 text-sm dark:text-emerald-400"
          aria-live="polite"
        >
          <CircleCheckIcon className="size-4" aria-hidden />
          Connected{f.user ? ` as ${f.user}` : ""}
        </p>
      ) : waiting ? (
        <div className="space-y-3" aria-live="polite">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <Spinner className="size-4" />
            Finish signing in in the box browser below.
            {f?.url ? (
              <a
                href={f.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-muted-foreground text-xs underline-offset-4 hover:text-foreground hover:underline"
              >
                Open link instead
                <ExternalLinkIcon className="size-3" aria-hidden />
              </a>
            ) : null}
          </p>
          <BrowserFrame className="h-[28rem]" />
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={start} disabled={installing || connect.isPending}>
            {installing || connect.isPending ? <Spinner /> : null}
            {installing ? "Installing…" : `Connect ${hit.name}`}
          </Button>
          {f?.state === "error" || f?.state === "cancelled" ? (
            <span className="text-destructive text-sm" role="alert">
              {f.message ?? "Sign-in did not finish."}
            </span>
          ) : (
            <span className="text-muted-foreground text-xs">
              Opens the sign-in page in the box's browser.
            </span>
          )}
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------------------------
// git identity

export function GitIdentityCard() {
  const queryClient = useQueryClient()
  const identity = useQuery(orpc.git.identity.queryOptions())
  const me = useQuery(orpc.auth.me.queryOptions())
  const [name, setName] = useState<string | null>(null)
  const [email, setEmail] = useState<string | null>(null)
  const n = name ?? identity.data?.name ?? me.data?.name ?? ""
  const e = email ?? identity.data?.email ?? (me.data?.login.includes("@") ? me.data.login : "")
  const save = useMutation(
    orpc.git.setIdentity.mutationOptions({
      onSuccess: (d) => {
        queryClient.setQueryData(orpc.git.identity.queryKey(), d)
        setName(null)
        setEmail(null)
        toast.success("Git identity saved")
      },
    }),
  )
  const dirty = n !== (identity.data?.name ?? "") || e !== (identity.data?.email ?? "")

  return (
    <section aria-labelledby="git-identity" className="rounded-xl border bg-card p-4 sm:p-5">
      <header className="mb-4 flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background">
          <GitBranchIcon className="size-4" aria-hidden />
        </div>
        <div>
          <h3 id="git-identity" className="font-medium leading-tight">
            Git identity
          </h3>
          <p className="mt-0.5 text-muted-foreground text-sm">
            Commits made on the box are signed with this name.
          </p>
        </div>
      </header>
      <form
        className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        onSubmit={(ev: FormEvent) => {
          ev.preventDefault()
          if (n.trim() && e.includes("@")) save.mutate({ name: n.trim(), email: e.trim() })
        }}
      >
        <Field>
          <FieldLabel htmlFor="git-name">Name</FieldLabel>
          <Input
            id="git-name"
            value={n}
            onChange={(ev) => setName(ev.target.value)}
            autoComplete="name"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="git-email">Email</FieldLabel>
          <Input
            id="git-email"
            type="email"
            value={e}
            onChange={(ev) => setEmail(ev.target.value)}
            autoComplete="email"
          />
        </Field>
        <Button
          type="submit"
          variant="outline"
          disabled={!dirty || !n.trim() || !e.includes("@") || save.isPending}
        >
          {save.isPending ? <Spinner /> : identity.data && !dirty ? <CircleCheckIcon /> : null}
          {identity.data && !dirty ? "Saved" : "Save"}
        </Button>
      </form>
    </section>
  )
}
