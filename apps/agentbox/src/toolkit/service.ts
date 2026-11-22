import type { RunSummary, Selection } from "@workspace/contract"

export class ToolkitService {
  get(): { selection: Selection; installed: Selection } {
    const empty = { skills: [], mcps: [], clis: [] }
    return { selection: empty, installed: empty }
  }
  apply(_add: string[], _remove: string[], _actor: string): RunSummary {
    throw new Error("Not available yet")
  }
}
