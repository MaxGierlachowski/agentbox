import type { Profile, ProfileDraft } from "@workspace/contract"

export class ProfileService {
  list(): Profile[] {
    return []
  }
  draft(): { profiles: ProfileDraft[]; source: "ai" | "template" } {
    return { profiles: [], source: "template" }
  }
  create(_d: ProfileDraft): Profile {
    throw new Error("Not available yet")
  }
  remove(_slug: string) {
    return { ok: false }
  }
}
