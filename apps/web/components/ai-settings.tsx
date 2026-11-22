"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { AiStatus, ApiKeyProvider, LoginFlow } from "@workspace/contract"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
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
import { Field, FieldLabel } from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { RadioGroup, RadioGroupItem } from "@workspace/ui/components/radio-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { toast } from "@workspace/ui/components/sonner"
import { Spinner } from "@workspace/ui/components/spinner"
import { CopyField } from "@workspace/ui/composites/copy-field"
import { StatusBadge } from "@workspace/ui/composites/status-badge"
import {
  CheckIcon,
  CircleCheckIcon,
  CircleXIcon,
  ExternalLinkIcon,
  PlusIcon,
  StarIcon,
  Trash2Icon,
  ZapIcon,
} from "lucide-react"
import { type FormEvent, useState } from "react"
import { PasswordInput } from "@/components/password-field"
import { errorMessage } from "@/lib/errors"
import { orpc } from "@/lib/orpc"
import { useLoginFlow } from "@/lib/use-login-flow"

function useAiStatus() {
  return useQuery(orpc.ai.status.queryOptions())
}

function useInvalidateAi() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: orpc.ai.key() })
}

// ---------------------------------------------------------------------------------------------
// Claude subscription accounts

export function ClaudeAccountsCard() {
  const status = useAiStatus()
  const invalidate = useInvalidateAi()
  const [adding, setAdding] = useState(false)
  const remove = useMutation(
    orpc.ai.accountRemove.mutationOptions({
      onSuccess: invalidate,
      onError: (e) => toast.error("Could not remove the account", { description: errorMessage(e) }),
    }),
  )
  const setDefault = useMutation(
    orpc.ai.accountSetDefault.mutationOptions({ onSuccess: invalidate }),
  )
  const accounts = status.data?.accounts ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle>Claude accounts</CardTitle>
        <CardDescription>
          Pro or Max subscriptions for Claude Code agents. Add two or more and agents switch when
          one hits its limit.
        </CardDescription>
        {!adding ? (
          <CardAction>
            <Button
              size="sm"
              variant={accounts.length ? "outline" : "default"}
              onClick={() => setAdding(true)}
            >
              <PlusIcon />
              Add account
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {status.isPending ? <Skeleton className="h-12" /> : null}
        {accounts.length > 0 ? (
          <ul className="divide-y rounded-lg border">
            {accounts.map((a) => (
              <li key={a.slug} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 font-medium text-sm">
                    {a.label}
                    {a.isDefault ? (
                      <Badge variant="secondary" className="h-5 px-1.5 font-normal text-[0.7rem]">
                        Default
                      </Badge>
                    ) : null}
                  </p>
                  <p className="truncate text-muted-foreground text-xs">
                    {a.email ?? a.message ?? "Not signed in yet"}
                  </p>
                </div>
                <StatusBadge
                  status={a.status === "ready" ? "ok" : a.status === "error" ? "fail" : "pending"}
                  label={
                    a.status === "ready" ? "Ready" : a.status === "error" ? "Error" : "Pending"
                  }
                />
                {!a.isDefault && a.status === "ready" ? (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Make ${a.label} the default`}
                    title="Make default"
                    onClick={() => setDefault.mutate({ slug: a.slug })}
                  >
                    <StarIcon />
                  </Button>
                ) : null}
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Remove ${a.label}`}
                  title="Remove"
                  onClick={() => remove.mutate({ slug: a.slug })}
                >
                  <Trash2Icon />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        {adding ? (
          <AddClaudeAccount
            suggestedLabel={accounts.length ? `Account ${accounts.length + 1}` : "Personal"}
            onDone={() => {
              setAdding(false)
              void invalidate()
            }}
          />
        ) : null}
        {!adding && !status.isPending && accounts.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No account yet. You can also use an API key.
          </p>
        ) : null}
        <p className="text-muted-foreground text-xs">
          Your subscription is used by Claude Code on your own box, like on your laptop. Check that
          your use fits Anthropic's terms for your plan; for shared or automated use an API key is
          the safer choice.
        </p>
      </CardContent>
    </Card>
  )
}

function AddClaudeAccount({
  suggestedLabel,
  onDone,
}: {
  suggestedLabel: string
  onDone: () => void
}) {
  const [label, setLabel] = useState(suggestedLabel)
  const start = useMutation(orpc.ai.accountLoginStart.mutationOptions())

  if (start.data) {
    return (
      <PasteLogin
        started={start.data}
        idPrefix="claude"
        intro={<>Open the Claude sign-in page and log in with the account for “{label}”.</>}
        onDone={onDone}
        onCancel={onDone}
      />
    )
  }

  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/30 p-3"
      onSubmit={(e: FormEvent) => {
        e.preventDefault()
        if (label.trim()) start.mutate({ label: label.trim() })
      }}
    >
      <Field className="min-w-48 flex-1">
        <FieldLabel htmlFor="claude-label">Name for this account</FieldLabel>
        <Input
          id="claude-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={40}
        />
      </Field>
      <Button type="submit" disabled={!label.trim() || start.isPending}>
        {start.isPending ? <Spinner /> : null}
        Start sign-in
      </Button>
      <Button type="button" variant="ghost" onClick={onDone}>
        Cancel
      </Button>
      {start.isError ? (
        <p className="basis-full text-destructive text-sm" role="alert">
          {errorMessage(start.error)}
        </p>
      ) : null}
    </form>
  )
}

/**
 * Claude's paste-code login (`claude auth login`, Hermes' Anthropic OAuth): open the page, sign
 * in, paste the code it shows back here; then poll the flow until the CLI confirms.
 */
function PasteLogin({
  started,
  idPrefix,
  intro,
  onDone,
  onCancel,
}: {
  started: LoginFlow
  idPrefix: string
  intro: React.ReactNode
  onDone: (flow: LoginFlow) => void
  onCancel: () => void
}) {
  const [code, setCode] = useState("")
  const flow = useLoginFlow(started.flowId, started)
  const finish = useMutation(
    orpc.ai.accountLoginFinish.mutationOptions({ onSuccess: () => void flow.refetch() }),
  )
  const cancel = useMutation(orpc.flows.cancel.mutationOptions({ onSettled: onCancel }))
  const f = flow.data ?? started

  if (f.state === "done") {
    return (
      <div
        className="flex items-center gap-2 rounded-lg border border-emerald-600/30 bg-emerald-50/50 p-3 text-sm dark:bg-emerald-950/20"
        aria-live="polite"
      >
        <CircleCheckIcon className="size-4 text-emerald-600" aria-hidden />
        <span className="flex-1">Signed in{f.user ? ` as ${f.user}` : ""}.</span>
        <Button size="sm" onClick={() => onDone(f)}>
          Done
        </Button>
      </div>
    )
  }

  const verifying = f.state === "starting" || finish.isPending
  const codeId = `${idPrefix}-code`
  return (
    <div className="space-y-4 rounded-lg border bg-muted/30 p-3 sm:p-4">
      <ol className="space-y-4 text-sm">
        <li className="space-y-2">
          <p>
            <span className="font-medium">1.</span> {intro}
          </p>
          {f.url ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild>
                <a href={f.url} target="_blank" rel="noopener noreferrer">
                  Open claude.ai
                  <ExternalLinkIcon />
                </a>
              </Button>
              <CopyField value={f.url} className="min-w-0 flex-1" />
            </div>
          ) : (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Spinner className="size-4" /> Preparing the link…
            </p>
          )}
        </li>
        <li>
          <form
            className="space-y-2"
            onSubmit={(e: FormEvent) => {
              e.preventDefault()
              if (code.trim().length >= 4) finish.mutate({ flowId: f.flowId, code: code.trim() })
            }}
          >
            <label htmlFor={codeId} className="block">
              <span className="font-medium">2.</span> Paste the code Claude shows you:
            </label>
            <div className="flex flex-wrap gap-2">
              <Input
                id={codeId}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="min-w-48 flex-1 font-mono"
                disabled={verifying}
              />
              <Button type="submit" disabled={code.trim().length < 4 || verifying}>
                {verifying ? <Spinner /> : null}
                {verifying ? "Checking…" : "Finish sign-in"}
              </Button>
            </div>
          </form>
        </li>
      </ol>
      {finish.isError || f.state === "error" ? (
        <Alert variant="destructive">
          <CircleXIcon />
          <AlertDescription>
            {finish.isError ? errorMessage(finish.error) : f.message}
          </AlertDescription>
        </Alert>
      ) : null}
      <Button variant="ghost" size="sm" onClick={() => cancel.mutate({ flowId: f.flowId })}>
        Cancel sign-in
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// API keys (write-only: the API returns at most `last4`)

const providers: { id: ApiKeyProvider; name: string; url: string; placeholder: string }[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    url: "https://console.anthropic.com/settings/keys",
    placeholder: "sk-ant-…",
  },
  {
    id: "openai",
    name: "OpenAI",
    url: "https://platform.openai.com/api-keys",
    placeholder: "sk-…",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    url: "https://openrouter.ai/settings/keys",
    placeholder: "sk-or-…",
  },
]

export function ApiKeysCard() {
  const status = useAiStatus()
  return (
    <Card>
      <CardHeader>
        <CardTitle>API keys</CardTitle>
        <CardDescription>
          Pay-per-use keys. Stored encrypted on the box and never shown again.
        </CardDescription>
      </CardHeader>
      <CardContent className="divide-y">
        {providers.map((p) => (
          <ApiKeyRow
            key={p.id}
            provider={p}
            state={status.data?.apiKeys.find((k) => k.provider === p.id)}
          />
        ))}
      </CardContent>
    </Card>
  )
}

function ApiKeyRow({
  provider,
  state,
}: {
  provider: (typeof providers)[number]
  state: AiStatus["apiKeys"][number] | undefined
}) {
  const invalidate = useInvalidateAi()
  const [key, setKey] = useState("")
  const [editing, setEditing] = useState(false)
  const save = useMutation(
    orpc.ai.setApiKey.mutationOptions({
      onSuccess: () => {
        setKey("")
        setEditing(false)
        toast.success(`${provider.name} key saved`)
        void invalidate()
      },
    }),
  )
  const remove = useMutation(orpc.ai.removeApiKey.mutationOptions({ onSuccess: invalidate }))
  const id = `key-${provider.id}`
  const showInput = !state?.set || editing

  return (
    <div className="space-y-2 py-3 first:pt-0 last:pb-0">
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="font-medium text-sm">
          {provider.name}
        </label>
        {state?.set ? (
          <span className="flex items-center gap-1 text-emerald-700 text-xs dark:text-emerald-400">
            <CircleCheckIcon className="size-3.5" aria-hidden />
            Saved · <span className="font-mono">••••{state.last4}</span>
          </span>
        ) : null}
        <a
          href={provider.url}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto inline-flex items-center gap-1 text-muted-foreground text-xs underline-offset-4 hover:text-foreground hover:underline"
        >
          Get a key
          <ExternalLinkIcon className="size-3" aria-hidden />
        </a>
      </div>
      {showInput ? (
        <form
          className="flex gap-2"
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            if (key.trim().length >= 8) save.mutate({ provider: provider.id, key: key.trim() })
          }}
        >
          <div className="flex-1">
            <PasswordInput
              id={id}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={provider.placeholder}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
              aria-invalid={save.isError || undefined}
            />
          </div>
          <Button
            type="submit"
            variant="outline"
            disabled={key.trim().length < 8 || save.isPending}
          >
            {save.isPending ? <Spinner /> : null}
            {save.isPending ? "Checking" : "Save"}
          </Button>
          {editing ? (
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          ) : null}
        </form>
      ) : (
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            Replace
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => remove.mutate({ provider: provider.id })}
          >
            Remove
          </Button>
        </div>
      )}
      {save.isError ? (
        <p className="text-destructive text-xs" role="alert">
          {errorMessage(save.error)}
        </p>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Hermes model

export function HermesModelCard() {
  const status = useAiStatus()
  const queryClient = useQueryClient()
  const invalidate = useInvalidateAi()
  const data = status.data
  const hermes = data?.hermes
  const keyProviders = data?.apiKeys.filter((k) => k.set).map((k) => k.provider) ?? []
  const claudeReady = hermes?.source === "claude-account" && hermes.ready

  const [wayChoice, setWay] = useState<"claude" | "api-key" | null>(null)
  const [provider, setProvider] = useState<string | null>(null)
  const [model, setModel] = useState<string | null>(null)
  const way =
    wayChoice ??
    (hermes?.source === "api-key" || (!claudeReady && keyProviders.length > 0)
      ? "api-key"
      : "claude")
  const prov =
    way === "claude"
      ? "anthropic"
      : (provider ??
        (hermes?.source === "api-key" ? hermes.provider : null) ??
        keyProviders[0] ??
        null)
  const models = (prov && data?.models[prov]) || []
  const current = hermes?.model && models.includes(hermes.model) ? hermes.model : null
  const mdl = model && models.includes(model) ? model : (current ?? models[0] ?? null)

  const login = useMutation(orpc.ai.hermesLoginStart.mutationOptions())
  const apply = useMutation(
    orpc.ai.setHermesModel.mutationOptions({
      onSuccess: (s) => {
        queryClient.setQueryData(orpc.ai.status.queryKey(), s)
        toast.success("Hermes model saved")
      },
    }),
  )
  const probe = useMutation(orpc.ai.probe.mutationOptions())
  const inUse =
    hermes?.ready &&
    hermes.model === mdl &&
    (way === "claude" ? hermes.source === "claude-account" : hermes.provider === prov)
  const canApply =
    !!prov &&
    !!mdl &&
    !inUse &&
    (way === "claude" ? claudeReady : keyProviders.includes(prov as ApiKeyProvider))

  return (
    <Card>
      <CardHeader>
        <CardTitle>Hermes model</CardTitle>
        <CardDescription>
          The model your assistant thinks with. This is the one thing Hermes needs.
        </CardDescription>
        <CardAction>
          {hermes?.ready ? (
            <StatusBadge status="ok" label="Ready" />
          ) : data ? (
            <StatusBadge status="warn" label="Not set" />
          ) : null}
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        <RadioGroup
          value={way}
          onValueChange={(v) => setWay(v as typeof way)}
          className="grid gap-2 sm:grid-cols-2"
          aria-label="How Hermes gets its model"
        >
          <SourceOption
            value="claude"
            title="Claude subscription"
            hint={claudeReady ? "Hermes is signed in" : "One more sign-in, same account"}
          />
          <SourceOption
            value="api-key"
            title="API key"
            hint={keyProviders.length ? keyProviders.join(", ") : "Add a key above first"}
          />
        </RadioGroup>

        {way === "claude" && !claudeReady ? (
          login.data ? (
            <PasteLogin
              started={login.data}
              idPrefix="hermes"
              intro="Open the Claude sign-in page and log in. This login is only for Hermes."
              onDone={() => {
                login.reset()
                void invalidate()
              }}
              onCancel={() => login.reset()}
            />
          ) : (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 p-3">
              <p className="min-w-56 flex-1 text-sm">
                Hermes signs in separately from your coding agents — it's the same Claude account,
                one more click.
              </p>
              <Button
                onClick={() => login.mutate({ model: mdl ?? undefined })}
                disabled={login.isPending}
              >
                {login.isPending ? <Spinner /> : null}
                Sign in for Hermes
              </Button>
              {login.isError ? (
                <p className="basis-full text-destructive text-sm" role="alert">
                  {errorMessage(login.error)}
                </p>
              ) : null}
            </div>
          )
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          {way === "api-key" ? (
            <Field>
              <FieldLabel htmlFor="hermes-provider">Provider</FieldLabel>
              <Select
                value={prov ?? ""}
                onValueChange={setProvider}
                disabled={!keyProviders.length}
              >
                <SelectTrigger id="hermes-provider" className="w-full">
                  <SelectValue placeholder="No API key yet" />
                </SelectTrigger>
                <SelectContent>
                  {keyProviders.map((p) => (
                    <SelectItem key={p} value={p}>
                      {providers.find((x) => x.id === p)?.name ?? p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}
          <Field>
            <FieldLabel htmlFor="hermes-model">Model</FieldLabel>
            <Select value={mdl ?? ""} onValueChange={setModel} disabled={!models.length}>
              <SelectTrigger id="hermes-model" className="w-full">
                <SelectValue placeholder="Pick a model" />
              </SelectTrigger>
              <SelectContent>
                {models.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={inUse ? "secondary" : "default"}
            disabled={!canApply || apply.isPending}
            onClick={() =>
              prov &&
              mdl &&
              apply.mutate({
                source: way === "claude" ? "claude-account" : "api-key",
                provider: prov,
                model: mdl,
              })
            }
          >
            {apply.isPending ? <Spinner /> : inUse ? <CheckIcon /> : null}
            {inUse ? "In use" : "Use this model"}
          </Button>
          <Button
            variant="outline"
            disabled={!hermes?.ready || probe.isPending}
            onClick={() => probe.mutate({})}
          >
            {probe.isPending ? <Spinner /> : <ZapIcon />}
            Test Hermes
          </Button>
          {hermes?.ready ? (
            <span className="text-muted-foreground text-xs">
              Now: <span className="font-mono">{hermes.model}</span> via{" "}
              {hermes.source === "claude-account" ? "Claude subscription" : hermes.provider}
            </span>
          ) : null}
        </div>
        {apply.isError ? (
          <p className="text-destructive text-sm" role="alert">
            {errorMessage(apply.error)}
          </p>
        ) : null}
        {probe.data ? (
          <p
            role="status"
            className={
              probe.data.ok
                ? "flex items-center gap-2 text-emerald-700 text-sm dark:text-emerald-400"
                : "flex items-center gap-2 text-destructive text-sm"
            }
          >
            {probe.data.ok ? (
              <CircleCheckIcon className="size-4" aria-hidden />
            ) : (
              <CircleXIcon className="size-4" aria-hidden />
            )}
            {probe.data.ok ? `Hermes answered: “${probe.data.reply}”` : probe.data.message}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

function SourceOption({ value, title, hint }: { value: string; title: string; hint: string }) {
  const id = `src-${value}`
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50 has-data-checked:border-primary/40 has-data-checked:bg-primary/5"
    >
      <RadioGroupItem id={id} value={value} className="mt-0.5" />
      <span className="grid">
        <span className="font-medium text-sm">{title}</span>
        <span className="text-muted-foreground text-xs">{hint}</span>
      </span>
    </label>
  )
}
