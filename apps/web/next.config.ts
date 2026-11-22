import type { NextConfig } from "next"
import { PHASE_DEVELOPMENT_SERVER } from "next/constants"

const API = process.env.AGENTBOX_API ?? "http://127.0.0.1:7777"

// Production: static export embedded into the agentbox binary and served by Hono. No Next.js
// server runs there, so no route handlers, server actions, proxy.ts, or dynamic segments
// without generateStaticParams. The API lives in apps/agentbox.
//
// Development: `next dev` serves the UI and rewrites /api and /auth to the local daemon, so the
// browser sees a single origin (cookies work, no CORS) and HMR keeps working.
export default function config(phase: string): NextConfig {
  const base: NextConfig = {
    trailingSlash: true,
    images: { unoptimized: true },
    reactCompiler: true,
    transpilePackages: ["@workspace/ui"],
  }
  if (phase === PHASE_DEVELOPMENT_SERVER) {
    return {
      ...base,
      // Otherwise /api/rpc/x would be redirected to /api/rpc/x/ before the rewrite applies.
      skipTrailingSlashRedirect: true,
      rewrites: async () => [
        { source: "/api/:path*", destination: `${API}/api/:path*` },
        { source: "/auth/:path*", destination: `${API}/auth/:path*` },
        // Other apps on the same origin in production (Caddy); the mock server stands in.
        { source: "/hermes/:path*", destination: `${API}/hermes/:path*` },
        { source: "/browser/:path*", destination: `${API}/browser/:path*` },
      ],
    }
  }
  return { ...base, output: "export" }
}
