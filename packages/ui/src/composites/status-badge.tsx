import { Badge } from "@workspace/ui/components/badge"
import { cn } from "@workspace/ui/lib/utils"
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleSlashIcon,
  CircleXIcon,
  LoaderCircleIcon,
  LockIcon,
} from "lucide-react"

export type Status =
  | "ok"
  | "warn"
  | "fail"
  | "running"
  | "pending"
  | "cancelled"
  | "sealed"
  | "succeeded"
  | "failed"

const styles: Record<Status, { label: string; className: string; icon: typeof CircleCheckIcon }> = {
  ok: { label: "OK", className: "text-emerald-600 dark:text-emerald-400", icon: CircleCheckIcon },
  succeeded: {
    label: "Succeeded",
    className: "text-emerald-600 dark:text-emerald-400",
    icon: CircleCheckIcon,
  },
  warn: {
    label: "Warning",
    className: "text-amber-600 dark:text-amber-400",
    icon: CircleAlertIcon,
  },
  fail: { label: "Failed", className: "text-red-600 dark:text-red-400", icon: CircleXIcon },
  failed: { label: "Failed", className: "text-red-600 dark:text-red-400", icon: CircleXIcon },
  running: {
    label: "Running",
    className: "text-sky-600 dark:text-sky-400",
    icon: LoaderCircleIcon,
  },
  pending: { label: "Pending", className: "text-muted-foreground", icon: CircleDashedIcon },
  cancelled: { label: "Cancelled", className: "text-muted-foreground", icon: CircleSlashIcon },
  sealed: { label: "Sealed", className: "text-amber-600 dark:text-amber-400", icon: LockIcon },
}

export function StatusBadge({
  status,
  label,
  className,
}: {
  status: Status
  label?: string
  className?: string
}) {
  const s = styles[status]
  const Icon = s.icon
  return (
    <Badge variant="outline" className={cn("gap-1", s.className, className)} data-status={status}>
      <Icon className={cn("size-3", status === "running" && "animate-spin")} aria-hidden />
      {label ?? s.label}
    </Badge>
  )
}
