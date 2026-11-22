"use client"

import { useQueries } from "@tanstack/react-query"
import type { CatalogHit, Selection } from "@workspace/contract"
import { orpc } from "./orpc"

export function toSelection(ids: readonly string[]): Selection {
  return {
    skills: ids.filter((i) => i.startsWith("skill.")),
    mcps: ids.filter((i) => i.startsWith("mcp.")),
    clis: ids.filter((i) => i.startsWith("cli.")),
  }
}

export const selectionIds = (s: Selection) => [...s.skills, ...s.mcps, ...s.clis]

/** Resolves catalog ids to hits: from hits already at hand, otherwise one `catalog.get` each. */
export function useCatalogHits(ids: readonly string[], known: readonly CatalogHit[]) {
  const byId = new Map(known.map((h) => [h.id, h]))
  const missing = ids.filter((id) => !byId.has(id))
  const fetched = useQueries({
    queries: missing.map((id) => ({
      ...orpc.catalog.get.queryOptions({ input: { id } }),
      staleTime: Number.POSITIVE_INFINITY,
    })),
  })
  for (const q of fetched) if (q.data) byId.set(q.data.id, q.data)
  return byId
}
