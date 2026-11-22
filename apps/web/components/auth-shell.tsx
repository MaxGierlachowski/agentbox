import type { ReactNode } from "react"
import { Brand } from "./brand"

/** Centered single-card layout for setup, sign-in and reset. */
export function AuthShell({
  title,
  description,
  children,
  aside,
}: {
  title: string
  description?: ReactNode
  children: ReactNode
  aside?: ReactNode
}) {
  return (
    <div className="relative flex min-h-svh flex-col items-center justify-center overflow-hidden px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,var(--color-muted),transparent_60%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(to_right,var(--color-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-border)_1px,transparent_1px)] bg-[size:48px_48px] opacity-40 [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]"
      />
      <main className="w-full max-w-md space-y-6">
        <Brand />
        <div className="space-y-6 rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
          <div className="space-y-1.5">
            <h1 className="font-semibold text-xl tracking-tight">{title}</h1>
            {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
          </div>
          {children}
        </div>
        {aside}
      </main>
    </div>
  )
}
