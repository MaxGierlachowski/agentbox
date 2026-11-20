import { z } from "zod"

export const ToolId = z.enum(["cloudcli", "plane", "metamcp"])
export type ToolId = z.infer<typeof ToolId>

/** Settings of the tool stack, edited on the "Tools" page. Never contains the password. */
export const ToolsSettings = z.object({
  admin: z.object({
    email: z.email("Enter a valid email address"),
    name: z.string().trim().min(1, "Enter a name").max(100),
    username: z
      .string()
      .regex(/^[a-z][a-z0-9_-]{2,31}$/, "3–32 characters: lowercase letters, digits, - and _"),
  }),
  plane: z.object({
    workspace: z.object({
      name: z.string().trim().min(1, "Enter a workspace name").max(80),
      slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,47}$/, "Lowercase letters, digits and -"),
    }),
    project: z.object({
      name: z.string().trim().min(1, "Enter a project name").max(80),
      identifier: z.string().regex(/^[A-Z][A-Z0-9]{1,11}$/, "2–12 uppercase letters or digits"),
    }),
  }),
  versions: z
    .object({
      cloudcli: z.string().default("1.37.4"),
      metamcp: z.string().default("2.4.22"),
      plane: z.string().default("v1.4.2"),
    })
    .default({ cloudcli: "1.37.4", metamcp: "2.4.22", plane: "v1.4.2" }),
})
export type ToolsSettings = z.infer<typeof ToolsSettings>

export const ToolsSaveInput = z.object({
  settings: ToolsSettings,
  /** Shared admin password for CloudCLI, Plane and MetaMCP. Stored as `tools.admin`. */
  adminPassword: z.string().min(12, "Use at least 12 characters").max(256).optional(),
})
export type ToolsSaveInput = z.infer<typeof ToolsSaveInput>

export const AppState = z.enum(["not_configured", "pending_apply", "ready", "unreachable"])
export type AppState = z.infer<typeof AppState>

export const AppInfo = z.object({
  id: ToolId,
  name: z.string(),
  description: z.string(),
  /** Tailnet URL; null while the node's MagicDNS name is unknown. */
  url: z.url().nullable(),
  port: z.number().int(),
  state: AppState,
})
export type AppInfo = z.infer<typeof AppInfo>

export const ToolsStatus = z.object({
  settings: ToolsSettings.nullable(),
  adminPasswordSet: z.boolean(),
  configured: z.boolean(),
  apps: z.array(AppInfo),
})
export type ToolsStatus = z.infer<typeof ToolsStatus>

// --- Automation (Plane -> CloudCLI) -----------------------------------------------------------

export const AutomationSettings = z.object({
  enabled: z.boolean().default(false),
  label: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,30}$/)
    .default("claude"),
  stateGroups: z
    .array(z.enum(["backlog", "unstarted"]))
    .min(1)
    .default(["unstarted"]),
  pollSeconds: z.number().int().min(15).max(3600).default(60),
  maxParallel: z.number().int().min(1).max(4).default(1),
  timeoutMinutes: z.number().int().min(5).max(480).default(60),
  projects: z
    .array(
      z.object({
        plane: z.string().regex(/^[A-Z][A-Z0-9]{1,11}$/, "Plane project identifier"),
        repo: z.string().regex(/^[a-zA-Z0-9._-]+$/, "Repository name"),
      }),
    )
    .default([]),
})
export type AutomationSettings = z.infer<typeof AutomationSettings>

export const AutomationTaskStatus = z.enum(["running", "review", "failed", "interrupted"])

export const AutomationTask = z.object({
  id: z.string(),
  key: z.string(),
  title: z.string(),
  repo: z.string(),
  status: AutomationTaskStatus,
  attempt: z.number().int(),
  sessionUrl: z.string().nullable(),
  issueUrl: z.string().nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  error: z.string().nullable(),
})
export type AutomationTask = z.infer<typeof AutomationTask>

export const AutomationStatus = z.object({
  settings: AutomationSettings,
  /** Scheduler active (enabled, configured, unlocked). */
  active: z.boolean(),
  /** Why it is not active, if it is not. */
  blockedBy: z.string().nullable(),
  lastPollAt: z.string().nullable(),
  lastError: z.string().nullable(),
  tasks: z.array(AutomationTask),
})
export type AutomationStatus = z.infer<typeof AutomationStatus>
