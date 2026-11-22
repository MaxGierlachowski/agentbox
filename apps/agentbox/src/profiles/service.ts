import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  type Profile,
  type ProfileDraft,
  ProfileDraft as ProfileDraftSchema,
  SoulRole,
} from "@workspace/contract"
import { z } from "zod"
import type { CatalogService } from "../catalog/service"
import type { Hermes } from "../hermes/hermes"
import type { Kv } from "../kv"
import { log } from "../log"
import type { SoulService } from "../soul/service"

const META = "profiles.meta"
const RESERVED = new Set(["default", "hermes", "root", "admin", "agentbox"])

type Meta = Record<string, { name: string; role: string; purpose: string }>

/** Role template per onboarding role, for drafts without AI. */
const ROLE_PROFILE: Record<
  string,
  { slug: string; name: string; role: z.infer<typeof SoulRole>; purpose: string }
> = {
  developer: {
    slug: "reviewer",
    name: "Reviewer",
    role: "developer",
    purpose: "Reviews pull requests and diffs, runs the tests, and hands fixes to Paseo agents.",
  },
  manager: {
    slug: "inbox",
    name: "Inbox assistant",
    role: "manager",
    purpose:
      "Triages mail and messages, drafts replies (never sends), and keeps a list of follow-ups.",
  },
  "founder-ops": {
    slug: "ops-brief",
    name: "Ops",
    role: "manager",
    purpose: "Prepares the morning brief: calendar, inbox highlights, open decisions.",
  },
  devops: {
    slug: "ops",
    name: "Ops",
    role: "ops",
    purpose:
      "Triages alerts by impact, checks recent deploys first, proposes a rollback before a fix.",
  },
  data: {
    slug: "analyst",
    name: "Analyst",
    role: "data",
    purpose: "Answers data questions with read-only queries and shows the query with every answer.",
  },
  support: {
    slug: "support",
    name: "Support",
    role: "support",
    purpose:
      "Clusters incoming tickets, drafts answers from the docs, flags bugs for the developers.",
  },
  "designer-marketer": {
    slug: "designer",
    name: "Designer",
    role: "designer",
    purpose: "Drafts copy and design variants and checks them against the brand notes.",
  },
}

const LlmDrafts = z.object({
  profiles: z
    .array(
      z.object({
        slug: z.string(),
        name: z.string(),
        role: SoulRole,
        purpose: z.string(),
        skills: z.array(z.string()).default([]),
        mcps: z.array(z.string()).default([]),
      }),
    )
    .min(1)
    .max(3),
})

/** Extracts the first JSON object from a model reply (tolerates prose and code fences). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1]
  const candidate = fenced ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)
  return JSON.parse(candidate)
}

export class ProfileService {
  constructor(
    private readonly d: {
      hermes: Hermes
      kv: Kv
      catalog: CatalogService
      soul: SoulService
      /** Onboarding facts: roles, about, installed skills/MCPs, repos. */
      context: () => { roles: string[]; about: string; installed: string[]; repos: string[] }
    },
  ) {}

  private meta(): Meta {
    return this.d.kv.get<Meta>(META) ?? {}
  }

  list(): Profile[] {
    const dir = join(this.d.hermes.home, "profiles")
    const slugs = existsSync(dir)
      ? readdirSync(dir, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => e.name)
      : []
    const meta = this.meta()
    return [
      {
        slug: "default",
        name: "Hermes",
        role: "orchestrator",
        purpose: "Your main assistant: plans, delegates to Paseo agents and reports.",
        isDefault: true,
      },
      ...slugs.map((slug) => ({
        slug,
        name: meta[slug]?.name ?? slug,
        role: meta[slug]?.role ?? "custom",
        purpose: meta[slug]?.purpose ?? readDescription(join(dir, slug)),
        isDefault: false,
      })),
    ]
  }

  private template(): ProfileDraft[] {
    const { roles } = this.d.context()
    const picks = [...new Set(roles)]
      .map((r) => ROLE_PROFILE[r])
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
    const unique = [
      ...new Map(
        (picks.length
          ? picks
          : [ROLE_PROFILE.developer as NonNullable<(typeof ROLE_PROFILE)[string]>]
        ).map((p) => [p.slug, p]),
      ).values(),
    ]
    return unique.slice(0, 3).map((p) => ({ ...p, skills: [], mcps: [], crons: [], soul: "" }))
  }

  async draft(): Promise<{ profiles: ProfileDraft[]; source: "ai" | "template" }> {
    const ctx = this.d.context()
    const installed = new Set(ctx.installed)
    const prompt = [
      "You design specialist assistant profiles for a personal agent box.",
      `User roles: ${ctx.roles.join(", ") || "unknown"}. About the user: ${ctx.about || "n/a"}.`,
      `Repos: ${ctx.repos.join(", ") || "none yet"}.`,
      `Installed skills and MCP servers (use only these ids): ${[...installed].join(", ") || "none"}.`,
      `Allowed roles: ${SoulRole.options.join(", ")}.`,
      "Propose 1 to 3 profiles that complement the main orchestrator. Reply with JSON only:",
      '{"profiles":[{"slug":"lowercase-dashes","name":"Short name","role":"<allowed role>","purpose":"one or two sentences","skills":["skill.x"],"mcps":["mcp.y"]}]}',
    ].join("\n")
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const reply = await this.d.hermes.chat(prompt, { timeoutMs: 120_000 })
        const parsed = LlmDrafts.parse(extractJson(reply))
        const drafts: ProfileDraft[] = []
        for (const p of parsed.profiles) {
          const slug = p.slug
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, "-")
            .replace(/^[^a-z0-9]+/, "")
            .slice(0, 64)
          if (!slug || RESERVED.has(slug) || drafts.some((d) => d.slug === slug)) continue
          drafts.push(
            ProfileDraftSchema.parse({
              slug,
              name: p.name.slice(0, 60),
              role: p.role,
              purpose: p.purpose.slice(0, 600),
              skills: p.skills.filter((s) => installed.has(s)),
              mcps: p.mcps.filter((m) => installed.has(m)),
              crons: [],
              soul: await this.d.soul.composeProfile(p.role, p.name, p.purpose),
            }),
          )
        }
        if (drafts.length) return { profiles: drafts, source: "ai" }
      } catch (err) {
        log.warn(
          { attempt, err: (err as Error).message.slice(0, 200) },
          "profile draft from AI failed",
        )
      }
    }
    const drafts = await Promise.all(
      this.template().map(async (t) => ({
        ...t,
        soul: await this.d.soul.composeProfile(t.role, t.name, t.purpose),
      })),
    )
    return { profiles: drafts, source: "template" }
  }

  async create(d: ProfileDraft): Promise<Profile> {
    if (RESERVED.has(d.slug)) throw new Error(`"${d.slug}" is reserved`)
    const dir = join(this.d.hermes.home, "profiles", d.slug)
    if (!existsSync(dir)) {
      await this.d.hermes.runOk(
        ["profile", "create", d.slug, "--no-alias", "--description", d.purpose.slice(0, 200)],
        {
          timeoutMs: 120_000,
        },
      )
    }
    const soul = d.soul.trim()
      ? d.soul
      : await this.d.soul.composeProfile(d.role, d.name, d.purpose)
    await this.d.soul.save(soul, d.slug)
    this.d.kv.set(META, {
      ...this.meta(),
      [d.slug]: { name: d.name, role: d.role, purpose: d.purpose },
    })
    return { slug: d.slug, name: d.name, role: d.role, purpose: d.purpose, isDefault: false }
  }

  async remove(slug: string) {
    if (slug === "default") return { ok: false, message: "The default profile stays" }
    const r = await this.d.hermes.run(["profile", "delete", slug, "--yes"], { timeoutMs: 60_000 })
    const meta = this.meta()
    delete meta[slug]
    this.d.kv.set(META, meta)
    return { ok: r.code === 0, message: r.code === 0 ? null : r.stderr.trim().slice(0, 300) }
  }

  slugs() {
    return this.list()
      .filter((p) => !p.isDefault)
      .map((p) => p.slug)
  }
}

function readDescription(dir: string) {
  const file = join(dir, "description.txt")
  return existsSync(file) ? readFileSync(file, "utf8").trim() : ""
}
