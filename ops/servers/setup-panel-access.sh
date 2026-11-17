#!/usr/bin/env bash
# Give the setup panel on the main server access to an additional hosting server. Run as root on the main server:
#
#   setup-panel-access.sh key                                   create the panel key (once) and print its public part
#   setup-panel-access.sh server ID SSH_TARGET HOST_KEY_FILE LOCAL_MONGO_PORT TUNNEL_UNIT
#
#   ID                e.g. d1 (as in NS_REMOTE_SERVERS)
#   SSH_TARGET        e.g. nsagent@31.220.43.162
#   HOST_KEY_FILE     the server's verified "ssh-ed25519 AAAA..." host key line
#   LOCAL_MONGO_PORT  local end of the MongoDB tunnel, e.g. 27118
#   TUNNEL_UNIT       ops/servers/nsromania-server-tunnel@.service
#
# Pins the host key in /root/.ssh/nsromania-servers/known_hosts (strict checking, never learned at runtime), writes
# /etc/nsromania/servers/ID.env and enables nsromania-server-tunnel@ID.service. It does not touch the panel, its .env,
# PM2, nginx, the firewall or any database. Replaced files are backed up to
# /var/log/nightscout/backup/panel-access-<UTC>.

set -euo pipefail

readonly KEY_DIR=/root/.ssh/nsromania-servers
readonly KEY="$KEY_DIR/id_ed25519"
readonly KNOWN_HOSTS="$KEY_DIR/known_hosts"
readonly BACKUP="/var/log/nightscout/backup/panel-access-$(date -u +%Y%m%dT%H%M%SZ)"

[[ $EUID -eq 0 ]] || { echo 'must run as root' >&2; exit 1; }

backup() {
    local target
    for target in "$@"; do
        [[ -e $target ]] || continue
        install -d -m 0700 "$BACKUP"
        cp -a --parents "$target" "$BACKUP/"
    done
}

create_key() {
    install -d -m 0700 -o root -g root "$KEY_DIR"
    if [[ ! -f $KEY ]]; then
        ssh-keygen -q -t ed25519 -N '' -C "nsromania-panel@$(hostname)" -f "$KEY"
    fi
    chmod 0600 "$KEY"
    cat "$KEY.pub"
}

case "${1:-}" in
    key)
        create_key
        ;;
    server)
        readonly ID="${2:?server ID}" TARGET="${3:?SSH_TARGET}" HOST_KEY_FILE="${4:?HOST_KEY_FILE}"
        readonly PORT="${5:?LOCAL_MONGO_PORT}" UNIT_SOURCE="${6:?TUNNEL_UNIT}"
        [[ $ID =~ ^[a-z][a-z0-9]{0,31}$ ]] || { echo 'invalid server id' >&2; exit 1; }
        [[ $TARGET =~ ^nsagent@([0-9.]+)$ ]] || { echo 'expected nsagent@IPv4' >&2; exit 1; }
        host="${BASH_REMATCH[1]}"
        [[ $PORT =~ ^[0-9]{4,5}$ ]] || { echo 'invalid port' >&2; exit 1; }
        host_key="$(cat "$HOST_KEY_FILE")"
        [[ $host_key =~ ^ssh-ed25519\ [A-Za-z0-9+/=]+$ ]] || { echo 'expected one ssh-ed25519 host key' >&2; exit 1; }
        [[ -f $KEY ]] || { echo "run '$0 key' first" >&2; exit 1; }

        # Pin the host key (replace only this host's line)
        touch "$KNOWN_HOSTS"
        chmod 0600 "$KNOWN_HOSTS"
        backup "$KNOWN_HOSTS"
        { grep -v "^$host " "$KNOWN_HOSTS" || true; printf '%s %s\n' "$host" "$host_key"; } > "$KNOWN_HOSTS.new"
        chmod 0600 "$KNOWN_HOSTS.new"
        mv -f "$KNOWN_HOSTS.new" "$KNOWN_HOSTS"

        install -d -m 0755 /etc/nsromania /etc/nsromania/servers
        env_file="/etc/nsromania/servers/$ID.env"
        printf 'SSH_TARGET=%s\nLOCAL_PORT=%s\n' "$TARGET" "$PORT" > "$env_file.new"
        chmod 0644 "$env_file.new"
        cmp -s "$env_file.new" "$env_file" || backup "$env_file"
        mv -f "$env_file.new" "$env_file"

        unit=/etc/systemd/system/nsromania-server-tunnel@.service
        systemd-analyze verify "$UNIT_SOURCE" >/dev/null 2>&1 || true
        if ! cmp -s "$UNIT_SOURCE" "$unit"; then
            backup "$unit"
            install -o root -g root -m 0644 "$UNIT_SOURCE" "$unit.new"
            mv -f "$unit.new" "$unit"
        fi
        systemctl daemon-reload
        systemctl enable "nsromania-server-tunnel@$ID.service" >/dev/null 2>&1
        systemctl restart "nsromania-server-tunnel@$ID.service"
        sleep 3
        systemctl --no-pager --lines=5 status "nsromania-server-tunnel@$ID.service" | sed -n '1,12p'
        [[ -d $BACKUP ]] && echo "backup: $BACKUP"
        echo 'setup-panel-access: done'
        ;;
    *)
        sed -n '2,17p' "$0"
        exit 1
        ;;
esac
