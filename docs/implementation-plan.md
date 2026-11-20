# agentbox – Implementierungsplan

Stand: 23.09.2026 · Basis: Plan v1 (TypeScript, ausschließlich Host Mode) · Status: Entwurf zur Abstimmung

Dieser Plan übernimmt Grundannahme, Kernablauf, Provider-Modell und Phasen aus v1 und macht sie umsetzbar. Neu bzw. geändert:

- UI mit **Next.js** statt Svelte, **Tailwind CSS v4** und einem eigenen **shadcn/ui Design System** als Paket im Monorepo
- **Libraries statt Eigenbau** für alles, was nicht Kerndomäne ist (RPC, Streaming, Formulare, Tabellen, Migrations, Sessions, CLI-Ausgabe, Git, Verschlüsselung)
- **Tailscale ist fester Bestandteil** von Bootstrap und Zugriff, nicht mehr optional
- **Werkzeug-Stack statt Agent-Plattform** (Entscheidung 10.10.2026, ersetzt OpenHands und Paperclip): **CloudCLI** als Web-Oberfläche für Claude-Code-Sessions, **MetaMCP** als zentrale MCP-Verwaltung mit einem Token-Endpoint für Claude Code, **Plane** als Scrum-/PM-Tool und ein eigener **Plane→CloudCLI-Automat**, der mit `claude` gelabelte Todos abarbeitet. Alles automatisch eingerichtet und verbunden, alle Web-UIs aus der agentbox-UI erreichbar.
- Korrekturen aus einer Recherche zum aktuellen Stand der Werkzeuge (CloudCLI, MetaMCP, Plane, Docker 29, Bun 1.4, Tailscale, mise, shadcn CLI 4)

---

## 1. Was sich gegenüber v1 ändert

| Thema | v1 | Neu | Grund |
|---|---|---|---|
| UI | Svelte SPA, eingebettet | Next.js 16 App Router als **Static Export**, zur Build-Zeit gerendert, im Binary eingebettet, von Hono ausgeliefert | Single Binary bleibt; kein Next-Server zur Laufzeit |
| Komponenten | – | Tailwind v4 + shadcn/ui (CLI 4) in `packages/ui`, ergänzt um Registries und eigene Composites, Storybook | Konsistente, erweiterbare Komponentenbasis |
| API | hono + SSE | Hono + **oRPC** (Contract-first, Zod), Live-Logs als Event Iterator mit Resume über `lastEventId` | Typen Ende-zu-Ende, kein Log-Verlust bei Reconnect, OpenAPI gratis |
| Docker | dockerode statt CLI | dockerode für Lifecycle, Inspect, Events, Logs; `docker buildx` für Builds; `docker compose` für den Stack | BuildKit und Compose-Reconcile sind Client-Features; dockerodes BuildKit-Pfad läuft im kompilierten Binary nicht |
| Zugriff | SSH Tunnel, Tailscale optional, `--bind 0.0.0.0` mit Passwort | Tailscale Pflicht; UI über `tailscale serve` (HTTPS, nur Tailnet) auf Unix Socket; Login über Tailscale-Identität; SSH Tunnel als Fallback mit Einmal-Link; kein 0.0.0.0 | Keine öffentlichen Ports, TLS und Identität ohne eigenes Passwort-Handling |
| Agent-Oberfläche | OpenHands mit eigenem Runtime Image | **CloudCLI** im workspace-Container (Claude Code, Toolchains, Browser), **MetaMCP** als MCP-Gateway, **Plane** für Tasks, eigener Automat Plane→CloudCLI; alle UIs nur im Tailnet, je eigener HTTPS-Port | OpenHands und Paperclip evaluiert und verworfen (zu schwach bzw. kontextüberladen); kleine, spezialisierte Werkzeuge, die agentbox verdrahtet |
| Kontext | CLAUDE.md und AGENTS.md in jedes Repo | AGENTS.md ist die Quelle, CLAUDE.md importiert sie (`@AGENTS.md`); getrackte Dateien werden nicht angefasst | Agents committen keine generierten Dateien; Claude Code liest AGENTS.md nicht nativ |
| State | Dateien unter `/srv/agentbox` | SQLite (`bun:sqlite` + Drizzle) für State, Runs, Events, Sessions, Audit | Transaktionen, Migrations, Log-Resume per Event-ID |
| Spec | ohne Version | `version: 1`, `mcp:` Registry, `expose:`, Kurzformen werden normalisiert, eigene Host-Spec | Migrationspfad; MCP einmal definieren, pro Agent rendern |
| Secrets | age, Passphrase beim Start | age (`age-encryption`), Dienst startet versiegelt, Unlock per UI oder CLI, Klartext nur auf tmpfs, Log-Redaction | Ein systemd-Dienst hat kein Terminal; Klartext nie auf persistenter Platte |
| Bootstrap | Schrittfolge | Host-Spec mit Host-Providern (detect, plan, apply, verify) auf derselben Engine | Idempotent, Plan-Anzeige, gleiche Verify-Logik |
| Repos | `/srv/agentbox/repos` | `/srv/agentbox/workspaces/<ws>/repos` | Multi-Workspace ab Tag 1 im Datenmodell |

## 2. Leitprinzipien

1. **Die VM ist die Sicherheitsgrenze** (unverändert). Innerhalb der VM gibt es Defense in Depth, aber kein Sandbox-Versprechen. Nichts ist öffentlich; alle Web-UIs sind nur im Tailnet erreichbar.
2. **Ein Owner:** agentbox ist der einzige Schreiber auf `/srv/agentbox` und auf Docker-Objekte mit Label `dev.agentbox.*`. Ein Apply-Lock verhindert parallele Applies aus UI und CLI.
3. **Deklarativ und idempotent:** `plan` hat keine Seiteneffekte, `apply` darf beliebig oft laufen, ein zweiter Apply ohne Änderung ist reines `noop`.
4. **Plan vor Apply, mit Plan-Hash:** Apply rechnet den bestätigten Plan neu und bricht ab, wenn er abweicht (wie Terraform Saved Plans).
5. **Multi-Workspace-fähig ab Tag 1:** Pfade, Compose-Projekte, Netzwerke, Image-Tags und State-Keys tragen immer den Workspace-Namen, auch wenn v0.1 nur einen zeigt.
6. **Secrets** stehen nie in Spec, Export, Logs oder API-Responses. Klartext nur im Speicher und auf tmpfs.
7. **Libraries für alles außerhalb der Kerndomäne.** Selbst gebaut werden nur Engine, Provider, Renderer (Dockerfile, Compose, Kontext) und Adapter.
8. **Volatile Integrationen** (CloudCLI, MetaMCP, Plane, Agent CLIs, Tailscale CLI) sitzen hinter dünnen Adaptern mit Contract-Tests gegen die gepinnte Version.
9. **Entscheidungen werden als ADR** unter `docs/adr/` festgehalten (Static Export, oRPC, SQLite, Tailscale-Socket, Werkzeug-Stack).

## 3. Zielarchitektur

### 3.1 Laufzeit-Topologie

```
Laptop (Tailnet-Mitglied), alles HTTPS über tailscale serve, nichts öffentlich
  https://agentbox-01.<tailnet>.ts.net         agentbox UI   (Startseite mit Links zu allen Tools)
  https://agentbox-01.<tailnet>.ts.net:8443    CloudCLI      (Claude-Code-Sessions)
  https://agentbox-01.<tailnet>.ts.net:8444    Plane         (Scrum/PM)
  https://agentbox-01.<tailnet>.ts.net:8445    MetaMCP       (MCP-Verwaltung)
  ▼
VM Ubuntu 24.04 ── ufw: eingehend nur SSH und tailscale0
├── tailscaled: serve :443 → unix:/run/agentbox/web.sock, :8443/:8444/:8445 → 127.0.0.1:<port>
├── agentbox (systemd, User agentbox, UID 10001)
│    ├── Hono: /api/rpc/* (oRPC inkl. SSE), statische Next.js Dateien, /healthz
│    ├── Listener: web.sock (nur Tailscale Serve) und 127.0.0.1:7777 (CLI, SSH Tunnel)
│    ├── Engine + Provider, SQLite unter /srv/agentbox/state
│    ├── Automat: pollt Plane, startet CloudCLI-Sessions, setzt Status und Kommentare
│    └── Docker: dockerode, docker buildx, docker compose
└── Docker Engine 29 (Loopback als Default-Binding, log-driver local)
     └── Compose-Projekt agentbox-<ws>:
          ├── workspace     CloudCLI + Claude Code + Toolchains + Browser, 127.0.0.1:3001
          ├── metamcp       MetaMCP (UI + Gateway), 127.0.0.1:12008; metamcp-db (postgres:16)
          ├── mcp-gateway   Caddy vor MetaMCP für Claude Code (blockt /.well-known, siehe 12.3)
          ├── plane-*       web, space, admin, live, api, worker, beat-worker, migrator,
          │                 proxy (127.0.0.1:8090), db, redis, mq, minio
          └── postgres, playwright, android (Services aus der Spec)
```

### 3.2 Build- und Prozessmodell

- **Next.js läuft nur zur Build-Zeit.** `next build` erzeugt `apps/web/out`, `bun build --compile --asset apps/web/out` bettet den Ordner ins Binary ein (`--asset` ist neu in Bun 1.4). Zur Laufzeit liefert Hono die Dateien aus.
- **Konsequenzen des Static Exports:** keine Route Handlers, Server Actions, `proxy.ts`, Rewrites, Cookies oder dynamischen Routen ohne `generateStaticParams`. Die API ist ausschließlich Hono + oRPC. Detailseiten nutzen Search Params (`/runs/?id=…`) statt `[id]`-Segmente.
- **Zwei Listener, eine Hono-App:** `Bun.serve` auf `web.sock` und auf `127.0.0.1:7777`. Der Listener wird als Hono-`env` übergeben; die Auth-Middleware entscheidet danach (Abschnitt 10.2).
- **CLI und Dienst teilen die Engine.** `agentbox apply` spricht mit dem laufenden Dienst über den lokalen Listener und streamt das Log ins Terminal. Läuft kein Dienst (Bootstrap, CI), führt die CLI die Engine im Prozess aus und nimmt denselben Apply-Lock. Beide schreiben Events in dieselbe SQLite-Tabelle, die UI sieht CLI-Runs also live.
- **Dev:** `bun run dev` startet den Dienst (`agentbox dev`, :7777) und `next dev` (:3100). Nur im Dev-Server leitet Next per Rewrite `/api` und `/auth` an den Dienst weiter. Die Origin ist damit einheitlich (Cookies ohne CORS), und Hot Reload über WebSockets funktioniert.

### 3.3 Verzeichnisse auf der VM

```
/etc/agentbox/host.yaml             Host-Spec (Bootstrap), ohne Secrets
/srv/agentbox/                      agentbox:agentbox, 0750
├── state/agentbox.db               SQLite (WAL): State, Drafts, Runs, Events, Sessions, Audit
├── secrets/store.age               age-verschlüsselter Secret Store
├── workspaces/<ws>/
│   ├── build/                      gerendert: Dockerfile, mise.toml, mise.lock, compose.yaml
│   ├── home/                       persistentes $HOME des Image-Users (Agent-Configs, Sessions)
│   └── repos/<name>/               Git Checkouts, Arbeitsbereich der Agents
└── cache/                          Downloads, Registry-Auth
/run/agentbox/                      tmpfs (systemd RuntimeDirectory), 0750
├── web.sock                        einziges Ziel von tailscale serve
├── cli.token                       Bearer Token der lokalen CLI (0640 root:agentbox)
└── <ws>/secrets/                   materialisierte Secrets, 0600, nach Reboot weg
```

## 4. Stack und Libraries

### 4.1 Runtime, Build, Tooling

| Bereich | Wahl | Hinweis |
|---|---|---|
| Runtime, Binary | Bun ≥ 1.4.2, `bun build --compile --bytecode --asset …` | Targets `bun-linux-x64` und `bun-linux-arm64`; für den Dienst `--no-compile-autoload-dotenv --no-compile-autoload-bunfig`. Zu x64 auf CPUs ohne AVX2 gibt es offene Crash-Reports, die Detektion prüft `/proc/cpuinfo` |
| Monorepo | Bun Workspaces + Turborepo | `shadcn init --monorepo` erzeugt genau dieses Layout |
| Sprache | TypeScript strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax` | gemeinsame tsconfig in `packages/config` |
| Lint, Format | Biome im ganzen Repo; in `apps/web` zusätzlich `eslint-plugin-react-hooks` für die React Compiler Regeln | `next lint` gibt es seit Next 16 nicht mehr |
| Modulgrenzen | dependency-cruiser | Regeln aus Abschnitt 5 in CI erzwungen |
| Releases | Changesets | Changelog, Versionen, Tags |
| Updates | Renovate | auch Base-Image-Digests, CloudCLI-, MetaMCP- und Plane-Versionen, Agent-CLI-Versionen in Vorlagen |
| Git Hooks | lefthook | Biome und Typecheck auf staged files |

### 4.2 Backend: Dienst, CLI, Engine

| Aufgabe | Library | Hinweis |
|---|---|---|
| HTTP | Hono (`secure-headers`, `csrf`, `body-limit`, `request-id`, `hono/proxy`) | |
| RPC + Streaming | oRPC 1.x (`@orpc/contract`, `@orpc/server`, `@orpc/openapi`, `@orpc/zod`) | v2 ist Beta mit neuem Wire-Format; der Contract liegt in einem Paket, die Migration bleibt ein abgegrenztes Arbeitspaket |
| Schema | Zod 4 | `z.toJSONSchema()` für Editor-Autocomplete und VS Code |
| YAML, TOML, JSONC | `yaml` (eemeli), `smol-toml`, `jsonc-parser` | YAML mit `LineCounter` für Fehler mit Zeile und Spalte; TOML für Codex und mise; JSONC für den devcontainer-Import |
| Datenbank | `bun:sqlite` + Drizzle ORM + drizzle-kit | Migrations per `--asset` eingebettet, WAL-Modus, `busy_timeout` für CLI und Dienst parallel |
| Docker API | dockerode, installiert mit `bun install --omit=optional` | ssh2 lädt sonst das native `cpu-features`, das Bun zum Absturz bringt. Exec und Attach erst ab Bun 1.4.x stabil |
| Build, Compose | `docker buildx build`, `docker compose` über die Exec-Abstraktion | `--progress=rawjson` für Build-Schritte in der UI, `--metadata-file` für den Digest |
| Prozesse | execa 9 hinter `infra/exec` | AbortSignal, `forceKillAfterDelay`, Prozessgruppen, Chunks ins Event Log |
| Nebenläufigkeit | `p-limit`, `p-retry`, `AbortSignal.any` und `AbortSignal.timeout` | |
| Dateien | `proper-lockfile`, `write-file-atomic` | Apply-Lock, atomare Writes |
| Git | `simple-git` ≥ 3.36 (`import { simpleGit }`) | 2026 mehrere RCE-Advisories behoben: aktuell halten, Repo-URLs strikt validieren, `GIT_ALLOW_PROTOCOL=ssh:https` |
| Detektion | `systeminformation` (aktuellste 5.x) | ebenfalls Advisories in 2026, nur mit festen Argumenten aufrufen |
| Verschlüsselung | `age-encryption` (typage, Bun-kompatibel) | API vor 1.0, daher hinter eigenem Interface |
| Sessions | `@oslojs/crypto`, `@oslojs/encoding`; Notfall-Passwort mit `Bun.password` (argon2id) | Token erzeugen, SHA-256 als Session-ID |
| Logging | pino nach stdout/journald, `hono-pino` | |
| CLI | commander + `@commander-js/extra-typings`, `@clack/prompts`, `picocolors` | clack `taskLog` und Spinner für die Apply-Ausgabe |
| Zeitsteuerung | `croner` | Drift-Verify, Board-Poller |
| Forges | `@gitbeaker/rest` (GitLab), `octokit` (GitHub) | MRs und PRs im Board Provider |
| Templates | Tagged Template Literals + kleine typisierte Builder | Dockerfile und Markdown brauchen keine Template-Engine |

### 4.3 Frontend

| Aufgabe | Library | Hinweis |
|---|---|---|
| Framework | Next.js 16.3, App Router | `output: 'export'`, `trailingSlash: true`, `images.unoptimized`, `reactCompiler: true`, Turbopack |
| Styling | Tailwind CSS v4, `tw-animate-css` | CSS-first `@theme`; `@source` auf `packages/ui` |
| Komponenten | shadcn/ui CLI 4 in `packages/ui` | Registries per `components.json`, Details in Abschnitt 15.2 |
| Server-State | TanStack Query v5 über `@orpc/tanstack-query` | |
| URL-State | nuqs 2 (`NuqsAdapter` für den App Router) | Komponenten mit Search Params in `<Suspense>`, sonst scheitert der Export |
| Formulare | react-hook-form, `@hookform/resolvers` (Zod 4), shadcn `Field` | der alte shadcn `Form` ist durch Field + `Controller` ersetzt |
| Tabellen | TanStack Table v9 (shadcn Data Table Guide, tablecn) | |
| Log-Terminal | `@xterm/xterm` 6 + `addon-fit`, `addon-search`, `addon-web-links` | ANSI-Farben und `\r`-Fortschrittsbalken von apt, mise und buildx; einen echten Log Viewer gibt es in keiner shadcn-Registry |
| Editor, Diff | CodeMirror 6 über `@uiw/react-codemirror`, `@codemirror/lang-yaml`, `@codemirror/merge` | Diagnostik aus der eigenen Zod-Validierung; Autocomplete optional über `codemirror-json-schema/yaml` (letztes Release 04/2025) |
| Feedback, Icons, Theme | sonner, lucide-react, next-themes | |
| Command Palette | shadcn `Command` (cmdk) | |
| Charts | shadcn Charts (Recharts 3) | Ressourcen und Run-Dauer |
| Datum | date-fns | |
| Katalog, Tests | Storybook (Next.js-Vite-Framework) + Vitest Addon, MSW, Playwright | |

### 4.4 Bewusst nicht verwendet

- **Next.js Server (standalone):** zweiter Prozess, Node-Runtime, bricht das Single Binary, doppelte API-Schicht.
- **Hono RPC:** `streamSSE` ist ungetypt, Resume müsste selbst gebaut werden. **tRPC v11** wäre die reife Alternative, erzeugt aber kein OpenAPI und leitet Typen aus dem Router statt aus einem geteilten Contract ab.
- **Better Auth und ähnliche:** kein User-Management nötig, die Identität kommt aus Tailscale.
- **Kibo UI:** seit 05/2026 keine Aktivität im Repo. **monaco-yaml:** schwer, Worker-Setup im Static Export.
- **mise `npm:` Backend für Agent CLIs:** blockiert Postinstall-Skripte, Claude Code braucht aber sein natives Binary.
- **Effect-TS:** passt fachlich (strukturierte Nebenläufigkeit), die Einstiegshürde ist für das Team zu hoch; AbortSignal und execa reichen.

## 5. Monorepo

```
agentbox/
├── apps/
│   ├── agentbox/        Bun: CLI-Einstieg, Hono-Server, Composition Root, Binary-Build
│   └── web/             Next.js Static Export
├── packages/
│   ├── spec/            Zod-Schemas (Workspace, Host), YAML mit Positionen, Normalisierung, JSON Schema, Migrationen
│   ├── contract/        oRPC Contract, Event-Typen, Fehlercodes
│   ├── engine/          Provider SDK, Planner, DAG-Runner, Events, Redaction, Lock
│   ├── providers/       host/* und workspace/*, je ein Ordner pro Provider inkl. Renderer
│   ├── infra/           exec, docker, buildx, compose, secrets, db (Drizzle), detect, tailscale
│   ├── ui/              shadcn Design System + agentbox-Composites + Storybook
│   └── config/          tsconfig, Biome-Preset
├── templates/           Beispiel-Specs (workspace.yaml, host.yaml)
├── e2e/                 Playwright, VM-E2E-Skripte
└── docs/                ADRs, dieser Plan
```

Abhängigkeitsregeln:

- `apps/web` importiert nur `contract`, `spec` und `ui`. Server-Code kann so nicht ins Bundle geraten.
- `providers` → `engine`, `infra`, `spec`. `engine` → `spec`, `contract`. `infra` kennt keine Provider.
- Nur `apps/agentbox` verdrahtet alles (Composition Root). Provider bekommen ihre Abhängigkeiten über den Kontext, nie per Import eines Singletons.

## 6. Spec

### 6.1 Workspace-Spec

```yaml
# yaml-language-server: $schema=https://…/workspace.schema.json
version: 1
workspace: acme
image:
  base: ubuntu:24.04@sha256:…               # Digest, von Renovate gepflegt
  tag: agentbox/workspace:acme
  registry: registry.digitalocean.com/acme   # optional ab v0.2: Push + Build-Cache
system: { packages: [ripgrep, jq, adb] }
toolchains: { node: "25", java: temurin-25, flutter: stable, python: "3.13" }
repos:
  - url: git@gitlab.com:acme/shop-api.git
    setup: yarn install --frozen-lockfile
    test: yarn test
credentials: [git.gitlab, ssh.default, anthropic.api, plane.api]
mcp:
  plane: { url: "https://…/mcp", headers: { Authorization: { secret: plane.api } } }
agents:
  claude_code: { version: "2.1.x", model: sonnet, mcp: [plane] }
  codex: {}
  gemini: {}
llm: { provider: anthropic, key_ref: anthropic.api }
services: [postgres:16, playwright, android]
tools:                                      # in der agentbox-UI gepflegt (Seite "Tools")
  admin: { email: you@example.com, name: Alex, username: alex, password_ref: tools.admin }
  cloudcli: { version: "1.37.4" }
  metamcp: { version: "2.4.22", endpoint: claude }
  plane: { version: "v1.4.2", workspace: { name: acme, slug: acme }, project: { name: Shop API, identifier: SHOP } }
automation:                                 # Plane -> CloudCLI (Abschnitt 12a)
  enabled: true
  label: claude
  poll_seconds: 60
  max_parallel: 1
  projects: [{ plane: SHOP, repo: shop-api }]
expose:                                     # zusätzliche tailnet-only Ports (tailscale serve)
  scrcpy: 10000
```

Änderungen gegenüber v1:

- `version` ermöglicht Migrationen als reine Funktionen (`packages/spec/migrations`).
- `mcp:` definiert MCP-Server einmal. Agents referenzieren sie per Name; Renderer erzeugen daraus Claude JSON, Codex TOML und Gemini JSON. Für Claude Code ist der Standard ein einziger Eintrag `metamcp` (HTTP + Token); alles Weitere wird in der MetaMCP-UI hinzugefügt. Nur der Browser bleibt lokal (stdio), weil er im selben Container laufen muss.
- `expose:` steuert zusätzliche tailnet-only `tailscale serve` Einträge.
- `tools:` und `automation:` beschreiben den Werkzeug-Stack. Sie werden in der agentbox-UI gepflegt und landen im Draft; das gemeinsame Admin-Passwort liegt nur im Secret Store (`tools.admin`).
- Kurzformen (`postgres:16`, `"25"`) werden in `packages/spec` zu kanonischen Objekten normalisiert. Der Rest des Systems sieht nur die kanonische Form.
- Secret-Referenzen haben die Form `<namespace>.<name>`. Der Plan prüft, dass jede Referenz im Store existiert, und meldet Fehler mit Pfad und Zeile.
- In Vorlagen sind Versionen und Digests Pflicht (Renovate hält sie aktuell); in eigenen Specs erzeugen ungepinnte Werte eine Warnung im Plan.

### 6.2 Host-Spec

`agentbox bootstrap` erzeugt `/etc/agentbox/host.yaml` aus Flags oder liest eine vorhandene Datei:

```yaml
version: 1
host:
  user: { name: agentbox, uid: 10001 }
  docker: { channel: stable }
  firewall: { ssh: public }                 # public | tailnet-only (erst nach verifiziertem Tailscale SSH)
  tailscale:
    hostname: agentbox-01                   # neutral halten, siehe 10.2
    tags: [tag:agentbox]
    auth_key_ref: tailscale.authkey         # fehlt er, gibt es einen Login-Link
    ssh: true
    allowed_users: [you@example.com]        # Tailscale-Logins mit UI-Zugriff
  android: { backend: auto }                # auto | kvm | redroid | off
```

### 6.3 Validierung

1. YAML parsen (`parseDocument` mit `LineCounter`, Positionen bleiben erhalten).
2. `version` prüfen, bei Bedarf migrieren.
3. Zod `safeParse`, Issues auf Zeile und Spalte abbilden.
4. Semantische Checks: Secret-Refs vorhanden, Ports frei, Toolchain für die Architektur verfügbar (Flutter in mise nur linux-x64), Namen eindeutig.
5. Ergebnis ist die normalisierte Spec.

Dieselbe Funktion läuft in CLI, API und Editor. Die UI importiert `packages/spec` direkt; Checks, die Server-State brauchen, laufen über `spec.validate`. `agentbox spec schema` schreibt das JSON Schema für VS Code und den UI-Editor.

## 7. Engine und Provider SDK

### 7.1 Interface

```ts
export interface Provider<Desired, Observed, Result = void> {
  id: ProviderId;                                 // "image", "repos", "host.tailscale", …
  scope: "host" | "workspace";
  dependsOn: ProviderId[];
  select(spec: NormalizedSpec): Desired | null;   // relevanter Ausschnitt, null = inaktiv
  detect(ctx: Ctx): Promise<Observed>;            // Ist-Zustand, ohne Seiteneffekte
  plan(desired: Desired, observed: Observed, ctx: Ctx): Promise<Change[]>;
  apply(changes: Change[], ctx: Ctx): Promise<Result>; // idempotent, abbrechbar
  verify(ctx: Ctx, result?: Result): Promise<Check[]>;
}

type Change = {
  op: "create" | "update" | "replace" | "delete" | "noop";
  resource: string; summary: string;
  before?: unknown; after?: unknown; destructive?: boolean;
};

type Check = { id: string; status: "ok" | "warn" | "fail"; message: string; hint?: string };

interface Ctx {
  signal: AbortSignal; log: ScopedLogger; exec: Exec; docker: DockerClient;
  secrets: SecretReader;        // liest nur die in der Spec deklarierten Refs
  state: ProviderState;         // Key-Value in SQLite, pro Provider und Workspace
  paths: WorkspacePaths; workspace: string; host: HostFacts;
}
```

### 7.2 Laufzeitregeln

- **DAG:** `dependsOn` wird topologisch sortiert, unabhängige Provider laufen parallel (`p-limit`, Default 3). Beispiel: Repos klonen parallel zum Image-Build, Setup-Kommandos warten auf beides.
- **Fehler** stoppen nur abhängige Provider. Ergebnis pro Provider: `ok`, `failed`, `skipped` oder `cancelled`.
- **Abbruch:** ein AbortController pro Run. Exec beendet ganze Prozessgruppen (SIGTERM, nach 10 s SIGKILL). Setup- und Testkommandos laufen in Wegwerf-Containern (`docker compose run --rm` mit Label), denn ein abgebrochenes `docker exec` lässt den Prozess im Container weiterlaufen. Abbruch heißt dort `docker rm -f` auf den per Label bekannten Container.
- **Fingerprints:** Nach erfolgreichem Apply speichert jeder Provider einen Hash seines Soll-Zustands. Stimmen Hash und `detect` überein, meldet `plan` nur `noop`. Drift heißt: gleicher Hash, aber abweichender Ist-Zustand.
- **Labels** `dev.agentbox.workspace`, `dev.agentbox.provider`, `dev.agentbox.spec-hash` an allen Docker-Objekten. Aufgeräumt wird nur per Label, nie per Namensmuster.
- **Destruktive Changes** (Volume löschen, Repo entfernen) brauchen eine ausdrückliche Bestätigung (`--allow-destroy` oder Checkbox im Review).
- **Repos werden nie hart zurückgesetzt:** nur `fetch` und Fast-Forward bei sauberem Working Tree, sonst `warn`. Dort arbeiten Agents.

### 7.3 Events

- Discriminated Union in `packages/contract`: `run.started`, `run.planned`, `provider.started`, `provider.log` (Chunk mit stdout/stderr, alle 50 ms gebündelt), `provider.progress` (Build-Schritte aus buildx rawjson), `provider.finished`, `check.result`, `run.finished`.
- Jedes Event hat eine monotone `seq` pro Run. Sie ist die SSE-Event-ID für den Resume.
- Senken: SQLite (`run_events`, Aufbewahrung der letzten 50 Runs), In-Memory Pub/Sub für Live-Streams, Terminal-Renderer der CLI.
- **Redaction vor jeder Senke:** bekannte Secret-Werte, auch in Base64 oder URL-kodiert, werden zu `***`.

## 8. Provider-Katalog

### 8.1 Host (Bootstrap, läuft als root)

| Provider | Phase | Aufgabe | Verify |
|---|---|---|---|
| `host.detect` | 0.1 | OS, Arch, AVX2, RAM, Disk, KVM, binder; Abbruch, wenn agentbox im Container läuft | Warnung bei zu kleiner VM |
| `host.user` | 0.1 | System-User `agentbox`, UID/GID 10001, Gruppen `docker`, `kvm` | `getent` |
| `host.fs` | 0.1 | `/srv/agentbox` mit Rechten | `stat` |
| `host.docker` | 0.1 | Docker Engine aus dem offiziellen apt-Repo (deb822), `daemon.json` (Abschnitt 10.1) | `docker version`, `docker info` |
| `host.firewall` | 0.1 | ufw: default deny incoming, `limit OpenSSH`, `allow in on tailscale0` | `ufw status verbose` |
| `host.tailscale` | 0.1 | apt-Repo, `tailscale up` mit Tag, `set --operator=agentbox`, `--ssh`, `serve` für die UI | Abschnitt 10.3 |
| `host.systemd` | 0.1 | `agentbox.service` mit Hardening | `systemctl is-active` |
| `host.android` | 0.3 | `kvm`-Gruppe oder `linux-modules-extra` + `binder_linux` persistent laden | `/dev/kvm` beschreibbar, binderfs |

### 8.2 Workspace

| Provider | Phase | Aufgabe | Verify |
|---|---|---|---|
| `image` | 0.1 | Dockerfile rendern (apt, mise, Agent CLIs, User), bauen, ab v0.2 pushen | Digest; `mise ls --current`, CLI-Versionen im Container |
| `credentials` | 0.1 | Refs prüfen, Secrets auf tmpfs materialisieren, Env-Files rendern | Dateien vorhanden, Rechte 0600 |
| `git` | 0.1 | ed25519-Key erzeugen oder importieren, `known_hosts`, `.gitconfig`, `gh`/`glab` Auth | `ssh -T`, `glab auth status` |
| `stack` | 0.1 | `compose.yaml` rendern, `docker compose up -d --wait --remove-orphans` (v0.1 nur der workspace-Container) | `compose ps --format json`, Healthchecks |
| `repos` | 0.1 | Klonen oder Fast-Forward, Setup im Wegwerf-Container | HEAD, Status sauber/dirty/ahead, Exit-Code Setup |
| `browser` | 0.1 | Headless Chromium (Playwright-Build, nicht das Ubuntu-Snap) + Fonts + Playwright MCP im workspace Image; MCP-Server `browser` für alle Agents, Fallback-CLI `agentbox-screenshot` | `browser-check.mjs`: Start, Rendering, Fonts (CJK, Emoji), Screenshot; Screenshot im Run sichtbar |
| `agents.claude_code` | 0.1 | Installation im Image, Config im Home (Modell, MCP im User-Scope), Auth | `claude --version`, optional Headless-Smoke-Test |
| `agents.codex`, `agents.gemini` | 0.2 | analog (Codex TOML, Gemini JSON) | `--version`, Smoke-Test |
| `services` | 0.2 | Katalog für postgres, playwright, … als Compose-Fragmente mit Healthcheck | TCP-Probe aus dem workspace-Container |
| `cloudcli` | 0.1 | CloudCLI im workspace-Image, Service starten, Admin registrieren (schließt die Registrierung), API-Key für den Automaten erzeugen, Projekte für alle Repos anlegen | `/api/auth/status` → kein Setup offen, Login, API-Key gültig |
| `metamcp` | 0.2 | MetaMCP + Postgres + `mcp-gateway`, Admin, Sign-up zu, Namespace + Endpoint `claude` mit API-Key-Auth, Plane-MCP vorinstalliert, Claude Code verbunden (`~/.claude.json`) | `/health`, Sign-up gesperrt, `tools/list` über den Endpoint mit Token |
| `plane` | 0.2 | Plane CE aus der gepinnten Release-Compose, Admin + Workspace + Projekt + Label `claude` + Status „In Review“ + Bot-User mit API-Token | Login, Sign-up gesperrt, API-Token liest Projekt |
| `automation` | 0.2 | Plane→CloudCLI-Automat aktivieren (läuft im agentbox-Dienst) | letzter Poll, offene/laufende Tasks |
| `expose` | 0.1 | `tailscale serve` für alle Tool-UIs (8443 CloudCLI, 8444 Plane, 8445 MetaMCP) und weitere Ports aus `expose:` | `serve status --json`, HTTPS-Probe pro Port |
| `context` | 0.2 | Kontext generieren und verteilen, hängt von allen ab | Hashes aktuell |
| `android` | 0.3 | KVM: docker-android; sonst Redroid; ws-scrcpy | `adb connect`, `sys.boot_completed` |
| `board` | 0.3 | Plane-Tickets ziehen, Agent-Lauf, Tests, MR/PR | letzter Poll, Queue-Status |

## 9. Image-Build

Der Dockerfile-Renderer ist ein kleiner typisierter Builder (`providers/workspace/image/dockerfile.ts`) mit Golden-File-Tests und hadolint in CI. Reihenfolge der Layer: stabil und groß zuerst, häufig geändert zuletzt.

```dockerfile
# syntax=docker/dockerfile:1
FROM ubuntu:24.04@sha256:…
# 1. User mit UID 10001 (= Host-User agentbox), Basis-Tools auch für den agent-server
RUN userdel -r ubuntu \
 && groupadd -g 10001 agent && useradd -m -u 10001 -g 10001 -s /bin/bash agent
# 2. apt-Pakete, sortiert, mit Cache Mounts statt apt-get clean
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
      bash ca-certificates git jq ripgrep tini tmux adb
# 3. mise gepinnt, systemweit, mit Lockfile
COPY --from=ghcr.io/jdx/mise:<version> /usr/local/bin/mise /usr/local/bin/mise
ENV MISE_DATA_DIR=/mise MISE_CONFIG_DIR=/mise MISE_CACHE_DIR=/mise/cache \
    MISE_YES=1 MISE_LOCKED=1 PATH=/mise/shims:$PATH
COPY mise.toml mise.lock /mise/
# 4. ein RUN pro Toolchain, große und stabile zuerst
RUN --mount=type=cache,target=/mise/cache mise install java
RUN --mount=type=cache,target=/mise/cache mise install flutter
RUN --mount=type=cache,target=/mise/cache mise install python node gh glab
# 5. Agent CLIs zuletzt, Version gepinnt, Auto-Update aus
ENV DISABLE_AUTOUPDATER=1
RUN … offizieller Installer von Claude Code, Codex, Gemini mit fester Version …
USER agent
WORKDIR /workspace
```

- **Ein Image-User für alles:** UID 10001 für Host-User `agentbox` und Image-User `agent`, damit Bind Mounts ohne `chown` funktionieren.
- **mise:** `mise.toml` wird aus `toolchains:` gerendert; beim Apply erzeugt `mise lock --platform linux-x64,linux-arm64` das Lockfile, der Build installiert mit `--locked`. Shims liegen im `PATH`, weil Agents nicht-interaktive Shells nutzen. mise hält neue Versionen per Default 24 h zurück (`minimum_release_age`), das ist gewollt.
- **apt** nur für Systembibliotheken. `gh` (`aqua:cli/cli`) und `glab` (`gitlab:gitlab-org/cli`) kommen über mise.
- **Agent CLIs** über ihren offiziellen Installationsweg mit fester Version, nicht über das `npm:` Backend von mise (Abschnitt 4.4).
- **Build:** `docker buildx build --progress=rawjson --metadata-file …`, Tags `agentbox/workspace:<ws>` und `:<ws>-<spec-hash>` für Rollback. Private Paketquellen nur über `--mount=type=secret`, nie als `ARG`.
- **Registry (v0.2):** Push in die DigitalOcean Registry, BuildKit-Cache mit `--cache-to type=registry,ref=<reg>/workspace:buildcache,mode=max` und `--cache-from`. Weitere VMs ziehen statt zu bauen.
- **CloudCLI im workspace-Image:** `npm i -g @cloudcli-ai/cloudcli@<version>` auf der mise-Node (≥ 22), dafür `build-essential python3` für node-pty, better-sqlite3 und bcrypt. Der workspace-Container läuft damit dauerhaft als CloudCLI-Server; CLI-Agents, Toolchains und Browser teilen sich denselben Container und dasselbe `$HOME`.
- **`agentbox exec`:** führt ad hoc im workspace-Container aus. Mit `--adopt` (v0.2) erkennt ein Parser `apt-get install`, `mise use` und `npm i -g` und bietet die Übernahme in die Spec als Diff an. Ohne Übernahme ist die Änderung beim nächsten Apply weg.

## 9a. Browser für Agents

Agents sollen ihre UI-Arbeit selbst prüfen: Dev-Server starten, Seite öffnen, Screenshot ansehen, Konsole lesen. Umgesetzt im Paket `packages/providers` (`@workspace/providers/browser`), end-to-end getestet mit `bun run --cwd e2e browser`.

- **Wo der Browser läuft:** im workspace Image selbst, nicht als eigener Service. So erreicht er `http://localhost:<port>` des Dev-Servers, den der Agent im selben Container gestartet hat. Claude-Sessions aus CloudCLI laufen im selben Container und nutzen ihn direkt.
- **Was installiert wird:** Chromium aus Playwright (Ubuntus `chromium-browser` ist ein Snap und im Image nicht installierbar), Fonts für Latein, CJK und Emoji, Playwright MCP in gepinnter Version. Die Chromium-Revision kommt aus der Playwright-Kopie von Playwright MCP, damit beide zusammenpassen.
- **Zugriff für Agents:**
  - MCP-Server `browser` (Wrapper `agentbox-browser-mcp`: headless, isoliertes Profil, Viewport 1440x900, absolute Dateipfade, Ausgabeordner `/tmp/agentbox-browser`). Screenshots kommen als Bild beim Modell an; Seiten-Snapshots (Accessibility-Baum mit Element-Refs) liegen als Datei im Ausgabeordner.
  - `agentbox-screenshot <url> [out.png] [--full-page]` für Agents ohne MCP: liefert HTTP-Status, Konsolenfehler und fehlgeschlagene Requests als JSON plus PNG.
  - Der generierte Kontext (AGENTS.md) beschreibt den Ablauf: Dev-Server starten, Screenshot, ansehen, Konsole prüfen, erst dann „fertig“ melden.
- **Spec:** `browser: { enabled: true, viewport: 1440x900 }`, Default an. Der MCP-Server `browser` steht automatisch in der `mcp:` Registry und ist für alle Agents aktiv.
- **Container-Einstellungen:** `shm_size: 1gb` (Chromium braucht mehr als die 64 MB Default), kein Sandbox-Modus von Chromium nötig (läuft als UID 10001 ohne Zusatzrechte).
- **Verify:** `browser-check.mjs` als Image-User: Start, Text-Rendering, CJK- und Emoji-Fonts, Screenshot > 2 KB. Der Screenshot wird ab v0.1 als Run-Artefakt in der UI angezeigt.
- **Getestet (03.10.2026):** Ubuntu 24.04, Chromium 155, Playwright MCP 0.0.83, linux/arm64 und linux/amd64: Navigation zu `localhost:3000`, Snapshot lesen, Klick, Konsolenfehler, Screenshot als Bild, Fallback-CLI.
- **Bekannt:** Playwright MCP ändert seine Tool-Schnittstelle zwischen Versionen (z. B. `browser_click` erwartet `target` statt `ref`, Snapshots als Datei statt inline). Version pinnen, der E2E-Test läuft in CI und fängt Brüche bei Renovate-Updates ab.

## 10. Tailscale und Zugriff

### 10.1 Bootstrap-Ablauf (`sudo agentbox bootstrap`)

1. **Detektion:** Abbruch, wenn agentbox im Container läuft. Warnung unter 4 vCPU, 8 GB RAM oder 80 GB Disk (mit Flutter und Android deutlich mehr).
2. **User und Verzeichnisse:** `agentbox` mit UID 10001, `/srv/agentbox`.
3. **Docker** aus dem offiziellen apt-Repo (nicht `get.docker.com`). `daemon.json`:

   ```json
   {
     "ip": "127.0.0.1",
     "default-network-opts": { "bridge": { "com.docker.network.bridge.host_binding_ipv4": "127.0.0.1" } },
     "log-driver": "local",
     "live-restore": true
   }
   ```

   `ip` gilt nur für die Default-Bridge, `default-network-opts` für Compose-Netzwerke. Veröffentlichte Ports landen so auf Loopback, auch wo Docker an ufw vorbei routet. Der `local` Log-Driver rotiert (json-file tut das per Default nicht).
4. **Tailscale** aus `pkgs.tailscale.com` (noble). `tailscale up --auth-key=… --advertise-tags=tag:agentbox --hostname=…`. Ohne Key druckt Bootstrap den Login-Link. Ein OAuth-Client-Secret als Key nur mit `?ephemeral=false&preauthorized=true`, sonst ist der Node ephemeral und verschwindet, sobald er offline ist. Getaggte Nodes haben keine Key Expiry.
5. `tailscale set --operator=agentbox`: der Dienst verwaltet `serve` ohne root.
6. **HTTPS-Check:** Ist HTTPS im Tailnet nicht aktiviert, konfiguriert `serve` nichts und endet trotzdem mit Exit 0. Bootstrap prüft danach `serve status --json`, zeigt den Link in die Admin-Konsole und wartet.
7. **ufw:** default deny incoming, `limit OpenSSH`, `allow in on tailscale0`. Nur wenn `firewall.ssh: tailnet-only` gesetzt ist und Tailscale SSH verifiziert funktioniert, fällt die öffentliche SSH-Regel weg. Vorher plant `systemd-run --on-active=5min` die Wiederherstellung der Regel; bestätigt der Nutzer über das Tailnet, wird der Timer gelöscht. Zusätzlich empfohlen: DigitalOcean Cloud Firewall als äußere Schicht.
8. **systemd:** Unit installieren, starten, Unlock-Hinweis und Tailnet-URL ausgeben.

### 10.2 Zugriff und Authentifizierung

- **Tailnet:** `tailscale serve --bg --https=443 unix:/run/agentbox/web.sock` für die agentbox-UI; die Tools bekommen eigene Ports (Abschnitt 12.1).
- **Autorisierung:** Der Login muss in `host.tailscale.allowed_users` stehen. Requests von getaggten Geräten tragen keine Identität und werden abgelehnt, die UI bedienen nur Menschen.
- **Kein Funnel:** Nichts ist öffentlich. `web.sock` lehnt trotzdem Requests mit `Tailscale-Funnel-Request` ab, falls jemand Funnel versehentlich einschaltet.
- **Tailnet-Policy:** nur eine Admin-Gruppe erreicht `tag:agentbox` auf 443, 8443–8445 und SSH. Ein Snippet liegt in `docs/tailscale-policy.hujson`.
- **Lokal (Fallback):** Listener `127.0.0.1:7777`. Die CLI authentifiziert sich per Bearer Token aus `/run/agentbox/cli.token`. Der Browser über SSH Tunnel (`ssh -L 7777:127.0.0.1:7777 vm`) meldet sich per Einmal-Link an: `agentbox login-link` erzeugt eine URL mit Token (5 min gültig, einmalig), die ein Session-Cookie setzt. Identity-Header werden auf diesem Listener ignoriert.
- **Sessions:** 32 Byte Zufallstoken, SHA-256 als ID in SQLite, Cookie `HttpOnly; SameSite=Strict` (plus `Secure` über HTTPS), 12 h Sliding Expiry.
- **Härtung:** Host-Header-Allowlist (MagicDNS-Name, `127.0.0.1:7777`, `localhost:7777`) gegen DNS Rebinding, `hono/csrf` Origin-Check, CSP mit beim Build berechneten Hashes der Inline-Scripts aus dem Export, Rate-Limit auf das Einlösen von Links.
- **`--bind 0.0.0.0` entfällt.** Als Notfall bleibt `--listen <ip:port>`, nur mit Passwort (argon2id) und Warnbanner.
- **Hostname neutral wählen:** Tailscale-HTTPS-Namen erscheinen in öffentlichen Certificate-Transparency-Logs, also `agentbox-01` statt Kunden- oder Projektnamen.

### 10.3 Verify-Checks

BackendState `Running`, Tag gesetzt, Key Expiry aus, `serve status` enthält 443 → `web.sock` und die Tool-Ports, `https://<node>.<tailnet>.ts.net/healthz` liefert 200, kein Funnel aktiv, ufw aktiv mit den erwarteten Regeln, keine öffentlich gebundenen Docker-Ports (`ss -tlnp` gegen die Erwartung).

## 11. Credentials und Secrets

- **Store:** `secrets/store.age` enthält eine JSON-Map `{ ref: { value, type, updatedAt } }`, verschlüsselt an eine X25519-Identity. Die Identity ist mit der Passphrase (scrypt) verschlüsselt. Ein Passphrase-Wechsel verschlüsselt nur die Identity neu.
- **Sealed/Unsealed:** Der Dienst startet versiegelt. Entsperrt wird in der UI (nach Login) oder mit `agentbox unlock`. Der Schlüssel liegt nur im Speicher. Optionaler Auto-Unlock über `systemd-creds` ist nur so sicher wie die Platte und bleibt Opt-in.
- **API write-only:** Antworten enthalten `{ ref, type, set, updatedAt, fingerprint }`. Der Fingerprint (8 Zeichen SHA-256) dient zum Wiedererkennen, den Wert zeigt die UI nie wieder.
- **Materialisierung:** nur deklarierte Refs, nach `/run/agentbox/<ws>/secrets/` (tmpfs, 0600): Dateien für Keys und Tokens, `agent.env` für Tools, die Env erwarten. Compose bindet sie read-only ein bzw. nutzt `env_file`. Nach einem Reboot sind sie weg; der nächste Apply nach dem Unlock stellt sie wieder her.
- **SSH:** ed25519-Keypair pro Workspace, Public Key in der UI mit Copy-Button und Links zu „SSH Key hinzufügen“ bei GitLab und GitHub. Import optional, der private Laptop-Key wird nie durchgereicht. `known_hosts` enthält gepinnte Fingerprints für gitlab.com und github.com; für eigene Forges zeigt die UI den Fingerprint aus `ssh-keyscan` zur Bestätigung.
- **Git und Forges:** pro Forge Host, User und Methode (SSH oder Token). Tokens gehen per stdin an `glab auth login` bzw. `gh auth login --with-token`, `.gitconfig` wird über `git config --file` geschrieben.
- **Agent-Auth:** Claude Code über `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN` (aus `claude setup-token`, für Pro/Max-Abos) oder ein `apiKeyHelper`-Skript, das aus dem Secret-Mount liest. Codex über `OPENAI_API_KEY`, Gemini über `GEMINI_API_KEY`.
- **Nie als CLI-Argument:** `agentbox secrets set` liest Werte per Prompt oder stdin, damit sie nicht in der Shell-History oder in `ps` auftauchen.
- **Backup:** Der Spec-Export enthält nur Refs. Secrets werden separat verschlüsselt exportiert (`agentbox secrets export --to age1…`).

## 12. Werkzeug-Stack: CloudCLI, MetaMCP, Plane

OpenHands und Paperclip sind evaluiert und gestrichen (ADR 0007). Statt einer Agent-Plattform verdrahtet agentbox drei spezialisierte Werkzeuge. Der Nutzer füllt einmal die Seite „Tools“ in der agentbox-UI aus (Admin-E-Mail, Name, Benutzername, Passwort, Plane-Workspace und -Projekt); der Apply richtet alles ein, verbindet es und stellt die UIs im Tailnet bereit.

### 12.1 Überblick

| Tool | Zweck | Version (10.10.2026) | Port lokal → Tailnet | Auth nach Bootstrap |
|---|---|---|---|---|
| CloudCLI (`@cloudcli-ai/cloudcli`, AGPL-3.0) | Web-UI für Claude-Code-Sessions, Projekte, Dateien, Shell | 1.37.4 | 3001 → :8443 | ein User, Registrierung schließt sich selbst |
| MetaMCP (`ghcr.io/metatool-ai/metamcp`) | MCP-Server verwalten, zu Namespaces bündeln, über einen Endpoint mit Token ausliefern | 2.4.22 | 12008 → :8445 | Better Auth, Sign-up per Config gesperrt |
| Plane CE (`makeplane/plane-*`) | Scrum/PM: Work Items, Zyklen, Labels | v1.4.2 | 8090 → :8444 | Instanz-Admin, Sign-up gesperrt |

Gemeinsamer Admin: dieselbe E-Mail und dasselbe Passwort für alle drei Tools (CloudCLI nutzt den Benutzernamen). Passwort nur im Secret Store (`tools.admin`). Alle generierten Geheimnisse (JWT-, Auth-, DB-Secrets, API-Keys) erzeugt agentbox einmalig und hält sie im Store (`cloudcli.*`, `metamcp.*`, `plane.*`).

### 12.2 CloudCLI

- **Laufort:** im workspace-Container (Abschnitt 9). `HOST=0.0.0.0` im Container, veröffentlicht nur `127.0.0.1:3001`; `WORKSPACES_ROOT=/workspaces` (Repos), `DATABASE_PATH=/home/agent/.cloudcli/auth.db`, `JWT_SECRET` aus dem Store. `API_KEY` bleibt **ungesetzt** (würde die UI brechen).
- **Claude-Auth:** `CLAUDE_CODE_OAUTH_TOKEN` oder `ANTHROPIC_API_KEY` aus dem Store per Env-File; CloudCLI reicht die Umgebung an das Agent SDK durch.
- **Bootstrap (idempotent):** `GET /api/auth/status` → bei `needsSetup` `POST /api/auth/register {username, password}`; danach ist die Registrierung dauerhaft zu. Login → JWT → `POST /api/settings/api-keys {keyName: "agentbox-automation"}` → `ck_…` in den Store (`cloudcli.api_key`). Für jedes Repo `POST /api/projects/create-project {path}`.
- **Risiko:** CloudCLI hat Shell- und Datei-API; 2026 gab es kritische Advisories (alle vor 1.25 behoben). Nur im Tailnet, `JWT_SECRET` gesetzt, Admin vor dem ersten `serve` registriert.

### 12.3 MetaMCP und Claude Code

- **Services:** `metamcp` (Image gepinnt) + `metamcp-db` (`postgres:16`, kein veröffentlichter Port, eigenes Passwort), `APP_URL=NEXT_PUBLIC_APP_URL=https://<node>:8445`, `BETTER_AUTH_SECRET` aus dem Store.
- **Bootstrap über die API, die auch die UI nutzt:** Sign-up des Admins (`/api/auth/sign-up/email`, `Origin: APP_URL`), Session; dann tRPC `frontend.config.setSignupDisabled {disabled:true}`, `frontend.namespaces.create {name: "agentbox"}`, `frontend.endpoints.create {name: "claude", namespaceUuid, enableApiKeyAuth: true, enableOauth: false, useQueryParamAuth: false}`, `frontend.apiKeys.create {name: "claude-code"}` → `sk_mt_…` in den Store.
- **Vorinstalliert im Namespace:** Plane-MCP (`uvx plane-mcp-server stdio`, `PLANE_API_KEY` des Bot-Users, `PLANE_WORKSPACE_SLUG`, `PLANE_BASE_URL=http://plane-proxy`). Weitere MCP-Server fügt der Nutzer in der MetaMCP-UI hinzu und hängt sie an den Namespace `agentbox`; Claude Code sieht sie sofort.
- **Claude Code verbinden:** agentbox schreibt in `~/.claude.json` des workspace-Containers (`mcpServers`, User-Scope): `metamcp: { type: "http", url: "http://mcp-gateway/metamcp/claude/mcp", headers: { Authorization: "Bearer sk_mt_…" } }` sowie lokal `browser` (stdio, Abschnitt 9a).
- **`mcp-gateway`:** kleiner Caddy vor MetaMCP, der `/.well-known/oauth-*` mit 404 beantwortet. Grund: MetaMCP liefert diese Pfade immer aus, und Claude Code ≥ 2.1.85 startet dann einen OAuth-Flow statt den Bearer-Token zu nutzen (MetaMCP-Issue #277, offen). Fällt weg, sobald das upstream behoben ist.
- **Risiko:** In MetaMCP ist jeder eingeloggte Nutzer faktisch Admin und kann stdio-Prozesse im Container starten; keine RBAC. Daher Sign-up zu, nur Tailnet, Container ohne Docker-Socket.

### 12.4 Plane

- **Quelle:** die `docker-compose.yml` des gepinnten Release (`v1.4.2`), von agentbox gerendert statt `setup.sh`: Proxy (Caddy) nur auf `127.0.0.1:8090` (statt auf allen Interfaces), kein HTTPS im Container, eigene Secrets (`SECRET_KEY`, `LIVE_SERVER_SECRET_KEY`, DB-, MQ-, MinIO-Passwörter). `WEB_URL=CORS_ALLOWED_ORIGINS=https://<node>:8444` (Port in der URL ist offiziell unterstützt; einen Subpfad unterstützt Plane nicht). `ENABLE_SIGNUP=0` per Override.
- **Ressourcen:** Plane braucht allein 4 GB RAM (8 GB empfohlen). Die Detektion warnt, wenn die VM mit Plane unter 8 GB liegt.
- **Bootstrap per Django-Shell** (`docker compose exec plane-api python manage.py shell`), ein idempotentes Skript: Admin-User mit Passwort, Profil als onboarded, Instanz-Admin, `is_setup_done`, `ENABLE_SIGNUP=0`, Workspace (Admin als Owner), Bot-User `claude@agentbox.local` als Mitglied, API-Token des Bots (`plane_api_…`, in den Store). Danach über die REST-API v1 mit dem Token: Projekt (falls fehlend), Label `claude`, Status „In Review“ (Gruppe `started`), Bot als Projektmitglied. Anschließend `manage.py clear_cache`.
- **Warum Shell statt API:** Für Workspace und ersten Admin gibt es in CE keine API-Key-taugliche Route, und das Admin-Sign-up ist ein CSRF-Formular mit Passwortstärke-Prüfung und Redirects.

## 12a. Plane→CloudCLI-Automat

Ein eigener Prozess im agentbox-Dienst (kein weiterer Container), Code in `packages/automation`.

**Ablauf pro Poll** (Default alle 60 s; Plane erlaubt 60 Requests/min pro Token):

1. Für jedes konfigurierte Projekt Work Items laden (`GET …/work-items/?per_page=100&expand=labels,state`) und **client-seitig** filtern: Label `claude`, Status-Gruppe `unstarted` (Todo) oder `backlog` (konfigurierbar), noch nicht in der Task-Tabelle. Plane CE kann serverseitig nicht nach Label filtern.
2. **Claim:** Status auf den ersten `started`-Status („In Progress“), Kommentar „Claude hat übernommen“, Eintrag in SQLite (`automation_tasks`: Issue, Projekt, Status, Session-ID, Zeiten, Fehler). Parallelität begrenzt (`max_parallel`, Default 1).
3. **Session starten:** `POST /api/agent` an CloudCLI mit `X-API-Key`, `provider: "claude"`, `projectPath: /workspaces/<repo>`, `stream: true`. Prompt aus Titel, Beschreibung, Link und festen Regeln (eigener Branch `claude/<IDENT>-<seq>`, Tests ausführen, UI per Browser-Screenshot prüfen, am Ende eine kurze Zusammenfassung). Aus dem Stream die `session-id` lesen und sofort als Kommentar mit Link `https://<node>:8443/session/<id>` posten: Die Session ist in CloudCLI live sichtbar und kann dort übernommen werden.
4. **Abschluss:** Den Stream bis `complete` lesen, die letzte Antwort von Claude als Kommentar posten (HTML-escaped, gekürzt), Status auf „In Review“.
5. **Fehler und Timeout** (Default 60 min): Kommentar mit Fehler, Status zurück auf Todo, Label `claude-failed`. Kein automatischer Retry; neu starten heißt `claude-failed` entfernen.
6. **Neustart des Dienstes:** laufende Tasks werden als unterbrochen markiert und kommentiert; die Session bleibt in CloudCLI erhalten und kann dort fortgesetzt werden.

**Zusätzlich:** Über den Plane-MCP in MetaMCP kann Claude während der Arbeit selbst Kommentare schreiben oder Sub-Tasks anlegen. Die Statuswechsel macht nur der Automat, damit der Ablauf nachvollziehbar bleibt.

**UI:** Seite „Automation“ mit Schalter (Pause), Label, Poll-Intervall, Parallelität, Projekt→Repo-Zuordnung und einer Tabelle der Tasks mit Links zu Plane und zur CloudCLI-Session.

## 13. Context Generator

- **Eingaben:** normalisierte Spec und Provider-Ergebnisse, also Toolchain-Versionen (`mise ls --json`), Services mit internem Hostnamen und Port, Credential-Namen ohne Werte, Setup- und Testkommandos pro Repo sowie bekannte Einschränkungen (Redroid ohne Play Services, Flutter nur auf x64, keine Produktionszugänge).
- **Ein Datenmodell, mehrere Renderer:**
  - `AGENTS.md` als Quelle. Codex liest sie nativ, Gemini über `contextFileName` in den Settings.
  - `CLAUDE.md` mit `@AGENTS.md` Import, weil Claude Code AGENTS.md nicht nativ liest.
  - Workspace-weiter Kontext zusätzlich global im persistenten Home: `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.gemini/GEMINI.md`.
  - CloudCLI-Sessions laufen im workspace-Container und lesen dieselben Dateien; der Kontext beschreibt zusätzlich Plane (Projekt, Label `claude`, Status) und den MetaMCP-Endpoint.
- **Keine Verschmutzung der Repos:**
  - Datei fehlt oder ist nicht getrackt: schreiben und in `.git/info/exclude` eintragen.
  - Datei ist getrackt: nicht anfassen, der Kontext landet nur in den globalen Dateien. Mit `context.inject: true` pflegt agentbox stattdessen einen Block zwischen `<!-- agentbox:begin -->` und `<!-- agentbox:end -->`.
- **Aktualität:** eigener Provider mit Abhängigkeit auf alle anderen, läuft nach jedem Apply, schreibt nur bei geändertem Hash.
- **Tests:** Golden Files pro Renderer und Beispiel-Spec.

## 14. API und Live-Logs

- **Contract** in `packages/contract`, gruppiert nach Namespaces:
  - `system`: `info`, `health`, `detect`
  - `auth`: `me`, `logout`, `redeemLink`
  - `secrets`: `status`, `unlock`, `list`, `set`, `delete`
  - `spec`: `getDraft`, `patchDraft(section, value)`, `validate`, `getApplied`, `importYaml`, `exportYaml`
  - `runs`: `plan`, `apply(planHash)`, `cancel`, `list`, `get`, `events(runId)`
  - `providers`: `status`, `verify`; dazu `ssh.publicKey` und `tailscale.status`
- **Mount:** oRPC `RPCHandler` unter `/api/rpc/*` in Hono. `OpenAPIGenerator` erzeugt `/api/openapi.json` für Skripte; die eigene CLI nutzt den typisierten Client.
- **Live-Log:** `runs.events` ist ein async Generator, jedes Event trägt `withEventMeta({ id: seq })`. Das Client-Retry-Plugin verbindet sich mit `lastEventId` neu. Der Server liest verpasste Events aus SQLite und geht dann live. Bei einem Reconnect geht kein Event verloren, auch nicht nach einem Neuladen der Seite.
- **Draft-Modell:** Die UI-Seiten bearbeiten Abschnitte eines serverseitigen Drafts (`spec.patchDraft`), keinen lokalen State. Review & Apply zeigt den Diff zwischen Draft und angewandter Spec plus den Provider-Plan. CLI und UI sehen denselben Draft.
- **Static Serving:** Hono liefert den eingebetteten Export aus: `_next/static/*` mit `Cache-Control: immutable`, HTML mit `no-cache`, RSC-Payloads (`*.txt`) mit korrektem Content-Type, unbekannte Pfade als `404.html`. Next 16 hat ein offenes Issue mit 404 beim Prefetch dieser Payloads (#85374); tritt es auf, wird Prefetch abgeschaltet.
- **Health:** `/healthz` ohne Auth (nur „ok“), `/readyz` prüft DB, Docker und Tailscale.

## 15. UI (Next.js)

### 15.1 App-Architektur

- **Statische Shells, Daten im Client:** Alle Seiten werden beim Build als Shell gerendert; Daten kommen über TanStack Query und oRPC. Root-Layout: `ThemeProvider` (next-themes), `QueryClientProvider`, `NuqsAdapter`, `TooltipProvider`, `Toaster` (sonner).
- **Routing:** nur statische Segmente. Details über Search Params (`/runs/?id=`), die Workspace-Auswahl ab v0.4 über `?ws=`. Komponenten mit Search Params stehen in `<Suspense>`.
- **Gates im Client:** `auth.me` liefert 401 → `/login/` (nur beim SSH-Tunnel relevant, über das Tailnet ist man automatisch angemeldet). `secrets.status` ist sealed → `/unlock/`. Durchgesetzt wird beides serverseitig; die Gates im Client dienen nur der Navigation.
- **Formulare:** eine Seite pro Spec-Abschnitt, Schema direkt aus `packages/spec`, also dieselben Regeln wie in der CLI. Autosave in den Draft mit Debounce und Hinweis „Entwurf gespeichert“. Serverfehler landen per `setError` am passenden Feld.
- **Keine Geschäftslogik im Frontend.** Plan, Diff und Validierung mit Server-State laufen über die API.
- **Sprache:** Englisch (entschieden), kein i18n in v1.

### 15.2 Design System (`packages/ui`)

- **Basis:** `shadcn init --monorepo`. Vendored shadcn-Komponenten liegen upstream-nah in `packages/ui/src/components` (`@workspace/ui/components/*`), eigene Bausteine in `packages/ui/src/composites` (`@workspace/ui/composites/*`), die voll gelintet werden. Tailwind-v4-Tokens (OKLCH, Light und Dark) in `packages/ui/src/styles/globals.css`, die App bindet sie per `@source` ein.
- **Primitive:** Radix (`shadcn init -b radix`), entschieden; die eingeplanten Registries (Dice UI, tablecn) setzen darauf auf.
- **shadcn-Kern:** Sidebar (Block), Breadcrumb, Button, Button Group, Input, Input Group, Field, Select, Combobox, Checkbox, Switch, Tabs, Card, Badge, Alert, Dialog, Alert Dialog, Sheet, Dropdown Menu, Tooltip, Popover, Command, Table, Skeleton, Spinner, Empty, Item, Kbd, Progress, Scroll Area, Accordion, Collapsible, Chart, Sonner.
- **Registries** (namespaced in `components.json`, z. B. `"@diceui": "https://diceui.com/r/{name}.json"`):
  - tablecn (`@diceui/data-table`): Data Table mit Filter- und Sortierlisten, URL-State über nuqs
  - Dice UI: Tags Input (Paketlisten), Stepper (Onboarding), Sortable (Repo-Reihenfolge), File Upload (Spec- und Key-Import)
- **Eigene Composites:**

  | Komponente | Zweck |
  |---|---|
  | `StatusBadge` | ok, warn, fail, running, sealed, drift |
  | `ProviderStatusCard` | Status, letzter Check, Hinweis zur Behebung |
  | `PlanTable` | Change-Liste mit op-Badges, destruktive Änderungen hervorgehoben |
  | `SpecDiff` | Draft gegen angewandt, CodeMirror Merge View |
  | `SpecEditor` | YAML mit Zod-Diagnostik, optional Schema-Autocomplete |
  | `LogTerminal` | xterm mit Follow-Modus, Suche, Download, Resume-Anzeige |
  | `BuildSteps` | Build-Schritte aus buildx rawjson mit Dauer und Cache-Treffern |
  | `RunTimeline` | Provider-Ablauf eines Runs |
  | `SecretField` | write-only, zeigt „gesetzt · Fingerprint“ |
  | `CopyField` | SSH Public Key, Befehle, URLs |
  | `ResourceMeter`, `KeyValueList`, `PageHeader`, `ConfirmDestructive` | Layout und Bestätigungen |

- **Regeln:** Komponenten werden per CLI in `packages/ui` kopiert (Code-Ownership, keine Runtime-Abhängigkeit). Updates laufen über `shadcn add … --diff` mit Review. Registry-Code wird vor der Übernahme gelesen.
- **Storybook** als Katalog mit einer Story pro Zustand, Light und Dark, MSW-Mocks aus dem Contract, a11y-Addon in CI.
- **shadcn MCP Server** in `.mcp.json` des Repos (`npx shadcn@latest mcp`), damit Claude Code Komponenten aus den Registries direkt findet und installiert.

### 15.3 Seiten

| Seite | Zweck | Wichtige Komponenten |
|---|---|---|
| Login, Unlock | Einmal-Link einlösen, Passphrase eingeben | Card, Field, Input Group |
| Onboarding | erster Start: Unlock einrichten, Tailscale prüfen, Workspace aus Vorlage oder YAML-Import | Stepper, File Upload |
| Übersicht | Provider-Status, letzter Run, Ressourcen, Drift | ProviderStatusCard, ResourceMeter, RunTimeline |
| Environment | Host-Fakten, Warnungen, Tailscale, Firewall | KeyValueList, Alert |
| Image & Toolchains | Base Image, apt-Pakete, mise-Tools, Agent CLIs | Tags Input, Combobox, Field |
| Repos | Liste, Setup- und Testkommandos, Git-Status | Data Table, Sortable, Sheet |
| Credentials | Secrets, SSH Key, Forge-Konten | SecretField, CopyField |
| Agents & LLM | Claude Code, Codex, Gemini, MCP-Registry, LLM | Tabs, Field |
| Services | postgres, playwright, android, … | Card-Grid, Switch |
| Tools | Gemeinsamer Admin (E-Mail, Name, Benutzername, Passwort), Plane-Workspace und -Projekt, Versionen; Status pro Tool (Bootstrap, erreichbar) | Field, SecretField, StatusBadge, CopyField |
| Apps | Startseite und Sidebar-Gruppe mit „Öffnen“-Buttons für CloudCLI, Plane, MetaMCP (neuer Tab), Status je App | Card, Button, StatusBadge |
| Automation | Schalter, Label, Intervall, Parallelität, Projekt→Repo, Task-Tabelle mit Links zu Plane und CloudCLI-Session | Switch, Field, Data Table, StatusBadge |
| Review & Apply | Diff, Plan, Bestätigung, Live-Log, Verify-Ergebnis | SpecDiff, PlanTable, LogTerminal, BuildSteps |
| Runs | Historie mit Filtern, Log-Replay, Audit (wer, wann, Plan-Hash) | Data Table, LogTerminal |
| Spec (YAML) | Editor für Power-User, Import und Export | SpecEditor |
| Settings | Sessions, erlaubte Tailscale-Logins, Theme | Table, Field |

## 16. CLI

| Befehl | Zweck |
|---|---|
| `agentbox bootstrap [-f host.yaml]` | frische VM einrichten (root) |
| `agentbox up` | Dienst im Vordergrund, so startet ihn auch systemd |
| `agentbox unlock [--passphrase-file …]` | Secret Store entsperren |
| `agentbox login-link` | Einmal-Link für den Browser über SSH Tunnel |
| `agentbox plan -f workspace.yaml` | Plan als farbiger Diff; Exit 2 bei Änderungen, damit CI-tauglich |
| `agentbox apply -f workspace.yaml [--auto-approve] [--allow-destroy]` | Plan, Bestätigung, Apply mit Live-Log |
| `agentbox verify` | alle Verify-Checks (Doctor) |
| `agentbox exec [--adopt] -- <cmd>` | ad hoc im workspace-Container, optional Übernahme in die Spec |
| `agentbox shell` | interaktive Shell im workspace-Container |
| `agentbox secrets set\|list\|rm\|export` | Store verwalten, Werte nur per Prompt oder stdin |
| `agentbox runs ls\|show\|logs <id>` | Historie und Log-Replay |
| `agentbox spec validate\|schema\|fmt` | Validierung, JSON Schema, Formatierung |
| `agentbox dev` | Entwicklung: API plus Proxy auf `next dev` |

Jeder Befehl hat eine menschenlesbare Ausgabe (clack, picocolors) und `--json` für Skripte. Exit-Codes sind dokumentiert.

## 17. Security-Checkliste

- [ ] Kein öffentlicher Port auf der VM außer SSH (ufw plus DigitalOcean Cloud Firewall). Alle Web-UIs (agentbox, CloudCLI, Plane, MetaMCP) nur über das Tailnet; kein Funnel.
- [ ] `web.sock` lehnt Funnel-Requests (`Tailscale-Funnel-Request`) ab.
- [ ] CloudCLI, MetaMCP und Plane: Admin wird vor dem ersten `tailscale serve` angelegt, Registrierung danach zu; keine veröffentlichten DB-Ports; kein Docker-Socket in den Containern.
- [ ] Docker bindet per Default auf Loopback (`ip` und `default-network-opts`). Der Compose-Renderer lehnt Ports ohne `127.0.0.1` und `network_mode: host` ab, ohne Ausnahme.
- [ ] `--privileged` nur für Redroid, sichtbar als Ausnahme im Plan.
- [ ] systemd-Hardening: `NoNewPrivileges`, `ProtectSystem=strict`, `ReadWritePaths=/srv/agentbox`, `RuntimeDirectory=agentbox`, `PrivateTmp`, `ProtectHome`, `RestrictSUIDSGID`, `LockPersonality`, `Restart=on-failure`.
- [ ] Secrets: age-Store, versiegelter Start, Klartext nur auf tmpfs, Redaction, write-only API, nie als CLI-Argument.
- [ ] Auth: Tailscale-Identität nur auf `web.sock`, Token und Session auf Loopback, Host-Allowlist, CSRF, CSP, Rate-Limit.
- [ ] Audit-Log: jede Mutation mit Identität, Zeit und Plan-Hash.
- [ ] Supply Chain: Base Images per Digest, gepinnte Tool-Versionen plus `mise.lock`, Renovate, `bun install --frozen-lockfile`, Release-Binaries mit SHA256SUMS und cosign-Signatur, SBOM für das workspace Image.
- [ ] Git: Repo-URLs strikt validiert (nur `ssh://`, `git@host:pfad`, `https://`), `GIT_ALLOW_PROTOCOL=ssh:https`, simple-git aktuell.
- [ ] Keine Secrets in Images: Build-Secrets nur über `--mount=type=secret`.

## 18. Teststrategie

| Ebene | Werkzeug | Inhalt |
|---|---|---|
| Unit | `bun test` | Spec (Parsing, Normalisierung, Migration), Planner, DAG-Runner (Fehler, Abbruch), Redaction |
| Golden Files | `bun test` Snapshots, hadolint, `docker compose config -q` | Dockerfile, compose.yaml, mise.toml, Agent-Configs, AGENTS.md und CLAUDE.md pro Beispiel-Spec |
| Provider | Fakes für `Exec` und `DockerClient` | `detect` und `plan` ohne Docker testbar, Antworten aufgezeichnet |
| Integration | CI-Runner mit Docker | Minimal-Spec (Ubuntu, node, öffentliches Repo) gegen einen echten Daemon; Idempotenz: zweiter Apply ist nur `noop` |
| UI | Vitest, Storybook-Vitest-Addon (Browser Mode), MSW | Komponenten und Seiten mit Mocks aus dem Contract |
| E2E | Playwright gegen das kompilierte Binary | Onboarding, Draft bearbeiten, Plan, Apply mit Live-Log, Reconnect ohne Lücke |
| VM-E2E (nightly) | `doctl`, ephemerer Tailscale-Key mit `tag:agentbox-ci` | Droplet anlegen, `bootstrap`, `apply` Golden Spec, `verify` grün, Zugriff per Tailnet-HTTPS, Droplet löschen |
| Contract (nightly) | gegen gepinnte Versionen | CloudCLI (Register, API-Key, `/api/agent`), MetaMCP (Bootstrap, Endpoint mit Token, Claude Code `tools/list`), Plane (Shell-Bootstrap, REST v1), Automat Ende-zu-Ende mit Fake-Ticket; Agent CLIs |

Coverage-Ziele: Engine und Spec mindestens 90 %, Provider-Logik mindestens 70 %. Die UI wird über Stories und E2E abgesichert, nicht über Prozentzahlen.

## 19. CI/CD und Release

- **Pipeline** (GitHub Actions): Install (frozen lockfile) → Biome → Typecheck → dependency-cruiser → Unit → Web-Build → Golden Files und hadolint → Binaries für x64 und arm64 → Integration mit Docker → Artefakte.
- **Nightly:** VM-E2E und Contract-Tests. Renovate-PRs für CloudCLI, MetaMCP, Plane und Agent CLIs werden erst nach grünem Nightly gemergt.
- **Release:** Changesets → Tag → Binaries, `SHA256SUMS` und cosign-Signatur (keyless) → Release-Seite. `install.sh` lädt das Binary, prüft Checksumme und Signatur und legt es nach `/usr/local/bin`. `agentbox self-update` (v0.2) prüft ebenfalls die Signatur.
- Optional: Turborepo Remote Cache.

## 20. Phasenplan

Jede Phase endet mit einem prüfbaren Exit-Kriterium. Die Arbeitspakete (P…) und Spikes (S…) sind so geschnitten, dass sie sich direkt als Tickets anlegen lassen.

### Phase 0 – Fundament (Walking Skeleton)

**Stand 24.09.2026:** umgesetzt bis auf Storybook (P0.2) und den Tailscale-Spike S1 (P0.6, braucht eine VM). Verifiziert: Static Export mit Turbopack; Binary für darwin-arm64, linux-x64 und linux-arm64 mit eingebetteter UI; Migrationen aus dem Bundle; Login-Link, Unlock und Session über Neustarts; Live-Log mit Resume ohne Lücke, auch durch den Dev-Proxy; Tailscale-Listener akzeptiert nur Logins aus der Allowlist. Offen gegen einen echten Docker-Daemon: der Smoke-Job in `.github/workflows/ci.yml` prüft das bei jedem Push.

Abweichungen bei der Umsetzung: dockerode wird mit `trustedDependencies: []` installiert und `cpu-features`/`*.node` werden beim Kompilieren externalisiert (ssh2 lädt sie optional). Login-Link und Logout sind Hono-Routen statt RPC, weil sie Cookies setzen und umleiten.


Ziel: die riskanten Integrationen einmal durchstechen, bevor Features entstehen.

- **P0.1** Monorepo: Bun Workspaces, Turborepo, Biome, TypeScript strict, dependency-cruiser, lefthook, Changesets, Renovate, ADR-Vorlage
- **P0.2** `packages/ui` per `shadcn init --monorepo`, Theme, App-Shell (Sidebar, Header, Command Palette), Storybook; Entscheidung Radix oder Base UI
- **P0.3** `apps/web` als Static Export mit `NuqsAdapter`, Query Client, Login- und Unlock-Seite als Stub
- **P0.4** `apps/agentbox`: Hono, oRPC (eine Query, ein Event Iterator mit Resume), SQLite mit einer Drizzle-Migration, pino
- **P0.5** Binary-Build mit `--asset` auf x64 und arm64: dockerode-Ping (mit `--omit=optional`), age-Roundtrip, SQLite und Migration im kompilierten Binary, Auslieferung des Exports
- **P0.6** Spike S1 Tailscale: `serve` auf Unix Socket, Identity-Header, `--operator`, Fall „HTTPS nicht aktiviert“
- **P0.7** CI-Pipeline bis zum Binary-Artefakt

**Exit:** Binary läuft auf einer frischen DO-VM. Die UI ist über `https://<node>.<tailnet>.ts.net` erreichbar, die Anmeldung erfolgt über die Tailscale-Identität, und der Live-Stream überlebt einen Reconnect ohne Lücke.

### v0.1 – Leere VM zu arbeitsfähigem Workspace

- **P1.1** `packages/spec`: Workspace- und Host-Schema, YAML mit Positionen, Normalisierung, JSON Schema, semantische Checks
- **P1.2** `packages/engine`: Provider SDK, DAG-Runner, Plan-Hash, Lock, Events, Redaction, Abbruch
- **P1.3** `packages/infra`: Exec (Prozessgruppen), Docker, buildx (rawjson), compose, Secret Store, Detektion
- **P1.4** Host-Provider und `agentbox bootstrap`: User, FS, Docker, ufw, Tailscale, systemd
- **P1.5** Workspace-Provider: image (apt, mise, Claude Code), browser (Baustein steht, Abschnitt 9a), credentials, git/ssh, stack (nur workspace-Container), repos, agents.claude_code
- **P1.6** API: auth, secrets, spec mit Draft, runs, providers
- **P1.7** UI: Onboarding, Übersicht, Environment, Image & Toolchains, Repos, Credentials, Agents (Claude), Review & Apply, Runs
- **P1.8** CLI: bootstrap, up, unlock, login-link, plan, apply, verify, shell, exec (ohne `--adopt`), secrets, runs, spec
- **P1.9** Tests: Golden Files, Integration mit Docker, erster VM-E2E

**Exit:** Auf einer frischen VM führen `install.sh`, `sudo agentbox bootstrap` und `agentbox apply -f templates/example.yaml` zu durchgehend grünen Checks. `claude` arbeitet im workspace-Container im geklonten Repo. Ein zweiter Apply ist reines `noop`. Derselbe Ablauf funktioniert vollständig über die UI.

### v0.2 – Werkzeug-Stack, Automat und Kontext

- **S3** Stack-Spike gegen echte Images: Plane-Shell-Bootstrap, MetaMCP-tRPC-Bootstrap, Claude Code ↔ `mcp-gateway` ↔ MetaMCP mit Token, CloudCLI `/api/agent` mit Session-Link. Ergebnis als ADR.
- **P2.1** Provider `cloudcli`, `metamcp`, `plane` (Compose, Secrets, Bootstrap-Clients), `expose` für alle Tool-Ports
- **P2.2** Automat Plane→CloudCLI (`packages/automation`), Seiten Tools, Apps, Automation
- **P2.3** Services postgres und playwright (Compose-Katalog, Healthchecks, `--wait`)
- **P2.4** Context Generator und MCP-Renderer (Claude über MetaMCP, Codex, Gemini)
- **P2.5** agents.codex, agents.gemini
- **P2.6** `exec --adopt`, Drift-Verify per croner mit Anzeige in der Übersicht
- **P2.7** Registry-Push und BuildKit-Registry-Cache (DigitalOcean), `self-update`

**Exit:** Nach dem Ausfüllen der Seite „Tools“ und einem Apply sind CloudCLI, Plane und MetaMCP im Tailnet erreichbar und aus der agentbox-UI zu öffnen; Registrierung ist überall zu; Claude Code in CloudCLI sieht die Plane-Tools über MetaMCP; ein mit `claude` gelabeltes Todo wandert ohne Eingriff über „In Progress“ nach „In Review“, mit Kommentaren und Link zur Session.

### v0.3 – Mobile und Automation

- **S4** Android-Spike auf der Ziel-Droplet-Größe: `/dev/kvm` und seine Performance, binder im DigitalOcean-Kernel
- **P3.1** Android Provider mit beiden Backends von Anfang an: KVM mit docker-android, sonst Redroid (`--privileged`, `androidboot.use_memfd=1`); ws-scrcpy über `expose`; `adb` aus workspace und Paperclip-Container
- **P3.2** Automat ausbauen: MRs/PRs aus der Session (gitbeaker, octokit), Webhooks statt Polling, sobald Plane interne Ziele erlaubt; Abbruch laufender Sessions aus der UI.

**Exit:** Eine Flutter-App läuft im Emulator oder in Redroid und ist im Browser über das Tailnet sichtbar. Ein markiertes Plane-Ticket führt ohne Eingriff zu einem MR mit grünen Tests.

### v0.4 – Mehrere Workspaces und Portabilität

- **P4.1** Mehrere Workspaces in UI (`?ws=`) und CLI (`--workspace`), Ressourcen-Limits pro Workspace
- **P4.2** Export und Import von Specs (nur Refs), verschlüsseltes Secret-Backup
- **P4.3** Importer für `devcontainer.json` (`jsonc-parser`, Features auf mise und apt abbilden, `postCreateCommand` als Repo-Setup)
- **P4.4** Snapshot und Restore: Spec, Image-Digest, Repo-Bundles, Volume-Dumps (postgres per `pg_dump`), optional Droplet-Snapshot per DigitalOcean API

**Exit:** Zwei Workspaces laufen isoliert parallel. Ein Export lässt sich auf einer zweiten VM importieren und ist nach `unlock` und `apply` identisch.

## 21. Risiken

| # | Risiko | Gegenmaßnahme |
|---|---|---|
| 1 | Drei schnelllebige Fremd-Tools mit eigener Auth (CloudCLI mit Shell-API und kritischen Advisories 2026, MetaMCP ohne RBAC, Plane mit 13 Containern) | Versionen pinnen, Contract-Tests nightly, nur Tailnet, Registrierung zu, Admin vor dem Freischalten, Renovate mit Vulnerability Alerts |
| 1a | MetaMCP-Bug #277: Claude Code ignoriert den Bearer-Token wegen OAuth-Discovery | `mcp-gateway` blockt `/.well-known/oauth-*`; Contract-Test prüft `tools/list` aus Claude Code |
| 1b | Ressourcen: Plane allein 4–8 GB RAM | Mindestgröße der VM 8 GB, empfohlen 16 GB; Detektion warnt |
| 2 | Image-Größe (Flutter, Android SDK, CloudCLI-Build-Abhängigkeiten) | Layer-Reihenfolge, Registry-Cache, Push statt Neubau pro VM, Disk-Warnung, Prune-Policy per Label |
| 3 | Bun-Kompilat mit nativen Modulen (dockerode, ssh2), `--asset` ist neu | Phase 0 prüft das Binary auf beiden Architekturen; Fallback: Docker API direkt per `fetch` mit der `unix`-Option von Bun |
| 4 | Grenzen des Next.js Static Exports, RSC-Prefetch-Issue in 16.x | Routing über Search Params, E2E gegen das Binary, Prefetch abschaltbar |
| 5 | Tailscale als einziger Zugang | SSH-Fallback mit Login-Link bleibt immer; tailnet-only SSH nur nach Verifikation und mit Rückfall-Timer |
| 6 | KVM auf DigitalOcean nicht garantiert, binder im DO-Kernel unklar | Redroid-Fallback ab Tag 1, Spike S4 vor v0.3; notfalls Android auf eigenem Host |
| 7 | Devcontainer-Neuerfindung | Importer in v0.4; die Spec bleibt bewusst kleiner als devcontainer |
| 8 | Volatile Libraries: oRPC v2 (neues Wire-Format), shadcn-Wechsel zu Base UI, simple-git v4, systeminformation v6 | Versionen pinnen, Upgrades als eigene Arbeitspakete, Contract in einem Paket gekapselt |
| 9 | Agents ändern Repos parallel zu einem Apply | Repos nie hart zurücksetzen, Apply fasst nur eigene Ressourcen an |

## 22. Entscheidungen

Entschieden am 24.09.2026:

1. **Agent-Oberfläche:** CloudCLI + MetaMCP + Plane mit eigenem Automaten (10.10.2026, ADR 0007; ersetzt OpenHands und Paperclip). Alles nur im Tailnet.
2. **shadcn-Primitive:** Radix (`shadcn init -b radix`).
3. **UI-Sprache:** Englisch, kein i18n in v1.
4. **Repo und CI:** GitHub mit GitHub Actions.

Noch offen:

5. **SSH nur über das Tailnet** als Default oder als Opt-in.
6. **Auto-Unlock nach Reboot** über `systemd-creds` erlauben (Komfort gegen Schutz).
