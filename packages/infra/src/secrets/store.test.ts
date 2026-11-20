import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SealedError, SecretStore } from "./store"

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "agentbox-secrets-"))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const PASS = "correct horse battery staple"

test("roundtrip: init, set, seal, unlock, reveal", async () => {
  const store = new SecretStore(dir, 10)
  await store.init(PASS)
  await store.set("anthropic.api", "sk-ant-test", "api_key")
  store.seal()
  expect(store.sealed).toBe(true)
  expect(() => store.list()).toThrow(SealedError)

  const reopened = new SecretStore(dir, 10)
  await reopened.unlock(PASS)
  expect(reopened.reveal("anthropic.api")).toBe("sk-ant-test")
  expect(reopened.list()).toEqual([
    expect.objectContaining({
      ref: "anthropic.api",
      type: "api_key",
      fingerprint: expect.any(String),
    }),
  ])
})

test("ciphertext never contains the plaintext", async () => {
  const store = new SecretStore(dir, 10)
  await store.init(PASS)
  await store.set("git.gitlab", "glpat-super-secret")
  const raw = await Bun.file(join(dir, "store.age")).text()
  expect(raw).not.toContain("glpat-super-secret")
})

test("wrong passphrase is rejected", async () => {
  await new SecretStore(dir, 10).init(PASS)
  await expect(new SecretStore(dir, 10).unlock("nope nope nope")).rejects.toThrow(
    "Wrong passphrase",
  )
})

test("passphrase change keeps secrets", async () => {
  const store = new SecretStore(dir, 10)
  await store.init(PASS)
  await store.set("plane.api", "plane-token")
  await store.changePassphrase(PASS, "another long passphrase")
  const reopened = new SecretStore(dir, 10)
  await reopened.unlock("another long passphrase")
  expect(reopened.reveal("plane.api")).toBe("plane-token")
})

test("refs are validated", async () => {
  const store = new SecretStore(dir, 10)
  await store.init(PASS)
  await expect(store.set("no-namespace", "x")).rejects.toThrow("Invalid secret ref")
})
