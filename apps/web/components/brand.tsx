import { cn } from "@workspace/ui/lib/utils"
import { BoxIcon } from "lucide-react"

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground",
        className,
      )}
      aria-hidden
    >
      <BoxIcon className="size-4" />
    </span>
  )
}

export function Brand({ subtitle, className }: { subtitle?: string; className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <BrandMark />
      <span className="grid leading-tight">
        <span className="font-semibold tracking-tight">agentbox</span>
        {subtitle ? <span className="text-muted-foreground text-xs">{subtitle}</span> : null}
      </span>
    </span>
  )
}
