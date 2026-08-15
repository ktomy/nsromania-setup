#!/usr/bin/env bash

set -Eeuo pipefail

export LC_ALL=C
umask 077

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly BASE_DIR='/var/log/nightscout'
readonly LIVE_DIR="$BASE_DIR/setup"
readonly BACKUP_DIR="$BASE_DIR/backup"
readonly INCOMING_DIR="$BASE_DIR/incoming"
readonly STAGING_DIR="$BASE_DIR/.staging"
readonly CONTROL_DIR="$BASE_DIR/.deployment-control"
readonly HELPER_UPDATE_UPLOAD_DIR="$BASE_DIR/helper-updates"
readonly HELPER_UPDATE_WORK_DIR="$CONTROL_DIR/helper-update-work"
readonly NODE='/usr/local/nvm/versions/node/v22.12.0/bin/node'
readonly NPM='/usr/local/nvm/versions/node/v22.12.0/bin/npm'
readonly PM2_CLI='/usr/local/lib/node_modules/pm2/bin/pm2'
readonly PM2_DUMP='/root/.pm2/dump.pm2'
readonly DEPLOY_USER='nsdeploy'
readonly DEPLOY_HOME="$BASE_DIR/.github-deploy-home"
readonly AUTHORIZED_KEYS="$DEPLOY_HOME/.ssh/authorized_keys"
readonly UPLOAD_LOCK="$CONTROL_DIR/upload.lock"
readonly DEPLOYMENT_LOCK="$CONTROL_DIR/deployment.lock"
readonly HELPER_UPDATE_LOCK="$CONTROL_DIR/helper-update.lock"
readonly KEY_COMMENT='github-actions-nsromania-deploy'

fail() {
    echo "Server bootstrap failed: $1" >&2
    exit 1
}

[[ $EUID -eq 0 ]] || fail 'bootstrap must run as root'
[[ $# -eq 1 ]] || fail 'expected the deployment public-key file as the only argument'

readonly PUBLIC_KEY_FILE="$1"
[[ -s "$PUBLIC_KEY_FILE" && ! -L "$PUBLIC_KEY_FILE" ]] || fail 'deployment public key is missing or unsafe'

read -r key_type key_body _key_comment < "$PUBLIC_KEY_FILE"
[[ "$key_type" == 'ssh-ed25519' && "$key_body" =~ ^[A-Za-z0-9+/]+={0,2}$ ]] || fail 'deployment key must be an ED25519 public key'

readonly TIMESTAMP="$(date -u '+%Y%m%dT%H%M%SZ')"
readonly BOOTSTRAP_BACKUP="$BACKUP_DIR/bootstrap-$TIMESTAMP"

[[ -d "$BASE_DIR" && ! -L "$BASE_DIR" ]] || fail 'application base directory is missing or unsafe'
[[ -d "$LIVE_DIR" && ! -L "$LIVE_DIR" ]] || fail 'live application directory is missing or unsafe'
[[ -f "$LIVE_DIR/.env" && ! -L "$LIVE_DIR/.env" ]] || fail 'live production environment file is missing or unsafe'
[[ -x "$NODE" && "$($NODE --version)" == 'v22.12.0' ]] || fail 'Node v22.12.0 is unavailable at the audited path'
[[ -x "$NPM" ]] || fail 'pinned npm executable is unavailable at the audited path'
[[ -s "$PM2_CLI" ]] || fail 'audited PM2 CLI is unavailable'
[[ -f "$PM2_DUMP" && ! -L "$PM2_DUMP" ]] || fail 'saved root PM2 process list is missing or unsafe'

for command_name in awk cp df find flock getent install mktemp mv python3 sha256sum ssh-keygen stat tar useradd visudo; do
    command -v "$command_name" >/dev/null || fail "required command is unavailable: $command_name"
done

ssh-keygen -lf "$PUBLIC_KEY_FILE" -E sha256 >/dev/null || fail 'deployment public key is invalid'
getent passwd ktomy >/dev/null || fail 'administrative upload account ktomy is missing'

panel_record_count="$(
    env -i \
        HOME='/root' \
        USER='root' \
        LOGNAME='root' \
        PM2_HOME='/root/.pm2' \
        PATH='/usr/local/nvm/versions/node/v22.12.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' \
        "$NODE" "$PM2_CLI" jlist | "$NODE" -e '
            let input = "";
            process.stdin.setEncoding("utf8");
            process.stdin.on("data", (chunk) => (input += chunk));
            process.stdin.on("end", () => {
                const processes = JSON.parse(input);
                process.stdout.write(String(processes.filter((entry) => entry.name === "setup-ns").length));
            });
        '
)"
[[ "$panel_record_count" == '1' ]] || fail 'setup-ns is not exactly one root PM2 process record'

panel_pid="$(
    env -i \
        HOME='/root' \
        USER='root' \
        LOGNAME='root' \
        PM2_HOME='/root/.pm2' \
        PATH='/usr/local/nvm/versions/node/v22.12.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' \
        "$NODE" "$PM2_CLI" pid setup-ns | awk '/^[1-9][0-9]*$/ {print}'
)"
[[ "$panel_pid" =~ ^[1-9][0-9]*$ ]] || fail 'setup-ns is not a single running root PM2 process'

NSR_PM2_DUMP="$PM2_DUMP" NSR_LIVE_DIR="$LIVE_DIR" NSR_NPM="$NPM" "$NODE" <<'NODE'
const fs = require('fs');

const records = JSON.parse(fs.readFileSync(process.env.NSR_PM2_DUMP, 'utf8')).filter(
    (entry) => entry.name === 'setup-ns',
);
if (records.length !== 1) {
    throw new Error('saved PM2 list does not contain exactly one setup-ns record');
}

const record = records[0];
if (
    record.pm_cwd !== process.env.NSR_LIVE_DIR ||
    record.pm_exec_path !== process.env.NSR_NPM ||
    JSON.stringify(record.args) !== JSON.stringify(['start']) ||
    record.node_version !== '22.12.0'
) {
    throw new Error('saved setup-ns PM2 command is not the audited Node 22.12.0 npm start definition');
}
NODE

if command -v ufw >/dev/null; then
    ufw_status="$(ufw status)"
    if grep -q '^Status: active' <<< "$ufw_status"; then
        grep -Eq '(^|[[:space:]])22(/tcp)?[[:space:]]+ALLOW' <<< "$ufw_status" ||
            fail 'UFW is active without a visible SSH allow rule; no firewall change was made'
    elif grep -q '^Status: inactive' <<< "$ufw_status"; then
        echo 'WARNING: UFW is inactive; deployment bootstrap will not change firewall state.' >&2
    else
        fail 'unable to determine UFW state; no firewall change was made'
    fi
fi

mkdir -p -- "$BACKUP_DIR"
mkdir -m 0700 -- "$BOOTSTRAP_BACKUP"

record_directory_metadata() {
    local directory="$1"
    if [[ -e "$directory" ]]; then
        stat -c '%A %a %U:%G %n' "$directory" >> "$BOOTSTRAP_BACKUP/directory-metadata.txt"
    fi
}

backup_existing_file() {
    local target="$1"
    if [[ -e "$target" || -L "$target" ]]; then
        cp -a --parents -- "$target" "$BOOTSTRAP_BACKUP"
    fi
}

record_directory_metadata "$CONTROL_DIR"
backup_existing_file "$DEPLOYMENT_LOCK"

if [[ -e "$CONTROL_DIR" || -L "$CONTROL_DIR" ]]; then
    [[ -d "$CONTROL_DIR" && ! -L "$CONTROL_DIR" && "$(stat -c '%U:%G:%a' "$CONTROL_DIR")" == 'root:root:711' ]] ||
        fail 'deployment control directory has unexpected ownership or mode'
else
    install -d -o root -g root -m 0711 "$CONTROL_DIR"
fi
if [[ ! -e "$DEPLOYMENT_LOCK" && ! -L "$DEPLOYMENT_LOCK" ]]; then
    (set -o noclobber; : > "$DEPLOYMENT_LOCK") || fail 'unable to create the deployment lock without replacing another file'
fi
[[ -f "$DEPLOYMENT_LOCK" && ! -L "$DEPLOYMENT_LOCK" && \
    "$(stat -c '%U:%G:%a:%h' "$DEPLOYMENT_LOCK")" == 'root:root:600:1' ]] ||
    fail 'deployment lock has unexpected ownership, mode, or link count'
exec 8<"$DEPLOYMENT_LOCK"
flock -n 8 || fail 'a production deployment or helper update is active; bootstrap did not replace helpers'

targets=(
    /usr/local/sbin/nsromania-activate-release
    /usr/local/libexec/nsromania-deploy-command
    /usr/local/libexec/nsromania-validate-artifact
    /usr/local/libexec/nsromania-health-check.mjs
    /usr/local/libexec/nsromania-port-check.mjs
    /usr/local/sbin/nsromania-update-deploy-helpers
    /usr/local/libexec/nsromania-validate-helper-update
    /etc/sudoers.d/nsromania-github-deploy
    /etc/passwd
    /etc/passwd-
    /etc/shadow
    /etc/shadow-
    /etc/group
    /etc/group-
    /etc/gshadow
    /etc/gshadow-
    /etc/subuid
    /etc/subuid-
    /etc/subgid
    /etc/subgid-
    "$UPLOAD_LOCK"
    "$HELPER_UPDATE_LOCK"
    "$AUTHORIZED_KEYS"
)

for target in "${targets[@]}"; do
    backup_existing_file "$target"
done

for directory in \
    "$BACKUP_DIR" \
    "$INCOMING_DIR" \
    "$STAGING_DIR" \
    "$HELPER_UPDATE_UPLOAD_DIR" \
    "$HELPER_UPDATE_WORK_DIR" \
    "$DEPLOY_HOME" \
    "$DEPLOY_HOME/.ssh" \
    /usr/local/libexec \
    /usr/local/sbin \
    /etc/sudoers.d; do
    record_directory_metadata "$directory"
done

if ! getent passwd "$DEPLOY_USER" >/dev/null; then
    useradd \
        --system \
        --user-group \
        --no-create-home \
        --no-log-init \
        --home-dir "$DEPLOY_HOME" \
        --shell /bin/bash \
        "$DEPLOY_USER"
fi

IFS=: read -r _account_name _account_password _account_uid _account_gid account_gecos account_home account_shell < <(
    getent passwd "$DEPLOY_USER"
)
[[ "$account_home" == "$DEPLOY_HOME" && "$account_shell" == '/bin/bash' ]] ||
    fail 'existing deployment account has unexpected home or shell'
readonly DEPLOY_GROUP="$(id -gn "$DEPLOY_USER")"

install -d -o root -g root -m 0700 "$BACKUP_DIR"
install -d -o "$DEPLOY_USER" -g "$DEPLOY_GROUP" -m 0700 "$INCOMING_DIR"
install -d -o root -g root -m 0700 "$STAGING_DIR"
install -d -o ktomy -g ktomy -m 0700 "$HELPER_UPDATE_UPLOAD_DIR"
install -d -o root -g root -m 0700 "$HELPER_UPDATE_WORK_DIR"
install -o "$DEPLOY_USER" -g "$DEPLOY_GROUP" -m 0600 /dev/null "$UPLOAD_LOCK"
install -o root -g root -m 0600 /dev/null "$HELPER_UPDATE_LOCK"
install -d -o root -g root -m 0755 /usr/local/libexec /usr/local/sbin

install -o root -g root -m 0755 "$SCRIPT_DIR/activate-release.sh" /usr/local/sbin/nsromania-activate-release
install -o root -g root -m 0755 "$SCRIPT_DIR/authorized-command.sh" /usr/local/libexec/nsromania-deploy-command
install -o root -g root -m 0755 "$SCRIPT_DIR/validate-artifact.py" /usr/local/libexec/nsromania-validate-artifact
install -o root -g root -m 0755 "$SCRIPT_DIR/health-check.mjs" /usr/local/libexec/nsromania-health-check.mjs
install -o root -g root -m 0755 "$SCRIPT_DIR/port-check.mjs" /usr/local/libexec/nsromania-port-check.mjs
install -o root -g root -m 0755 \
    "$SCRIPT_DIR/update-deploy-helpers-on-server.sh" \
    /usr/local/sbin/nsromania-update-deploy-helpers
install -o root -g root -m 0755 \
    "$SCRIPT_DIR/validate-helper-update.py" \
    /usr/local/libexec/nsromania-validate-helper-update

readonly SUDOERS_TEMP="$(mktemp /etc/sudoers.d/.nsromania-github-deploy.XXXXXXXX)"
cleanup_sudoers_temp() {
    if [[ -f "$SUDOERS_TEMP" ]]; then
        rm -f -- "$SUDOERS_TEMP"
    fi
}
trap cleanup_sudoers_temp EXIT

install -o root -g root -m 0440 "$SCRIPT_DIR/nsromania-github-deploy.sudoers" "$SUDOERS_TEMP"
visudo -cf "$SUDOERS_TEMP" >/dev/null
mv -T -- "$SUDOERS_TEMP" /etc/sudoers.d/nsromania-github-deploy
trap - EXIT
visudo -cf /etc/sudoers.d/nsromania-github-deploy >/dev/null

install -d -o "$DEPLOY_USER" -g "$DEPLOY_GROUP" -m 0700 "$DEPLOY_HOME" "$DEPLOY_HOME/.ssh"
readonly AUTHORIZED_KEYS_TEMP="$(mktemp "$DEPLOY_HOME/.ssh/.authorized_keys.XXXXXXXX")"

if [[ -f "$AUTHORIZED_KEYS" ]]; then
    awk -v comment="$KEY_COMMENT" '$NF != comment' "$AUTHORIZED_KEYS" > "$AUTHORIZED_KEYS_TEMP"
fi
printf 'command="/usr/local/libexec/nsromania-deploy-command",restrict %s %s %s\n' \
    "$key_type" "$key_body" "$KEY_COMMENT" >> "$AUTHORIZED_KEYS_TEMP"

chown "$DEPLOY_USER:$DEPLOY_GROUP" "$AUTHORIZED_KEYS_TEMP"
chmod 0600 "$AUTHORIZED_KEYS_TEMP"
mv -T -- "$AUTHORIZED_KEYS_TEMP" "$AUTHORIZED_KEYS"

echo "Restricted GitHub deployment bootstrap installed."
echo "Backups of replaced files: $BOOTSTRAP_BACKUP"
