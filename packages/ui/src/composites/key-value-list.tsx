import { cn } from "@workspace/ui/lib/utils"
import type { ReactNode } from "react"

export function KeyValueList({
  items,
  className,
}: {
  items: { label: ReactNode; value: ReactNode }[]
  className?: string
}) {
  return (
    <dl className={cn("grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm", className)}>
      {items.map((item, i) => (
        <div key={i} className="contents">
          <dt className="text-muted-foreground">{item.label}</dt>
          <dd className="min-w-0 truncate font-mono text-xs leading-5">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}
