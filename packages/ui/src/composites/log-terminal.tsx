"use client"

import type { Terminal } from "@xterm/xterm"
import "@xterm/xterm/css/xterm.css"
import { cn } from "@workspace/ui/lib/utils"
import { useEffect, useRef } from "react"

export interface LogTerminalProps {
  /**
   * Raw output chunks (ANSI and carriage returns included). The array may only grow while the
   * same `streamKey` is shown; a new key clears the terminal.
   */
  chunks: readonly string[]
  streamKey: string
  className?: string
}

/**
 * Read-only terminal for build and apply logs. xterm renders ANSI colors and `\r` progress bars
 * from apt, mise and buildx correctly, which a plain <pre> cannot.
 */
export function LogTerminal({ chunks, streamKey, className }: LogTerminalProps) {
  const container = useRef<HTMLDivElement>(null)
  const term = useRef<Terminal | null>(null)
  const written = useRef(0)
  const pending = useRef<readonly string[]>(chunks)
  pending.current = chunks

  // xterm touches `window` at import time, so it is loaded lazily on the client only.
  useEffect(() => {
    let disposed = false
    let cleanup = () => {}
    void (async () => {
      const [{ Terminal }, { FitAddon }, { WebLinksAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        import("@xterm/addon-web-links"),
      ])
      if (disposed || !container.current) return
      const t = new Terminal({
        convertEol: true,
        disableStdin: true,
        cursorStyle: "bar",
        cursorInactiveStyle: "none",
        // xterm measures glyphs on a canvas and cannot resolve CSS variables itself.
        fontFamily: `${getComputedStyle(container.current).getPropertyValue("--font-geist-mono") || "ui-monospace"}, ui-monospace, monospace`,
        fontSize: 12,
        lineHeight: 1.3,
        scrollback: 20_000,
        theme: { background: "#0a0a0a", foreground: "#e5e5e5", selectionBackground: "#404040" },
      })
      const fit = new FitAddon()
      t.loadAddon(fit)
      t.loadAddon(new WebLinksAddon())
      t.open(container.current)
      fit.fit()
      const observer = new ResizeObserver(() => fit.fit())
      observer.observe(container.current)
      term.current = t
      written.current = 0
      flush()
      cleanup = () => {
        observer.disconnect()
        t.dispose()
      }
    })()
    return () => {
      disposed = true
      term.current = null
      cleanup()
    }
  }, [])

  function flush() {
    const t = term.current
    if (!t) return
    const all = pending.current
    for (let i = written.current; i < all.length; i++) t.write(all[i] ?? "")
    written.current = all.length
  }

  useEffect(() => {
    term.current?.reset()
    written.current = 0
  }, [streamKey])

  useEffect(flush)

  return (
    <div
      className={cn("overflow-hidden rounded-lg border bg-[#0a0a0a] p-2", className)}
      data-slot="log-terminal"
    >
      <div ref={container} className="size-full" />
    </div>
  )
}
