import { expect, test } from "bun:test"
import { CADDYFILE, COMPONENTS, HELPERS, SCRIPTS, UNITS } from "../index"

test("every service unit belongs to agentbox.target and runs as a dedicated user", () => {
  for (const [name, text] of Object.entries(UNITS)) {
    if (name === "agentbox.target" || name.endsWith(".path")) continue
    if (name === "agentbox-iroh-reload.service") continue
    expect(text, name).toContain("PartOf=agentbox.target")
    expect(text, name).toContain("WantedBy=agentbox.target")
    if (name !== "agentbox-firewall.service") expect(text, name).toMatch(/^User=agentbox(-edge)?$/m)
  }
})

test("the edge config binds loopback except the LAN block and strips spoofable headers", () => {
  expect(CADDYFILE).toContain("# @LAN_BEGIN@")
  expect(CADDYFILE).toContain("# @LAN_END@")
  const outsideLan = CADDYFILE.replace(/# @LAN_BEGIN@[\s\S]*# @LAN_END@/, "")
  expect(outsideLan.match(/^\s*bind (.+)$/gm)?.map((l) => l.trim())).toEqual([
    "bind 127.0.0.1",
    "bind 127.0.0.1",
  ])
  expect(CADDYFILE).toContain("request_header -X-Agentbox-User")
  expect(CADDYFILE).toContain("copy_headers X-Agentbox-User")
  expect(CADDYFILE).toContain("protocols h1 h2")
})

test("install scripts are strict bash; helpers exist", () => {
  for (const [name, text] of Object.entries(SCRIPTS)) {
    expect(text.startsWith("#!/usr/bin/env bash"), name).toBe(true)
    expect(text, name).toContain("set -euo pipefail")
  }
  expect(Object.keys(HELPERS).sort()).toEqual(["chrome-cdp-close.py", "firewall.sh", "open-url"])
})

test("pinned debs carry sha256 for both architectures", () => {
  for (const c of [COMPONENTS.gh, COMPONENTS.glab]) {
    expect(c.sha256.amd64).toMatch(/^[0-9a-f]{64}$/)
    expect(c.sha256.arm64).toMatch(/^[0-9a-f]{64}$/)
    expect(c.url("amd64")).toContain(c.version)
  }
})
