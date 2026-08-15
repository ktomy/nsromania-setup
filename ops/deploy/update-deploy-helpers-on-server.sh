#!/usr/bin/env bash

set -Eeuo pipefail

export LC_ALL=C
export PATH='/usr/local/nvm/versions/node/v22.12.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
umask 077

readonly BASE_DIR='/var/log/nightscout'
readonly LIVE_DIR="$BASE_DIR/setup"
readonly BACKUP_DIR="$BASE_DIR/backup"
readonly UPLOAD_ROOT="$BASE_DIR/helper-updates"
readonly CONTROL_DIR="$BASE_DIR/.deployment-control"
readonly WORK_ROOT="$CONTROL_DIR/helper-update-work"
readonly DEPLOYMENT_LOCK="$CONTROL_DIR/deployment.lock"
readonly LOCK_FILE="$CONTROL_DIR/helper-update.lock"
readonly STATE_FILE="$CONTROL_DIR/helper-version.json"

readonly NODE='/usr/local/nvm/versions/node/v22.12.0/bin/node'
readonly PM2_CLI='/usr/local/lib/node_modules/pm2/bin/pm2'
readonly VALIDATOR='/usr/local/libexec/nsromania-validate-helper-update'
readonly HEALTH_CHECK='/usr/local/libexec/nsromania-health-check.mjs'
readonly PORT_CHECK='/usr/local/libexec/nsromania-port-check.mjs'
readonly PROCESS_NAME='setup-ns'
readonly APP_PORT='11000'
readonly LOCAL_HEALTH_URL="http://127.0.0.1:${APP_PORT}/api/health"
readonly PUBLIC_HEALTH_URL='https://setup.nsromania.info/api/health'

HEALTH_CHECK_RUNTIME="$HEALTH_CHECK"
PORT_CHECK_RUNTIME="$PORT_CHECK"

readonly -a PAYLOAD_NAMES=(
    activate-release.sh
    authorized-command.sh
    validate-artifact.py
    health-check.mjs
    port-check.mjs
    nsromania-github-deploy.sudoers
    update-deploy-helpers-on-server.sh
    validate-helper-update.py
)
readonly -a TARGETS=(
    /usr/local/sbin/nsromania-activate-release
    /usr/local/libexec/nsromania-deploy-command
    /usr/local/libexec/nsromania-validate-artifact
    /usr/local/libexec/nsromania-health-check.mjs
    /usr/local/libexec/nsromania-port-check.mjs
    /etc/sudoers.d/nsromania-github-deploy
    /usr/local/sbin/nsromania-update-deploy-helpers
    /usr/local/libexec/nsromania-validate-helper-update
)
readonly -a MODES=(
    0755
    0755
    0755
    0755
    0755
    0440
    0755
    0755
)

BACKUP_PATH=''
WORK_DIR=''
ACTIVE_TEMP=''
INSTALL_STARTED=0

fail() {
    echo "Deployment-helper update failed: $1" >&2
    return 1
}

private_directory_has_safe_metadata() {
    local directory="$1"
    local owner_group="$2"
    local metadata

    metadata="$(stat -c '%U:%G:%a' "$directory")"
    [[ "$metadata" == "$owner_group:700" || "$metadata" == "$owner_group:2700" ]]
}

pm2() {
    env -i \
        HOME='/root' \
        USER='root' \
        LOGNAME='root' \
        SHELL='/bin/bash' \
        PM2_HOME='/root/.pm2' \
        PATH="$PATH" \
        "$NODE" "$PM2_CLI" "$@"
}

panel_pid() {
    local record_count
    local -a pids

    record_count="$(
        pm2 jlist | "$NODE" -e '
            let input = "";
            process.stdin.setEncoding("utf8");
            process.stdin.on("data", (chunk) => (input += chunk));
            process.stdin.on("end", () => {
                const records = JSON.parse(input).filter((entry) => entry.name === "setup-ns");
                process.stdout.write(String(records.length));
            });
        '
    )"
    [[ "$record_count" == '1' ]] || return 1

    mapfile -t pids < <(pm2 pid "$PROCESS_NAME" | awk '/^[1-9][0-9]*$/ {print}')
    [[ ${#pids[@]} -eq 1 ]] || return 1
    printf '%s\n' "${pids[0]}"
}

verify_panel_health() {
    local release_sha=''

    if [[ -s "$LIVE_DIR/RELEASE_SHA" && ! -L "$LIVE_DIR/RELEASE_SHA" ]]; then
        release_sha="$(tr -d '\r\n' < "$LIVE_DIR/RELEASE_SHA")"
    fi

    if [[ "$release_sha" =~ ^[0-9a-f]{40}$ ]]; then
        "$NODE" "$HEALTH_CHECK_RUNTIME" "${LOCAL_HEALTH_URL}?helper-update=${release_sha}" "$release_sha" >/dev/null
        "$NODE" "$HEALTH_CHECK_RUNTIME" "${PUBLIC_HEALTH_URL}?helper-update=${release_sha}" "$release_sha" >/dev/null
    else
        "$NODE" "$PORT_CHECK_RUNTIME" '127.0.0.1' "$APP_PORT" >/dev/null
    fi
}

backup_file_or_record_missing() {
    local target="$1"

    if [[ -e "$target" || -L "$target" ]]; then
        cp -a --parents -- "$target" "$BACKUP_PATH"
    else
        printf '%s\n' "$target" >> "$BACKUP_PATH/missing-before-update.txt"
    fi
}

install_candidate_file() {
    local source="$1"
    local target="$2"
    local mode="$3"
    local target_directory

    target_directory="$(dirname -- "$target")"
    ACTIVE_TEMP="$(mktemp "$target_directory/.nsromania-helper.XXXXXXXX")"
    install -o root -g root -m "$mode" -- "$source" "$ACTIVE_TEMP"
    mv -T -- "$ACTIVE_TEMP" "$target"
    ACTIVE_TEMP=''
}

preserve_failed_file() {
    local target="$1"
    local failed_target="$BACKUP_PATH/failed-installed$target"

    if [[ -e "$target" || -L "$target" ]]; then
        mkdir -p -- "$(dirname -- "$failed_target")"
        cp -a -- "$target" "$failed_target"
    fi
}

restore_original_file() {
    local target="$1"
    local original="$BACKUP_PATH$target"
    local failed_new="$BACKUP_PATH/failed-new$target"
    local restore_temp

    if [[ -e "$original" || -L "$original" ]]; then
        restore_temp="$(mktemp "$(dirname -- "$target")/.nsromania-rollback.XXXXXXXX")"
        cp -a -- "$original" "$restore_temp"
        mv -T -- "$restore_temp" "$target"
    elif [[ -e "$target" || -L "$target" ]]; then
        mkdir -p -- "$(dirname -- "$failed_new")"
        mv -T -- "$target" "$failed_new"
    fi
}

cleanup() {
    if [[ -n "$ACTIVE_TEMP" && -f "$ACTIVE_TEMP" && "$(basename -- "$ACTIVE_TEMP")" == .nsromania-helper.* ]]; then
        rm -f -- "$ACTIVE_TEMP"
    fi
    if [[ -n "$WORK_DIR" && -d "$WORK_DIR" && "$WORK_DIR" == "$WORK_ROOT"/update-* ]]; then
        rm -rf -- "$WORK_DIR"
    fi
}

rollback() {
    local original_status=$?
    local rollback_failed=0
    local target

    (( original_status != 0 )) || original_status=1
    trap - ERR HUP INT TERM
    set +e

    if (( INSTALL_STARTED == 0 )) || [[ -z "$BACKUP_PATH" || ! -d "$BACKUP_PATH" ]]; then
        exit "$original_status"
    fi

    echo 'Helper installation failed; restoring every previous helper from its backup.' >&2
    for target in "${TARGETS[@]}" "$STATE_FILE"; do
        preserve_failed_file "$target" || rollback_failed=1
    done
    for target in "${TARGETS[@]}" "$STATE_FILE"; do
        restore_original_file "$target" || rollback_failed=1
    done

    visudo -cf /etc/sudoers.d/nsromania-github-deploy >/dev/null || rollback_failed=1
    if [[ "$(panel_pid 2>/dev/null)" != "$PANEL_PID_BEFORE" ]]; then
        rollback_failed=1
    fi
    verify_panel_health >/dev/null 2>&1 || rollback_failed=1

    if (( rollback_failed != 0 )); then
        echo "CRITICAL: helper rollback was incomplete; inspect $BACKUP_PATH" >&2
        exit 70
    fi

    echo "Previous helpers restored. Failed versions preserved under: $BACKUP_PATH" >&2
    exit "$original_status"
}

trap cleanup EXIT

[[ $EUID -eq 0 ]] || fail 'receiver must run as root through interactive sudo'
[[ $# -eq 3 ]] || fail 'expected ARCHIVE, SHA256, and COMMIT_SHA arguments'

readonly ARCHIVE="$1"
readonly CHECKSUM="$2"
readonly COMMIT_SHA="$3"

[[ "$CHECKSUM" =~ ^[0-9a-f]{64}$ ]] || fail 'invalid package checksum'
[[ "$COMMIT_SHA" =~ ^[0-9a-f]{40}$ ]] || fail 'invalid source commit'
[[ "$ARCHIVE" =~ ^${UPLOAD_ROOT}/update-${COMMIT_SHA:0:12}-[0-9]{8}T[0-9]{6}Z-[0-9]+/deploy-helpers-${COMMIT_SHA}\.tar\.gz$ ]] ||
    fail 'package path is outside the accepted staging layout'

for command_name in awk cp df dirname flock getent grep install mktemp mv python3 realpath sha256sum stat tar visudo; do
    command -v "$command_name" >/dev/null || fail "required command is unavailable: $command_name"
done

[[ -x "$NODE" && "$($NODE --version)" == 'v22.12.0' ]] || fail 'audited Node v22.12.0 is unavailable'
[[ -s "$PM2_CLI" && -x "$VALIDATOR" && -s "$HEALTH_CHECK" && -s "$PORT_CHECK" ]] ||
    fail 'installed validation/runtime helpers are incomplete'

for required_directory in "$BASE_DIR" "$LIVE_DIR" "$BACKUP_DIR" "$UPLOAD_ROOT" "$CONTROL_DIR" "$WORK_ROOT"; do
    [[ -d "$required_directory" && ! -L "$required_directory" ]] || fail "unsafe or missing directory: $required_directory"
done
private_directory_has_safe_metadata "$UPLOAD_ROOT" 'ktomy:ktomy' || fail 'helper upload root has unexpected ownership or mode'
private_directory_has_safe_metadata "$WORK_ROOT" 'root:root' || fail 'helper work root has unexpected ownership or mode'
[[ -f "$DEPLOYMENT_LOCK" && ! -L "$DEPLOYMENT_LOCK" && \
    "$(stat -c '%U:%G:%a:%h' "$DEPLOYMENT_LOCK")" == 'root:root:600:1' ]] ||
    fail 'deployment lock has unexpected ownership, mode, or link count'
[[ -f "$LOCK_FILE" && ! -L "$LOCK_FILE" && "$(stat -c '%U:%G:%a:%h' "$LOCK_FILE")" == 'root:root:600:1' ]] ||
    fail 'helper update lock has unexpected ownership, mode, or link count'
getent passwd ktomy >/dev/null || fail 'administrative upload account ktomy is missing'

for target_directory in /usr/local/sbin /usr/local/libexec /etc/sudoers.d; do
    [[ -d "$target_directory" && ! -L "$target_directory" && "$(stat -c '%U:%G' "$target_directory")" == 'root:root' ]] ||
        fail "helper target directory is unsafe: $target_directory"
done
for index in "${!TARGETS[@]}"; do
    [[ -f "${TARGETS[$index]}" && ! -L "${TARGETS[$index]}" ]] || fail "installed helper is missing or unsafe: ${TARGETS[$index]}"
    [[ "$(stat -c '%U:%G:%a:%h' "${TARGETS[$index]}")" == "root:root:${MODES[$index]#0}:1" ]] ||
        fail "installed helper has unexpected ownership, mode, or link count: ${TARGETS[$index]}"
done
if [[ -e "$STATE_FILE" || -L "$STATE_FILE" ]]; then
    [[ -f "$STATE_FILE" && ! -L "$STATE_FILE" && "$(stat -c '%U:%G:%a:%h' "$STATE_FILE")" == 'root:root:644:1' ]] ||
        fail 'installed helper state is unsafe'
fi

readonly REAL_ARCHIVE="$(realpath -e -- "$ARCHIVE")"
[[ "$REAL_ARCHIVE" == "$ARCHIVE" && -f "$ARCHIVE" && ! -L "$ARCHIVE" ]] || fail 'package is missing or reached through a link'
readonly ARCHIVE_DIRECTORY="$(dirname -- "$ARCHIVE")"
[[ "$(realpath -e -- "$ARCHIVE_DIRECTORY")" == "$ARCHIVE_DIRECTORY" ]] || fail 'package staging directory is reached through a link'
private_directory_has_safe_metadata "$ARCHIVE_DIRECTORY" 'ktomy:ktomy' ||
    fail 'package staging directory has unexpected ownership or mode'
[[ "$(stat -c '%U:%G:%a:%h' "$ARCHIVE")" == 'ktomy:ktomy:600:1' ]] ||
    fail 'package has unexpected ownership, mode, or link count'

exec 8<"$DEPLOYMENT_LOCK"
flock -n 8 || fail 'a production application deployment is active'
exec 9<"$LOCK_FILE"
flock -n 9 || fail 'another deployment-helper update is active'

PANEL_PID_BEFORE="$(panel_pid)" || fail 'setup-ns is not exactly one running root PM2 process'
readonly PANEL_PID_BEFORE
verify_panel_health || fail 'current application is not healthy before the helper update'

WORK_DIR="$(mktemp -d --tmpdir="$WORK_ROOT" "update-${COMMIT_SHA}.XXXXXXXX")"
readonly WORK_DIR
readonly PRIVATE_ARCHIVE="$WORK_DIR/helpers.tar.gz"
readonly CANDIDATE_DIR="$WORK_DIR/candidate"
readonly TRUSTED_HEALTH_CHECK="$WORK_DIR/trusted-health-check.mjs"
readonly TRUSTED_PORT_CHECK="$WORK_DIR/trusted-port-check.mjs"

cp -- "$HEALTH_CHECK" "$TRUSTED_HEALTH_CHECK"
cp -- "$PORT_CHECK" "$TRUSTED_PORT_CHECK"
chmod 0500 "$TRUSTED_HEALTH_CHECK" "$TRUSTED_PORT_CHECK"
HEALTH_CHECK_RUNTIME="$TRUSTED_HEALTH_CHECK"
PORT_CHECK_RUNTIME="$TRUSTED_PORT_CHECK"

readonly ARCHIVE_SIZE="$(stat -c '%s' "$ARCHIVE")"
readonly AVAILABLE_BYTES="$(df -P -B1 "$WORK_ROOT" | awk 'NR == 2 {print $4}')"
[[ "$ARCHIVE_SIZE" =~ ^[1-9][0-9]*$ && "$AVAILABLE_BYTES" =~ ^[0-9]+$ ]] || fail 'unable to determine package capacity'
(( ARCHIVE_SIZE <= 10000000 )) || fail 'compressed helper package exceeds the safety limit'
(( AVAILABLE_BYTES >= ARCHIVE_SIZE + 104857600 )) || fail 'insufficient free space for helper validation'

cp --reflink=never -- "$ARCHIVE" "$PRIVATE_ARCHIVE"
chmod 0400 "$PRIVATE_ARCHIVE"
[[ "$(sha256sum "$PRIVATE_ARCHIVE" | awk '{print $1}')" == "$CHECKSUM" ]] || fail 'private package checksum mismatch'

read -r EXPANDED_BYTES MEMBER_COUNT < <("$VALIDATOR" "$PRIVATE_ARCHIVE" "$COMMIT_SHA")
readonly EXPANDED_BYTES MEMBER_COUNT
[[ "$EXPANDED_BYTES" =~ ^[1-9][0-9]*$ && "$MEMBER_COUNT" == '9' ]] || fail 'installed validator returned invalid package metadata'

mkdir -m 0700 -- "$CANDIDATE_DIR"
tar --extract --gzip --file "$PRIVATE_ARCHIVE" --directory "$CANDIDATE_DIR" --no-same-owner --no-same-permissions

bash -n "$CANDIDATE_DIR/activate-release.sh"
bash -n "$CANDIDATE_DIR/authorized-command.sh"
bash -n "$CANDIDATE_DIR/update-deploy-helpers-on-server.sh"
PYTHONPYCACHEPREFIX="$WORK_DIR/pycache" python3 -m py_compile \
    "$CANDIDATE_DIR/validate-artifact.py" \
    "$CANDIDATE_DIR/validate-helper-update.py"
"$NODE" --check "$CANDIDATE_DIR/health-check.mjs"
"$NODE" --check "$CANDIDATE_DIR/port-check.mjs"
visudo -cf "$CANDIDATE_DIR/nsromania-github-deploy.sudoers" >/dev/null
[[ "$(tr -d '\r\n' < "$CANDIDATE_DIR/nsromania-github-deploy.sudoers")" == \
    'nsdeploy ALL=(root) NOPASSWD: /usr/local/sbin/nsromania-activate-release *' ]] ||
    fail 'candidate sudo rule differs from the narrow deployment rule'

NSR_CANDIDATE="$CANDIDATE_DIR" python3 <<'PYTHON'
import os
import re
from pathlib import Path

candidate = Path(os.environ['NSR_CANDIDATE'])
activation = (candidate / 'activate-release.sh').read_text(encoding='utf8').lower()
receiver = (candidate / 'update-deploy-helpers-on-server.sh').read_text(encoding='utf8').lower()

for forbidden in (
    'pri' + 'sma',
    'mi' + 'grate',
    'db' + ' push',
    'my' + 'sql',
    'maria' + 'db',
    'mon' + 'go',
    'pn' + 'pm',
    'np' + 'x',
):
    if forbidden in activation or forbidden in receiver:
        raise SystemExit(f'forbidden command marker in candidate helpers: {forbidden}')

if re.search(r'np' + r'm\s+install', activation) or re.search(r'np' + r'm\s+install', receiver):
    raise SystemExit('package installation is forbidden in candidate helpers')
if re.search(r'pm2\s+(?:start|stop|restart|delete|reload|save|kill|resurrect)', receiver):
    raise SystemExit('the helper receiver may not mutate PM2 state')
if re.search(r'pm2\s+(?:restart|stop|delete)\s+(?:all|\*)|pm2\s+(?:save|kill|resurrect)', activation):
    raise SystemExit('the activation helper contains a broad PM2 command')
PYTHON

TIMESTAMP="$(date -u '+%Y%m%dT%H%M%SZ')"
readonly TIMESTAMP
[[ "$TIMESTAMP" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || fail 'unable to create a backup timestamp'
BACKUP_PATH="$(mktemp -d "$BACKUP_DIR/helpers-${TIMESTAMP}-before-${COMMIT_SHA}.XXXXXXXX")"
readonly BACKUP_PATH
chmod 0700 "$BACKUP_PATH"

for directory in /usr/local/sbin /usr/local/libexec /etc/sudoers.d "$CONTROL_DIR"; do
    stat -c '%A %a %U:%G %n' "$directory" >> "$BACKUP_PATH/directory-metadata.txt"
done
for target in "${TARGETS[@]}" "$STATE_FILE"; do
    backup_file_or_record_missing "$target"
done
cp -a -- "$PRIVATE_ARCHIVE" "$BACKUP_PATH/validated-package.tar.gz"
printf '%s  %s\n' "$CHECKSUM" 'validated-package.tar.gz' > "$BACKUP_PATH/validated-package.sha256"

trap rollback ERR HUP INT TERM
INSTALL_STARTED=1

for index in "${!PAYLOAD_NAMES[@]}"; do
    install_candidate_file \
        "$CANDIDATE_DIR/${PAYLOAD_NAMES[$index]}" \
        "${TARGETS[$index]}" \
        "${MODES[$index]}"
done

STATE_CANDIDATE="$WORK_DIR/helper-version.json"
readonly STATE_CANDIDATE
NSR_COMMIT_SHA="$COMMIT_SHA" \
    NSR_CHECKSUM="$CHECKSUM" \
    NSR_INSTALLED_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
    NSR_BACKUP_PATH="$BACKUP_PATH" \
    python3 > "$STATE_CANDIDATE" <<'PYTHON'
import json
import os

print(json.dumps({
    'status': 'installed',
    'sourceCommit': os.environ['NSR_COMMIT_SHA'],
    'packageSha256': os.environ['NSR_CHECKSUM'],
    'installedAt': os.environ['NSR_INSTALLED_AT'],
    'backupPath': os.environ['NSR_BACKUP_PATH'],
}, indent=4))
PYTHON
install_candidate_file "$STATE_CANDIDATE" "$STATE_FILE" 0644

for index in "${!PAYLOAD_NAMES[@]}"; do
    [[ "$(sha256sum "${TARGETS[$index]}" | awk '{print $1}')" == \
        "$(sha256sum "$CANDIDATE_DIR/${PAYLOAD_NAMES[$index]}" | awk '{print $1}')" ]] ||
        fail "installed helper checksum mismatch: ${TARGETS[$index]}"
    [[ "$(stat -c '%U:%G:%a' "${TARGETS[$index]}")" == "root:root:${MODES[$index]#0}" ]] ||
        fail "installed helper ownership or mode mismatch: ${TARGETS[$index]}"
done
visudo -cf /etc/sudoers.d/nsromania-github-deploy >/dev/null
python3 -m json.tool "$STATE_FILE" >/dev/null

[[ "$(panel_pid)" == "$PANEL_PID_BEFORE" ]] || fail 'application PM2 process changed during the helper update'
verify_panel_health || fail 'application is not healthy after the helper update'

trap - ERR HUP INT TERM
INSTALL_STARTED=0

echo "Deployment helpers installed from commit: $COMMIT_SHA"
echo "Package SHA-256: $CHECKSUM"
echo "Previous helpers preserved: $BACKUP_PATH"
echo "Application PM2 PID remained unchanged: $PANEL_PID_BEFORE"
