---
name: agentbox-repo-setup
description: Clone the user's GitHub/GitLab repos onto the box and get each one ready for agents - detect the stack, install dependencies, run the tests and write an AGENTS.md if missing. Use when the user wants to "clone my repos", "set up <repo>", or a task needs a repo that is not under ~/work yet.
license: MIT
compatibility: Runs on an Agentbox host. Needs the `agentbox` CLI, git and the repo's toolchain.
metadata:
  author: agentbox
  version: "1.0"
---

# Clone and set up repos

Repos live at `/home/agentbox/work/<host>/<owner>/<repo>`. Cloning goes through the agentbox
API; the per-repo setup is ordinary work inside the checkout.

Call the API with `agentbox api <procedure> --json '<json input>'`.

## 1. Clone

1. `repos.list {"host": "github.com"}` (or `"gitlab.com"`) lists the user's repos, most recently
   pushed first. If it fails because the CLI is not signed in, run `agentbox-auth-cli`; if SSH is
   not set up, run `agentbox-ssh`.
2. Show the top entries and let the user pick. Use the repo identifiers exactly as `repos.list`
   returns them.
3. `repos.clone {"repos": ["<id>", ...]}`. Cloning runs in the background; if the result
   contains a run id, follow it with `runs.get {"id": "<run id>"}` until it finishes. Repos that
   already exist are left untouched.

## 2. Set up each repo

When running inside Hermes with the `paseo` MCP, hand each repo to its own Paseo agent (cwd = the
repo path) with the steps below as its brief, and report back when they finish. Otherwise do the
steps yourself, one repo at a time.

1. **Read first:** `AGENTS.md`, `CLAUDE.md`, `README*`, `CONTRIBUTING*`. Follow what they say
   over anything below.
2. **Detect the stack** from lockfiles and manifests: `bun.lock`, `pnpm-lock.yaml`,
   `package-lock.json`, `yarn.lock`, `pyproject.toml`/`uv.lock`, `requirements*.txt`, `go.mod`,
   `Cargo.toml`, `Gemfile`, `pom.xml`/`build.gradle*`, `Makefile`, `Dockerfile`/`compose*.yaml`.
3. **Install dependencies** with the lockfile, frozen (`bun install --frozen-lockfile`,
   `npm ci`, `pnpm install --frozen-lockfile`, `uv sync --frozen`, `go mod download`,
   `cargo fetch`, …). If a toolchain is missing, say which and suggest `agentbox-add-tool`; do
   not install language toolchains with `curl | sh`.
4. **Run the tests** with the documented command (or the obvious one: `bun test`, `npm test`,
   `uv run pytest`, `go test ./...`, `cargo test`). Cap the run at 10 minutes. Record pass/fail
   counts; do not fix failing tests in this step.
5. **Environment:** if the app needs a `.env`, list the variable names it expects (from
   `.env.example` or the code). Never invent values and never write secrets into files.
6. **AGENTS.md:** if the repo has none, draft one (stack, how to install, test, lint and run,
   layout, conventions you observed) and save it in the working tree. Do not overwrite an
   existing AGENTS.md, and do not commit or push unless the user asks.

## Rules

- Never run deploy, publish, release or database-migration commands against real environments.
- Do not change git remotes, branches or global git config.
- Report per repo: path, stack, install result, test result, AGENTS.md written or not, open
  questions.
