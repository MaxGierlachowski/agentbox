import { Kbd } from "@workspace/ui/components/kbd"
import { Separator } from "@workspace/ui/components/separator"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@workspace/ui/components/sidebar"
import type { ReactNode } from "react"
import { AppSidebar } from "@/components/app-sidebar"
import { CommandMenu } from "@/components/command-menu"
import { Gate } from "@/components/gate"

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <Gate>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
            <span className="text-muted-foreground text-sm">workspace: default</span>
            <span className="ml-auto hidden text-muted-foreground text-xs sm:inline">
              Jump to <Kbd>⌘</Kbd> <Kbd>K</Kbd>
            </span>
          </header>
          <main className="flex flex-1 flex-col gap-6 p-4 md:p-6">{children}</main>
        </SidebarInset>
        <CommandMenu />
      </SidebarProvider>
    </Gate>
  )
}
