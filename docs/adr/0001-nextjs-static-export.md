# 0001 – Next.js as a static export embedded in the binary

- Status: accepted
- Date: 2026-09-24

## Context

agentbox ships as one Bun binary. The UI should use Next.js, Tailwind and shadcn/ui.

## Decision

Next.js runs only at build time (`output: 'export'`). `bun build --compile --asset web` embeds
the export; Hono serves it. In development `next dev` rewrites `/api` and `/auth` to the daemon.

## Consequences

- No route handlers, server actions, `proxy.ts` or dynamic segments. Detail pages use search params.
- One origin in production and development, so session cookies work without CORS.
- Hono owns caching headers and 404 handling for the export.
