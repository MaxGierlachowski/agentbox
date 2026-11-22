import type { CatalogHit, RoleId } from "@workspace/contract"

type Item = Omit<CatalogHit, "reason" | "installed">

const item = (
  id: string,
  name: string,
  summary: string,
  extra: Partial<Item> & { roles?: RoleId[] } = {},
): Item => ({
  id,
  kind: id.split(".")[0] as Item["kind"],
  name,
  summary,
  tier: "T0",
  source: ["curated"],
  licence: "MIT",
  roles: [],
  needsAuth: false,
  homepage: null,
  ...extra,
})

/** A small, realistic slice of the v1 catalog. */
export const CATALOG: Item[] = [
  // skills
  item("skill.grounded-citations", "Grounded citations", "Cite the source of every claim", {
    source: ["hermes"],
    tier: "T1",
  }),
  item("skill.email-inbox-triage", "Inbox triage", "Sort, summarise and draft replies", {
    source: ["hermes"],
    tier: "T1",
    roles: ["manager", "founder-ops", "support"],
  }),
  item("skill.meeting-action-items", "Meeting action items", "Owners and dates from notes", {
    source: ["hermes"],
    tier: "T1",
    roles: ["manager"],
  }),
  item("skill.weekly-review-planning", "Weekly review", "Plan the week from open loops", {
    source: ["hermes"],
    tier: "T1",
  }),
  item("skill.github", "GitHub workflows", "Issues, PRs and reviews through gh", {
    source: ["hermes"],
    tier: "T1",
    roles: ["developer", "devops"],
  }),
  item("skill.systematic-debugging", "Systematic debugging", "Reproduce, bisect, fix, verify", {
    source: ["hermes"],
    tier: "T1",
    roles: ["developer"],
  }),
  item(
    "skill.test-driven-development",
    "Test-driven development",
    "Red, green, refactor in small steps",
    { source: ["hermes"], tier: "T1", roles: ["developer"] },
  ),
  item(
    "skill.requesting-code-review",
    "Code review requests",
    "Prepare a diff a reviewer can read",
    { source: ["hermes"], tier: "T1", roles: ["developer"] },
  ),
  item("skill.frontend-design", "Frontend design", "Distinctive, intentional UI design", {
    source: ["anthropics-skills"],
    tier: "T1",
    licence: "Apache-2.0",
    roles: ["developer"],
  }),
  item("skill.humanizer", "Humanizer", "Rewrite text so it reads naturally", {
    source: ["hermes"],
    tier: "T1",
    roles: ["designer-marketer"],
  }),
  item(
    "skill.competitor-news-monitor",
    "Competitor news monitor",
    "Weekly digest of competitor moves",
    { source: ["hermes"], tier: "T1", roles: ["founder-ops", "manager"] },
  ),
  item("skill.agentbox-onboard", "agentbox onboard", "Re-run onboarding by chatting", {}),
  item("skill.agentbox-doctor", "agentbox doctor", "Find and fix problems on this box", {}),
  item("skill.sql-analyst", "SQL analyst", "Read-only SQL with the query shown", {
    tier: "T2",
    source: ["mcp-registry"],
    roles: ["data"],
  }),
  // MCP servers
  item("mcp.paseo", "Paseo", "Delegate coding work to Claude Code agents", {}),
  item("mcp.github", "GitHub", "Issues, pull requests and code search", {
    roles: ["developer", "devops"],
    needsAuth: true,
    homepage: "https://github.com/github/github-mcp-server",
  }),
  item("mcp.context7", "Context7", "Up-to-date library docs", {
    tier: "T1",
    source: ["mcp-registry"],
    roles: ["developer"],
  }),
  item("mcp.playwright", "Playwright", "Drive a browser for tests and checks", {
    tier: "T1",
    source: ["mcp-registry"],
    licence: "Apache-2.0",
    roles: ["developer"],
  }),
  item("mcp.sentry", "Sentry", "Errors and performance issues", {
    tier: "T1",
    source: ["mcp-registry"],
    roles: ["developer", "devops"],
    needsAuth: true,
  }),
  item("mcp.linear", "Linear", "Issues, projects and cycles", {
    tier: "T1",
    source: ["mcp-registry"],
    roles: ["manager", "founder-ops"],
    needsAuth: true,
  }),
  item("mcp.gmail", "Gmail", "Read, label and draft mail", {
    roles: ["manager", "founder-ops", "support"],
    needsAuth: true,
  }),
  item("mcp.slack", "Slack", "Channels, threads and search", {
    roles: ["manager", "founder-ops", "support"],
    needsAuth: true,
  }),
  item("mcp.google-calendar", "Google Calendar", "Events and free/busy", {
    roles: ["manager", "founder-ops"],
    needsAuth: true,
  }),
  item("mcp.postgres", "Postgres (read-only)", "Query a database with a read-only role", {
    tier: "T1",
    source: ["mcp-registry"],
    roles: ["data", "developer"],
    needsAuth: true,
  }),
  item("mcp.grafana", "Grafana", "Dashboards, alerts and logs", {
    tier: "T1",
    source: ["mcp-registry"],
    licence: "Apache-2.0",
    roles: ["devops"],
    needsAuth: true,
  }),
  item("mcp.figma", "Figma", "Read frames and components", {
    tier: "T2",
    source: ["mcp-registry"],
    roles: ["designer-marketer"],
    needsAuth: true,
  }),
  item("mcp.weather-demo", "Weather (community)", "Forecasts from a community server", {
    tier: "T3",
    source: ["mcp-registry"],
    licence: null,
  }),
  // CLIs
  item("cli.git", "git", "Version control", { licence: "GPL-2.0" }),
  item("cli.gh", "GitHub CLI", "gh: PRs, issues and releases", {
    roles: ["developer", "devops"],
    needsAuth: true,
  }),
  item("cli.glab", "GitLab CLI", "glab: merge requests and pipelines", {
    roles: ["developer", "devops"],
    needsAuth: true,
  }),
  item("cli.docker", "Docker", "Containers for builds and tests", {
    roles: ["developer", "devops"],
    licence: "Apache-2.0",
  }),
  item("cli.kubectl", "kubectl", "Kubernetes clusters", {
    roles: ["devops"],
    licence: "Apache-2.0",
    needsAuth: true,
  }),
  item("cli.duckdb", "DuckDB", "Fast local analytics on files", { roles: ["data"] }),
]

export const byId = new Map(CATALOG.map((i) => [i.id, i]))

interface Bundle {
  label: string
  ids: string[]
  firstTask: string
  alternatives: string[]
  sites: string[]
}

export const BASE = [
  "skill.grounded-citations",
  "skill.weekly-review-planning",
  "skill.agentbox-onboard",
  "skill.agentbox-doctor",
  "mcp.paseo",
  "cli.git",
]

export const BUNDLES: Partial<Record<RoleId, Bundle>> = {
  developer: {
    label: "Developer",
    ids: [
      "skill.github",
      "skill.systematic-debugging",
      "skill.test-driven-development",
      "skill.requesting-code-review",
      "skill.frontend-design",
      "mcp.github",
      "mcp.context7",
      "cli.gh",
      "cli.glab",
    ],
    firstTask: "Review the open pull requests in my main repo and summarise the risk of each.",
    alternatives: [
      "Find flaky tests in my main repo and propose fixes",
      "Write an AGENTS.md for each cloned repo",
      "List TODOs older than 6 months and open issues for them",
    ],
    sites: ["github.com", "gitlab.com"],
  },
  manager: {
    label: "Manager / PM",
    ids: ["skill.meeting-action-items", "skill.email-inbox-triage", "mcp.linear", "mcp.slack"],
    firstTask: "Summarise this week's tickets and draft my stand-up notes.",
    alternatives: [
      "Draft a project status update",
      "Find decisions without an owner",
      "Plan next week",
    ],
    sites: ["linear.app", "slack.com", "accounts.google.com"],
  },
  "founder-ops": {
    label: "Founder / Ops",
    ids: [
      "skill.email-inbox-triage",
      "skill.competitor-news-monitor",
      "mcp.gmail",
      "mcp.google-calendar",
    ],
    firstTask: "Triage my inbox and draft replies for anything urgent.",
    alternatives: ["Prepare tomorrow's meetings", "Summarise competitor news", "Plan my week"],
    sites: ["accounts.google.com", "slack.com"],
  },
  data: {
    label: "Data",
    ids: ["skill.sql-analyst", "mcp.postgres", "cli.duckdb"],
    firstTask: "Answer: what were last month's top metrics, with the SQL you used?",
    alternatives: ["Profile a CSV", "Find anomalies in yesterday's numbers", "Draft a dashboard"],
    sites: [],
  },
  devops: {
    label: "DevOps / SRE",
    ids: ["mcp.grafana", "mcp.sentry", "cli.kubectl", "cli.docker", "cli.gh"],
    firstTask: "Check the alerts from the last 24 hours and rank them by impact.",
    alternatives: ["Review the last deploy", "Find noisy alerts", "Write a runbook"],
    sites: ["github.com"],
  },
  support: {
    label: "Support",
    ids: ["skill.email-inbox-triage", "mcp.slack", "mcp.gmail"],
    firstTask: "Cluster this week's support requests by topic.",
    alternatives: ["Draft macros for top questions", "Find unanswered threads", "Weekly report"],
    sites: ["slack.com"],
  },
  "designer-marketer": {
    label: "Designer / Marketer",
    ids: ["skill.humanizer", "mcp.figma"],
    firstTask: "Draft a launch post for my latest project.",
    alternatives: ["Rewrite my homepage hero", "Plan a content calendar", "Review a design"],
    sites: ["figma.com"],
  },
}
