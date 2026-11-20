// Manual check for Phase 0: start a demo run, drop the stream midway, resume with lastEventId,
// and assert that the sequence has no gaps or duplicates.
import { createORPCClient } from "@orpc/client"
import { RPCLink } from "@orpc/client/fetch"
import type { ContractRouterClient } from "@orpc/contract"
import type { Contract } from "@workspace/contract"

const url = process.env.AGENTBOX_URL ?? "http://127.0.0.1:7777/api/rpc"
const client: ContractRouterClient<Contract> = createORPCClient(new RPCLink({ url }))

const run = await client.runs.demo()
const seen: number[] = []

const first = new AbortController()
const it = await client.runs.events({ id: run.id }, { signal: first.signal })
for await (const event of it) {
  seen.push(event.seq)
  if (seen.length === 12) break // simulate a dropped connection
}
first.abort()
await Bun.sleep(1200)

const resumeFrom = seen.at(-1)
const resumed = await client.runs.events({ id: run.id }, { lastEventId: String(resumeFrom) })
for await (const event of resumed) seen.push(event.seq)

const gaps = seen.some((seq, i) => seq !== i)
console.log(`events=${seen.length} resumedAfter=${resumeFrom} contiguous=${!gaps}`)
if (gaps) process.exit(1)
