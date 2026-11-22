"use client"

import { useMutation } from "@tanstack/react-query"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { toast } from "@workspace/ui/components/sonner"
import { ArrowUpRightIcon } from "lucide-react"
import { useSyncExternalStore } from "react"
import { errorMessage } from "@/lib/errors"
import { orpc } from "@/lib/orpc"

const KEY = "agentbox.browser.sites-done"
const listeners = new Set<() => void>()
const read = () => (typeof window === "undefined" ? "[]" : (localStorage.getItem(KEY) ?? "[]"))
function useDoneSites(): [string[], (next: string[]) => void] {
  const raw = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    read,
    () => "[]",
  )
  const set = (next: string[]) => {
    localStorage.setItem(KEY, JSON.stringify(next))
    for (const l of listeners) l()
  }
  return [JSON.parse(raw) as string[], set]
}

const toUrl = (site: string) => (/^https?:\/\//.test(site) ? site : `https://${site}`)
const label = (site: string) => {
  try {
    return new URL(toUrl(site)).host.replace(/^www\./, "")
  } catch {
    return site
  }
}

/** Sites worth signing in to in the box's browser, ticked off locally. */
export function SiteChecklist({ sites }: { sites: readonly string[] }) {
  const [done, setDone] = useDoneSites()
  const open = useMutation(
    orpc.browser.open.mutationOptions({
      onSuccess: (_, v) => toast.success(`Opened ${label(v.url)} in the box browser`),
      onError: (e) => toast.error("Could not open the page", { description: errorMessage(e) }),
    }),
  )
  if (!sites.length) {
    return (
      <p className="text-muted-foreground text-sm">
        No suggestions for your toolkit. Sign in to whatever your agents should use.
      </p>
    )
  }
  return (
    <ul className="space-y-1">
      {sites.map((site) => {
        const id = `site-${site}`
        const checked = done.includes(site)
        return (
          <li
            key={site}
            className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-muted/50"
          >
            <Checkbox
              id={id}
              checked={checked}
              onCheckedChange={(v) => setDone(v ? [...done, site] : done.filter((x) => x !== site))}
            />
            <label
              htmlFor={id}
              className={
                checked ? "flex-1 text-muted-foreground text-sm line-through" : "flex-1 text-sm"
              }
            >
              {label(site)}
            </label>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => open.mutate({ url: toUrl(site) })}
              aria-label={`Open ${label(site)} in the box browser`}
            >
              Open
              <ArrowUpRightIcon />
            </Button>
          </li>
        )
      })}
    </ul>
  )
}
