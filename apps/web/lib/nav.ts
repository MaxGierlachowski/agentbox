import {
  BotIcon,
  HistoryIcon,
  LayoutDashboardIcon,
  type LucideIcon,
  MonitorIcon,
  PackageIcon,
  SettingsIcon,
  SmartphoneIcon,
} from "lucide-react"

export interface NavItem {
  title: string
  href: string
  icon: LucideIcon
}

export const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: "Box",
    items: [
      { title: "Overview", href: "/", icon: LayoutDashboardIcon },
      { title: "Devices", href: "/devices/", icon: SmartphoneIcon },
      { title: "Browser", href: "/desktop/", icon: MonitorIcon },
      { title: "Runs", href: "/runs/", icon: HistoryIcon },
    ],
  },
  {
    label: "Configure",
    items: [
      { title: "Toolkit", href: "/toolkit/", icon: PackageIcon },
      { title: "Agents", href: "/agents/", icon: BotIcon },
      { title: "Settings", href: "/settings/", icon: SettingsIcon },
    ],
  },
]

/** usePathname() drops the trailing slash; hrefs keep it (trailingSlash: true). */
export const samePath = (a: string, b: string) =>
  (a.replace(/\/+$/, "") || "/") === (b.replace(/\/+$/, "") || "/")
