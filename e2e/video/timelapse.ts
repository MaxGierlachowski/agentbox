// Speeds up the waits in an asciicast v2 recording instead of cutting them: a quiet gap longer
// than IDLE seconds plays FACTOR times faster. Writes the new cast plus the time ranges (in the new
// timeline) that run fast, so the video can show a "×8" marker exactly there.
//
//   bun e2e/video/timelapse.ts in.cast out.cast out.fast.json [factor=8]
const [input, output, fastFile, factorArg] = process.argv.slice(2)
if (!input || !output || !fastFile)
  throw new Error("usage: timelapse.ts in.cast out.cast fast.json [factor]")
const FACTOR = Number(factorArg ?? 8)
const IDLE = 1.2

const lines = (await Bun.file(input).text()).split("\n").filter(Boolean)
const header = JSON.parse(lines[0] as string) as { version: number }
if (header.version !== 2) throw new Error("expects asciicast v2 (asciinema rec -f asciicast-v2)")
const events = lines.slice(1).map((l) => JSON.parse(l) as [number, string, string])

const out: [number, string, string][] = []
const fast: { from: number; to: number; factor: number }[] = []
let prev = 0
let t = 0
for (const [time, type, data] of events) {
  const gap = time - prev
  prev = time
  if (gap > IDLE) {
    // Keep a short real pause, run the rest fast.
    const quick = (gap - IDLE / 2) / FACTOR
    const from = t + IDLE / 2
    t += IDLE / 2 + quick
    if (quick > 0.4) {
      const last = fast.at(-1)
      if (last && from - last.to < 0.5) last.to = t
      else fast.push({ from, to: t, factor: FACTOR })
    }
  } else t += gap
  out.push([Number(t.toFixed(4)), type, data])
}
await Bun.write(output, `${lines[0]}\n${out.map((e) => JSON.stringify(e)).join("\n")}\n`)
await Bun.write(fastFile, `${JSON.stringify(fast, null, 2)}\n`)
const total = prev
console.log(
  `${total.toFixed(1)}s → ${t.toFixed(1)}s (${fast.length} sped-up stretches at ×${FACTOR})`,
)
