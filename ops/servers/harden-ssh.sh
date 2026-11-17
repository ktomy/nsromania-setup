#!/usr/bin/env bash
# Disable SSH password authentication and root login on a hosting server. Run as root only after key login for the
# administrative user (with sudo) has been verified from a second session. The root password keeps working on the
# provider's console for recovery.
#
# sshd uses the first value it reads, and sshd_config.d files are read in lexical order before the main file, so this
# file must sort before the provider's 01-*.conf and cloud-init's 50-cloud-init.conf (which enable passwords).

set -euo pipefail

readonly CONF=/etc/ssh/sshd_config.d/00-nsromania-hardening.conf
readonly BACKUP="/var/log/nightscout/backup/harden-ssh-$(date -u +%Y%m%dT%H%M%SZ)"

[[ $EUID -eq 0 ]] || { echo 'must run as root' >&2; exit 1; }

if [[ -e $CONF ]]; then
    install -d -m 0700 "$BACKUP"
    cp -a "$CONF" "$BACKUP/"
fi

cat > "$CONF.new" <<'EOF'
# Managed by ops/servers/harden-ssh.sh
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
X11Forwarding no
EOF
chmod 0644 "$CONF.new"
mv -f "$CONF.new" "$CONF"

if ! sshd -t; then
    echo 'sshd configuration test failed; removing the new file' >&2
    rm -f "$CONF"
    [[ -e $BACKUP/$(basename "$CONF") ]] && cp -a "$BACKUP/$(basename "$CONF")" "$CONF"
    exit 1
fi

sshd -T | grep -E '^(permitrootlogin|passwordauthentication|kbdinteractiveauthentication|x11forwarding) '
systemctl reload ssh
echo 'harden-ssh: done'
