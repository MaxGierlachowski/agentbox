"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { Spinner } from "@workspace/ui/components/spinner"
import { LockOpenIcon } from "lucide-react"
import { useRouter } from "next/navigation"
import { Controller, useForm } from "react-hook-form"
import { z } from "zod"
import { orpc } from "@/lib/orpc"

const schema = z.object({ passphrase: z.string().min(12, "Use at least 12 characters.") })

export function UnlockForm() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const status = useQuery(orpc.secrets.status.queryOptions())
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { passphrase: "" },
  })
  const unlock = useMutation(
    orpc.secrets.unlock.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: orpc.secrets.status.key() })
        router.replace("/")
      },
      onError: (err) => form.setError("passphrase", { message: err.message }),
    }),
  )
  const firstRun = status.data?.initialized === false

  return (
    <Card className="w-full max-w-md">
      <form onSubmit={form.handleSubmit((values) => unlock.mutate(values))}>
        <CardHeader>
          <CardTitle>{firstRun ? "Create the secret store" : "Unlock agentbox"}</CardTitle>
          <CardDescription>
            {firstRun
              ? "Choose a passphrase. It encrypts all credentials on this VM and cannot be recovered."
              : "Secrets stay encrypted on disk and are only held in memory after unlocking."}
          </CardDescription>
        </CardHeader>
        <CardContent className="py-6">
          <FieldGroup>
            <Controller
              name="passphrase"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="passphrase">Passphrase</FieldLabel>
                  <Input
                    {...field}
                    id="passphrase"
                    type="password"
                    autoComplete={firstRun ? "new-password" : "current-password"}
                    aria-invalid={fieldState.invalid}
                    autoFocus
                  />
                  {firstRun ? <FieldDescription>At least 12 characters.</FieldDescription> : null}
                  {fieldState.error ? <FieldError errors={[fieldState.error]} /> : null}
                </Field>
              )}
            />
          </FieldGroup>
        </CardContent>
        <CardFooter>
          <Button type="submit" className="w-full" disabled={unlock.isPending}>
            {unlock.isPending ? <Spinner /> : <LockOpenIcon />}
            {firstRun ? "Create and unlock" : "Unlock"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
