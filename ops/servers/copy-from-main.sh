#!/usr/bin/env bash
# Stage the main server's runtime files on a new hosting server, from an operator workstation:
#
#   copy-from-main.sh NEW_HOST_IP
#
# Streams (main -> this workstation -> new host, never written locally) the exact Node 22.12.0 tree, the global PM2,
# all Nightscout versions, the wildcard certificate and the nginx/MongoDB/PM2 configuration that
# provision-stack.sh installs. Everything lands in a new root-only staging directory on the new host; nothing is
# installed or changed in place. The certificate key passes only through the encrypted pipe.
#
# Both hosts must already be in ~/.ssh/known_hosts (strict checking) and accept key login for ADMIN_USER with sudo.

set -euo pipefail

readonly NEW_HOST="${1:?usage: copy-from-main.sh NEW_HOST_IP}"
readonly MAIN_HOST="${MAIN_HOST:-nsromania.info}"
readonly ADMIN_USER="${ADMIN_USER:-ktomy}"
readonly KEY="${SSH_KEY:-$HOME/.ssh/id_rsa}"
readonly STAGING="/root/staging-main-$(date -u +%Y%m%dT%H%M%SZ)"

ssh_opts=(-F /dev/null -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$HOME/.ssh/known_hosts" -o BatchMode=yes
    -o IdentitiesOnly=yes -i "$KEY")

# Paths copied verbatim (relative to /) from the main server
readonly PATHS=(
    usr/local/nvm/versions/node/v22.12.0
    usr/local/lib/node_modules/pm2
    var/log/nightscout/versions
    etc/nginx/nginx.conf
    etc/nginx/proxy_params
    etc/nginx/certs_paths
    etc/nginx/cert/star_nsromania_info.crt
    etc/nginx/cert/star_nsromania_info.key
    etc/nginx/sites-available/_template
    etc/nginx/sites-available/default
    etc/mongod.conf
    etc/logrotate.d/mongodb-server
    etc/systemd/system/nsromania-mongodb-logrotate.service
    etc/systemd/system/nsromania-mongodb-logrotate.timer
    etc/systemd/system/pm2-root.service
    usr/share/keyrings/mongodb-server-8.0.gpg
    root/.pm2/module_conf.json
)

echo "staging on $NEW_HOST: $STAGING"
ssh "${ssh_opts[@]}" "$ADMIN_USER@$NEW_HOST" "sudo install -d -m 0700 -o root -g root '$STAGING'"

# shellcheck disable=SC2029 # PATHS are constants defined above
ssh "${ssh_opts[@]}" "$ADMIN_USER@$MAIN_HOST" "sudo tar -C / --numeric-owner -cpf - ${PATHS[*]} | zstd -q -3" \
    | ssh "${ssh_opts[@]}" "$ADMIN_USER@$NEW_HOST" "sudo tar -C '$STAGING' --numeric-owner -xpf - --zstd"

# Verify the staged copy against the main server file by file
# shellcheck disable=SC2029
remote_sums() {
    ssh "${ssh_opts[@]}" "$1" "sudo bash -c 'cd $2 && find ${PATHS[*]} -type f -print0 | sort -z | xargs -0 sha256sum'"
}
main_sums="$(remote_sums "$ADMIN_USER@$MAIN_HOST" /)"
new_sums="$(remote_sums "$ADMIN_USER@$NEW_HOST" "$STAGING")"
if [[ "$main_sums" != "$new_sums" ]]; then
    echo 'staged files differ from the main server' >&2
    exit 1
fi
echo "verified $(wc -l <<<"$main_sums") files"
echo "STAGING=$STAGING"
