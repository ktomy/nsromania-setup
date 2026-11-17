#!/usr/bin/env bash
# Phase 1 of preparing an additional Nightscout hosting server (e.g. d1.nsromania.info). Run as root on the new,
# empty Ubuntu 24.04 host:
#
#   provision-base.sh FQDN ADMIN_USER /path/to/admin_authorized_keys
#
# Installs base packages and upgrades the system, sets the hostname, creates the administrative user with
# passwordless sudo (as on the main server), adds 8 GiB of emergency swap with vm.swappiness=1, and enables UFW for
# SSH/HTTP/HTTPS only. SSH hardening is a separate step (harden-ssh.sh) that runs only after key login for the admin
# user has been verified. Idempotent; replaced files are backed up to /var/log/nightscout/backup.

set -euo pipefail
export DEBIAN_FRONTEND=noninteractive LC_ALL=C

readonly FQDN="${1:?usage: provision-base.sh FQDN ADMIN_USER AUTHORIZED_KEYS_FILE}"
readonly ADMIN_USER="${2:?usage: provision-base.sh FQDN ADMIN_USER AUTHORIZED_KEYS_FILE}"
readonly KEYS_FILE="${3:?usage: provision-base.sh FQDN ADMIN_USER AUTHORIZED_KEYS_FILE}"
readonly SHORT="${FQDN%%.*}"
readonly BACKUP="/var/log/nightscout/backup/provision-base-$(date -u +%Y%m%dT%H%M%SZ)"

[[ $EUID -eq 0 ]] || { echo 'must run as root' >&2; exit 1; }
grep -q 'VERSION_ID="24.04"' /etc/os-release || { echo 'expected Ubuntu 24.04' >&2; exit 1; }
[[ -s $KEYS_FILE ]] || { echo "no authorized keys in $KEYS_FILE" >&2; exit 1; }

backup() {
    local target
    for target in "$@"; do
        [[ -e $target ]] || continue
        install -d -m 0700 "$BACKUP"
        cp -a --parents "$target" "$BACKUP/"
    done
}

# Same layout as the main server: /usr/local/nsromania/nightscout -> /var/log/nightscout
install -d -m 0755 /var/log/nightscout
install -d -m 0700 /var/log/nightscout/backup /var/log/nightscout/pm2-errors
install -d -m 0755 /usr/local/nsromania
[[ -L /usr/local/nsromania/nightscout ]] || ln -s /var/log/nightscout /usr/local/nsromania/nightscout

echo '== packages'
apt-get update -q
apt-get -y -q -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold full-upgrade
apt-get -y -q install nginx ufw rsync zstd jq sysstat curl gnupg ca-certificates logrotate acl bind9-dnsutils

echo '== hostname'
hostnamectl set-hostname "$SHORT"
if ! grep -qE "^[0-9.]+[[:space:]]+$FQDN([[:space:]]|$)" /etc/hosts; then
    backup /etc/hosts
    ip4="$(ip -4 -o addr show scope global | awk '{print $4}' | cut -d/ -f1 | head -1)"
    sed -i "/^127\.0\.0\.1[[:space:]]\+localhost/a $ip4 $FQDN $SHORT" /etc/hosts
fi

echo '== admin user'
getent group nightscout >/dev/null || groupadd --system nightscout
if ! id "$ADMIN_USER" >/dev/null 2>&1; then
    adduser --disabled-password --gecos '' "$ADMIN_USER"
fi
usermod -aG sudo,nightscout "$ADMIN_USER"
install -d -m 0700 -o "$ADMIN_USER" -g "$ADMIN_USER" "/home/$ADMIN_USER/.ssh"
install -m 0600 -o "$ADMIN_USER" -g "$ADMIN_USER" "$KEYS_FILE" "/home/$ADMIN_USER/.ssh/authorized_keys"
sudoers="/etc/sudoers.d/90-$ADMIN_USER"
printf '%s ALL=(ALL:ALL) NOPASSWD: ALL\n' "$ADMIN_USER" > "$sudoers.new"
chmod 0440 "$sudoers.new"
visudo -cf "$sudoers.new" >/dev/null
mv -f "$sudoers.new" "$sudoers"

echo '== swap'
if ! swapon --show=NAME --noheadings | grep -qx /swapfile; then
    fallocate -l 8G /swapfile
    chmod 0600 /swapfile
    mkswap /swapfile >/dev/null
    swapon /swapfile
fi
grep -q '^/swapfile ' /etc/fstab || { backup /etc/fstab; echo '/swapfile none swap sw 0 0' >> /etc/fstab; }
echo 'vm.swappiness = 1' > /etc/sysctl.d/99-nsromania-swap.conf
sysctl -q --system

echo '== sysstat (60 days of sar history, as on the main server)'
sed -i 's/^HISTORY=.*/HISTORY=60/' /etc/sysstat/sysstat
sed -i 's/^ENABLED=.*/ENABLED="true"/' /etc/default/sysstat
systemctl enable --now sysstat >/dev/null 2>&1 || true

echo '== firewall'
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow 22/tcp comment 'ssh' >/dev/null
ufw allow 80/tcp comment 'http' >/dev/null
ufw allow 443/tcp comment 'https' >/dev/null
ufw --force enable >/dev/null
ufw status verbose

[[ -d $BACKUP ]] && echo "backup: $BACKUP"
[[ -f /var/run/reboot-required ]] && echo 'REBOOT REQUIRED'
echo 'provision-base: done'
