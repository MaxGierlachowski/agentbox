"use client"

import { Alert, AlertDescription } from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { toast } from "@workspace/ui/components/sonner"
import { Spinner } from "@workspace/ui/components/spinner"
import { CopyField } from "@workspace/ui/composites/copy-field"
import { CircleAlertIcon } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { type FormEvent, useState } from "react"
import { AuthShell } from "@/components/auth-shell"
import { PasswordInput, PasswordMeter } from "@/components/password-field"
import { api } from "@/lib/api"
import { errorMessage } from "@/lib/errors"
import { passwordStrength } from "@/lib/password"

export function ResetForm() {
  const router = useRouter()
  const [otp, setOtp] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const canSubmit = otp.trim() && passwordStrength(password).score >= 3

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setPending(true)
    setError(null)
    try {
      await api.reset({
        otp: otp
          .trim()
          .toLowerCase()
          .split(/[\s-]+/)
          .join("-"),
        password,
      })
      toast.success("Password changed. Sign in with the new one.")
      router.replace("/login/")
    } catch (err) {
      setError(errorMessage(err))
      setPending(false)
    }
  }

  return (
    <AuthShell
      title="Reset the owner password"
      description="You need shell access to the box. That is the proof that you own it."
      aside={
        <p className="text-center text-muted-foreground text-sm">
          Remembered it?{" "}
          <Link href="/login/" className="text-foreground underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
      }
    >
      <ol className="list-decimal space-y-2 pl-5 text-muted-foreground text-sm marker:text-foreground">
        <li>
          On the box, run:
          <CopyField value="sudo agentbox reset-owner" className="mt-1.5" />
        </li>
        <li>Enter the reset code it prints and choose a new password.</li>
      </ol>
      <form onSubmit={onSubmit}>
        <FieldGroup>
          {error ? (
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <Field>
            <FieldLabel htmlFor="otp">Reset code</FieldLabel>
            <Input
              id="otp"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              autoComplete="one-time-code"
              autoCapitalize="none"
              spellCheck={false}
              className="font-mono"
              required
            />
            <FieldDescription>The code only allows setting a new password.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="password">New password</FieldLabel>
            <PasswordInput
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
              aria-describedby="password-meter"
            />
            <PasswordMeter id="password-meter" password={password} />
          </Field>
          <Button type="submit" size="lg" className="w-full" disabled={!canSubmit || pending}>
            {pending ? <Spinner /> : null}
            Set new password
          </Button>
        </FieldGroup>
      </form>
    </AuthShell>
  )
}
