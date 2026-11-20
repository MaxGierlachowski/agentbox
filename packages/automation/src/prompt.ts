import type { PlaneWorkItem } from "@workspace/providers/plane"

export const escapeHtml = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")

/** Plain text → Plane comment HTML: paragraphs and line breaks, everything escaped. */
export function toCommentHtml(text: string, maxLength = 6000) {
  const trimmed =
    text.length > maxLength
      ? `${text.slice(0, maxLength)}\n\n… (truncated, full text in the session)`
      : text
  return trimmed
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replaceAll("\n", "<br>")}</p>`)
    .join("")
}

export function issueKey(identifier: string, item: Pick<PlaneWorkItem, "sequence_id">) {
  return `${identifier}-${item.sequence_id}`
}

export function buildPrompt(o: {
  key: string
  item: PlaneWorkItem
  issueUrl: string
  followUp: boolean
}) {
  const description = (o.item.description_stripped ?? "").trim() || "(no description)"
  const branch = `claude/${o.key.toLowerCase()}`
  return [
    o.followUp
      ? `The Plane work item ${o.key} was moved back to Todo after your previous run. Check its comments for feedback and continue.`
      : `Work on the Plane work item ${o.key}.`,
    "",
    `Title: ${o.item.name}`,
    `Link: ${o.issueUrl}`,
    "",
    "Description:",
    description,
    "",
    "Rules:",
    `- Work on the git branch \`${branch}\` (create it from the default branch if it does not exist). Commit your changes there; do not push to the default branch.`,
    "- Run the project's tests and fix failures you caused.",
    "- If you change UI, start the dev server and check it with the browser (screenshot) before you finish.",
    "- You can read and comment on Plane work items through the `plane` tools, but do not change the work item's state: agentbox moves it to In Review when you are done.",
    "- Finish with a short summary for the reviewer: what you changed, how you verified it, and anything left open.",
  ].join("\n")
}
