"use client"

import { Button } from "@workspace/ui/components/button"
import { Command, CommandInput, CommandItem, CommandList } from "@workspace/ui/components/command"
import { Label } from "@workspace/ui/components/label"
import { Spinner } from "@workspace/ui/components/spinner"
import { Switch } from "@workspace/ui/components/switch"
import { type CatalogEntry, CatalogItemRow } from "@workspace/ui/composites/catalog-item"
import { cn } from "@workspace/ui/lib/utils"
import { CheckIcon, PlusIcon } from "lucide-react"
import { useEffect, useId, useState } from "react"

export interface CatalogSearchProps<T extends CatalogEntry> {
  /** Runs the search; called debounced. */
  search: (q: string) => Promise<T[]>
  selected: readonly string[]
  onToggle: (item: T) => void
  placeholder?: string
  debounceMs?: number
  className?: string
}

/**
 * Library autocomplete: debounced search, keyboard navigation (cmdk), tier badges and an
 * "unverified" toggle that hides T3 entries by default.
 */
export function CatalogSearch<T extends CatalogEntry>({
  search,
  selected,
  onToggle,
  placeholder = "Search skills, MCP servers and CLIs…",
  debounceMs = 250,
  className,
}: CatalogSearchProps<T>) {
  const [q, setQ] = useState("")
  const [last, setLast] = useState<{ q: string; items: T[]; error: string | null } | null>(null)
  const [showUnverified, setShowUnverified] = useState(false)
  const toggleId = useId()
  const query = q.trim()

  useEffect(() => {
    if (!query) return
    let cancelled = false
    const t = setTimeout(() => {
      search(query)
        .then((items) => {
          if (!cancelled) setLast({ q: query, items, error: null })
        })
        .catch((err: unknown) => {
          if (!cancelled)
            setLast({
              q: query,
              items: [],
              error: err instanceof Error ? err.message : String(err),
            })
        })
    }, debounceMs)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [query, search, debounceMs])

  const loading = query !== "" && last?.q !== query
  // Keep showing the previous results while the next query loads.
  const results = query ? (last?.items ?? null) : null
  const error = query ? (last?.error ?? null) : null

  const visible = (results ?? []).filter((r) => showUnverified || r.tier !== "T3")
  const hidden = (results?.length ?? 0) - visible.length

  return (
    <div className={cn("space-y-2", className)} data-slot="catalog-search">
      <Command shouldFilter={false} className="rounded-xl! border bg-card p-0">
        <div className="relative">
          <CommandInput
            value={q}
            onValueChange={setQ}
            placeholder={placeholder}
            aria-label="Search the library"
          />
          {loading ? (
            <Spinner className="absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
          ) : null}
        </div>
        {results !== null ? (
          <CommandList className="max-h-80 border-t">
            {error ? <p className="p-3 text-destructive text-sm">{error}</p> : null}
            {!error && visible.length === 0 && !loading ? (
              <p className="p-4 text-center text-muted-foreground text-sm">
                Nothing found for “{query}”.
              </p>
            ) : null}
            {visible.map((item) => {
              const isSelected = selected.includes(item.id)
              return (
                <CommandItem
                  key={item.id}
                  value={item.id}
                  onSelect={() => onToggle(item)}
                  className="items-start rounded-lg px-3 py-0"
                >
                  <CatalogItemRow item={item} showKind className="flex-1 py-2" />
                  <Button
                    asChild
                    size="sm"
                    variant={isSelected ? "secondary" : "outline"}
                    className="mt-2 shrink-0"
                  >
                    <span>
                      {isSelected ? <CheckIcon /> : <PlusIcon />}
                      {isSelected ? "Added" : "Add"}
                    </span>
                  </Button>
                </CommandItem>
              )
            })}
          </CommandList>
        ) : null}
      </Command>
      <div className="flex items-center gap-2 px-1 text-muted-foreground text-xs">
        <Switch
          id={toggleId}
          size="sm"
          checked={showUnverified}
          onCheckedChange={setShowUnverified}
        />
        <Label htmlFor={toggleId} className="font-normal text-muted-foreground text-xs">
          Show unverified entries{hidden > 0 && !showUnverified ? ` (${hidden} hidden)` : ""}
        </Label>
      </div>
    </div>
  )
}
