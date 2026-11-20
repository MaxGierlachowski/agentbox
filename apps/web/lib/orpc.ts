import { createORPCClient } from "@orpc/client"
import { RPCLink } from "@orpc/client/fetch"
import { ClientRetryPlugin, type ClientRetryPluginContext } from "@orpc/client/plugins"
import type { ContractRouterClient } from "@orpc/contract"
import { createTanstackQueryUtils } from "@orpc/tanstack-query"
import type { Contract } from "@workspace/contract"

const link = new RPCLink<ClientRetryPluginContext>({
  url: () => `${window.location.origin}/api/rpc`,
  // Event streams (run logs) reconnect with Last-Event-ID; the server replays missed events.
  plugins: [new ClientRetryPlugin({ default: { retry: 0 } })],
})

export const client: ContractRouterClient<Contract, ClientRetryPluginContext> =
  createORPCClient(link)

export const orpc = createTanstackQueryUtils(client)
