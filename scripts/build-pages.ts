// Assembles the GitHub Pages site into _site/:
//
//   landing/*                      -> /            (product page, without its README)
//   docs/plan/00-master-plan.md    -> /docs/plan/
//   docs/adr/NNNN-*.md             -> /docs/adr/NNNN-*/
//   (index of all documents)       -> /docs/
//
// Pages share the landing page's tokens and font; links stay relative so the site also works
// below another path. `bun scripts/build-pages.ts`, then serve _site/ under /agentbox/.
import { cp, mkdir, readdir, rm } from "node:fs/promises"
import { join, relative } from "node:path"
import { Marked } from "marked"

const root = join(import.meta.dir, "..")
const out = join(root, "_site")
const repo = "https://github.com/MaxGierlachowski/agentbox"

await rm(out, { recursive: true, force: true })
await mkdir(out, { recursive: true })
await cp(join(root, "landing"), out, {
  recursive: true,
  filter: (src) => relative(join(root, "landing"), src) !== "README.md",
})

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")

function render(markdown: string, sourcePath: string) {
  const marked = new Marked({ gfm: true })
  const seen = new Map<string, number>()
  const toc: { depth: number; text: string; id: string }[] = []
  marked.use({
    renderer: {
      heading({ tokens, depth }) {
        const html = this.parser.parseInline(tokens)
        let id = slug(html)
        const n = seen.get(id) ?? 0
        seen.set(id, n + 1)
        if (n) id = `${id}-${n}`
        if (depth === 2 || depth === 3) toc.push({ depth, text: html.replace(/<[^>]+>/g, ""), id })
        return `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true">#</a>${html}</h${depth}>\n`
      },
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens)
        // Links between repo files point to GitHub (docs pages are rendered copies).
        let target = href
        if (!/^(https?:|#|mailto:)/.test(href)) {
          target = `${repo}/blob/main/${join(sourcePath, "..", href).replace(/:(\d+)$/, "#L$1")}`
        }
        return `<a href="${target}"${title ? ` title="${title}"` : ""}>${text}</a>`
      },
    },
  })
  const html = marked.parse(markdown) as string
  return { html, toc }
}

function page(o: {
  title: string
  lang: string
  depth: number
  body: string
  toc?: { depth: number; text: string; id: string }[]
  source?: string
}) {
  const up = "../".repeat(o.depth)
  const toc = o.toc?.length
    ? `<aside class="toc"><b>Contents</b><ol>${o.toc
        .map((t) => `<li class="d${t.depth}"><a href="#${t.id}">${t.text}</a></li>`)
        .join("")}</ol></aside>`
    : ""
  return `<!doctype html>
<html lang="${o.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${o.title} · agentbox</title>
<meta name="color-scheme" content="light dark">
<link rel="icon" type="image/svg+xml" href="${up}favicon.svg">
<style>
@font-face { font-family: "Geist"; src: url("${up}assets/fonts/geist-latin.woff2") format("woff2"); font-weight: 100 900; font-display: swap; }
:root { --bg:#fafafa; --surface:#fff; --surface-2:#f4f4f5; --border:#e4e4e7; --fg:#09090b; --muted:#71717b; --accent:#615fff; --accent-ink:#4f39f6; --code-bg:#111113; --code-fg:#e4e4e7; }
@media (prefers-color-scheme: dark) { :root { --bg:#09090b; --surface:#111113; --surface-2:#18181b; --border:#27272a; --fg:#fafafa; --muted:#9f9fa9; --accent:#7c7aff; --accent-ink:#a3a1ff; --code-bg:#0c0c0e; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.65 "Geist", -apple-system, "Segoe UI", Roboto, sans-serif; -webkit-font-smoothing: antialiased; }
a { color: var(--accent-ink); text-decoration: none; } a:hover { text-decoration: underline; text-underline-offset: 3px; }
nav.top { position: sticky; top: 0; z-index: 10; backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); background: color-mix(in srgb, var(--bg) 82%, transparent); border-bottom: 1px solid var(--border); }
nav.top .in { max-width: 1240px; margin: 0 auto; padding: 0 24px; height: 58px; display: flex; align-items: center; justify-content: space-between; gap: 16px; font-size: 14px; }
.brand { display: flex; align-items: center; gap: 10px; font-weight: 650; color: var(--fg); } .brand img { width: 26px; height: 26px; }
nav.top .links { display: flex; gap: 20px; } nav.top .links a { color: var(--muted); }
.layout { max-width: 1240px; margin: 0 auto; padding: 40px 24px 80px; display: grid; grid-template-columns: minmax(0, 1fr) 260px; gap: 48px; }
@media (max-width: 1000px) { .layout { grid-template-columns: 1fr; } .toc { display: none; } }
article { min-width: 0; }
article h1 { font-size: clamp(30px, 4vw, 42px); line-height: 1.1; letter-spacing: -.03em; margin: 0 0 18px; }
article h2 { font-size: 26px; letter-spacing: -.02em; margin: 52px 0 14px; padding-top: 18px; border-top: 1px solid var(--border); }
article h3 { font-size: 19px; margin: 32px 0 10px; } article h4 { margin: 24px 0 8px; }
h1, h2, h3, h4 { position: relative; scroll-margin-top: 76px; }
.anchor { position: absolute; left: -1em; color: var(--muted); opacity: 0; font-weight: 400; } h2:hover .anchor, h3:hover .anchor { opacity: 1; text-decoration: none; }
article p, article li { color: color-mix(in srgb, var(--fg) 86%, var(--muted)); }
code { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: .87em; }
:not(pre) > code { background: var(--surface-2); border: 1px solid var(--border); border-radius: 6px; padding: .08em .35em; }
pre { background: var(--code-bg); color: var(--code-fg); border: 1px solid #27272a; border-radius: 12px; padding: 16px 18px; overflow-x: auto; font-size: 13px; line-height: 1.6; }
.table { overflow-x: auto; margin: 18px 0; border: 1px solid var(--border); border-radius: 12px; }
table { border-collapse: collapse; width: 100%; font-size: 14px; }
th, td { text-align: left; vertical-align: top; padding: 9px 12px; border-bottom: 1px solid var(--border); }
th { background: var(--surface-2); font-weight: 600; } tr:last-child td { border-bottom: 0; }
blockquote { margin: 18px 0; padding: 4px 18px; border-left: 3px solid var(--accent); color: var(--muted); }
hr { border: 0; border-top: 1px solid var(--border); margin: 36px 0; }
.toc { position: sticky; top: 82px; align-self: start; max-height: calc(100vh - 100px); overflow: auto; font-size: 13.5px; }
.toc b { display: block; margin-bottom: 8px; } .toc ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 5px; }
.toc a { color: var(--muted); } .toc a:hover { color: var(--fg); } .toc .d3 { padding-left: 14px; font-size: 13px; }
.meta { color: var(--muted); font-size: 14px; margin-bottom: 28px; }
.cards { display: grid; gap: 10px; margin-top: 18px; }
.cards a { display: flex; justify-content: space-between; gap: 14px; padding: 14px 18px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); color: var(--fg); }
.cards a:hover { text-decoration: none; border-color: var(--muted); } .cards span { color: var(--muted); font-size: 13px; }
footer { border-top: 1px solid var(--border); color: var(--muted); font-size: 14px; } footer .in { max-width: 1240px; margin: 0 auto; padding: 28px 24px 48px; }
</style>
</head>
<body>
<nav class="top"><div class="in"><a class="brand" href="${up}"><img src="${up}favicon.svg" alt="" width="26" height="26">agentbox</a><div class="links"><a href="${up}docs/">Docs</a><a href="${up}docs/plan/">Plan</a><a href="${repo}">GitHub</a></div></div></nav>
<div class="layout"><article>${o.source ? `<p class="meta">Rendered from <a href="${repo}/blob/main/${o.source}"><code>${o.source}</code></a></p>` : ""}${o.body}</article>${toc}</div>
<footer><div class="in">agentbox · MIT license · <a href="${up}">Product page</a></div></footer>
</body>
</html>
`
}

const wrapTables = (html: string) =>
  html.replaceAll("<table>", '<div class="table"><table>').replaceAll("</table>", "</table></div>")

async function write(path: string, html: string) {
  await mkdir(join(out, path), { recursive: true })
  await Bun.write(join(out, path, "index.html"), html)
}

// Implementation plan
const planSource = "docs/plan/00-master-plan.md"
const plan = render(await Bun.file(join(root, planSource)).text(), planSource)
await write(
  "docs/plan",
  page({
    title: "Implementierungsplan",
    lang: "de",
    depth: 2,
    body: wrapTables(plan.html),
    toc: plan.toc,
    source: planSource,
  }),
)

// Decision records
const adrs: { file: string; title: string; status: string }[] = []
for (const file of (await readdir(join(root, "docs/adr"))).sort()) {
  if (!file.endsWith(".md") || file.startsWith("0000-")) continue
  const source = `docs/adr/${file}`
  const md = await Bun.file(join(root, source)).text()
  const title = md.match(/^# (.+)$/m)?.[1] ?? file
  const status = md.match(/^- Status: (.+)$/m)?.[1] ?? ""
  adrs.push({ file: file.replace(/\.md$/, ""), title, status })
  const { html } = render(md, source)
  await write(
    `docs/adr/${file.replace(/\.md$/, "")}`,
    page({ title, lang: "en", depth: 3, body: wrapTables(html), source }),
  )
}

// Index
const index = `<h1>Documents</h1>
<p>Everything written down so far. The implementation plan is the full design; the decision records explain why it looks the way it does.</p>
<div class="cards">
<a href="plan/"><b>Implementation plan</b><span>Architecture, host layout, access, onboarding, catalog, acceptance test</span></a>
<a href="${repo}/blob/main/README.md"><b>README</b><span>on GitHub</span></a>
<a href="${repo}/blob/main/AGENTS.md"><b>AGENTS.md</b><span>repository rules for humans and coding agents</span></a>
</div>
<h2 id="adr">Decision records</h2>
<div class="cards">${adrs.map((a) => `<a href="adr/${a.file}/"><b>${a.title}</b><span>${a.status}</span></a>`).join("")}</div>`
await write("docs", page({ title: "Documents", lang: "en", depth: 1, body: index }))

console.log(`built _site/ with ${adrs.length} decision records`)
