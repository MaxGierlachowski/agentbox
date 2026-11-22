import { cn } from "@workspace/ui/lib/utils"
import { useMemo } from "react"
import { encode } from "uqr"

export interface QrCodeProps {
  value: string
  /** Accessible description of what scanning does. */
  label: string
  className?: string
}

/**
 * QR code rendered as a single SVG path (no canvas, no network). Dark modules on a white
 * quiet zone in both themes: phone cameras need the contrast.
 */
export function QrCode({ value, label, className }: QrCodeProps) {
  const { path, size } = useMemo(() => {
    const qr = encode(value, { ecc: "M", border: 2 })
    let d = ""
    qr.data.forEach((row, y) => {
      row.forEach((on, x) => {
        if (on) d += `M${x} ${y}h1v1h-1z`
      })
    })
    return { path: d, size: qr.size }
  }, [value])

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className={cn("aspect-square rounded-lg bg-white", className)}
      data-slot="qr-code"
      data-value={value}
    >
      <path d={path} fill="#0a0a0a" />
    </svg>
  )
}
