/**
 * Every third-party component agentbox installs, pinned. Bumps go through a PR (Renovate) and
 * the acceptance test. Scripts in ./scripts carry the per-arch sha256 of their own downloads
 * (caddy, iroh, kasmvnc, node via SHASUMS256); everything else is pinned here.
 */
export type Arch = "amd64" | "arm64"

export const COMPONENTS = {
  node: { version: "24.22.3" },
  paseo: { version: "0.17.3" },
  hermes: { version: "v0.23.3" },
  claude: { version: "2.1.330" },
  caddy: { version: "2.11.9" },
  iroh: { version: "0.6.4" },
  kasmvnc: { version: "1.5.2" },
  gh: {
    version: "2.105.0",
    url: (a: Arch) =>
      `https://github.com/cli/cli/releases/download/v2.105.0/gh_2.105.0_linux_${a}.deb`,
    sha256: {
      amd64: "1dac939af3e84fb3861927c984b357531341be9403b889e4aa86e8822145a09d",
      arm64: "d17e9b089ce0356679c9fa1898f3a7d38dccf943d529acaa94c24e8a4584e0ae",
    },
  },
  glab: {
    version: "1.131.0",
    url: (a: Arch) =>
      `https://gitlab.com/api/v4/projects/gitlab-org%2Fcli/packages/generic/glab/1.131.0/glab_1.131.0_linux_${a}.deb`,
    sha256: {
      amd64: "e9e841f4bc62dfb0d6c30ada0aa70e22d9bb4879eba7571ef54998912cebe9ed",
      arm64: "ee85fd31636c25bdcea896c4383cf8ea54347666b89a4edcd1c477889be5abdf",
    },
  },
} as const

/**
 * Release tarballs of the companion repositories (platform independent). `url` may be
 * `release:<file>`: an asset of the agentbox release this binary belongs to.
 */
export interface Artifact {
  name: "paseo-mcp" | "paseo-multi-account" | "hermes-paseo-bridge" | "hermes-ui"
  version: string
  url: string
  sha256: string
  /** Top-level directory inside the tarball. */
  dir: string
}
