#!/usr/bin/env bash

set -Eeuo pipefail

export LC_ALL=C
export PATH='/usr/local/nvm/versions/node/v22.12.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
umask 077

readonly BASE_DIR='/var/log/nightscout'
readonly LIVE_DIR="$BASE_DIR/setup"
readonly INCOMING_DIR="$BASE_DIR/incoming"
readonly BACKUP_DIR="$BASE_DIR/backup"
readonly STAGING_DIR="$BASE_DIR/.staging"
readonly CONTROL_DIR="$BASE_DIR/.deployment-control"
readonly LOCK_FILE="$CONTROL_DIR/deployment.lock"

readonly NODE='/usr/local/nvm/versions/node/v22.12.0/bin/node'
readonly PM2_CLI='/usr/local/lib/node_modules/pm2/bin/pm2'
readonly VALIDATOR='/usr/local/libexec/nsromania-validate-artifact'
readonly HEALTH_CHECK='/usr/local/libexec/nsromania-health-check.mjs'
readonly PORT_CHECK='/usr/local/libexec/nsromania-port-check.mjs'

readonly PROCESS_NAME='setup-ns'
readonly APP_PORT='11000'
readonly LOCAL_HEALTH_URL="http://127.0.0.1:${APP_PORT}/api/health"
readonly PUBLIC_HEALTH_URL='https://setup.nsromania.info/api/health'
readonly RESERVED_BYTES=1073741824
readonly MIN_FREE_INODES=100000

fail() {
    echo "Deployment failed: $1" >&2
    exit 1
}

pm2() {
    env -i \
        HOME='/root' \
        USER='root' \
        LOGNAME='root' \
        SHELL='/bin/bash' \
        PM2_HOME='/root/.pm2' \
        NODE_ENV='production' \
        PORT="$APP_PORT" \
        HOSTNAME='127.0.0.1' \
        PATH='/usr/local/nvm/versions/node/v22.12.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' \
        "$NODE" "$PM2_CLI" "$@"
}

classify_release() {
    local release_dir="$1"

    if [[ -s "$release_dir/server.js" && -s "$release_dir/RELEASE_SHA" ]]; then
        echo 'managed'
    elif [[ -s "$release_dir/.next/BUILD_ID" && -s "$release_dir/node_modules/next/dist/bin/next" ]]; then
        echo 'legacy'
    else
        return 1
    fi
}

wait_for_release_health() {
    local commit_sha="$1"
    local attempt
    local healthy=0

    for attempt in {1..10}; do
        if "$NODE" "$HEALTH_CHECK" "${LOCAL_HEALTH_URL}?deployment=${commit_sha}" "$commit_sha"; then
            healthy=1
            break
        fi
        sleep 2
    done
    (( healthy == 1 )) || return 1

    healthy=0
    for attempt in {1..10}; do
        if "$NODE" "$HEALTH_CHECK" "${PUBLIC_HEALTH_URL}?deployment=${commit_sha}" "$commit_sha"; then
            healthy=1
            break
        fi
        sleep 2
    done

    (( healthy == 1 ))
}

wait_for_legacy_port() {
    local attempt

    for attempt in {1..10}; do
        if "$NODE" "$PORT_CHECK" '127.0.0.1' "$APP_PORT"; then
            return 0
        fi
        sleep 2
    done

    return 1
}

start_panel() {
    local release_kind="$1"

    pm2 delete "$PROCESS_NAME" >/dev/null 2>&1 || true

    case "$release_kind" in
        managed)
            pm2 start "$LIVE_DIR/server.js" \
                --name "$PROCESS_NAME" \
                --cwd "$LIVE_DIR" \
                --interpreter "$NODE" >/dev/null
            ;;
        legacy)
            pm2 start "$LIVE_DIR/node_modules/next/dist/bin/next" \
                --name "$PROCESS_NAME" \
                --cwd "$LIVE_DIR" \
                --interpreter "$NODE" \
                -- start -p "$APP_PORT" -H '127.0.0.1' >/dev/null
            ;;
        *)
            return 1
            ;;
    esac
}

[[ $EUID -eq 0 ]] || fail 'activation helper must run as root'
[[ $# -eq 2 ]] || fail 'expected COMMIT_SHA and SHA256 arguments'

readonly COMMIT_SHA="$1"
readonly CHECKSUM="$2"

[[ "$COMMIT_SHA" =~ ^[0-9a-f]{40}$ ]] || fail 'invalid commit SHA'
[[ "$CHECKSUM" =~ ^[0-9a-f]{64}$ ]] || fail 'invalid artifact checksum'

readonly ARCHIVE="$INCOMING_DIR/${COMMIT_SHA}-${CHECKSUM}.tar.gz"

[[ -x "$NODE" ]] || fail 'pinned Node executable is missing'
[[ "$($NODE --version)" == 'v22.12.0' ]] || fail 'pinned Node executable has the wrong version'
[[ -s "$PM2_CLI" && -s "$VALIDATOR" && -s "$HEALTH_CHECK" && -s "$PORT_CHECK" ]] || fail 'deployment runtime is incomplete'

for required_directory in "$BASE_DIR" "$LIVE_DIR" "$INCOMING_DIR" "$BACKUP_DIR" "$STAGING_DIR" "$CONTROL_DIR"; do
    [[ -d "$required_directory" && ! -L "$required_directory" ]] || fail "unsafe or missing directory: $required_directory"
done

[[ -f "$LIVE_DIR/.env" && ! -L "$LIVE_DIR/.env" ]] || fail 'live production environment file is missing or unsafe'
[[ -f "$ARCHIVE" && ! -L "$ARCHIVE" ]] || fail 'uploaded artifact is missing or unsafe'

for deployment_directory in "$LIVE_DIR" "$BACKUP_DIR" "$STAGING_DIR"; do
    [[ "$(stat -c '%d' "$deployment_directory")" == "$(stat -c '%d' "$BASE_DIR")" ]] ||
        fail "deployment directory is not on the application filesystem: $deployment_directory"
done

exec 9>"$LOCK_FILE"
flock -n 9 || fail 'another production deployment is active'

CURRENT_KIND="$(classify_release "$LIVE_DIR")" || fail 'current release is neither supported legacy nor managed format'
readonly CURRENT_KIND

PANEL_RECORD_COUNT="$(
    pm2 jlist | "$NODE" -e '
        let input = "";
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", (chunk) => (input += chunk));
        process.stdin.on("end", () => {
            const processes = JSON.parse(input);
            process.stdout.write(String(processes.filter((entry) => entry.name === "setup-ns").length));
        });
    '
)"
readonly PANEL_RECORD_COUNT
[[ "$PANEL_RECORD_COUNT" == '1' ]] || fail 'setup-ns is not exactly one PM2 process record'

mapfile -t PANEL_PIDS < <(pm2 pid "$PROCESS_NAME" | awk '/^[1-9][0-9]*$/ {print}')
[[ ${#PANEL_PIDS[@]} -eq 1 ]] || fail 'setup-ns is not a single running PM2 process'

PREVIOUS_COMMIT=''
if [[ "$CURRENT_KIND" == 'managed' ]]; then
    PREVIOUS_COMMIT="$(tr -d '\r\n' < "$LIVE_DIR/RELEASE_SHA")"
    [[ "$PREVIOUS_COMMIT" =~ ^[0-9a-f]{40}$ ]] || fail 'current managed release has an invalid commit marker'
    wait_for_release_health "$PREVIOUS_COMMIT" || fail 'current managed release is not healthy before deployment'
else
    wait_for_legacy_port || fail 'current legacy release is not healthy before deployment'
fi
readonly PREVIOUS_COMMIT

if [[ "$CURRENT_KIND" == 'managed' ]] &&
    [[ "$(tr -d '\r\n' < "$LIVE_DIR/RELEASE_SHA")" == "$COMMIT_SHA" ]] &&
    [[ -s "$LIVE_DIR/DEPLOYMENT_CHECKSUM" ]] &&
    [[ "$(tr -d '\r\n' < "$LIVE_DIR/DEPLOYMENT_CHECKSUM")" == "$CHECKSUM" ]]; then
    wait_for_release_health "$COMMIT_SHA" || fail 'current matching release is not healthy'
    echo "Release already active: $COMMIT_SHA"
    exit 0
fi

WORK_DIR="$(mktemp -d --tmpdir="$STAGING_DIR" "deploy-${COMMIT_SHA}.XXXXXXXX")"
readonly WORK_DIR
readonly PRIVATE_ARCHIVE="$WORK_DIR/artifact.tar.gz"
readonly CANDIDATE_DIR="$WORK_DIR/candidate"

cleanup_work_dir() {
    if [[ -n "${WORK_DIR:-}" && -d "$WORK_DIR" && "$WORK_DIR" == "$STAGING_DIR"/deploy-"$COMMIT_SHA".* ]]; then
        rm -rf -- "$WORK_DIR"
    fi
}
trap cleanup_work_dir EXIT

readonly ARCHIVE_BYTES="$(stat -c '%s' "$ARCHIVE")"
readonly PRECOPY_AVAILABLE_BYTES="$(df -P -B1 "$STAGING_DIR" | awk 'NR == 2 {print $4}')"
[[ "$ARCHIVE_BYTES" =~ ^[1-9][0-9]*$ && "$PRECOPY_AVAILABLE_BYTES" =~ ^[0-9]+$ ]] ||
    fail 'unable to determine artifact size or pre-copy capacity'
(( PRECOPY_AVAILABLE_BYTES >= ARCHIVE_BYTES + RESERVED_BYTES )) ||
    fail 'insufficient free bytes for the private artifact copy and reserve'

cp --reflink=never -- "$ARCHIVE" "$PRIVATE_ARCHIVE"
chmod 0400 "$PRIVATE_ARCHIVE"
[[ "$(sha256sum "$PRIVATE_ARCHIVE" | awk '{print $1}')" == "$CHECKSUM" ]] || fail 'private artifact checksum mismatch'

read -r EXPANDED_BYTES MEMBER_COUNT < <("$VALIDATOR" "$PRIVATE_ARCHIVE" "$COMMIT_SHA")
readonly EXPANDED_BYTES MEMBER_COUNT
[[ "$EXPANDED_BYTES" =~ ^[0-9]+$ && "$MEMBER_COUNT" =~ ^[1-9][0-9]*$ ]] ||
    fail 'validator did not return expanded size and member count'

readonly AVAILABLE_BYTES="$(df -P -B1 "$STAGING_DIR" | awk 'NR == 2 {print $4}')"
readonly AVAILABLE_INODES="$(df -P -i "$STAGING_DIR" | awk 'NR == 2 {print $4}')"
[[ "$AVAILABLE_BYTES" =~ ^[0-9]+$ && "$AVAILABLE_INODES" =~ ^[0-9]+$ ]] || fail 'unable to determine filesystem capacity'
(( AVAILABLE_BYTES >= EXPANDED_BYTES + RESERVED_BYTES )) || fail 'insufficient free bytes for staged release and reserve'
(( AVAILABLE_INODES >= MEMBER_COUNT + MIN_FREE_INODES )) || fail 'insufficient free inodes for staged release and reserve'

mkdir -m 0700 -- "$CANDIDATE_DIR"
tar \
    --extract \
    --gzip \
    --file "$PRIVATE_ARCHIVE" \
    --directory "$CANDIDATE_DIR" \
    --no-same-owner \
    --no-same-permissions

[[ -s "$CANDIDATE_DIR/server.js" && -s "$CANDIDATE_DIR/.next/BUILD_ID" ]] || fail 'extracted release is incomplete'
[[ "$(tr -d '\r\n' < "$CANDIDATE_DIR/RELEASE_SHA")" == "$COMMIT_SHA" ]] || fail 'extracted release commit mismatch'

find "$CANDIDATE_DIR" -type d -exec chmod go-w {} +
find "$CANDIDATE_DIR" -type f -exec chmod go-w {} +
chown -R ktomy:nightscout "$CANDIDATE_DIR"

install -o ktomy -g nightscout -m 0600 -- "$LIVE_DIR/.env" "$CANDIDATE_DIR/.env"
printf '%s\n' "$CHECKSUM" > "$CANDIDATE_DIR/DEPLOYMENT_CHECKSUM"
chown ktomy:nightscout "$CANDIDATE_DIR/DEPLOYMENT_CHECKSUM"
chmod 0644 "$CANDIDATE_DIR/DEPLOYMENT_CHECKSUM"

TIMESTAMP="$(date -u '+%Y%m%dT%H%M%SZ')"
readonly TIMESTAMP
[[ "$TIMESTAMP" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || fail 'unable to create a backup timestamp'
readonly PREVIOUS_RELEASE="$BACKUP_DIR/${TIMESTAMP}-before-${COMMIT_SHA}"
readonly FAILED_RELEASE="$BACKUP_DIR/${TIMESTAMP}-failed-${COMMIT_SHA}"

[[ ! -e "$PREVIOUS_RELEASE" && ! -e "$FAILED_RELEASE" ]] || fail 'backup target already exists'

rollback() {
    local original_status=$?
    local rollback_failed=0
    local restored_kind=''
    (( original_status != 0 )) || original_status=1

    trap - ERR INT TERM
    set +e
    echo 'Activation failed; restoring the previous release.' >&2

    pm2 stop "$PROCESS_NAME" >/dev/null 2>&1 || true

    if [[ -d "$PREVIOUS_RELEASE" ]]; then
        if [[ -d "$LIVE_DIR" ]]; then
            mv -T -- "$LIVE_DIR" "$FAILED_RELEASE" || rollback_failed=1
        fi
        mv -T -- "$PREVIOUS_RELEASE" "$LIVE_DIR" || rollback_failed=1
    elif [[ ! -d "$LIVE_DIR" ]]; then
        rollback_failed=1
    fi

    if [[ -d "$LIVE_DIR" ]]; then
        restored_kind="$(classify_release "$LIVE_DIR")" || true
    fi
    if [[ "$restored_kind" != "$CURRENT_KIND" ]]; then
        rollback_failed=1
    fi

    if [[ "$restored_kind" == "$CURRENT_KIND" ]]; then
        start_panel "$CURRENT_KIND" || rollback_failed=1
        if [[ "$CURRENT_KIND" == 'managed' ]]; then
            wait_for_release_health "$PREVIOUS_COMMIT" || rollback_failed=1
        else
            wait_for_legacy_port || rollback_failed=1
        fi
    fi

    if (( rollback_failed != 0 )); then
        echo 'CRITICAL: automatic rollback did not restore a healthy previous release.' >&2
        exit 70
    fi
    if [[ -d "$FAILED_RELEASE" ]]; then
        echo "Previous release restored; failed release preserved at $FAILED_RELEASE" >&2
    else
        echo 'Previous release restored; activation failed before the candidate became live.' >&2
    fi
    exit "$original_status"
}

trap rollback ERR INT TERM

pm2 stop "$PROCESS_NAME" >/dev/null
mv -T -- "$LIVE_DIR" "$PREVIOUS_RELEASE"
mv -T -- "$CANDIDATE_DIR" "$LIVE_DIR"
start_panel 'managed'
wait_for_release_health "$COMMIT_SHA"

trap - ERR INT TERM

echo "Deployment completed: $COMMIT_SHA"
echo "Previous release preserved: $PREVIOUS_RELEASE"
