import { join } from "node:path"
import type { Bundle, CatalogItem } from "@workspace/contract"
import { validateCatalog } from "../../scripts/catalog-validate"

/** The real curated catalog from `catalog/` (items + bundles), loaded once at start. */
const result = await validateCatalog(join(import.meta.dir, "../.."))
if (result.errors.length) {
  console.warn(`catalog has ${result.errors.length} validation errors; the mock uses it anyway`)
}

export const CATALOG: CatalogItem[] = result.items
export const byId = new Map(CATALOG.map((i) => [i.id, i]))
export const BUNDLES: Bundle[] = result.bundles
export const BASE = BUNDLES.find((b) => b.id === "base")

export const bundleIds = (b: Bundle) => [...b.skills, ...b.mcps, ...b.clis]
