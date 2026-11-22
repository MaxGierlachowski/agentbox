"use client"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { cn } from "@workspace/ui/lib/utils"
import { EyeIcon, EyeOffIcon } from "lucide-react"
import { type ComponentProps, useState } from "react"
import { passwordStrength } from "@/lib/password"

type InputProps = Omit<ComponentProps<typeof Input>, "type">

/** Password input with a show/hide toggle. */
export function PasswordInput({ className, ...props }: InputProps) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <Input type={visible ? "text" : "password"} className={cn("pr-10", className)} {...props} />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground"
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        onClick={() => setVisible((v) => !v)}
      >
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </Button>
    </div>
  )
}

const bar = ["bg-red-500", "bg-orange-500", "bg-amber-500", "bg-emerald-500", "bg-emerald-600"]

/** Four-segment strength meter with a one-line hint. */
export function PasswordMeter({
  password,
  userInputs,
  id,
}: {
  password: string
  userInputs?: string[]
  id?: string
}) {
  const s = passwordStrength(password, userInputs)
  return (
    <div className="space-y-1.5" id={id} aria-live="polite">
      <div className="flex gap-1" aria-hidden>
        {[1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={cn(
              "h-1 flex-1 rounded-full bg-muted transition-colors",
              password && s.score >= i && bar[s.score],
              password && s.score === 0 && i === 1 && bar[0],
            )}
          />
        ))}
      </div>
      <p className="flex justify-between gap-3 text-xs">
        <span className="text-muted-foreground">
          {password ? s.hint : "Use 12 or more characters."}
        </span>
        {password ? (
          <span
            className={cn(
              "shrink-0 font-medium",
              s.score >= 3 ? "text-emerald-600" : "text-muted-foreground",
            )}
          >
            {s.label}
          </span>
        ) : null}
      </p>
    </div>
  )
}
