/** Small JSON-over-HTTP helper with a cookie jar, shared by the tool bootstrap clients. */
export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message)
  }
}

export interface HttpOptions {
  baseUrl: string
  fetch?: typeof fetch
  /** Headers sent on every request (Origin, API keys). */
  headers?: Record<string, string>
}

export class Http {
  readonly cookies = new Map<string, string>()
  private readonly f: typeof fetch

  constructor(private readonly opts: HttpOptions) {
    this.f = opts.fetch ?? fetch
  }

  async raw(
    method: string,
    path: string,
    init: { body?: unknown; form?: Record<string, string>; headers?: Record<string, string> } = {},
  ) {
    const headers = new Headers({
      accept: "application/json",
      ...this.opts.headers,
      ...init.headers,
    })
    let body: string | undefined
    if (init.form) {
      headers.set("content-type", "application/x-www-form-urlencoded")
      body = new URLSearchParams(init.form).toString()
    } else if (init.body !== undefined) {
      headers.set("content-type", "application/json")
      body = JSON.stringify(init.body)
    }
    if (this.cookies.size)
      headers.set("cookie", [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "))
    const res = await this.f(`${this.opts.baseUrl}${path}`, {
      method,
      headers,
      body,
      redirect: "manual",
    })
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const pair = raw.split(";")[0] ?? ""
      const eq = pair.indexOf("=")
      if (eq > 0) this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim())
    }
    return res
  }

  async json<T>(method: string, path: string, init: Parameters<Http["raw"]>[2] = {}): Promise<T> {
    const res = await this.raw(method, path, init)
    const text = await res.text()
    if (!res.ok)
      throw new HttpError(
        `${method} ${path} returned HTTP ${res.status}: ${text.slice(0, 300)}`,
        res.status,
        text,
      )
    return (text ? JSON.parse(text) : undefined) as T
  }
}

/** Parses a text/event-stream body into `data:` payloads (JSON-decoded when possible). */
export async function* readSse(body: unknown, signal?: AbortSignal): AsyncGenerator<unknown> {
  // Typed loosely: Bun's and the DOM's ReadableStream types do not unify.
  const reader = (body as ReadableStream<Uint8Array>).getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    while (!signal?.aborted) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value as Uint8Array, { stream: true })
      let sep = buffer.indexOf("\n\n")
      while (sep >= 0) {
        const block = buffer.slice(0, sep)
        buffer = buffer.slice(sep + 2)
        const data = block
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trimStart())
          .join("\n")
        if (data) {
          try {
            yield JSON.parse(data)
          } catch {
            yield data
          }
        }
        sep = buffer.indexOf("\n\n")
      }
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
}

export function toEnvFile(env: Record<string, string>) {
  return `${Object.entries(env)
    .map(([k, v]) => {
      if (/[\r\n]/.test(v)) throw new Error(`Env value for ${k} must be single-line`)
      return `${k}=${v}`
    })
    .join("\n")}\n`
}

export function randomSecret(bytes = 32) {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("base64url")
}
