"use client"

import { useQuery } from "@tanstack/react-query"
import type { LoginFlow } from "@workspace/contract"
import { orpc } from "./orpc"

const active = (f: LoginFlow | undefined) => f?.state === "starting" || f?.state === "waiting"

/** Polls a login flow (claude, gh, glab) while it is starting or waiting. */
export function useLoginFlow(flowId: string | null, initial?: LoginFlow | null) {
  return useQuery({
    ...orpc.flows.get.queryOptions({ input: { flowId: flowId ?? "" } }),
    enabled: !!flowId,
    initialData: initial && initial.flowId === flowId ? initial : undefined,
    initialDataUpdatedAt: 0,
    refetchInterval: (q) => (active(q.state.data) ? 1000 : false),
    staleTime: 0,
  })
}
