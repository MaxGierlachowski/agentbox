#!/usr/bin/env bash
# Runs inside the box as `ubuntu`: a prompt, the public one-liner typed out, then the real install.
URL="${1:-https://maxgierlachowski.github.io/agentbox/install.sh}"
CMD="curl -fsSL $URL | sudo AGENTBOX_UP=1 sh"
prompt() { printf '\033[1;32mubuntu@agentbox\033[0m:\033[1;34m~\033[0m$ '; }
cd ~ || exit 1
clear
prompt
sleep 1.2
for ((i = 0; i < ${#CMD}; i++)); do
  printf '%s' "${CMD:i:1}"
  sleep 0.03
done
sleep 0.8
printf '\n'
bash -c "$CMD"
sleep 4
prompt
sleep 2
