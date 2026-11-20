import pino from "pino"

// Structured JSON to stdout; systemd forwards it to the journal. Pipe through
// `pino-pretty` locally if you want colors.
export const log = pino({ level: process.env.AGENTBOX_LOG_LEVEL ?? "info", base: undefined })
