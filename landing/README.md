# landing/ – the website at the root of GitHub Pages

`index.html` is the product page at <https://maxgierlachowski.github.io/agentbox/>. Its look follows
[Hermes UI](https://maxgierlachowski.github.io/hermes-ui/) (same tokens, font and components).

`scripts/build-pages.ts` assembles the site (`.github/workflows/pages.yml` runs it):

| Source | Published at |
|---|---|
| `landing/*` (without this README) | `/` |
| `docs/implementation-plan.md` | `/docs/plan/` |
| `docs/adr/NNNN-*.md` (without the template) | `/docs/adr/NNNN-*/` |
| generated index | `/docs/` |

Local preview: `bun scripts/build-pages.ts`, then serve `_site/` under `/agentbox/`, so that relative
paths match GitHub Pages.

## Rules for the page

- Self-contained: inline CSS and JS, no external fonts, scripts, images, cookies or trackers. Geist is
  served from `assets/fonts/` (OFL, see `OFL-Geist.txt`).
- Light and dark through `prefers-color-scheme`; every UI screenshot exists in both
  (`*-light.webp`, `*-dark.webp`). `prefers-reduced-motion` disables the reveal animation.
- Generic product, no company names; screenshots show made-up demo data only.
- Relative links only (`docs/`, `assets/…`), so the site also works below another path or domain.
  Absolute URLs only where they must be (canonical, `og:image`, GitHub links).
- Honest status: the roadmap section says what works, what is coded but untested, and what is planned.
  Update it with the plan.

## Assets

- `assets/shots/`: screenshots of the agentbox UI (Playwright, 1440×900, demo data, system and identity
  endpoints mocked so they show a Linux VM in a tailnet), as WebP.
- `assets/shots/agent-screenshot.webp`: a screenshot an agent took through Playwright MCP in
  `e2e/browser` (cropped).
