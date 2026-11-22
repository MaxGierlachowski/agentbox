# agentbox

An agent box on a single VM. A Bun binary installs and wires Hermes, Hermes UI, Paseo (+ paseo-mcp,
paseo-multi-account, hermes-paseo-bridge), a streamed Chrome, Caddy and one iroh gateway, and serves
the embedded Next.js config UI through Hono. The plan lives in `docs/plan/00-master-plan.md`,
contracts between repos in `docs/plan/v1-interfaces.md`, decisions in `docs/adr/`.

## Layout

- `apps/agentbox` – CLI (`up`, `serve`, `otp`, `api`, `connect`, `host apply`), Hono server, services, binary build (`scripts/compile.ts`)
- `apps/web` – Next.js App Router, **static export only**
- `packages/contract` – oRPC contract and run event types, shared by web and server
- `packages/infra` – SQLite/Drizzle, age secret store, filesystem helpers
- `packages/providers` – host installation: pinned component manifest, install scripts, systemd units, Caddyfile
- `catalog/` – curated skills/MCPs/CLIs, role bundles, agentbox skills, SOUL templates (embedded in the binary)
- `e2e` – mock API server (`bun run --cwd e2e mock`), Playwright UI tests (`bun run --cwd e2e test`), VM acceptance harness (`e2e/vm/acceptance.sh`)
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
- Every internal port binds 127.0.0.1 (v1 port map in `docs/plan/v1-interfaces.md`). Only Caddy's
  LAN listener (:8443) may face the network. CDP (9333) is never proxied.
- Edge headers (`X-Agentbox-Via`, `X-Iroh-Remote-Id`) count only together with the Caddy proxy
  secret; `X-Iroh-Remote-Id` only on the iroh listener. Remote access is iroh only (ADR 0009).
- Pin every component in the host manifest; never install "latest" at runtime.
- Hermes is changed only through its CLI/config via `apps/agentbox/src/hermes` (no fork, no core patches).
- Keep `trustedDependencies: []` in the root package.json.
- UI copy is English.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
