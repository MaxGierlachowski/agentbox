import type { AgentEvent, AgentRunRequest } from "@workspace/providers/cloudcli"
import type {
  PlaneClient,
  PlaneLabel,
  PlaneState,
  PlaneWorkItem,
  StateGroup,
} from "@workspace/providers/plane"
import { buildPrompt, escapeHtml, issueKey, toCommentHtml } from "./prompt"

export type TaskStatus = "running" | "review" | "failed" | "interrupted"

export interface AutomationTask {
  /** Plane work item id. */
  id: string
  key: string
  title: string
  projectId: string
  projectIdentifier: string
  repo: string
  status: TaskStatus
  attempt: number
  sessionId: string | null
  startedAt: string
  finishedAt: string | null
  error: string | null
}

export interface TaskStore {
  get(id: string): AutomationTask | null
  save(task: AutomationTask): void
  /** Tasks left `running` by a previous process. */
  running(): AutomationTask[]
}

export interface AutomationConfig {
  label: string
  /** Which state groups count as "open". Default: unstarted (Todo). */
  stateGroups: StateGroup[]
  maxParallel: number
  timeoutMinutes: number
  projects: { plane: string; repo: string }[]
}

export interface AutomationDeps {
  plane: Pick<
    PlaneClient,
    "workspaceSlug" | "projects" | "states" | "labels" | "workItems" | "updateWorkItem" | "comment"
  >
  runAgent: (req: AgentRunRequest, signal: AbortSignal) => AsyncIterable<AgentEvent>
  store: TaskStore
  urls: { planeWeb: string; cloudcli: string }
  /** Path of a repo inside the workspace container. */
  repoPath: (repo: string) => string
  log?: (msg: string, extra?: Record<string, unknown>) => void
  now?: () => Date
}

const name = (x: string | { name?: string }, byId: Map<string, string>) =>
  typeof x === "string" ? (byId.get(x) ?? "") : (x.name ?? "")

/**
 * Picks up open Plane work items labelled `claude`, runs each as a Claude Code session in
 * CloudCLI, and moves it Todo → In Progress → In Review with comments along the way.
 */
export class PlaneAutomation {
  private readonly active = new Map<string, Promise<void>>()
  private readonly log: NonNullable<AutomationDeps["log"]>
  private readonly now: () => Date

  constructor(
    private readonly deps: AutomationDeps,
    private config: AutomationConfig,
  ) {
    this.log = deps.log ?? (() => {})
    this.now = deps.now ?? (() => new Date())
  }

  setConfig(config: AutomationConfig) {
    this.config = config
  }

  get runningCount() {
    return this.active.size
  }

  /** Waits for all runs started so far (tests, shutdown). */
  async drain() {
    await Promise.allSettled([...this.active.values()])
  }

  /** After a restart: runs that were in flight cannot be followed any more. */
  async recoverInterrupted() {
    for (const task of this.deps.store.running()) {
      if (this.active.has(task.id)) continue
      this.deps.store.save({
        ...task,
        status: "interrupted",
        finishedAt: this.now().toISOString(),
        error: "agentbox restarted during the run",
      })
      await this.deps.plane
        .comment(
          task.projectId,
          task.id,
          `<p>agentbox restarted while Claude was working on this. The session continues to exist in <a href="${escapeHtml(this.sessionUrl(task.sessionId))}">CloudCLI</a>; move the item back to Todo to start a follow-up run.</p>`,
        )
        .catch(() => {})
    }
  }

  /** One polling round. Returns the keys of work items that were started. */
  async poll(signal?: AbortSignal): Promise<string[]> {
    const started: string[] = []
    const projects = await this.deps.plane.projects()
    for (const mapping of this.config.projects) {
      if (signal?.aborted || this.active.size >= this.config.maxParallel) break
      const project = projects.find((p) => p.identifier === mapping.plane)
      if (!project) {
        this.log("plane project not found", { identifier: mapping.plane })
        continue
      }
      const [states, labels, items] = await Promise.all([
        this.deps.plane.states(project.id),
        this.deps.plane.labels(project.id),
        this.deps.plane.workItems(project.id),
      ])
      const stateById = new Map(states.map((s) => [s.id, s]))
      const labelNames = new Map(labels.map((l) => [l.id, l.name]))
      const failedLabel = `${this.config.label}-failed`

      const candidates = items.filter((item) => {
        const itemLabels = item.labels.map((l) => name(l as string | PlaneLabel, labelNames))
        const state = typeof item.state === "string" ? stateById.get(item.state) : item.state
        return (
          itemLabels.includes(this.config.label) &&
          !itemLabels.includes(failedLabel) &&
          state !== undefined &&
          this.config.stateGroups.includes(state.group) &&
          !this.active.has(item.id) &&
          this.deps.store.get(item.id)?.status !== "running"
        )
      })

      for (const item of candidates) {
        if (this.active.size >= this.config.maxParallel) break
        const run = this.run(
          item,
          { id: project.id, identifier: project.identifier },
          mapping.repo,
          states,
          labels,
        )
        this.active.set(
          item.id,
          run.finally(() => this.active.delete(item.id)),
        )
        started.push(issueKey(project.identifier, item))
      }
    }
    return started
  }

  private sessionUrl(sessionId: string | null) {
    return sessionId
      ? `${this.deps.urls.cloudcli.replace(/\/$/, "")}/session/${encodeURIComponent(sessionId)}`
      : this.deps.urls.cloudcli
  }

  private async run(
    item: PlaneWorkItem,
    project: { id: string; identifier: string },
    repo: string,
    states: PlaneState[],
    labels: PlaneLabel[],
  ) {
    const plane = this.deps.plane
    const key = issueKey(project.identifier, item)
    const previous = this.deps.store.get(item.id)
    const inProgress = pickState(states, "started", (s) => !/review/i.test(s.name))
    const inReview = states.find((s) => /review/i.test(s.name)) ?? inProgress
    const todo = pickState(states, "unstarted")
    const issueUrl = `${this.deps.urls.planeWeb.replace(/\/$/, "")}/${plane.workspaceSlug}/projects/${project.id}/issues/${item.id}`

    const task: AutomationTask = {
      id: item.id,
      key,
      title: item.name,
      projectId: project.id,
      projectIdentifier: project.identifier,
      repo,
      status: "running",
      attempt: (previous?.attempt ?? 0) + 1,
      sessionId: previous?.sessionId ?? null,
      startedAt: this.now().toISOString(),
      finishedAt: null,
      error: null,
    }
    this.deps.store.save(task)
    this.log("claimed work item", { key })

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMinutes * 60_000)
    try {
      if (inProgress) await plane.updateWorkItem(project.id, item.id, { state: inProgress.id })
      await plane.comment(
        project.id,
        item.id,
        `<p>🤖 Claude picked this up (run ${task.attempt}) in <code>${escapeHtml(repo)}</code>.</p>`,
      )

      const texts: string[] = []
      let completed = false
      let failure: string | null = null
      const request: AgentRunRequest = {
        projectPath: this.deps.repoPath(repo),
        message: buildPrompt({ key, item, issueUrl, followUp: Boolean(previous?.sessionId) }),
        ...(previous?.sessionId ? { sessionId: previous.sessionId } : {}),
      }
      for await (const event of this.deps.runAgent(request, controller.signal)) {
        if (event.type === "session" && event.sessionId !== task.sessionId) {
          task.sessionId = event.sessionId
          this.deps.store.save(task)
          await plane.comment(
            project.id,
            item.id,
            `<p>Live session: <a href="${escapeHtml(this.sessionUrl(task.sessionId))}">open in CloudCLI</a></p>`,
          )
        } else if (event.type === "text") texts.push(event.text)
        else if (event.type === "error") failure = event.message
        else if (event.type === "complete") {
          completed = !event.aborted
          if (event.aborted) failure = "the run was aborted in CloudCLI"
        }
      }
      if (controller.signal.aborted && !completed)
        failure = `timed out after ${this.config.timeoutMinutes} minutes`
      if (!completed && !failure) failure = "the session ended without completing"
      if (failure) throw new Error(failure)

      const summary = texts.at(-1)?.trim() || "Claude finished without a summary."
      await plane.comment(
        project.id,
        item.id,
        `<p><strong>Ready for review.</strong> <a href="${escapeHtml(this.sessionUrl(task.sessionId))}">Session</a></p>${toCommentHtml(summary)}`,
      )
      if (inReview) await plane.updateWorkItem(project.id, item.id, { state: inReview.id })
      this.deps.store.save({ ...task, status: "review", finishedAt: this.now().toISOString() })
      this.log("work item ready for review", { key })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.deps.store.save({
        ...task,
        status: "failed",
        finishedAt: this.now().toISOString(),
        error: message,
      })
      this.log("work item failed", { key, error: message })
      const failedLabel = labels.find((l) => l.name === `${this.config.label}-failed`)
      const currentLabels = item.labels.map((l) => (typeof l === "string" ? l : l.id))
      await plane
        .comment(
          project.id,
          item.id,
          `<p><strong>Claude could not finish:</strong> ${escapeHtml(message)}</p><p>Remove the label <code>${escapeHtml(`${this.config.label}-failed`)}</code> to retry.${task.sessionId ? ` <a href="${escapeHtml(this.sessionUrl(task.sessionId))}">Session</a>` : ""}</p>`,
        )
        .catch(() => {})
      await plane
        .updateWorkItem(project.id, item.id, {
          ...(todo ? { state: todo.id } : {}),
          ...(failedLabel ? { labels: [...new Set([...currentLabels, failedLabel.id])] } : {}),
        })
        .catch(() => {})
    } finally {
      clearTimeout(timeout)
    }
  }
}

function pickState(
  states: PlaneState[],
  group: StateGroup,
  accept: (s: PlaneState) => boolean = () => true,
) {
  return states
    .filter((s) => s.group === group && accept(s))
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))[0]
}
