"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Field, FieldGroup, FieldLabel } from "@workspace/ui/components/field"
import { Spinner } from "@workspace/ui/components/spinner"
import { CircleAlertIcon } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { parseAsString, useQueryState } from "nuqs"
import { type FormEvent, useEffect, useState } from "react"
import { AuthShell } from "@/components/auth-shell"
import { FullPageSpinner } from "@/components/gate"
import { PasswordInput } from "@/components/password-field"
import { api, go, isExternalPath, safeNext, setupStatusQuery } from "@/lib/api"
import { errorMessage } from "@/lib/errors"

export function LoginForm() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [nextParam] = useQueryState("next", parseAsString)
  const next = safeNext(nextParam)
  const status = useQuery(setupStatusQuery)
  const [password, setPassword] = useState("")
  const [remember, setRemember] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const unclaimed = status.data?.claimed === false
  useEffect(() => {
    if (unclaimed) router.replace("/setup/")
  }, [unclaimed, router])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!password) return
    setPending(true)
    setError(null)
    try {
      await api.login({ password, remember })
      await queryClient.invalidateQueries()
      const target = next ?? "/"
      if (isExternalPath(target)) go(target)
      else router.replace(target)
    } catch (err) {
      setError(errorMessage(err))
      setPending(false)
    }
  }

  if (status.isPending || unclaimed) return <FullPageSpinner />

  return (
    <AuthShell title="Sign in" description="Enter the owner password of this box.">
      <form onSubmit={onSubmit}>
        <FieldGroup>
          {error ? (
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <Field>
            <div className="flex items-baseline justify-between">
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <Link
                href="/reset/"
                className="text-muted-foreground text-xs underline-offset-4 hover:text-foreground hover:underline"
              >
                Forgot it?
              </Link>
            </div>
            <PasswordInput
              id="password"
              name="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              autoFocus
              required
            />
          </Field>
          <Field orientation="horizontal">
            <Checkbox
              id="remember"
              checked={remember}
              onCheckedChange={(v) => setRemember(v === true)}
            />
            <FieldLabel htmlFor="remember" className="font-normal">
              Keep me signed in for 30 days
            </FieldLabel>
          </Field>
          <Button type="submit" size="lg" className="w-full" disabled={!password || pending}>
            {pending ? <Spinner /> : null}
            Sign in
          </Button>
        </FieldGroup>
      </form>
    </AuthShell>
  )
}
