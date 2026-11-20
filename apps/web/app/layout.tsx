import { GeistMono } from "geist/font/mono"
import { GeistSans } from "geist/font/sans"
import type { Metadata } from "next"
import "@workspace/ui/globals.css"
import { cn } from "@workspace/ui/lib/utils"
import { Providers } from "./providers"

export const metadata: Metadata = {
  title: { default: "agentbox", template: "%s · agentbox" },
  description: "Declarative agent workspaces on a single VM",
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("font-sans antialiased", GeistSans.variable, GeistMono.variable)}
    >
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
