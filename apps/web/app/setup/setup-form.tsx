"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { Spinner } from "@workspace/ui/components/spinner"
import { CircleAlertIcon } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { type FormEvent, useEffect, useState } from "react"
import { AuthShell } from "@/components/auth-shell"
import { CertExplainer } from "@/components/cert-explainer"
import { FullPageSpinner } from "@/components/gate"
import { PasswordInput, PasswordMeter } from "@/components/password-field"
import { ApiError, api, setupStatusQuery } from "@/lib/api"
import { passwordStrength } from "@/lib/password"
import { useMounted } from "@/lib/use-mounted"

export function SetupForm() {
  const mounted = useMounted()
  const status = useQuery(setupStatusQuery)
  if (!mounted || status.isPending) return <FullPageSpinner />
  if (status.data?.claimed) {
    return (
      <AuthShell
        title="This box already has an owner"
        description="Setup runs only once. Sign in with the owner's password instead."
      >
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/login/">Sign in</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/reset/">Forgot the password?</Link>
          </Button>
        </div>
      </AuthShell>
    )
  }
  return <ClaimForm />
}

/** The one-time code travels in the URL fragment, so it never reaches a server log. */
function otpFromHash(): string {
  const params = new URLSearchParams(window.location.hash.slice(1))
  return (params.get("otp") ?? "").replaceAll("-", " ").trim()
}

function ClaimForm() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [otp, setOtp] = useState(otpFromHash)
  const [prefilled] = useState(() => otp !== "")
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  // Drop the fragment from the address bar and history once it has been read.
  useEffect(() => {
    if (window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search)
    }
  }, [])

  const strength = passwordStrength(password, [name, email])
  const canSubmit = otp.trim() && name.trim() && email.includes("@") && strength.score >= 3

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setPending(true)
    setError(null)
    try {
      await api.claim({
        otp: otp
          .trim()
          .toLowerCase()
          .split(/[\s-]+/)
          .join("-"),
        name: name.trim(),
        email: email.trim(),
        password,
        remember,
      })
      await queryClient.invalidateQueries()
      router.replace("/onboarding/")
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 404
          ? "This box has already been claimed. Sign in instead."
          : err instanceof Error
            ? err.message
            : String(err),
      )
      setPending(false)
    }
  }

  return (
    <AuthShell
      title="Claim this box"
      description="You are the first one here. Create the owner account; nobody else can claim the box after you."
      aside={<CertExplainer />}
    >
      <form onSubmit={onSubmit} noValidate>
        <FieldGroup>
          {error ? (
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <Field>
            <FieldLabel htmlFor="otp">One-time code</FieldLabel>
            <Input
              id="otp"
              name="otp"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              autoComplete="one-time-code"
              autoCapitalize="none"
              spellCheck={false}
              className="font-mono"
              placeholder="river lamp oak mint fold acre"
              required
              aria-describedby="otp-help"
            />
            <FieldDescription id="otp-help">
              {prefilled
                ? "Filled in from the link in your console."
                : "Six words printed by sudo agentbox up. Lost it? Run sudo agentbox otp."}
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="name">Your name</FieldLabel>
            <Input
              id="name"
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              required
              autoFocus={prefilled}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input
              id="email"
              name="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
              aria-describedby="email-help"
            />
            <FieldDescription id="email-help">
              Your login name and a recovery hint. agentbox never sends mail.
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <PasswordInput
              id="password"
              name="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
              minLength={12}
              aria-describedby="password-meter"
            />
            <PasswordMeter id="password-meter" password={password} userInputs={[name, email]} />
          </Field>
          <Field orientation="horizontal">
            <Checkbox
              id="remember"
              checked={remember}
              onCheckedChange={(v) => setRemember(v === true)}
            />
            <FieldLabel htmlFor="remember" className="font-normal">
              Keep me signed in on this device for 30 days
            </FieldLabel>
          </Field>
          <Button type="submit" size="lg" disabled={!canSubmit || pending} className="w-full">
            {pending ? <Spinner /> : null}
            Claim this box
          </Button>
        </FieldGroup>
      </form>
    </AuthShell>
  )
}
