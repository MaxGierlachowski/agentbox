import caddyfile from "./host/Caddyfile.tmpl" with { type: "text" }
import base from "./host/scripts/base.sh" with { type: "text" }
import browser from "./host/scripts/browser.sh" with { type: "text" }
import caddy from "./host/scripts/caddy.sh" with { type: "text" }
import chromeClose from "./host/scripts/chrome-cdp-close.py" with { type: "text" }
import claude from "./host/scripts/claude.sh" with { type: "text" }
import cli from "./host/scripts/cli.sh" with { type: "text" }
import deb from "./host/scripts/deb.sh" with { type: "text" }
import firewall from "./host/scripts/firewall.sh" with { type: "text" }
import hermes from "./host/scripts/hermes.sh" with { type: "text" }
import iroh from "./host/scripts/iroh.sh" with { type: "text" }
import kasmvnc from "./host/scripts/kasmvnc.sh" with { type: "text" }
import node from "./host/scripts/node.sh" with { type: "text" }
import openUrl from "./host/scripts/open-url.sh" with { type: "text" }
import paseo from "./host/scripts/paseo.sh" with { type: "text" }
import tarball from "./host/scripts/tarball.sh" with { type: "text" }
import target from "./host/units/agentbox.target" with { type: "text" }
import caddyUnit from "./host/units/agentbox-caddy.service" with { type: "text" }
import chromeUnit from "./host/units/agentbox-chrome.service" with { type: "text" }
import configUnit from "./host/units/agentbox-config.service" with { type: "text" }
import firewallUnit from "./host/units/agentbox-firewall.service" with { type: "text" }
import hermesUnit from "./host/units/agentbox-hermes.service" with { type: "text" }
import hermesUiUnit from "./host/units/agentbox-hermes-ui.service" with { type: "text" }
import irohUnit from "./host/units/agentbox-iroh.service" with { type: "text" }
import irohReloadPath from "./host/units/agentbox-iroh-reload.path" with { type: "text" }
import irohReloadUnit from "./host/units/agentbox-iroh-reload.service" with { type: "text" }
import kasmvncUnit from "./host/units/agentbox-kasmvnc.service" with { type: "text" }
import paseoUnit from "./host/units/agentbox-paseo.service" with { type: "text" }

export * from "./host/components"

export const SCRIPTS = {
  base,
  node,
  paseo,
  claude,
  hermes,
  caddy,
  iroh,
  kasmvnc,
  browser,
  deb,
  tarball,
  firewall,
  cli,
}

/** Helper files installed to /usr/local/lib/agentbox. */
export const HELPERS = {
  "firewall.sh": firewall,
  "open-url": openUrl,
  "chrome-cdp-close.py": chromeClose,
}

export const UNITS: Record<string, string> = {
  "agentbox.target": target,
  "agentbox-firewall.service": firewallUnit,
  "agentbox-config.service": configUnit,
  "agentbox-caddy.service": caddyUnit,
  "agentbox-iroh.service": irohUnit,
  "agentbox-iroh-reload.path": irohReloadPath,
  "agentbox-iroh-reload.service": irohReloadUnit,
  "agentbox-paseo.service": paseoUnit,
  "agentbox-hermes.service": hermesUnit,
  "agentbox-hermes-ui.service": hermesUiUnit,
  "agentbox-kasmvnc.service": kasmvncUnit,
  "agentbox-chrome.service": chromeUnit,
}

export const CADDYFILE = caddyfile
