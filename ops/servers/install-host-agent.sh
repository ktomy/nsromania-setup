#!/usr/bin/env bash
# Install or update the host agent on an additional hosting server. Run as root on that server:
#
#   install-host-agent.sh AGENT_SOURCE PANEL_PUBLIC_KEY_FILE MAIN_SOURCE_ADDRESSES
#
#   AGENT_SOURCE           ops/servers/host_agent.py
#   PANEL_PUBLIC_KEY_FILE  the main server's /root/.ssh/nsromania-servers/id_ed25519.pub
#   MAIN_SOURCE_ADDRESSES  comma-separated addresses the key may connect from, e.g. "45.134.39.79,2a0e:97c0:3ea:6c4::1"
#
# The `nsagent` account has no password and cannot change its own key: its home, ~/.ssh and authorized_keys are
# root-owned. Its single key is restricted to the main server's addresses, may forward only to the local MongoDB
# (the panel's tunnel), and has a forced command that runs the agent through one exact sudo rule. Replaced files are
# backed up to /var/log/nightscout/backup/host-agent-<UTC>.

set -euo pipefail

readonly AGENT_SOURCE="${1:?usage: install-host-agent.sh AGENT_SOURCE PANEL_PUBLIC_KEY_FILE MAIN_SOURCE_ADDRESSES}"
readonly PUBLIC_KEY_FILE="${2:?usage: install-host-agent.sh AGENT_SOURCE PANEL_PUBLIC_KEY_FILE MAIN_SOURCE_ADDRESSES}"
readonly SOURCES="${3:?usage: install-host-agent.sh AGENT_SOURCE PANEL_PUBLIC_KEY_FILE MAIN_SOURCE_ADDRESSES}"
readonly AGENT=/usr/local/libexec/nsromania-host-agent
readonly SUDOERS=/etc/sudoers.d/nsromania-host-agent
readonly HOME_DIR=/var/lib/nsromania-agent
readonly BACKUP="/var/log/nightscout/backup/host-agent-$(date -u +%Y%m%dT%H%M%SZ)"

[[ $EUID -eq 0 ]] || { echo 'must run as root' >&2; exit 1; }
[[ $SOURCES =~ ^[0-9A-Fa-f.:,]+$ ]] || { echo 'invalid source address list' >&2; exit 1; }
key="$(cat "$PUBLIC_KEY_FILE")"
[[ $key =~ ^ssh-ed25519\ [A-Za-z0-9+/=]+(\ [A-Za-z0-9@._-]+)?$ ]] || { echo 'expected one ssh-ed25519 public key' >&2; exit 1; }
/usr/bin/python3 -I -c 'import ast, sys; ast.parse(open(sys.argv[1]).read(), sys.argv[1])' "$AGENT_SOURCE"

backup() {
    local target
    for target in "$@"; do
        [[ -e $target ]] || continue
        install -d -m 0700 "$BACKUP"
        cp -a --parents "$target" "$BACKUP/"
    done
}

if ! id nsagent >/dev/null 2>&1; then
    adduser --system --group --home "$HOME_DIR" --no-create-home --shell /bin/sh nsagent
fi
usermod -L nsagent

install -d -m 0755 -o root -g root "$HOME_DIR" "$HOME_DIR/.ssh"

# Agent
install -d -m 0755 -o root -g root "$(dirname "$AGENT")"
if ! cmp -s "$AGENT_SOURCE" "$AGENT"; then
    backup "$AGENT"
    install -o root -g root -m 0755 "$AGENT_SOURCE" "$AGENT.new"
    mv -f "$AGENT.new" "$AGENT"
    echo "installed $AGENT"
fi

# sudo: exactly the agent without arguments; the operation travels in SSH_ORIGINAL_COMMAND
cat > "$SUDOERS.new" <<EOF
# Managed by ops/servers/install-host-agent.sh
Defaults!$AGENT env_keep += "SSH_ORIGINAL_COMMAND"
nsagent ALL=(root) NOPASSWD: $AGENT ""
EOF
chmod 0440 "$SUDOERS.new"
visudo -cf "$SUDOERS.new" >/dev/null
if ! cmp -s "$SUDOERS.new" "$SUDOERS"; then
    backup "$SUDOERS"
    mv -f "$SUDOERS.new" "$SUDOERS"
    echo "installed $SUDOERS"
else
    rm -f "$SUDOERS.new"
fi

# Key last, once everything it points to exists
options="restrict,port-forwarding,permitopen=\"127.0.0.1:27017\",from=\"$SOURCES\",command=\"/usr/bin/sudo -n $AGENT\""
printf '%s %s\n' "$options" "$key" > "$HOME_DIR/.ssh/authorized_keys.new"
chmod 0644 "$HOME_DIR/.ssh/authorized_keys.new"
if ! cmp -s "$HOME_DIR/.ssh/authorized_keys.new" "$HOME_DIR/.ssh/authorized_keys"; then
    backup "$HOME_DIR/.ssh/authorized_keys"
    mv -f "$HOME_DIR/.ssh/authorized_keys.new" "$HOME_DIR/.ssh/authorized_keys"
    echo "installed $HOME_DIR/.ssh/authorized_keys"
else
    rm -f "$HOME_DIR/.ssh/authorized_keys.new"
fi

# Self-test as root (no SSH involved)
SSH_ORIGINAL_COMMAND=ping "$AGENT"
echo
[[ -d $BACKUP ]] && echo "backup: $BACKUP"
echo 'install-host-agent: done'
