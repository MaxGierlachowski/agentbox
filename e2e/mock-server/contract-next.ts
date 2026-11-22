import { oc } from "@orpc/contract"
import { contract, LoginFlow } from "@workspace/contract"
import { z } from "zod"

/**
 * Procedures the main session announced for v1 but that are not in packages/contract yet:
 * `toolkit.apply` takes `env` values, `toolkit.connect` signs an OAuth MCP in through the box's
 * browser, `ai.hermesLoginStart` signs Hermes' own Anthropic OAuth in (finished with
 * `ai.accountLoginFinish`). Delete this file and use `contract` once they land there.
 */
export const contractNext = {
  ...contract,
  ai: {
    ...contract.ai,
    /** Hermes' own Claude subscription login (separate from the Paseo accounts). */
    hermesLoginStart: oc.input(z.object({ model: z.string().optional() })).output(LoginFlow),
  },
  toolkit: {
    ...contract.toolkit,
    apply: oc
      .input(
        z.object({
          add: z.array(z.string()),
          remove: z.array(z.string()).default([]),
          /** Values for items whose catalog entry declares `env` (write-only, never returned). */
          env: z.record(z.string(), z.record(z.string(), z.string())).optional(),
        }),
      )
      .output(
        contract.toolkit.apply["~orpc"].outputSchema as NonNullable<
          (typeof contract.toolkit.apply)["~orpc"]["outputSchema"]
        >,
      ),
    /** Signs an installed OAuth MCP in; the consent page opens in the box's browser. */
    connect: oc.input(z.object({ id: z.string() })).output(LoginFlow),
  },
}

export type ContractNext = typeof contractNext
