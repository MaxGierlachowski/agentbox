import { readFileSync } from "node:fs"
import { createORPCClient } from "@orpc/client"
import { RPCLink } from "@orpc/client/fetch"
import type { ContractRouterClient } from "@orpc/contract"
import type { Contract } from "@workspace/contract"
import { type Config, paths } from "../config"

export type ApiClient = ContractRouterClient<Contract>

/** Client for the local API, authenticated with the CLI token (root and the agentbox user). */
export function apiClient(config: Config): ApiClient {
  let token: string
  try {
    token = readFileSync(paths(config).cliToken, "utf8").trim()
  } catch {
    throw new Error(
      `Cannot read ${paths(config).cliToken}. Is agentbox running (systemctl status agentbox-config) and are you root or the agentbox user?`,
    )
  }
  const link = new RPCLink({
    url: `http://127.0.0.1:${config.port}/api/rpc`,
    headers: { authorization: `Bearer ${token}` },
  })
  return createORPCClient(link)
}

/** Calls `group.procedure` by its dotted name. */
export async function callByName(client: ApiClient, name: string, input: unknown) {
  let target: unknown = client
  for (const part of name.split(".")) {
    target = (target as Record<string, unknown>)?.[part]
    if (target === undefined) throw new Error(`Unknown procedure "${name}"`)
  }
  if (typeof target !== "function") throw new Error(`"${name}" is a group, not a procedure`)
  return (target as (i: unknown) => Promise<unknown>)(input)
}
