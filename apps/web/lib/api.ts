/**
 * Plain (non-oRPC) routes. They set or clear the session cookie, so they are not part of the
 * contract. Errors come back as `{ error }` with 400/401/404/409/429.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) {
    const fallback =
      res.status === 429
        ? "Too many attempts. Wait a minute."
        : res.status === 404
          ? "Not found."
          : `Request failed (${res.status})`
    throw new ApiError(data.error ?? fallback, res.status)
  }
  return data as T
}

export const api = {
  setupStatus: () => call<{ claimed: boolean }>("GET", "/api/setup/status"),
  claim: (input: {
    otp: string
    name: string
    email: string
    password: string
    remember?: boolean
  }) => call<{ ok: boolean }>("POST", "/api/setup/claim", input),
  login: (input: { password: string; remember?: boolean }) =>
    call<{ ok: boolean }>("POST", "/api/auth/login", input),
  reset: (input: { otp: string; password: string }) =>
    call<{ ok: boolean }>("POST", "/api/auth/reset", input),
  logout: () => call<{ ok: boolean }>("POST", "/auth/logout"),
}

export const setupStatusQuery = {
  queryKey: ["setup-status"] as const,
  queryFn: api.setupStatus,
  staleTime: 60_000,
}

/** Only same-origin absolute paths; never `//host` or a scheme. */
export function safeNext(next: string | null | undefined): string | null {
  if (!next?.startsWith("/") || next.startsWith("//") || next.includes("\\")) return null
  return next
}

/** Paths served by other apps on this origin need a full page load. */
export const isExternalPath = (path: string) =>
  /^\/(hermes|browser|api|auth|webhooks)(\/|$)/.test(path)

export function go(path: string) {
  window.location.assign(path)
}
