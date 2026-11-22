import { sha256 } from "@oslojs/crypto/sha2"
import { encodeHexLowerCase } from "@oslojs/encoding"
// EFF large wordlist (CC BY 3.0 US, https://www.eff.org/dice), one word per line.
import wordlist from "./eff-large-wordlist.txt" with { type: "text" }

/** Words without hyphens, so an OTP can be joined with "-" in URLs and split back. */
const WORDS = wordlist
  .split("\n")
  .map((w) => w.trim())
  .filter((w) => /^[a-z]+$/.test(w))

export const OTP_WORDS = 6

/** Six random words (~77 bits), e.g. "river lamp oak mint fold acre". */
export function generateOtp(words = OTP_WORDS) {
  const out: string[] = []
  const buf = new Uint32Array(1)
  // Rejection sampling keeps the choice uniform.
  const limit = Math.floor(0x1_0000_0000 / WORDS.length) * WORDS.length
  while (out.length < words) {
    crypto.getRandomValues(buf)
    const n = buf[0] as number
    if (n < limit) out.push(WORDS[n % WORDS.length] as string)
  }
  return out.join(" ")
}

/** Accepts spaces, dashes, commas or mixed case: "River-lamp oak,mint fold acre". */
export function normalizeOtp(input: string) {
  return input
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean)
    .join(" ")
}

export const hashOtp = (otp: string) =>
  encodeHexLowerCase(sha256(new TextEncoder().encode(normalizeOtp(otp))))

export const wordCount = () => WORDS.length
