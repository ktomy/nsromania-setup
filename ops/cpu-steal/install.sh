#!/usr/bin/env bash
# Install or update the CPU steal collector on production in one step.
#   ./ops/cpu-steal/install.sh
# Runs the tests, streams the files over SSH into a private temporary directory, runs
# install-on-server.sh with sudo (ktomy has passwordless sudo; nothing prompts), and removes the
# temporary directory. Does not touch PM2, Nightscout, the panel, databases, nginx or the firewall.

set -euo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly TARGET="${NSROMANIA_SSH_TARGET:-ktomy@nsromania.info}"

python3 -I "$SCRIPT_DIR/test_cpu_steal.py"

tar -C "$SCRIPT_DIR" -cf - collect_cpu_steal.py nsromania-cpu-steal.service install-on-server.sh |
    ssh -F /dev/null -o StrictHostKeyChecking=yes -o BatchMode=yes "$TARGET" \
        'set -e; t=$(mktemp -d); trap "rm -rf \"$t\"" EXIT; tar -x -C "$t"; sudo -n bash "$t/install-on-server.sh" "$t"'
