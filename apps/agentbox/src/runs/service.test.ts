import { expect, test } from "bun:test"
import { openDb } from "@workspace/infra/db"
import { RunService } from "./service"

test("stream resumes from a sequence number and ends on run.finished", async () => {
  const runs = new RunService(openDb(":memory:"))
  const run = runs.create("apply", "test")
  runs.append(run.id, { type: "provider.started", provider: "image" })

  const collected: number[] = []
  const reader = (async () => {
    for await (const e of runs.stream(run.id, 1)) collected.push(e.seq)
  })()
  await Bun.sleep(10)
  runs.append(run.id, { type: "provider.log", provider: "image", stream: "stdout", data: "hi" })
  runs.append(run.id, { type: "run.finished", status: "succeeded" })
  await reader

  expect(collected).toEqual([1, 2, 3])
  expect(runs.get(run.id).status).toBe("succeeded")
})

test("secret values are redacted from logs", async () => {
  const runs = new RunService(openDb(":memory:"))
  runs.setRedactions(["sk-ant-secret"])
  const run = runs.create("apply", "test")
  runs.append(run.id, {
    type: "provider.log",
    provider: "x",
    stream: "stdout",
    data: `key=sk-ant-secret b64=${Buffer.from("sk-ant-secret").toString("base64")}`,
  })
  runs.append(run.id, { type: "run.finished", status: "succeeded" })
  const logs: string[] = []
  for await (const e of runs.stream(run.id, 0)) if (e.type === "provider.log") logs.push(e.data)
  expect(logs).toEqual(["key=*** b64=***"])
})
