"use client"

import { useMutation, useQuery } from "@tanstack/react-query"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Field, FieldGroup, FieldLabel } from "@workspace/ui/components/field"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { toast } from "@workspace/ui/components/sonner"
import { Spinner } from "@workspace/ui/components/spinner"
import { PageHeader } from "@workspace/ui/composites/page-header"
import { StatusBadge } from "@workspace/ui/composites/status-badge"
import { ChevronRightIcon, RefreshCwIcon } from "lucide-react"
import Link from "next/link"
import { type FormEvent, useState } from "react"
import { ApiKeysCard, ClaudeAccountsCard, HermesModelCard } from "@/components/ai-settings"
import { PasswordInput, PasswordMeter } from "@/components/password-field"
import { errorMessage } from "@/lib/errors"
import { STEPS } from "@/lib/onboarding"
import { orpc } from "@/lib/orpc"
import { passwordStrength } from "@/lib/password"

export function SettingsView() {
  return (
    <>
      <PageHeader
        title="Settings"
        description="Your account, AI providers and the health of the box."
      />
      <Section id="ai" title="AI">
        <div className="grid gap-4 xl:grid-cols-2">
          <ClaudeAccountsCard />
          <ApiKeysCard />
        </div>
        <HermesModelCard />
      </Section>
      <div className="grid gap-6 xl:grid-cols-2">
        <Section id="onboarding" title="Setup steps">
          <OnboardingSteps />
        </Section>
        <Section id="account" title="Account">
          <ChangePassword />
        </Section>
      </div>
      <Section id="doctor" title="Doctor">
        <Doctor />
      </Section>
    </>
  )
}

function Section({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-16 space-y-3">
      <h2
        id={`${id}-title`}
        className="font-medium text-muted-foreground text-sm uppercase tracking-wider"
      >
        {title}
      </h2>
      {children}
    </section>
  )
}

function OnboardingSteps() {
  const onboarding = useQuery(orpc.onboarding.get.queryOptions())
  return (
    <Card className="py-2">
      <CardContent className="px-2">
        <ul>
          {STEPS.map((s) => {
            const done = onboarding.data?.completed.includes(s.id)
            const skipped = onboarding.data?.skipped.includes(s.id)
            return (
              <li key={s.id}>
                <Link
                  href={`/onboarding/?step=${s.id}`}
                  className="flex items-center gap-3 rounded-lg px-3 py-2 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-sm">{s.title}</span>
                    <span className="block text-muted-foreground text-xs">{s.description}</span>
                  </span>
                  {done ? (
                    <StatusBadge status="ok" label="Done" />
                  ) : skipped ? (
                    <StatusBadge status="pending" label="Skipped" />
                  ) : null}
                  <ChevronRightIcon className="size-4 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}

function ChangePassword() {
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const change = useMutation(
    orpc.auth.changePassword.mutationOptions({
      onSuccess: () => {
        setCurrent("")
        setNext("")
        toast.success("Password changed")
      },
    }),
  )
  const ok = current && next.length >= 12 && passwordStrength(next).score >= 3
  return (
    <Card>
      <CardHeader>
        <CardTitle>Change password</CardTitle>
        <CardDescription>Forgot it? Run sudo agentbox reset-owner on the box.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault()
            if (ok) change.mutate({ current, next })
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="current-password">Current password</FieldLabel>
              <PasswordInput
                id="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                autoComplete="current-password"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="new-password">New password</FieldLabel>
              <PasswordInput
                id="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                autoComplete="new-password"
                aria-describedby="new-password-meter"
              />
              <PasswordMeter id="new-password-meter" password={next} />
            </Field>
            {change.isError ? (
              <p className="text-destructive text-sm" role="alert">
                {errorMessage(change.error)}
              </p>
            ) : null}
            <div>
              <Button type="submit" disabled={!ok || change.isPending}>
                {change.isPending ? <Spinner /> : null}
                Change password
              </Button>
            </div>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}

function Doctor() {
  const doctor = useQuery(orpc.system.doctor.queryOptions())
  return (
    <Card>
      <CardHeader>
        <CardTitle>Checks</CardTitle>
        <CardDescription>
          The same checks as <code className="font-mono text-xs">agentbox doctor</code>.
        </CardDescription>
        <CardAction>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void doctor.refetch()}
            disabled={doctor.isFetching}
          >
            {doctor.isFetching ? <Spinner /> : <RefreshCwIcon />}
            Run again
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {doctor.data ? (
          <ul className="divide-y">
            {doctor.data.checks.map((c) => (
              <li key={c.id} className="flex items-start gap-3 py-2.5">
                <StatusBadge status={c.level} />
                <div className="min-w-0">
                  <p className="font-mono text-muted-foreground text-xs">{c.id}</p>
                  <p className="text-sm">{c.message}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Skeleton className="h-32" />
        )}
      </CardContent>
    </Card>
  )
}
