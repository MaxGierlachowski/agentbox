import { expect, test } from "bun:test"
import { RunEvent } from "./events"

const base = { runId: "r1", seq: 0, at: "2026-09-24T10:00:00.000Z" }

test("accepts every event type the server emits", () => {
  const events = [
    { ...base, type: "run.started", kind: "apply" },
    { ...base, type: "provider.started", provider: "image" },
    {
      ...base,
      type: "provider.log",
      provider: "image",
      stream: "stdout",
      data: "\x1b[32mok\x1b[0m\r",
    },
    {
      ...base,
      type: "check.result",
      provider: "image",
      id: "image.ready",
      status: "warn",
      message: "m",
    },
    { ...base, type: "provider.finished", provider: "image", outcome: "ok", durationMs: 12 },
    { ...base, type: "run.finished", status: "succeeded" },
  ]
  for (const e of events) expect(RunEvent.safeParse(e).success).toBe(true)
})

test("rejects unknown types and negative sequence numbers", () => {
  expect(RunEvent.safeParse({ ...base, type: "nope" }).success).toBe(false)
  expect(
    RunEvent.safeParse({ ...base, seq: -1, type: "run.finished", status: "succeeded" }).success,
  ).toBe(false)
})
