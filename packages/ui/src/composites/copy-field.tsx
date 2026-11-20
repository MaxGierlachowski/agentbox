"use client"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { CheckIcon, CopyIcon } from "lucide-react"
import { useState } from "react"

/** Read-only value with a copy button: public URLs, SSH public keys, commands. */
export function CopyField({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-md border bg-muted/40 py-1 pr-1 pl-3",
        className,
      )}
    >
      <code className="min-w-0 flex-1 truncate font-mono text-xs">{value}</code>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label="Copy"
        onClick={async () => {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
    </div>
  )
}
