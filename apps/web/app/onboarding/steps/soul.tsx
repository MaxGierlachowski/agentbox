"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@workspace/ui/components/alert-dialog"
import { Button } from "@workspace/ui/components/button"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { toast } from "@workspace/ui/components/sonner"
import { Spinner } from "@workspace/ui/components/spinner"
import { SoulEditor } from "@workspace/ui/composites/soul-editor"
import { RotateCcwIcon, SparklesIcon } from "lucide-react"
import { useState } from "react"
import { errorMessage } from "@/lib/errors"
import { orpc } from "@/lib/orpc"
import { useWizard } from "../context"
import { StepLayout } from "../step-layout"

export function SoulStep() {
  const w = useWizard()
  const queryClient = useQueryClient()
  const soul = useQuery(orpc.soul.get.queryOptions())
  const ai = useQuery(orpc.ai.status.queryOptions())
  const [draft, setDraft] = useState<string | null>(null)
  const markdown = draft ?? soul.data?.markdown ?? ""
  const dirty = draft !== null && draft !== soul.data?.markdown

  const save = useMutation(
    orpc.soul.save.mutationOptions({
      onSuccess: (s) => queryClient.setQueryData(orpc.soul.get.queryKey(), s),
    }),
  )
  const regenerate = useMutation(
    orpc.soul.regenerate.mutationOptions({
      onSuccess: (s) => {
        queryClient.setQueryData(orpc.soul.get.queryKey(), s)
        setDraft(null)
        toast.success("SOUL regenerated")
      },
      onError: (e) => toast.error("Could not regenerate", { description: errorMessage(e) }),
    }),
  )

  async function onContinue() {
    if (dirty) await save.mutateAsync({ markdown })
    await w.advance()
  }

  return (
    <StepLayout
      title="Your SOUL"
      description="SOUL.md tells Hermes who it works for and how. Edit freely; the box facts in the middle are kept up to date by agentbox."
      onContinue={onContinue}
      pending={save.isPending}
      hint={dirty ? "Unsaved edits are saved when you continue." : undefined}
      actions={
        <>
          <RegenerateButton
            label="Reset"
            icon={<RotateCcwIcon />}
            description="Your sections are rebuilt from the templates and your answers. Edits you made are lost."
            disabled={regenerate.isPending}
            onConfirm={() => regenerate.mutate({ ai: false })}
          />
          <RegenerateButton
            label="Rewrite with AI"
            icon={regenerate.isPending ? <Spinner /> : <SparklesIcon />}
            description="Your model rewrites the sections about you and how it works, from your roles and description. Edits you made are replaced."
            disabled={!ai.data?.hermes.ready || regenerate.isPending}
            onConfirm={() => regenerate.mutate({ ai: true })}
          />
        </>
      }
    >
      {soul.data ? (
        <SoulEditor
          value={markdown}
          generated={soul.data.generated}
          onChange={setDraft}
          disabled={regenerate.isPending}
        />
      ) : (
        <Skeleton className="h-96" />
      )}
    </StepLayout>
  )
}

function RegenerateButton({
  label,
  icon,
  description,
  disabled,
  onConfirm,
}: {
  label: string
  icon: React.ReactNode
  description: string
  disabled?: boolean
  onConfirm: () => void
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          {icon}
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{label}?</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep my text</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{label}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
