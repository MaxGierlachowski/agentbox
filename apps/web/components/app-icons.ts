import type { ToolId } from "@workspace/contract"
import { KanbanSquareIcon, type LucideIcon, PlugZapIcon, TerminalSquareIcon } from "lucide-react"

export const appIcons: Record<ToolId, LucideIcon> = {
  cloudcli: TerminalSquareIcon,
  plane: KanbanSquareIcon,
  metamcp: PlugZapIcon,
}
