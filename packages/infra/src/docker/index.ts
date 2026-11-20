import Docker from "dockerode"

export type DockerClient = Docker

/** Label keys put on every Docker object agentbox owns. Cleanup only ever goes by label. */
export const LABELS = {
  workspace: "dev.agentbox.workspace",
  provider: "dev.agentbox.provider",
  specHash: "dev.agentbox.spec-hash",
} as const

export function createDocker(socketPath = process.env.DOCKER_SOCKET ?? "/var/run/docker.sock") {
  return new Docker({ socketPath })
}

export interface DockerFacts {
  reachable: boolean
  serverVersion?: string
  apiVersion?: string
  error?: string
}

export async function dockerFacts(docker: DockerClient): Promise<DockerFacts> {
  try {
    const v = await docker.version()
    return { reachable: true, serverVersion: v.Version, apiVersion: v.ApiVersion }
  } catch (err) {
    return { reachable: false, error: err instanceof Error ? err.message : String(err) }
  }
}
