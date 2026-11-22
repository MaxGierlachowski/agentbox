import { Badge } from "@workspace/ui/components/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import { KeyRoundIcon } from "lucide-react"
import type { ReactNode } from "react"

/** Structural subset of the contract's CatalogHit, so this package stays contract-free. */
export interface CatalogEntry {
  id: string
  kind: "skill" | "mcp" | "cli"
  name: string
  summary: string
  tier: "T0" | "T1" | "T2" | "T3"
  source: string[]
  licence: string | null
  needsAuth: boolean
  reason?: string | null
  installed?: boolean
}

const tiers = {
  T0: { label: "Curated", hint: "Curated by agentbox and tested in CI", className: "" },
  T1: { label: "Official", hint: "Official vendor or upstream project", className: "" },
  T2: {
    label: "Community",
    hint: "Popular community entry with an open-source licence",
    className: "",
  },
  T3: {
    label: "Unverified",
    hint: "Not reviewed. Check the source before you add it.",
    className: "border-amber-500/40 text-amber-700 dark:text-amber-400",
  },
} as const

export function TierBadge({ tier, className }: { tier: CatalogEntry["tier"]; className?: string }) {
  const t = tiers[tier]
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant={tier === "T0" ? "secondary" : "outline"}
          className={cn(
            "h-5 cursor-default px-1.5 font-normal text-[0.7rem]",
            t.className,
            className,
          )}
          tabIndex={0}
        >
          {t.label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{t.hint}</TooltipContent>
    </Tooltip>
  )
}

export const kindLabel = { skill: "Skill", mcp: "MCP server", cli: "CLI" } as const

/** One catalog row: name, tier, licence, auth hint, summary and why it was suggested. */
export function CatalogItemRow({
  item,
  action,
  showKind = false,
  className,
}: {
  item: CatalogEntry
  action?: ReactNode
  showKind?: boolean
  className?: string
}) {
  return (
    <div
      className={cn("flex items-start gap-3 py-2.5", className)}
      data-slot="catalog-item"
      data-id={item.id}
    >
      {action ? <div className="pt-0.5">{action}</div> : null}
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium text-sm">{item.name}</span>
          <TierBadge tier={item.tier} />
          {showKind ? (
            <Badge variant="outline" className="h-5 px-1.5 font-normal text-[0.7rem]">
              {kindLabel[item.kind]}
            </Badge>
          ) : null}
          {item.needsAuth ? (
            <span
              className="inline-flex items-center gap-1 text-amber-700 text-xs dark:text-amber-400"
              title="Needs a sign-in or API key"
            >
              <KeyRoundIcon className="size-3" aria-hidden />
              <span>Sign-in</span>
            </span>
          ) : null}
        </div>
        <p className="text-muted-foreground text-xs leading-snug">{item.summary}</p>
        <p className="text-[0.7rem] text-muted-foreground/80">
          {item.licence ?? "No licence"} · {item.source.join(", ")}
          {item.reason ? <> · {item.reason}</> : null}
        </p>
      </div>
    </div>
  )
}
