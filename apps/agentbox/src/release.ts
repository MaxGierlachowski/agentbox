import { readFileSync } from "node:fs"
import type { Artifact } from "@workspace/providers"
import pkg from "../package.json" with { type: "json" }
import artifacts from "./host/artifacts.json" with { type: "json" }

/**
 * Where releases live. One constant, so a domain can replace GitHub later
 * (`install.sh` has the same constant).
 */
export const AGENTBOX_BASE_URL = "https://github.com/MaxGierlachowski/agentbox/releases/download"
export const RELEASE_TAG = `v${pkg.version}`

/** Companion-repo tarballs this build installs (written by scripts/release.ts). */
export function releaseArtifacts(): Artifact[] {
  const override = process.env.AGENTBOX_ARTIFACTS
  const list = override
    ? (JSON.parse(readFileSync(override, "utf8")) as Artifact[])
    : (artifacts as Artifact[])
  return list.map((a) => ({
    ...a,
    url: a.url.startsWith("release:")
      ? `${AGENTBOX_BASE_URL}/${RELEASE_TAG}/${a.url.slice("release:".length)}`
      : a.url,
  }))
}
