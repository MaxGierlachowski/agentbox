"use client"

import { isDefinedError } from "@orpc/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { Toaster } from "@workspace/ui/components/sonner"
import { TooltipProvider } from "@workspace/ui/components/tooltip"
import { NuqsAdapter } from "nuqs/adapters/next/app"
import { type ReactNode, useState } from "react"
import { ThemeProvider } from "@/components/theme-provider"

const isUnauthorized = (error: unknown) =>
  typeof error === "object" && error !== null && "status" in error && error.status === 401

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10_000,
            retry: (count, error) => !isUnauthorized(error) && !isDefinedError(error) && count < 2,
          },
        },
      }),
  )
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <NuqsAdapter>
          <TooltipProvider>
            {children}
            <Toaster richColors closeButton position="top-center" />
          </TooltipProvider>
        </NuqsAdapter>
      </QueryClientProvider>
    </ThemeProvider>
  )
}
