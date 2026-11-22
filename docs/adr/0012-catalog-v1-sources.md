# 0012 – Catalog v1 sources

- Status: accepted
- Date: 2026-11-22

## Decision

The skills/MCP/CLI library has four sources in v1: curated YAML in `catalog/` (embedded in the
binary, works offline), the official MCP Registry (live search, cached), the anthropics/skills
index (pinned SHA; the source-available document skills are not auto-installed) and Hermes'
built-in skills of the pinned tag. Role bundles preselect items. No paid directories and no
cloud ingest pipeline yet; the item schema is kept so a snapshot pipeline can come later.

## Consequences

Search works offline for curated items and degrades silently without network. Adding an item is
a reviewed pull request.
