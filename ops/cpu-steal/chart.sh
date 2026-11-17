#!/usr/bin/env bash
# Draw CPU steal, our CPU use and the load average as one standalone HTML page (read-only, no sudo).
#   ./ops/cpu-steal/chart.sh > steal-chart.html                                    # last 24 hours
#   ./ops/cpu-steal/chart.sh --from 2026-11-16 --to 2026-11-22 > steal-week.html
#   ./ops/cpu-steal/chart.sh --mark '2026-11-16T05:42|steal drops (14.7% before, 8.8% after)|steal drops' > chart.html
# Streams only the month files the range needs from production (nothing is written on the server)
# into a local temporary directory, removed afterwards, and runs steal_chart.py on them locally.
# All arguments are passed to steal_chart.py; see --help.

set -euo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly TARGET="${NSROMANIA_SSH_TARGET:-ktomy@nsromania.info}"
readonly REMOTE_DIR=/var/log/nsromania-cpu-steal

for arg in "$@"; do
    case "$arg" in
    -h | --help) exec python3 -I "$SCRIPT_DIR/steal_chart.py" --help ;;
    esac
done

months="$(python3 -I "$SCRIPT_DIR/steal_chart.py" --list-months "$@")"
files=''
for m in $months; do
    [[ $m =~ ^[0-9]{4}-[0-9]{2}$ ]] || { echo "chart.sh: unexpected month '$m'" >&2; exit 1; }
    files+=" steal-$m.csv steal-$m.*.csv"
done

tmp="$(mktemp -d)"
trap 'rm -rf -- "$tmp"' EXIT

# Remote: keep the patterns that match a file (an unmatched glob stays literal and fails -f), tar them to stdout.
ssh -F /dev/null -o StrictHostKeyChecking=yes -o BatchMode=yes "$TARGET" \
    "cd $REMOTE_DIR && for f in $files; do [ -f \"\$f\" ] && printf '%s\\0' \"\$f\"; done | nice -n 10 tar --null -T - -cf -" |
    tar -xf - -C "$tmp"

python3 -I "$SCRIPT_DIR/steal_chart.py" --data-dir "$tmp" "$@"
