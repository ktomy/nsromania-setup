#!/usr/bin/env bash
# Generate the CPU steal report on production and print it locally (read-only, no sudo, no files left).
#   ./ops/cpu-steal/report.sh --from 2026-11-16 --to 2026-11-22 > steal-report.md
#   ./ops/cpu-steal/report.sh --from 2026-11-16 --to 2026-11-22 --csv hourly > steal-hourly.csv
#   NSROMANIA_SSH_TARGET=ktomy@d1.nsromania.info ./ops/cpu-steal/report.sh   # another server
# All arguments are passed to steal_report.py; see --help.

set -euo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly TARGET="${NSROMANIA_SSH_TARGET:-ktomy@nsromania.info}"

remote='nice -n 10 /usr/bin/python3 -I -'
host_given=0
for arg in "$@"; do
    [[ $arg == --host || $arg == --host=* ]] && host_given=1
    remote+=" $(printf '%q' "$arg")"
done
# Title the report with the server it ran on unless --host is given.
[[ $host_given -eq 1 ]] || remote+=" --host $(printf '%q' "${TARGET#*@}")"
exec ssh -F /dev/null -o StrictHostKeyChecking=yes -o BatchMode=yes "$TARGET" "$remote" <"$SCRIPT_DIR/steal_report.py"
