# 0005 – OpenHands target: Agent Canvas

- Status: superseded by 0006, then by 0008
- Date: 2026-09-24

## Decision

Integrate Agent Canvas with the agent-server Docker runtime. The legacy Local GUI stays only as
an emergency fallback behind the same `HarnessAdapter`. Spike S3 (start of v0.2) settles where
Canvas runs, port handling and the sandbox image build.

## Consequences

agentbox builds the sandbox image (agent-server layered on the workspace image) and configures
LLM and MCP through the settings API. The Docker runtime shipped on 2026-09-16, so versions are
pinned and covered by nightly contract tests.
