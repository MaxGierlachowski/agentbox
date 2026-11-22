import type { SecretStore } from "@workspace/infra/secrets"
import type { AiService } from "./ai/service"
import type { Auth } from "./auth/auth"
import type { BrowserService } from "./browser/service"
import type { CatalogService } from "./catalog/service"
import type { DeviceService } from "./devices/service"
import type { FlowRegistry } from "./flows/flows"
import type { CliService } from "./git/clis"
import type { GitService } from "./git/git"
import type { OnboardingService } from "./onboarding/service"
import type { ProfileService } from "./profiles/service"
import type { RunService } from "./runs/service"
import type { SoulService } from "./soul/service"
import type { SystemService } from "./system/service"
import type { ToolkitService } from "./toolkit/service"

/** Everything the API router delegates to (built in server/start.ts). */
export interface Services {
  auth: Auth
  system: SystemService
  onboarding: OnboardingService
  ai: AiService
  flows: FlowRegistry
  catalog: CatalogService
  toolkit: ToolkitService
  soul: SoulService
  clis: CliService
  git: GitService
  profiles: ProfileService
  browser: BrowserService
  devices: DeviceService
  runs: RunService
  secrets: SecretStore
}
