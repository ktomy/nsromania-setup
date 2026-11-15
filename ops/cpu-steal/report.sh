#!/usr/bin/env bash
# Generate the CPU steal report on production and print it locally (read-only, no sudo, no files left).
#   ./ops/cpu-steal/report.sh --from 2026-11-16 --to 2026-11-22 > steal-report.md
#   ./ops/cpu-steal/report.sh --from 2026-11-16 --to 2026-11-22 --csv hourly > steal-hourly.csv
# All arguments are passed to steal_report.py; see --help.

set -euo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly TARGET="${NSROMANIA_SSH_TARGET:-ktomy@nsromania.info}"

remote='nice -n 10 /usr/bin/python3 -I -'
for arg in "$@"; do
    remote+=" $(printf '%q' "$arg")"
done
exec ssh -F /dev/null -o StrictHostKeyChecking=yes -o BatchMode=yes "$TARGET" "$remote" <"$SCRIPT_DIR/steal_report.py"
