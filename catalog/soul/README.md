# SOUL templates

A Hermes profile's `SOUL.md` is composed from these files:

```
soul-base.md  +  box-facts.md  +  role-<role>.md  +  user section
```

- **Default profile** (`HERMES_HOME/SOUL.md`): base + box facts + `role-orchestrator.md`, plus the
  user's roles merged in.
- **Generated profiles** (`profiles/<slug>/SOUL.md`): base + box facts + their role template +
  the profile's purpose.

Role templates: `orchestrator`, `developer`, `manager`, `ops`, `support`, `data`, `designer`
(`SoulRole` in `packages/contract/src/catalog.ts`). Bundles pick one with `soul_role`.

## Generated blocks

Text between `<!-- agentbox:generated -->` and `<!-- /agentbox:generated -->` belongs to
agentbox. When box facts change (new repos, accounts, MCP servers), only these blocks are
rewritten; edits the user made outside them survive. `box-facts.md` is one generated block and is
shown read-only in the UI.

## Placeholders

Mustache-style `{{name}}`, no sections or partials. The composer replaces every placeholder;
values are plain text (lists are comma-separated, empty values become `none`). Only the names
below are allowed; `bun scripts/catalog-validate.ts` rejects anything else. The same list is
exported as `SoulPlaceholder` from `@workspace/contract`.

| Placeholder | Filled from | Example |
|---|---|---|
| `{{agent.name}}` | Profile display name (default profile: "Hermes" or the name the user chose) | `Reviewer` |
| `{{user.name}}` | Owner name from the claim screen | `Alex` |
| `{{user.language}}` | Onboarding screen 3 | `English` |
| `{{user.timezone}}` | Onboarding screen 3 (IANA) | `Europe/Berlin` |
| `{{user.about}}` | "Describe your work" sentence | `I run a two-person SaaS.` |
| `{{user.roles}}` | Selected role cards | `developer, founder-ops` |
| `{{box.hostname}}` | Box hostname | `agentbox-7f3a` |
| `{{paseo.accounts}}` | Claude accounts registered as Paseo providers | `work, personal` |
| `{{paseo.default}}` | Default Paseo account | `work` |
| `{{repos.list}}` | Cloned repos (`<host>/<owner>/<repo>`) | `github.com/alex/app` |
| `{{browser.sites}}` | Sites marked as logged in on the browser screen | `GitHub, Google` |
| `{{clis.authed}}` | Signed-in CLIs with account | `gh (@alex), glab (@alex)` |
| `{{git.name}}` | `git config --global user.name` | `Alex Example` |
| `{{git.email}}` | `git config --global user.email` | `alex@example.com` |
| `{{mcps.list}}` | MCP servers registered for the profile | `paseo, github, context7` |
| `{{delivery.home}}` | Home channel of the profile | `slack:#agent` |
| `{{delivery.targets}}` | Channels crons may deliver to | `slack, local` |

## Adding a role template

1. Add `role-<id>.md` (10–20 lines: what the role does, its defaults, what needs approval).
2. Add `<id>` to `SoulRole` in `packages/contract/src/catalog.ts`.
3. Use only the placeholders above; run `bun run catalog:validate`.
