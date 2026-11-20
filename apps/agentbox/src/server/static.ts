import { stat } from "node:fs/promises"
import { join, normalize } from "node:path"

/**
 * Serves the Next.js static export (embedded into the binary, or from disk in development).
 * `trailingSlash: true` means every route is `<route>/index.html`.
 */
export function createStaticHandler(root: string) {
  const resolveFile = async (pathname: string) => {
    const clean = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "")
    const candidates = [clean, join(clean, "index.html"), `${clean}.html`]
    for (const candidate of candidates) {
      const full = join(root, candidate)
      if (!full.startsWith(root)) continue
      const s = await stat(full).catch(() => null)
      if (s?.isFile()) return full
    }
    return null
  }

  return async (pathname: string): Promise<Response> => {
    const file = await resolveFile(pathname)
    if (!file) {
      const notFound = join(root, "404.html")
      return new Response(Bun.file(notFound), {
        status: 404,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" },
      })
    }
    const headers = new Headers()
    // Hashed build assets never change; HTML must always be revalidated.
    headers.set(
      "cache-control",
      pathname.startsWith("/_next/static/") ? "public, max-age=31536000, immutable" : "no-cache",
    )
    // RSC payloads used for client navigation.
    if (file.endsWith(".txt")) headers.set("content-type", "text/x-component")
    return new Response(Bun.file(file), { headers })
  }
}
