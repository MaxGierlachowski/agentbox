# landing/ – the website at the root of GitHub Pages

`index.html` is the product page at <https://maxgierlachowski.github.io/agentbox/>. Its look follows
[Hermes UI](https://maxgierlachowski.github.io/hermes-ui/) (same tokens, font and components).

`scripts/build-pages.ts` assembles the site (`.github/workflows/pages.yml` runs it):

| Source | Published at |
|---|---|
| `landing/*` (without this README) | `/` |
| `docs/plan/00-master-plan.md` | `/docs/plan/` |
| `docs/adr/NNNN-*.md` (without the template) | `/docs/adr/NNNN-*/` |
| generated index | `/docs/` |

Local preview: `bun scripts/build-pages.ts`, then serve `_site/` under `/agentbox/`, so that relative
paths match GitHub Pages.

## Rules for the page

- Self-contained: inline CSS and JS, no external fonts, scripts, images, cookies or trackers. Geist is
  served from `assets/fonts/` (OFL, see `OFL-Geist.txt`).
- Light and dark through `prefers-color-scheme`. The screenshots come from a real box in the light
  theme and are shown in both. `prefers-reduced-motion` disables the reveal animation.
- Generic product, no company names; screenshots show made-up demo data only.
- Name every project the box installs, with link, licence and its job; keep versions in step with
  `packages/providers/src/host/components.ts` and `docs/release-notes.md`.
- Relative links only (`docs/`, `assets/…`), so the site also works below another path or domain.
  Absolute URLs only where they must be (canonical, `og:image`, GitHub links).
- Honest status: the status section says what is verified automatically, what is tested by hand, and
  the known limitations from the release notes. Update it with each release.

## Assets

- `assets/shots/`: screenshots of the config UI on a real box (Playwright run of `e2e/vm/ui-smoke.ts`,
  1440 px wide, cropped to 1440×1000, demo owner `owner@example.org`), as WebP (`cwebp -q 85`):
  `claim`, `connect-ai`, `toolkit`, `browser`, `hermes-ui`, `pair-phone`.
