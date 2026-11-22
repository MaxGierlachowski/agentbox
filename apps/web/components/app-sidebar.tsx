"use client"

import { useQuery } from "@tanstack/react-query"
import { Button } from "@workspace/ui/components/button"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@workspace/ui/components/sidebar"
import { ArrowUpRightIcon, LogOutIcon, MessageSquareIcon } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { api, go } from "@/lib/api"
import { navGroups, samePath } from "@/lib/nav"
import { orpc } from "@/lib/orpc"
import { Brand } from "./brand"

export function AppSidebar() {
  const pathname = usePathname()
  const me = useQuery(orpc.auth.me.queryOptions())
  const info = useQuery(orpc.system.info.queryOptions())

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/">
                <Brand subtitle={info.data?.hostname ?? "…"} />
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="Open Hermes UI" className="font-medium">
                  <a href="/hermes/">
                    <MessageSquareIcon />
                    <span>Open Hermes UI</span>
                    <ArrowUpRightIcon className="ml-auto size-3.5 opacity-60" />
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {navGroups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={samePath(pathname, item.href)}
                      tooltip={item.title}
                    >
                      <Link href={item.href}>
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <div className="flex items-center gap-2 px-2 group-data-[collapsible=icon]:hidden">
          <div className="grid min-w-0 flex-1 text-xs leading-tight">
            <span className="truncate font-medium">{me.data?.name ?? me.data?.login}</span>
            <span className="truncate text-muted-foreground">{me.data?.login}</span>
          </div>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Sign out"
            title="Sign out"
            onClick={async () => {
              await api.logout().catch(() => {})
              go("/login/")
            }}
          >
            <LogOutIcon />
          </Button>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
