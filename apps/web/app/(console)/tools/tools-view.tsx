"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ToolsSettings, type ToolsStatus } from "@workspace/contract"
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
import { Skeleton } from "@workspace/ui/components/skeleton"
import { toast } from "@workspace/ui/components/sonner"
import { Spinner } from "@workspace/ui/components/spinner"
import { PageHeader } from "@workspace/ui/composites/page-header"
import { SaveIcon } from "lucide-react"
import { useEffect } from "react"
import { Controller, type FieldPath, type UseFormReturn, useForm } from "react-hook-form"
import { z } from "zod"
import { AppCards } from "@/components/app-cards"
import { orpc } from "@/lib/orpc"

function formSchema(passwordRequired: boolean) {
  return z.object({ settings: ToolsSettings, adminPassword: z.string() }).superRefine((v, ctx) => {
    if (v.adminPassword === "" && !passwordRequired) return
    if (v.adminPassword.length < 12) {
      ctx.addIssue({
        code: "custom",
        path: ["adminPassword"],
        message: "Use at least 12 characters",
      })
    }
  })
}
type FormValues = z.input<ReturnType<typeof formSchema>>

const empty: FormValues = {
  settings: {
    admin: { email: "", name: "", username: "" },
    plane: { workspace: { name: "", slug: "" }, project: { name: "", identifier: "" } },
  },
  adminPassword: "",
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)

export function ToolsView() {
  const status = useQuery(orpc.tools.status.queryOptions())
  return (
    <>
      <PageHeader
        title="Tools"
        description="CloudCLI for Claude Code sessions, Plane for work items, MetaMCP for MCP servers. Fill this in once; the next apply sets them up, connects them and closes their sign-up."
      />
      <AppCards />
      {status.data ? <ToolsForm status={status.data} /> : <Skeleton className="h-96" />}
    </>
  )
}

function ToolsForm({ status }: { status: ToolsStatus }) {
  const queryClient = useQueryClient()
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema(!status.adminPasswordSet)),
    defaultValues: status.settings ? { settings: status.settings, adminPassword: "" } : empty,
  })
  useEffect(() => {
    if (status.settings) form.reset({ settings: status.settings, adminPassword: "" })
  }, [status.settings, form])

  const save = useMutation(
    orpc.tools.save.mutationOptions({
      onSuccess: (next) => {
        queryClient.setQueryData(orpc.tools.status.queryKey(), next)
        toast.success("Tool settings saved", { description: "They take effect on the next apply." })
      },
      onError: (err) => toast.error("Could not save", { description: err.message }),
    }),
  )

  return (
    <form
      className="grid gap-4 lg:grid-cols-2"
      onSubmit={form.handleSubmit((v) =>
        save.mutate({
          settings: ToolsSettings.parse(v.settings),
          adminPassword: v.adminPassword === "" ? undefined : v.adminPassword,
        }),
      )}
    >
      <Card>
        <CardHeader>
          <CardTitle>Admin account</CardTitle>
          <CardDescription>
            One login for all three tools. CloudCLI uses the username, Plane and MetaMCP the email.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <TextField form={form} name="settings.admin.name" label="Name" autoComplete="name" />
            <TextField
              form={form}
              name="settings.admin.email"
              label="Email"
              type="email"
              autoComplete="email"
            />
            <TextField
              form={form}
              name="settings.admin.username"
              label="Username"
              autoComplete="username"
              description="For CloudCLI. Lowercase letters, digits, - and _."
            />
            <TextField
              form={form}
              name="adminPassword"
              label="Password"
              type="password"
              autoComplete="new-password"
              placeholder={status.adminPasswordSet ? "Stored · leave empty to keep" : ""}
              description="At least 12 characters. Stored encrypted in the agentbox secret store and never shown again."
            />
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Plane</CardTitle>
          <CardDescription>
            Created on the first apply, with the label <code>claude</code> and an In Review state
            for the automation.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <TextField
              form={form}
              name="settings.plane.workspace.name"
              label="Workspace name"
              onValueChange={(v) => {
                if (!form.getFieldState("settings.plane.workspace.slug").isDirty) {
                  form.setValue("settings.plane.workspace.slug", slugify(v))
                }
              }}
            />
            <TextField
              form={form}
              name="settings.plane.workspace.slug"
              label="Workspace URL slug"
              mono
            />
            <TextField form={form} name="settings.plane.project.name" label="Project name" />
            <TextField
              form={form}
              name="settings.plane.project.identifier"
              label="Project identifier"
              mono
              description="Prefix of work item keys, e.g. SHOP for SHOP-12."
              transform={(v) => v.toUpperCase()}
            />
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? <Spinner /> : <SaveIcon />}
            Save settings
          </Button>
        </CardFooter>
      </Card>
    </form>
  )
}

function TextField({
  form,
  name,
  label,
  type = "text",
  autoComplete,
  description,
  placeholder,
  mono,
  onValueChange,
  transform,
}: {
  form: UseFormReturn<FormValues>
  name: FieldPath<FormValues>
  label: string
  type?: string
  autoComplete?: string
  description?: string
  placeholder?: string
  mono?: boolean
  onValueChange?: (value: string) => void
  transform?: (value: string) => string
}) {
  return (
    <Controller
      name={name}
      control={form.control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={name}>{label}</FieldLabel>
          <Input
            id={name}
            name={field.name}
            ref={field.ref}
            onBlur={field.onBlur}
            value={typeof field.value === "string" ? field.value : ""}
            onChange={(e) => {
              const value = transform ? transform(e.target.value) : e.target.value
              field.onChange(value)
              onValueChange?.(value)
            }}
            type={type}
            autoComplete={autoComplete}
            placeholder={placeholder}
            className={mono ? "font-mono" : undefined}
            aria-invalid={fieldState.invalid}
          />
          {description ? <FieldDescription>{description}</FieldDescription> : null}
          {fieldState.error ? <FieldError errors={[fieldState.error]} /> : null}
        </Field>
      )}
    />
  )
}
