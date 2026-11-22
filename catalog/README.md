# Curated catalog

The offline, PR-reviewed part of the agentbox catalog (tier T0). It is embedded in the binary and
drives onboarding screens 3–5 and 8, the console's catalog page and the `agentbox-*` skills.

```
catalog/
  items/*.yaml       skills, MCP servers and CLIs (CatalogItemsFile: { items: CatalogItem[] })
  bundles/*.yaml     base + one bundle per role (Bundle), file name = bundle id
  skills/agentbox-*/ agentbox's own skills (agentskills format: SKILL.md with frontmatter)
  soul/*.md          SOUL templates for Hermes profiles (see soul/README.md)
```

The schemas live in [`packages/contract/src/catalog.ts`](../packages/contract/src/catalog.ts):
`CatalogItem`, `CatalogItemsFile`, `Bundle`, `Role`, `SoulRole`, `SoulPlaceholder`.

Validate after every change:

```sh
bun run catalog:validate                                     # schema, references, skills, SOUL
bun scripts/catalog-validate.ts --hermes-repo ../hermes-agent  # also checks Hermes skill paths
```

The same check runs as a test in `packages/contract` (`bunx turbo test`).

## Items

One entry per skill, MCP server or CLI. Files are grouped by origin (`skills-hermes.yaml`,
`skills-anthropic.yaml`, `skills-agentbox.yaml`, `mcps.yaml`, `clis.yaml`); the file name does not
matter to the loader.

```yaml
- id: mcp.github                 # <kind>.<name>, lowercase, stable forever
  kind: mcp                      # skill | mcp | cli
  name: GitHub
  summary: Issues, pull requests, code search and Actions on github.com.
  source: [curated]              # curated | mcp-registry | anthropics-skills | hermes
  tier: T0                       # T0 curated · T1 official · T2 community · T3 unverified
  licence: MIT                   # SPDX id; "Proprietary" for vendor-hosted services
  roles: [developer, devops]     # role affinity for ranking (empty = everyone)
  install:
    mcp:
      transport: http            # or: stdio + command/args/env
      url: https://api.githubcopilot.com/mcp/
      headers: { Authorization: "Bearer ${gh.token}" }
  auth: { type: derived, from: cli.gh }   # none | api_key | oauth | device | derived
  env: []                        # values the user supplies: {name, secret, required?, help_url?, description?}
  targets: [hermes, paseo]       # hermes | paseo | claude
  pinned_version: null           # exact version/tag/SHA; null for hosted or distro packages
  homepage: https://github.com/github/github-mcp-server
  requires: [cli.gh]             # other items installed along with this one
  notes: ...                     # caveats shown in the UI (optional)
```

Install variants:

| Kind | `install` | Notes |
|---|---|---|
| MCP, local | `mcp: { transport: stdio, command, args, env? }` | Pin exactly: `npx -y pkg@1.2.3`, `uvx pkg==1.2.3`. `uvx` servers require `cli.uv`. |
| MCP, hosted | `mcp: { transport: http, url, headers?, oauth? }` | Only URLs the vendor documents publicly. `oauth.client_id/client_secret` for servers without dynamic client registration. |
| Skill from Hermes | `skill: { source: hermes-builtin, path, category }` | `path` inside the Hermes repo at the tag in `pinned_version`. |
| Skill from git | `skill: { source: git, repo, sha, path }` | Full 40-character commit SHA. |
| Agentbox skill | `skill: { source: agentbox, path: catalog/skills/<name> }` | Shipped in this repo. |
| CLI | `cli: { plan: cli.<name> }` | `plan` = the item id; the host installer implements it for Ubuntu 24.04 x64 and arm64. |

Placeholders in `args`, `env`, `url`, `headers` and `oauth`: `${NAME}` is an entry of the item's
`env` (secrets are rendered from the secret store at apply time), `${<cli>.token}` is the token of
an authenticated CLI (`${gh.token}`), which must be the item's `auth.from` or in `requires`.

### Adding an item

1. Check that it is public, free to use and maintained. No company-internal servers, no personal
   one-off skills, no source-available document skills (anthropics `docx`/`pdf`/`pptx`/`xlsx`).
2. Verify the install spec yourself and pin it:
   - npm: `npm view <pkg> version license bin`
   - PyPI: `curl -s https://pypi.org/pypi/<pkg>/json | jq .info.version`
   - MCP registry: `curl -s 'https://registry.modelcontextprotocol.io/v0.1/servers?search=<q>'`
   - hosted: link the vendor page that documents the URL as `homepage` or `help_url`
   - Hermes skills: `git -C <hermes> ls-tree -r --name-only <tag> -- skills optional-skills`
   - anthropics/skills: `gh api repos/anthropics/skills/commits/main --jq .sha`
3. Mark auth and env correctly; mark secrets `secret: true`. Never put a value of a secret in the
   catalog.
4. If something could not be verified, use tier `T2` and say what in `notes`.
5. Add the id to a bundle only if it fits the role for most people; put optional extras in the
   bundle's `opt_in`.
6. `bun run catalog:validate`.

## Bundles

```yaml
id: developer                     # = file name; `base` is always included
name: Developer
description: ...
roles: [developer]                # role cards that select it (empty for base)
skills: [skill.github, ...]
mcps: [mcp.github, ...]
clis: [cli.gh, ...]
opt_in: [mcp.playwright, ...]     # shown in the bundle, not preselected (must be listed above)
soul_role: developer              # role template in soul/
first_task: ...                   # prefilled in the Hermes composer after onboarding
first_task_alternatives: [..., ..., ...]   # exactly three chips
suggested_sites: [{ name, url }]  # browser login checklist (screen 9)
suggested_crons:                  # created disabled, always
  - { name, schedule, prompt, deliver: home | origin | local, skills: [], enabled: false }
```

First tasks must be concrete, safe (read or draft only) and work on a fresh box with just the
bundle installed.

## Agentbox skills

`skills/agentbox-*/SKILL.md` follow the [agentskills](https://agentskills.io/specification)
format: YAML frontmatter with `name` (= folder name) and `description` (what it does and when to
use it), then the instructions. They change the box only through
`agentbox api <procedure> --json '<input>'`; the validator rejects procedures that the API does
not have (`AGENTBOX_API_PROCEDURES` in `scripts/catalog-validate.ts`). Every skill folder needs a
matching item in `items/skills-agentbox.yaml`.
