"use client"

import { useQuery } from "@tanstack/react-query"
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
import { BoxIcon, ExternalLinkIcon } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { navGroups } from "@/lib/nav"
import { orpc } from "@/lib/orpc"
import { appIcons } from "./app-icons"

export function AppSidebar() {
  const pathname = usePathname()
  const me = useQuery(orpc.auth.me.queryOptions())
  const info = useQuery(orpc.system.info.queryOptions())
  const tools = useQuery(orpc.tools.status.queryOptions())

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <BoxIcon className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">agentbox</span>
                  <span className="truncate text-muted-foreground text-xs">
                    {info.data?.hostname ?? "…"}
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {navGroups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={pathname === item.href}
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
        <SidebarGroup>
          <SidebarGroupLabel>Apps</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {(tools.data?.apps ?? []).map((app) => {
                const Icon = appIcons[app.id]
                return (
                  <SidebarMenuItem key={app.id}>
                    {app.url ? (
                      <SidebarMenuButton asChild tooltip={`Open ${app.name}`}>
                        <a href={app.url} target="_blank" rel="noopener noreferrer">
                          <Icon />
                          <span>{app.name}</span>
                          <ExternalLinkIcon className="ml-auto size-3 opacity-60" />
                        </a>
                      </SidebarMenuButton>
                    ) : (
                      <SidebarMenuButton disabled tooltip={`${app.name}: not reachable yet`}>
                        <Icon />
                        <span>{app.name}</span>
                      </SidebarMenuButton>
                    )}
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <div className="truncate px-2 text-muted-foreground text-xs group-data-[collapsible=icon]:hidden">
          {me.data ? `${me.data.login} · via ${me.data.via}` : null}
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
