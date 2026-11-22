import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { stripAnsi } from "./flows"
import { claudeParser, ghParser, glabParser } from "./parsers"

// Raw PTY transcripts from the pinned CLIs (spike S9; one-time codes replaced by X).
const fixture = (name: string) =>
  stripAnsi(readFileSync(join(import.meta.dir, "fixtures", name), "utf8"))

test("gh: code, verification URL and the Enter prompt", () => {
  const p = ghParser(undefined)
  const out = fixture("gh-device.txt")
  expect(p.parse(out)).toEqual({ code: "XXXX-XXXX", url: "https://github.com/login/device" })
  expect(p.autoAnswers?.[0]?.match.test(out)).toBe(true)
})

test("glab: 8-character code and device URL", () => {
  expect(glabParser(undefined).parse(fixture("glab-device.txt"))).toEqual({
    code: "XXXXXXXX",
    url: "https://gitlab.com/oauth/device",
  })
})

test("claude: short authorize URL, paste needed; OSC 8 links are stripped", () => {
  const out = fixture("claude-login.txt")
  const r = claudeParser(undefined).parse(out)
  expect(r.url).toMatch(/^https:\/\/claude\.ai\/oauth\/authorize\?\S+$/)
  expect(r.needsPaste).toBe(true)
  expect(out).not.toContain("\u001b")
  expect(fixture("claude-login-badcode.txt")).toContain("Couldn't log in")
})
