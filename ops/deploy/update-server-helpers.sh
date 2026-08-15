#!/usr/bin/env bash

set -Eeuo pipefail

export LC_ALL=C
umask 077

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPOSITORY_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
readonly VALIDATOR="$SCRIPT_DIR/validate-helper-update.py"

readonly SSH_HOST='nsromania.info'
readonly SSH_PORT='22'
readonly SSH_USER='ktomy'
readonly REMOTE_UPLOAD_ROOT='/var/log/nightscout/helper-updates'
readonly REMOTE_UPDATER='/usr/local/sbin/nsromania-update-deploy-helpers'
readonly REMOTE_STATE='/var/log/nightscout/.deployment-control/helper-version.json'

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

fail() {
    echo "Helper update failed: $1" >&2
    exit 1
}

[[ $# -eq 0 ]] || fail 'this command does not accept arguments'
[[ -t 0 && -t 1 ]] || fail 'run this command interactively so sudo can prompt on the server'

for command_name in git install python3 scp sha256sum ssh tar; do
    command -v "$command_name" >/dev/null || fail "required local command is unavailable: $command_name"
done

cd "$REPOSITORY_ROOT"

readonly SOURCE_COMMIT="$(git rev-parse HEAD)"
[[ "$SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ ]] || fail 'unable to determine the source commit'
[[ "$(git branch --show-current)" == 'main' ]] || fail 'deployment helpers may only be installed from the main branch'
[[ "$(git rev-parse '@{upstream}')" == "$SOURCE_COMMIT" ]] ||
    fail 'local main must exactly match its configured upstream before installing helpers'

if [[ -n "$(git status --porcelain --untracked-files=normal -- ops/deploy)" ]]; then
    fail 'ops/deploy contains uncommitted changes; commit the exact helper version before installing it'
fi

"$SCRIPT_DIR/test.sh"

readonly TIMESTAMP="$(date -u '+%Y%m%dT%H%M%SZ')"
[[ "$TIMESTAMP" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || fail 'unable to create an update timestamp'

TEMP_ROOT="$(mktemp -d /tmp/nsromania-helper-update.XXXXXXXX)"
readonly TEMP_ROOT
readonly PAYLOAD_DIR="$TEMP_ROOT/payload"
readonly ARCHIVE="$TEMP_ROOT/deploy-helpers-${SOURCE_COMMIT}.tar.gz"

cleanup() {
    if [[ -n "${TEMP_ROOT:-}" && -d "$TEMP_ROOT" && "$TEMP_ROOT" == /tmp/nsromania-helper-update.* ]]; then
        rm -rf -- "$TEMP_ROOT"
    fi
}
trap cleanup EXIT

mkdir -m 0700 -- "$PAYLOAD_DIR"
for name in "${PAYLOAD_NAMES[@]}"; do
    [[ -f "$SCRIPT_DIR/$name" && ! -L "$SCRIPT_DIR/$name" ]] || fail "payload source is missing or unsafe: $name"
    install -m 0600 -- "$SCRIPT_DIR/$name" "$PAYLOAD_DIR/$name"
done

NSR_VALIDATOR="$VALIDATOR" \
    NSR_PAYLOAD_DIR="$PAYLOAD_DIR" \
    NSR_SOURCE_COMMIT="$SOURCE_COMMIT" \
    NSR_CREATED_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
    python3 <<'PYTHON'
import hashlib
import importlib.util
import json
import os
from pathlib import Path

validator_path = Path(os.environ['NSR_VALIDATOR'])
spec = importlib.util.spec_from_file_location('validate_helper_update', validator_path)
if spec is None or spec.loader is None:
    raise SystemExit('Unable to load the helper package validator.')
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)

payload = Path(os.environ['NSR_PAYLOAD_DIR'])
manifest = {
    'schemaVersion': 1,
    'sourceCommit': os.environ['NSR_SOURCE_COMMIT'],
    'createdAt': os.environ['NSR_CREATED_AT'],
    'files': {},
}
for name, expected in validator.EXPECTED_FILES.items():
    content = (payload / name).read_bytes()
    manifest['files'][name] = {
        **expected,
        'sha256': hashlib.sha256(content).hexdigest(),
    }

(payload / validator.MANIFEST_NAME).write_text(f'{json.dumps(manifest, indent=4)}\n', encoding='utf8')
PYTHON

(
    cd "$PAYLOAD_DIR"
    tar \
        --sort=name \
        --mtime='UTC 1970-01-01' \
        --owner=0 \
        --group=0 \
        --numeric-owner \
        -czf "$ARCHIVE" \
        "${PAYLOAD_NAMES[@]}" \
        helper-manifest.json
)

python3 "$VALIDATOR" "$ARCHIVE" "$SOURCE_COMMIT" >/dev/null

readonly ARCHIVE_CHECKSUM="$(sha256sum "$ARCHIVE" | awk '{print $1}')"
readonly ARCHIVE_SIZE="$(stat -c '%s' "$ARCHIVE")"
[[ "$ARCHIVE_CHECKSUM" =~ ^[0-9a-f]{64}$ && "$ARCHIVE_SIZE" =~ ^[1-9][0-9]*$ ]] ||
    fail 'unable to determine the helper package checksum or size'

readonly REMOTE_STAGE="$REMOTE_UPLOAD_ROOT/update-${SOURCE_COMMIT:0:12}-${TIMESTAMP}-$$"
readonly REMOTE_ARCHIVE="$REMOTE_STAGE/$(basename -- "$ARCHIVE")"
readonly REMOTE="$SSH_USER@$SSH_HOST"
readonly -a SSH_ARGS=(
    -F /dev/null
    -p "$SSH_PORT"
    -o BatchMode=yes
    -o StrictHostKeyChecking=yes
    -o PasswordAuthentication=no
    -o KbdInteractiveAuthentication=no
    -o ConnectTimeout=15
    -o ServerAliveInterval=15
    -o ServerAliveCountMax=3
)

echo "Preparing deployment-helper update for commit $SOURCE_COMMIT"
echo "Package: $ARCHIVE_SIZE bytes, SHA-256 $ARCHIVE_CHECKSUM"

ssh "${SSH_ARGS[@]}" "$REMOTE" \
    "test -d '$REMOTE_UPLOAD_ROOT' && test ! -L '$REMOTE_UPLOAD_ROOT' && mkdir -m 700 '$REMOTE_STAGE'"

scp \
    -F /dev/null \
    -P "$SSH_PORT" \
    -p \
    -o BatchMode=yes \
    -o StrictHostKeyChecking=yes \
    -o PasswordAuthentication=no \
    -o KbdInteractiveAuthentication=no \
    -- "$ARCHIVE" "$REMOTE:$REMOTE_ARCHIVE"

echo 'Administrative elevation will now be requested on the server.'
ssh -tt "${SSH_ARGS[@]}" "$REMOTE" \
    "sudo -- '$REMOTE_UPDATER' '$REMOTE_ARCHIVE' '$ARCHIVE_CHECKSUM' '$SOURCE_COMMIT'"

STATE_JSON="$(ssh "${SSH_ARGS[@]}" "$REMOTE" "cat '$REMOTE_STATE'")"
readonly STATE_JSON

NSR_STATE_JSON="$STATE_JSON" \
    NSR_SOURCE_COMMIT="$SOURCE_COMMIT" \
    NSR_ARCHIVE_CHECKSUM="$ARCHIVE_CHECKSUM" \
    python3 <<'PYTHON'
import json
import os

state = json.loads(os.environ['NSR_STATE_JSON'])
if state.get('sourceCommit') != os.environ['NSR_SOURCE_COMMIT']:
    raise SystemExit('Server helper state reports a different commit.')
if state.get('packageSha256') != os.environ['NSR_ARCHIVE_CHECKSUM']:
    raise SystemExit('Server helper state reports a different package checksum.')
if state.get('status') != 'installed':
    raise SystemExit('Server helper state does not report a successful installation.')

print(f"Deployment helpers installed from {state['sourceCommit']}")
print(f"Server backup: {state['backupPath']}")
PYTHON

echo "Staged package retained on the server: $REMOTE_ARCHIVE"
