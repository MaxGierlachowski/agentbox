# Setup video

Records the whole setup as a video, from the public one-liner on a clean Ubuntu 24.04 box to the
first task in Hermes UI and the device pairing QR. Everything shown is real: a fresh systemd
container installs agentbox with the published installer, and Playwright drives the real config
UI. Logins are only started (the Claude sign-in link and the GitHub device code appear), never
completed, so no account or secret is involved.

```sh
e2e/video/record.sh                       # → e2e/video/out/agentbox-setup.mp4, -short.mp4, stills/
e2e/video/record.sh <install-url> <dir>   # another release or output directory
```

Needs Docker, asciinema 3, agg, ffmpeg, bun and Playwright's Chromium (`bunx playwright install chromium` in `e2e/`).

| File | Does |
|---|---|
| `Dockerfile` | the clean "VM": Ubuntu 24.04 with systemd, sudo, an `ubuntu` user |
| `demo-install.sh` | runs in the box: types the one-liner, runs it for real |
| `record-terminal.sh` | starts the box, records the install with asciinema, time-lapses the waits (×8, marked) |
| `timelapse.ts` | speeds up quiet stretches of an asciicast and records where |
| `record-browser.ts` | Playwright with `recordVideo` (1440×900, visible cursor, click ripples): claim → onboarding → install → Hermes UI → Devices; writes chapter, time-lapse and highlight marks |
| `cards.ts` | German chapter cards, captions and the time-lapse badge as PNGs (HTML → screenshot) |
| `stitch.ts` | ffmpeg: full cut with chapter cards, 60–90 s highlight cut with captions, stills |
