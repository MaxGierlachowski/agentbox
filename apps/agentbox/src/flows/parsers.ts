import type { FlowParser } from "./flows"

const lastMatch = (s: string, re: RegExp) => {
  let found: RegExpExecArray | null = null
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`)
  for (let m = g.exec(s); m; m = g.exec(s)) found = m
  return found
}

/** `gh auth login --web …`: one-time code + github.com/login/device, then "Press Enter". */
export function ghParser(verify: FlowParser["verify"]): FlowParser {
  return {
    parse: (out) => ({
      code: lastMatch(out, /one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/)?.[1],
      url: lastMatch(out, /(https:\/\/[^\s]+\/login\/device)/)?.[1],
    }),
    autoAnswers: [{ match: /Press Enter to open/i, send: "\r" }],
    verify,
  }
}

/** `glab auth login --device …`: user code + verification URL on the GitLab instance. */
export function glabParser(verify: FlowParser["verify"]): FlowParser {
  return {
    parse: (out) => ({
      code:
        lastMatch(out, /(?:user code|code)[^A-Z0-9]{0,20}([A-Z0-9]{4,}-?[A-Z0-9]{4,})/i)?.[1] ??
        undefined,
      url: lastMatch(out, /(https:\/\/[^\s]+\/oauth\/device[^\s]*)/)?.[1],
    }),
    autoAnswers: [{ match: /Press Enter/i, send: "\r" }],
    verify,
  }
}

/**
 * `claude auth login --claudeai`: prints an authorize URL; the page shows a code the user
 * pastes back ("Paste code here if prompted").
 */
export function claudeParser(verify: FlowParser["verify"]): FlowParser {
  return {
    parse: (out) => {
      const url = lastMatch(
        out,
        /(https:\/\/(?:claude\.ai|claude\.com|console\.anthropic\.com)\/[^\s]*oauth[^\s]*)/,
      )?.[1]
      return { url, needsPaste: Boolean(url) }
    },
    verify,
  }
}
