// Renders the title cards and overlays of the setup video as PNGs (HTML → Playwright screenshot),
// so the stitcher only needs ffmpeg's overlay/concat (no drawtext/freetype).
//
//   bun e2e/video/cards.ts <out-dir>
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { chromium } from "@playwright/test"

export const CHAPTERS = [
  {
    id: "install",
    n: 1,
    title: "Installation",
    text: "Ein Befehl auf einer frischen Ubuntu-24.04-VM installiert und verdrahtet alles.",
  },
  {
    id: "login",
    n: 2,
    title: "Erster Login",
    text: "Adresse aus der Konsole öffnen, Einmal-Code eingeben, eigenes Passwort setzen.",
  },
  {
    id: "onboarding",
    n: 3,
    title: "Onboarding",
    text: "KI-Konto verbinden und kurz sagen, woran du arbeitest.",
  },
  {
    id: "toolkit",
    n: 4,
    title: "Toolkit",
    text: "Vorkonfigurierte Skills, MCP-Server und CLIs, Suche in der Bibliothek, SOUL, GitHub-Login, SSH-Key.",
  },
  {
    id: "agents",
    n: 5,
    title: "Agents",
    text: "Agent-Profile mit eigener SOUL und der gemeinsame, eingeloggte Chrome der Box.",
  },
  {
    id: "hermes",
    n: 6,
    title: "Hermes UI",
    text: "Alles installieren, dann weiter in die Hermes UI: die erste Aufgabe ist schon vorbereitet.",
  },
  {
    id: "pair",
    n: 7,
    title: "Handy koppeln",
    text: "Handy oder Laptop per QR-Code koppeln, Ende-zu-Ende verschlüsselt über iroh.",
  },
] as const

/** Captions of the short cut, keyed by highlight label. */
export const SHORT_CAPTIONS: Record<string, string> = {
  install: "Ein Befehl auf einer frischen VM",
  claim: "Einmal-Code aus der Konsole, eigenes Passwort",
  "claude-link": "Claude-Konto verbinden",
  "toolkit-search": "Skills & MCP-Server aus der Bibliothek",
  "github-code": "GitHub-Login per Gerätecode",
  browser: "Ein gemeinsamer, eingeloggter Chrome",
  "browser-full": "Der Chrome der Box, live gestreamt",
  "install-done": "Ein Klick installiert dein Toolkit",
  "hermes-ui": "Hermes UI: erste Aufgabe bereit",
  qr: "Handy koppeln per iroh",
}

const style = `
  * { margin: 0; box-sizing: border-box; }
  body { width: 1440px; height: 900px; font-family: -apple-system, "SF Pro Display", "Helvetica Neue", Arial, sans-serif; }
  .card { width: 100%; height: 100%; display: flex; flex-direction: column; justify-content: center; padding: 0 160px;
    color: #f4f4f5; background: radial-gradient(1200px 700px at 20% 10%, #312e81 0%, #111827 55%, #09090b 100%); }
  .logo { display: flex; align-items: center; gap: 18px; font-size: 30px; font-weight: 600; letter-spacing: -.01em; color: #e4e4e7; margin-bottom: 64px; }
  .logo svg { width: 52px; height: 52px; }
  .n { font-size: 26px; font-weight: 600; color: #a5b4fc; letter-spacing: .08em; text-transform: uppercase; margin-bottom: 18px; }
  h1 { font-size: 96px; font-weight: 700; letter-spacing: -.03em; line-height: 1.02; }
  p { font-size: 36px; line-height: 1.35; color: #d4d4d8; margin-top: 30px; max-width: 1050px; }
  .small { font-size: 26px; color: #a1a1aa; margin-top: 54px; font-family: "SF Mono", Menlo, monospace; }
  .badge { position: absolute; top: 28px; right: 28px; padding: 12px 22px; border-radius: 999px; background: rgba(17,24,39,.88);
    color: #fde68a; font: 600 26px -apple-system, Arial, sans-serif; border: 2px solid rgba(253,230,138,.6); }
  .caption { position: absolute; left: 50%; top: 26px; transform: translateX(-50%); padding: 18px 34px; border-radius: 18px;
    background: rgba(17,24,39,.9); color: #fff; font: 600 38px -apple-system, Arial, sans-serif; white-space: nowrap;
    box-shadow: 0 10px 40px rgba(0,0,0,.35); }
`
const logo = `<div class="logo"><svg viewBox="0 0 24 24" fill="none" stroke="#e4e4e7" stroke-width="1.6" stroke-linejoin="round"><path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="m3 7 9 5 9-5M12 12v10"/></svg>agentbox</div>`

export async function renderCards(dir: string) {
  await mkdir(dir, { recursive: true })
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const shot = async (name: string, body: string, transparent = false) => {
    await page.setContent(
      `<html><head><style>${style}</style></head><body${transparent ? ' style="background:transparent"' : ""}>${body}</body></html>`,
    )
    await page.screenshot({ path: join(dir, `${name}.png`), omitBackground: transparent })
  }
  await shot(
    "intro",
    `<div class="card">${logo}<h1>Von der leeren VM<br>zur ersten Aufgabe</h1><p>Hermes, Paseo, Hermes UI und ein gemeinsamer Chrome, mit einem Befehl eingerichtet und über iroh von überall erreichbar.</p><div class="small">curl -fsSL https://maxgierlachowski.github.io/agentbox/install.sh | sudo AGENTBOX_UP=1 sh</div></div>`,
  )
  for (const c of CHAPTERS)
    await shot(
      `chapter-${c.id}`,
      `<div class="card">${logo}<div class="n">Kapitel ${c.n} von ${CHAPTERS.length}</div><h1>${c.title}</h1><p>${c.text}</p></div>`,
    )
  await shot(
    "outro",
    `<div class="card">${logo}<h1>Bereit für die<br>erste Aufgabe.</h1><p>Open Source. Läuft auf deiner eigenen VM.</p><div class="small">maxgierlachowski.github.io/agentbox · github.com/MaxGierlachowski/agentbox</div></div>`,
  )
  await shot("fast-x8", `<div class="badge">▶▶ ×8 Zeitraffer</div>`, true)
  await shot("fast-x24", `<div class="badge">▶▶ ×24 Zeitraffer</div>`, true)
  for (const [label, text] of Object.entries(SHORT_CAPTIONS)) {
    // The terminal clip keeps a free band at the bottom for its caption (its top is the command).
    const where = label === "install" ? ' style="top:auto;bottom:16px"' : ""
    await shot(`caption-${label}`, `<div class="caption"${where}>${text}</div>`, true)
  }
  await browser.close()
}

if (import.meta.main) await renderCards(process.argv[2] ?? join(import.meta.dir, "out", "cards"))
