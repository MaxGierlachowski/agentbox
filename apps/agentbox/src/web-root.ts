import { existsSync } from "node:fs"
import { join } from "node:path"

/**
 * Where the Next.js export lives:
 * - compiled binary: embedded via `bun build --compile --asset`, under the virtual $bunfs root
 * - from source: apps/web/out (run `bun run build` in apps/web first)
 */
export function resolveWebRoot(): string | null {
  const candidates = [
    process.env.AGENTBOX_WEB_ROOT,
    join(import.meta.dir, "web"),
    join(import.meta.dir, "../../web/out"),
  ].filter((c): c is string => Boolean(c))
  return candidates.find((c) => existsSync(join(c, "index.html"))) ?? null
}
