#!/usr/bin/env bash
# firewall.sh — runtime rules (agentbox-firewall.service, every boot). Idempotent.
# - Only the iroh gateway (uid agentbox-edge) may connect to Caddy's iroh ingress :8081: that
#   listener trusts X-Iroh-Remote-Id.
# - KasmVNC's UDP transport must not face the network.
set -euo pipefail
for ipt in iptables ip6tables; do
  command -v "$ipt" >/dev/null || continue
  r1=(OUTPUT -o lo -p tcp --dport 8081 -m owner ! --uid-owner agentbox-edge -j REJECT)
  "$ipt" -C "${r1[@]}" 2>/dev/null || "$ipt" -A "${r1[@]}"
  r2=(INPUT ! -i lo -p udp --dport 6901 -j DROP)
  "$ipt" -C "${r2[@]}" 2>/dev/null || "$ipt" -A "${r2[@]}"
done
echo "[firewall] ok"
