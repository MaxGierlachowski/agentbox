import {
  BotIcon,
  BotMessageSquareIcon,
  BoxesIcon,
  FileCodeIcon,
  FolderGitIcon,
  HistoryIcon,
  KeyRoundIcon,
  LayoutDashboardIcon,
  type LucideIcon,
  PackageIcon,
  PlayIcon,
  ServerIcon,
  SettingsIcon,
  WrenchIcon,
} from "lucide-react"

export interface NavItem {
  title: string
  href: string
  icon: LucideIcon
  /** Phase in which the page gets real content. */
  phase: "0" | "0.1" | "0.2"
}

export const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: "Workspace",
    items: [
      { title: "Overview", href: "/", icon: LayoutDashboardIcon, phase: "0" },
      { title: "Environment", href: "/environment/", icon: ServerIcon, phase: "0.1" },
      { title: "Image & Toolchains", href: "/image/", icon: PackageIcon, phase: "0.1" },
      { title: "Repositories", href: "/repos/", icon: FolderGitIcon, phase: "0.1" },
      { title: "Credentials", href: "/credentials/", icon: KeyRoundIcon, phase: "0.1" },
      { title: "Agents & LLM", href: "/agents/", icon: BotIcon, phase: "0.1" },
      { title: "Services", href: "/services/", icon: BoxesIcon, phase: "0.2" },
      { title: "Tools", href: "/tools/", icon: WrenchIcon, phase: "0.2" },
    ],
  },
  {
    label: "Operations",
    items: [
      { title: "Review & Apply", href: "/apply/", icon: PlayIcon, phase: "0.1" },
      { title: "Automation", href: "/automation/", icon: BotMessageSquareIcon, phase: "0.2" },
      { title: "Runs", href: "/runs/", icon: HistoryIcon, phase: "0" },
      { title: "Spec (YAML)", href: "/spec/", icon: FileCodeIcon, phase: "0.1" },
      { title: "Settings", href: "/settings/", icon: SettingsIcon, phase: "0.1" },
    ],
  },
]
