import { randomBytes } from "node:crypto"
import { chmod, rename, writeFile } from "node:fs/promises"

/** Write-then-rename so readers never see a partially written file. */
export async function writeFileAtomic(path: string, data: string | Uint8Array, mode = 0o600) {
  const tmp = `${path}.${randomBytes(6).toString("hex")}.tmp`
  await writeFile(tmp, data, { mode })
  await chmod(tmp, mode)
  await rename(tmp, path)
}
