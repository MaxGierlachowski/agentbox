# agentbox

Declarative agent workspaces on a single VM. A Bun binary owns Docker on the host, serves an
embedded Next.js UI through Hono, and is reached over Tailscale. The full design lives in
`docs/implementation-plan.md` (German); decisions are recorded in `docs/adr/`.

## Layout

- `apps/agentbox` – CLI, Hono server, composition root, binary build (`scripts/compile.ts`)
- `apps/web` – Next.js App Router, **static export only**
- `packages/contract` – oRPC contract and run event types, shared by web and server
- `packages/infra` – SQLite/Drizzle, age secret store, Docker, filesystem helpers
- `packages/providers` – workspace/host providers: `browser` (headless Chromium + Playwright MCP), `cloudcli`, `metamcp`, `plane` (compose, secrets, bootstrap clients); Plane's release compose is vendored unchanged with an agentbox override
- `packages/automation` – Plane → CloudCLI automation (picks up items labelled `claude`, runs a Claude Code session, moves the item to In Review)
- `e2e` – end-to-end harnesses (need Docker): `bun run --cwd e2e browser` drives the browser over MCP like an agent
- `packages/ui` – design system: `src/components` is vendored shadcn/ui (Radix), `src/composites` is ours
- `packages/typescript-config` – shared tsconfig presets

## Commands

```sh
bun install
bun run dev              # agentbox API on :7777 + next dev on :3100 (open http://localhost:3100)
bunx turbo typecheck lint test
bun run format           # Biome
bun run boundaries       # dependency-cruiser module rules
bun run --cwd apps/agentbox compile [--target linux-x64 --target linux-arm64]
bun run --cwd packages/infra db:generate   # after changing src/db/schema.ts
```

## Rules

- The UI is a static export. No route handlers, server actions, `proxy.ts`, cookies or dynamic
  segments; detail pages use search params via nuqs, wrapped in `<Suspense>`. All server logic
  goes through the oRPC contract in `packages/contract`.
- `apps/web` may only import `@workspace/contract`, `@workspace/ui` and later `@workspace/spec`.
- Add shadcn components from `apps/web` with `bunx --bun shadcn@latest add <name>`; they land in
  `packages/ui/src/components`. Do not edit vendored files beyond what an upstream update would
  keep; build agentbox-specific pieces in `packages/ui/src/composites`.
- Secrets never go into specs, logs, API responses or CLI arguments. Run logs pass through
  redaction in `RunService`.
- Tailscale identity headers are trusted only on the `web.sock` listener; never on `127.0.0.1:7777`.
  Requests carrying `Tailscale-Funnel-Request` are rejected there. Nothing is public (no Funnel).
- Tool stack (ADR 0007): CloudCLI (:8443), Plane (:8444), MetaMCP (:8445), tailnet-only via
  `tailscale serve`. Their admin accounts are created before they are served and registration is
  closed afterwards. One shared admin password lives only in the secret store (`tools.admin`).
- Claude Code reaches MetaMCP through `mcp-gateway` (Caddy hiding `/.well-known`, MetaMCP #277).
- Keep `trustedDependencies: []` in the root package.json and the native externals in
  `scripts/compile.ts`: ssh2's optional native modules crash compiled Bun binaries.
- UI copy is English.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
