import type { Db } from "@workspace/infra/db"
import { schema } from "@workspace/infra/db"
import { and, eq } from "drizzle-orm"

/** Key-value access to provider_state for one workspace and provider. */
export class ProviderState {
  constructor(
    private readonly db: Db,
    private readonly workspace: string,
    private readonly provider: string,
  ) {}

  get(key: string): unknown {
    return this.db
      .select()
      .from(schema.providerState)
      .where(
        and(
          eq(schema.providerState.workspace, this.workspace),
          eq(schema.providerState.provider, this.provider),
          eq(schema.providerState.key, key),
        ),
      )
      .get()?.value
  }

  set(key: string, value: unknown) {
    const updatedAt = new Date().toISOString()
    this.db
      .insert(schema.providerState)
      .values({ workspace: this.workspace, provider: this.provider, key, value, updatedAt })
      .onConflictDoUpdate({
        target: [
          schema.providerState.workspace,
          schema.providerState.provider,
          schema.providerState.key,
        ],
        set: { value, updatedAt },
      })
      .run()
  }
}
