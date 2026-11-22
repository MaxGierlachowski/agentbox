import { createHash } from "node:crypto"
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import * as age from "age-encryption"
import { writeFileAtomic } from "../fs/atomic"

export type SecretType = "token" | "api_key" | "ssh_private_key" | "password" | "other"

export interface SecretEntry {
  value: string
  type: SecretType
  updatedAt: string
}

/** What the API is allowed to reveal about a secret. Never the value. */
export interface SecretMeta {
  ref: string
  type: SecretType
  updatedAt: string
  fingerprint: string
}

export class SealedError extends Error {
  constructor() {
    super("Secret store is sealed. Run `agentbox unlock` first.")
  }
}

const REF = /^[a-z0-9][a-z0-9_-]*\.[a-z0-9][a-z0-9_.-]*$/

export function assertRef(ref: string) {
  if (!REF.test(ref)) throw new Error(`Invalid secret ref "${ref}", expected <namespace>.<name>`)
}

/**
 * age-encrypted secret store.
 *
 * - `identity.age`: an X25519 identity, encrypted with the passphrase (scrypt).
 * - `store.age`: JSON map of all secrets, encrypted to that identity's recipient.
 *
 * Changing the passphrase only re-encrypts the identity. The decrypted identity and
 * secrets only ever live in memory; `seal()` drops them.
 */
export class SecretStore {
  private identity: string | null = null
  private entries: Map<string, SecretEntry> | null = null

  constructor(
    private readonly dir: string,
    /** scrypt work factor (log2 N). Lower only in tests. */
    private readonly scryptLogN = 18,
  ) {}

  private get identityPath() {
    return join(this.dir, "identity.age")
  }
  private get storePath() {
    return join(this.dir, "store.age")
  }

  private get plainIdentityPath() {
    return join(this.dir, "identity")
  }

  async isInitialized() {
    return (
      (await Bun.file(this.identityPath).exists()) ||
      (await Bun.file(this.plainIdentityPath).exists())
    )
  }

  /**
   * Unattended mode (v1): the identity is a plain file (0600, owned by the service user), so the
   * store unlocks itself on boot. Secrets stay encrypted at rest; anyone who can read the identity
   * file can decrypt them, which is the same trust boundary as the service user itself.
   * Passphrase sealing (`init`/`unlock`) stays available for a later sealed mode.
   */
  async openUnattended() {
    await mkdir(this.dir, { recursive: true, mode: 0o700 })
    const file = Bun.file(this.plainIdentityPath)
    let identity: string
    if (await file.exists()) {
      identity = (await file.text()).trim()
    } else {
      if (await Bun.file(this.identityPath).exists())
        throw new Error("Secret store is passphrase-sealed; unlock it with the passphrase")
      identity = await age.generateX25519Identity()
      await writeFileAtomic(this.plainIdentityPath, `${identity}\n`, 0o600)
    }
    await this.load(identity)
  }

  get sealed() {
    return this.entries === null
  }

  async init(passphrase: string) {
    if (await this.isInitialized()) throw new Error("Secret store already initialized")
    await mkdir(this.dir, { recursive: true, mode: 0o700 })
    const identity = await age.generateX25519Identity()
    await writeFileAtomic(this.identityPath, await this.encryptWithPassphrase(identity, passphrase))
    this.identity = identity
    this.entries = new Map()
    await this.persist()
  }

  async unlock(passphrase: string) {
    const d = new age.Decrypter()
    d.addPassphrase(passphrase)
    let identity: string
    try {
      identity = await d.decrypt(await Bun.file(this.identityPath).bytes(), "text")
    } catch {
      throw new Error("Wrong passphrase")
    }
    await this.load(identity)
  }

  private async load(identity: string) {
    const entries = new Map<string, SecretEntry>()
    if (await Bun.file(this.storePath).exists()) {
      const s = new age.Decrypter()
      s.addIdentity(identity)
      const json = await s.decrypt(await Bun.file(this.storePath).bytes(), "text")
      for (const [ref, entry] of Object.entries(JSON.parse(json) as Record<string, SecretEntry>)) {
        entries.set(ref, entry)
      }
    }
    this.identity = identity
    this.entries = entries
  }

  seal() {
    this.identity = null
    this.entries = null
  }

  async changePassphrase(current: string, next: string) {
    await this.unlock(current)
    if (!this.identity) throw new SealedError()
    await writeFileAtomic(this.identityPath, await this.encryptWithPassphrase(this.identity, next))
  }

  list(): SecretMeta[] {
    return [...this.requireEntries()]
      .map(([ref, e]) => ({
        ref,
        type: e.type,
        updatedAt: e.updatedAt,
        fingerprint: fingerprint(e.value),
      }))
      .sort((a, b) => a.ref.localeCompare(b.ref))
  }

  has(ref: string) {
    return this.requireEntries().has(ref)
  }

  /** Plaintext access, reserved for providers materializing secrets onto tmpfs. */
  reveal(ref: string): string {
    const entry = this.requireEntries().get(ref)
    if (!entry) throw new Error(`Unknown secret ref "${ref}"`)
    return entry.value
  }

  /** All plaintext values, used by log redaction. */
  values(): string[] {
    return [...this.requireEntries().values()].map((e) => e.value)
  }

  async set(ref: string, value: string, type: SecretType = "other") {
    assertRef(ref)
    if (!value) throw new Error("Secret value must not be empty")
    this.requireEntries().set(ref, { value, type, updatedAt: new Date().toISOString() })
    await this.persist()
  }

  async delete(ref: string) {
    const deleted = this.requireEntries().delete(ref)
    if (deleted) await this.persist()
    return deleted
  }

  private requireEntries() {
    if (!this.entries) throw new SealedError()
    return this.entries
  }

  private async persist() {
    if (!this.identity || !this.entries) throw new SealedError()
    const e = new age.Encrypter()
    e.addRecipient(await age.identityToRecipient(this.identity))
    const json = JSON.stringify(Object.fromEntries(this.entries))
    await writeFileAtomic(this.storePath, await e.encrypt(json))
  }

  private async encryptWithPassphrase(data: string, passphrase: string) {
    const e = new age.Encrypter()
    e.setPassphrase(passphrase)
    e.setScryptWorkFactor(this.scryptLogN)
    return e.encrypt(data)
  }
}

export function fingerprint(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 8)
}
