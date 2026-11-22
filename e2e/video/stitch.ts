// Stitches the setup video from the recordings in $OUT (record-terminal.sh, record-browser.ts):
//   agentbox-setup.mp4         full walk-through with German chapter cards (1440x900, H.264)
//   agentbox-setup-short.mp4   60–90 s highlight cut with captions
//   stills/*.png               a few frames for posts
//
//   bun e2e/video/stitch.ts [final-dir]
import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { $ } from "bun"
import { CHAPTERS, renderCards, SHORT_CAPTIONS } from "./cards"

const OUT = process.env.OUT ?? join(import.meta.dir, "out")
const FINAL = process.argv[2] ?? OUT
const W = 1440
const H = 900
const FPS = 30
const ENC = [
  "-c:v",
  "libx264",
  "-preset",
  "medium",
  "-crf",
  "20",
  "-pix_fmt",
  "yuv420p",
  "-r",
  String(FPS),
]
const work = join(OUT, "work")
const cards = join(OUT, "cards")
await rm(work, { recursive: true, force: true })
await mkdir(work, { recursive: true })
await mkdir(join(FINAL, "stills"), { recursive: true })
await renderCards(cards)

interface Span {
  from: number
  to: number
}
const browser = (await Bun.file(join(OUT, "browser.json")).json()) as {
  chapters: { id: string; start: number }[]
  fast: (Span & { factor: number })[]
  highlights: (Span & { label: string })[]
}
const termFast = (await Bun.file(join(OUT, "terminal.fast.json")).json()) as (Span & {
  factor: number
})[]

let n = 0
const clip = () => join(work, `${String(n++).padStart(3, "0")}.mp4`)
const ff = (args: string[]) => $`ffmpeg -v error -y ${args}`

/** A still card, faded in and out. */
async function card(png: string, seconds: number) {
  const out = clip()
  const fadeOut = (seconds - 0.4).toFixed(2)
  await ff([
    "-loop",
    "1",
    "-t",
    String(seconds),
    "-i",
    png,
    "-vf",
    `scale=${W}:${H},fps=${FPS},fade=in:0:9,fade=out:st=${fadeOut}:d=0.4`,
    ...ENC,
    out,
  ])
  return out
}

/** A piece of a source video, optionally sped up, with PNG overlays (badge, caption). */
async function piece(
  src: string,
  from: number,
  to: number,
  opts: { factor?: number; overlays?: string[]; hold?: number } = {},
) {
  const out = clip()
  const factor = opts.factor ?? 1
  const base = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x0d1117,setpts=(PTS-STARTPTS)/${factor},fps=${FPS}${opts.hold ? `,tpad=stop_mode=clone:stop_duration=${opts.hold}` : ""}`
  const overlays = opts.overlays ?? []
  const args = [
    "-ss",
    from.toFixed(3),
    "-to",
    to.toFixed(3),
    "-i",
    src,
    ...overlays.flatMap((o) => ["-i", o]),
  ]
  if (!overlays.length) await ff([...args, "-vf", base, ...ENC, out])
  else {
    let graph = `[0:v]${base}[v0]`
    overlays.forEach((_, k) => {
      graph += `;[v${k}][${k + 1}:v]overlay=0:0[v${k + 1}]`
    })
    await ff([...args, "-filter_complex", graph, "-map", `[v${overlays.length}]`, ...ENC, out])
  }
  return out
}

interface Fast extends Span {
  /** Playback speed-up of this stretch (1 when the source is already time-lapsed). */
  factor: number
  /** The ×N shown in the badge. */
  badge: number
}

/** Cuts [from, to) into normal and fast parts; fast parts play at their factor with a ×N badge. */
async function timelapsed(
  src: string,
  from: number,
  to: number,
  fast: Fast[],
  hold = 0,
  extra: string[] = [],
) {
  const parts: string[] = []
  let t = from
  for (const f of fast.filter((f) => f.to > from && f.from < to).sort((a, b) => a.from - b.from)) {
    const a = Math.max(f.from, from)
    const b = Math.min(f.to, to)
    if (a - t > 0.05) parts.push(await piece(src, t, a, { overlays: extra }))
    parts.push(
      await piece(src, a, b, {
        factor: f.factor,
        overlays: [join(cards, `fast-x${f.badge}.png`), ...extra],
      }),
    )
    t = b
  }
  if (to - t > 0.05 || hold) parts.push(await piece(src, t, to, { hold, overlays: extra }))
  return parts
}

async function concat(parts: string[], out: string) {
  const list = join(work, `${n++}.txt`)
  await writeFile(list, parts.map((p) => `file '${p}'`).join("\n"))
  // Silent stereo track: some platforms reject video without audio.
  await ff([
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    list,
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=48000:cl=stereo",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-shortest",
    "-movflags",
    "+faststart",
    out,
  ])
}

// ---- terminal: cast → gif → mp4 ----------------------------------------------------------------
const agg = (cast: string, gif: string) =>
  $`agg --quiet --font-family Menlo --font-size 19 --line-height 1.3 --theme github-dark --fps-cap 20 --idle-time-limit 999 ${cast} ${gif}`
await agg(join(OUT, "terminal.cast"), join(work, "terminal.gif"))
const termRaw = join(work, "terminal.mp4")
await ff([
  "-i",
  join(work, "terminal.gif"),
  "-vf",
  `fps=${FPS},pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0:color=0x0d1117,format=yuv420p`,
  "-c:v",
  "libx264",
  "-crf",
  "16",
  termRaw,
])
const termLen = Number(
  (await $`ffprobe -v error -show_entries format=duration -of csv=p=0 ${termRaw}`.text()).trim(),
)

// ---- full video ---------------------------------------------------------------------------------
const full: string[] = [await card(join(cards, "intro.png"), 4)]
full.push(await card(join(cards, "chapter-install.png"), 3.2))
// The cast is already time-lapsed: its fast stretches only get the badge.
full.push(
  ...(await timelapsed(
    termRaw,
    0,
    termLen,
    termFast.map((f) => ({ ...f, factor: 1, badge: f.factor })),
    4,
  )),
)
const src = join(OUT, "browser.webm")
const chapters = browser.chapters
for (let i = 0; i < chapters.length - 1; i++) {
  const c = chapters[i] as { id: string; start: number }
  const next = chapters[i + 1] as { start: number }
  if (!CHAPTERS.some((x) => x.id === c.id)) continue
  full.push(await card(join(cards, `chapter-${c.id}.png`), 3.2))
  full.push(
    ...(await timelapsed(
      src,
      c.start,
      next.start,
      browser.fast.map((f) => ({ ...f, badge: f.factor })),
    )),
  )
}
full.push(await card(join(cards, "outro.png"), 4))
await concat(full, join(FINAL, "agentbox-setup.mp4"))

// ---- short cut ----------------------------------------------------------------------------------
const termShort = join(work, "terminal-short.mp4")
await $`bun ${join(import.meta.dir, "timelapse.ts")} ${join(OUT, "terminal.raw.cast")} ${join(work, "short.cast")} ${join(work, "short.fast.json")} 24`.quiet()
// Drop the slow typing part of the prompt in the short: start where the command runs.
await agg(join(work, "short.cast"), join(work, "short.gif"))
await ff([
  "-i",
  join(work, "short.gif"),
  "-vf",
  `fps=${FPS},scale=-2:790,pad=${W}:${H}:(ow-iw)/2:0:color=0x0d1117,format=yuv420p`,
  "-c:v",
  "libx264",
  "-crf",
  "16",
  termShort,
])
const shortLen = Number(
  (await $`ffprobe -v error -show_entries format=duration -of csv=p=0 ${termShort}`.text()).trim(),
)
const short: string[] = [await card(join(cards, "intro.png"), 2.5)]
const shortFast = (await Bun.file(join(work, "short.fast.json")).json()) as (Span & {
  factor: number
})[]
short.push(
  ...(await timelapsed(
    termShort,
    0,
    shortLen,
    shortFast.map((f) => ({ ...f, factor: 1, badge: f.factor })),
    1.5,
    [join(cards, "caption-install.png")],
  )),
)
for (const h of browser.highlights) {
  const caption = SHORT_CAPTIONS[h.label]
  if (!caption) continue
  // Long highlights (typing) play a bit faster so the cut stays short.
  const len = h.to - h.from
  short.push(
    await piece(src, h.from, h.to, {
      overlays: [join(cards, `caption-${h.label}.png`)],
      factor: len > 8 ? 1.8 : 1,
    }),
  )
}
short.push(await card(join(cards, "outro.png"), 3))
await concat(short, join(FINAL, "agentbox-setup-short.mp4"))

// ---- stills -------------------------------------------------------------------------------------
await ff([
  "-sseof",
  "-2",
  "-i",
  termRaw,
  "-frames:v",
  "1",
  join(FINAL, "stills", "01-install-done.png"),
])
let s = 2
for (const h of browser.highlights) {
  const at = h.from + (h.to - h.from) * 0.7
  await ff([
    "-ss",
    at.toFixed(2),
    "-i",
    src,
    "-frames:v",
    "1",
    join(FINAL, "stills", `${String(s++).padStart(2, "0")}-${h.label}.png`),
  ])
}
for (const f of ["agentbox-setup.mp4", "agentbox-setup-short.mp4"]) {
  const d = Number(
    (
      await $`ffprobe -v error -show_entries format=duration -of csv=p=0 ${join(FINAL, f)}`.text()
    ).trim(),
  )
  console.log(`${f}: ${Math.floor(d / 60)}:${String(Math.round(d % 60)).padStart(2, "0")} min`)
}
