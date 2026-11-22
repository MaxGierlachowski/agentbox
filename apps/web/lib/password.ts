/**
 * Password strength, zxcvbn-style but tiny: estimate guesses from length and character
 * variety, then penalise what attackers try first (common words, sequences, repeats, the
 * user's own name/email). Score 0–4 like zxcvbn; the claim form requires ≥ 3 and 12+ chars.
 */

const COMMON = [
  "password",
  "passwort",
  "qwerty",
  "letmein",
  "welcome",
  "admin",
  "agentbox",
  "iloveyou",
  "monkey",
  "dragon",
  "sunshine",
  "football",
  "baseball",
  "master",
  "secret",
  "hello",
  "login",
  "abc123",
  "trustno1",
  "changeme",
]

const SEQUENCES = ["abcdefghijklmnopqrstuvwxyz", "0123456789", "qwertyuiop", "asdfghjkl", "zxcvbnm"]

export interface Strength {
  score: 0 | 1 | 2 | 3 | 4
  label: string
  hint: string | null
}

export function passwordStrength(password: string, userInputs: string[] = []): Strength {
  if (!password) return { score: 0, label: "Empty", hint: "Use 12 or more characters." }
  const lower = password.toLowerCase()
  let pool = 0
  if (/[a-z]/.test(password)) pool += 26
  if (/[A-Z]/.test(password)) pool += 26
  if (/[0-9]/.test(password)) pool += 10
  if (/[^a-zA-Z0-9]/.test(password)) pool += 33
  // Unique characters cap the effective length (aaaaaaaaaaaa is not 12 characters of entropy).
  const unique = new Set(password).size
  const effective = Math.min(password.length, unique * 2)
  let bits = effective * Math.log2(Math.max(pool, 2))

  let hint: string | null = null
  for (const word of COMMON) {
    if (lower.includes(word)) {
      bits -= word.length * 3.5
      hint = `Avoid common words like “${word}”.`
    }
  }
  for (const input of userInputs) {
    for (const part of input.toLowerCase().split(/[^a-z0-9]+/)) {
      if (part.length >= 3 && lower.includes(part)) {
        bits -= part.length * 3.5
        hint = "Don't use your name or email."
      }
    }
  }
  for (const seq of SEQUENCES) {
    for (let i = 0; i + 4 <= seq.length; i++) {
      const chunk = seq.slice(i, i + 4)
      if (lower.includes(chunk) || lower.includes([...chunk].reverse().join(""))) {
        bits -= 10
        hint ??= "Avoid sequences like abcd or 1234."
        break
      }
    }
  }
  if (/(.)\1{2,}/.test(password)) {
    bits -= 10
    hint ??= "Avoid repeated characters."
  }
  if (password.length < 12) hint = "Use 12 or more characters."

  const score = (
    bits < 28 ? 0 : bits < 45 ? 1 : bits < 60 ? 2 : bits < 80 || password.length < 12 ? 3 : 4
  ) as Strength["score"]
  const capped = (password.length < 12 ? Math.min(score, 2) : score) as Strength["score"]
  const label = ["Very weak", "Weak", "Fair", "Strong", "Very strong"][capped] as string
  if (capped >= 3) hint = null
  else hint ??= "Add a few more words or characters."
  return { score: capped, label, hint }
}
