"use client"

import { useQueries, useQuery } from "@tanstack/react-query"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { LinkIcon } from "lucide-react"
import {
  asDetail,
  CliLoginCard,
  EnvCard,
  GitIdentityCard,
  OAuthCard,
} from "@/components/connect-cards"
import { selectionIds } from "@/lib/catalog"
import { orpc } from "@/lib/orpc"
import { useWizard } from "../context"
import { StepLayout } from "../step-layout"

export function AccountsStep() {
  const w = useWizard()
  const sel = w.state.selection
  const toolkit = useQuery(orpc.toolkit.get.queryOptions())
  const installed = new Set(toolkit.data ? selectionIds(toolkit.data.installed) : [])
  const clis = (["gh", "glab"] as const).filter((c) => sel.clis.includes(`cli.${c}`))
  const ids = selectionIds(sel).filter((id) => !id.startsWith("skill."))
  const details = useQueries({
    queries: ids.map((id) => ({
      ...orpc.catalog.get.queryOptions({ input: { id } }),
      staleTime: Number.POSITIVE_INFINITY,
    })),
  })
  const loading = details.some((d) => d.isPending)
  const items = details.flatMap((d) =>
    d.data ? [{ hit: d.data, detail: asDetail(d.data.detail) }] : [],
  )
  const oauth = items.filter((i) => i.detail.auth?.type === "oauth")
  const withEnv = items.filter(
    (i) => i.detail.auth?.type !== "oauth" && (i.detail.env ?? []).length > 0,
  )
  const derived = items.filter((i) => i.detail.auth?.type === "derived")
  const nothing = !loading && clis.length + oauth.length + withEnv.length === 0

  return (
    <StepLayout
      title="Connect accounts"
      description="Only what your toolkit needs. Each sign-in runs on the box; tokens stay there and are shared by the tools that need them."
    >
      {clis.length ? (
        <div className="grid items-start gap-4 xl:grid-cols-2">
          {clis.map((c) => (
            <CliLoginCard key={c} cli={c} />
          ))}
        </div>
      ) : null}

      {loading ? <Skeleton className="h-32" /> : null}

      {oauth.length ? (
        <section aria-labelledby="oauth-title" className="space-y-3">
          <h2 id="oauth-title" className="font-medium text-sm">
            Services that sign in with your account
          </h2>
          <div className="grid gap-4">
            {oauth.map(({ hit }) => (
              <OAuthCard key={hit.id} hit={hit} installed={installed.has(hit.id)} />
            ))}
          </div>
        </section>
      ) : null}

      {withEnv.length ? (
        <section aria-labelledby="env-title" className="space-y-3">
          <h2 id="env-title" className="font-medium text-sm">
            API keys and settings
          </h2>
          <div className="grid gap-4 xl:grid-cols-2">
            {withEnv.map(({ hit, detail }) => (
              <EnvCard key={hit.id} hit={hit} env={detail.env ?? []} done={installed.has(hit.id)} />
            ))}
          </div>
        </section>
      ) : null}

      {derived.length ? (
        <p className="flex items-start gap-2 text-muted-foreground text-sm">
          <LinkIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {derived.map((d) => d.hit.name).join(", ")} {derived.length === 1 ? "reuses" : "reuse"}{" "}
            the CLI sign-in above; nothing else to do.
          </span>
        </p>
      ) : null}

      {nothing ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-muted-foreground text-sm">
          Nothing in your toolkit needs a sign-in right now.
        </p>
      ) : null}

      <GitIdentityCard />
    </StepLayout>
  )
}
