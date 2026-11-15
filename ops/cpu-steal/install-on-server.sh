#!/usr/bin/env bash
# Root side of ops/cpu-steal/install.sh: install or update the CPU steal collector.
# Usage (as root): install-on-server.sh STAGING_DIR
#
# Backs up any target it replaces into /var/log/nightscout/backup/cpu-steal-<UTC>, installs atomically,
# (re)starts only nsromania-cpu-steal.service, waits for a new CSV line, and restores the previous
# files if the service does not produce one. Touches nothing else.

set -euo pipefail

readonly SRC="${1:?usage: install-on-server.sh STAGING_DIR}"
readonly SERVICE=nsromania-cpu-steal.service
readonly DATA_DIR=/var/log/nsromania-cpu-steal
readonly BACKUP=/var/log/nightscout/backup/cpu-steal-$(date -u +%Y%m%dT%H%M%SZ)
# source file : target : mode
readonly FILES=(
    "collect_cpu_steal.py:/usr/local/sbin/nsromania-cpu-steal:0755"
    "nsromania-cpu-steal.service:/etc/systemd/system/nsromania-cpu-steal.service:0644"
)

[[ $EUID -eq 0 ]] || { echo 'must run as root' >&2; exit 1; }
df -h / | tail -1

# Validate the candidates before touching anything. ExecStart's executable is /usr/bin/python3.
/usr/bin/python3 -I -c 'import ast, sys; ast.parse(open(sys.argv[1]).read(), sys.argv[1])' "$SRC/collect_cpu_steal.py"
systemd-analyze verify "$SRC/nsromania-cpu-steal.service"

had_backup=0
changed=0
for entry in "${FILES[@]}"; do
    IFS=: read -r name target mode <<<"$entry"
    cmp -s "$SRC/$name" "$target" && continue
    if [[ -e $target ]]; then
        install -d -m 0700 -o root -g root "$BACKUP"
        cp -a "$target" "$BACKUP/"
        had_backup=1
    fi
    install -o root -g root -m "$mode" "$SRC/$name" "$target.new"
    mv -f "$target.new" "$target"
    changed=1
    echo "installed $target"
done

data_bytes() {
    local n=0 f
    for f in "$DATA_DIR"/steal-*.csv; do
        [[ -f $f ]] && n=$((n + $(stat -c %s "$f")))
    done
    echo "$n"
}

rollback() {
    echo "collector did not write a line; rolling back" >&2
    if [[ $had_backup -eq 1 ]]; then
        for entry in "${FILES[@]}"; do
            IFS=: read -r name target mode <<<"$entry"
            [[ -e $BACKUP/$(basename "$target") ]] && cp -a "$BACKUP/$(basename "$target")" "$target"
        done
        systemctl daemon-reload
        systemctl restart "$SERVICE"
    else
        systemctl disable --now "$SERVICE"
    fi
    journalctl -u "$SERVICE" -n 20 --no-pager >&2 || true
    exit 1
}

systemctl daemon-reload
systemctl enable "$SERVICE"
before=$(data_bytes)
if [[ $changed -eq 1 ]] || ! systemctl is-active --quiet "$SERVICE"; then
    systemctl restart "$SERVICE"
    # The first line is written at the second minute boundary after start.
    for _ in $(seq 1 30); do
        sleep 5
        [[ $(data_bytes) -gt $before ]] && break
    done
    [[ $(data_bytes) -gt $before ]] || rollback
fi

systemctl is-enabled "$SERVICE"
systemctl is-active "$SERVICE"
systemctl show -p MainPID -p NRestarts -p Restart "$SERVICE"
ls -l "$DATA_DIR"
tail -n 2 "$(ls -1 "$DATA_DIR"/steal-*.csv | tail -n 1)"
if [[ $had_backup -eq 1 ]]; then
    echo "backup: $BACKUP"
else
    echo 'backup: none needed (no existing file was replaced)'
fi
