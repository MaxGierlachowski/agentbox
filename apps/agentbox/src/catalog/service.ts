import type { CatalogHit, RoleId, Suggestion } from "@workspace/contract"

// Replaced by the catalog index once the curated catalog lands.
export class CatalogService {
  search(_input: { q: string; kind?: string; roles?: RoleId[]; limit: number }): CatalogHit[] {
    return []
  }
  get(_id: string): CatalogHit & { detail: unknown } {
    throw new Error("Unknown catalog item")
  }
  suggest(_input: { roles: RoleId[]; about?: string; refine: boolean }): Suggestion {
    return {
      selection: { skills: [], mcps: [], clis: [] },
      reasons: {},
      firstTask: "",
      firstTaskAlternatives: [],
      suggestedSites: [],
      items: [],
    }
  }
}
