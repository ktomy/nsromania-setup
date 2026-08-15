#!/usr/bin/env bash

set -euo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPOSITORY_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
readonly VALIDATOR="$SCRIPT_DIR/validate-artifact.py"

usage() {
    echo "Usage: $0 OUTPUT_ARCHIVE COMMIT_SHA" >&2
    exit 2
}

[[ $# -eq 2 ]] || usage

readonly OUTPUT_ARCHIVE="$(realpath -m -- "$1")"
readonly COMMIT_SHA="$2"

[[ "$COMMIT_SHA" =~ ^[0-9a-f]{40}$ ]] || {
    echo 'Commit SHA must contain exactly 40 lowercase hexadecimal characters.' >&2
    exit 2
}

[[ ! -e "$OUTPUT_ARCHIVE" ]] || {
    echo "Refusing to overwrite existing artifact: $OUTPUT_ARCHIVE" >&2
    exit 1
}

cd "$REPOSITORY_ROOT"

readonly STANDALONE_DIR="$REPOSITORY_ROOT/.next/standalone"
[[ -s "$STANDALONE_DIR/server.js" ]] || {
    echo 'Standalone output is missing. Run the production build first.' >&2
    exit 1
}

readonly TEMP_ROOT="$(mktemp -d)"
readonly RELEASE_DIR="$TEMP_ROOT/release"

cleanup() {
    rm -rf -- "$TEMP_ROOT"
}
trap cleanup EXIT

mkdir -p -- "$RELEASE_DIR"
cp -a -- "$STANDALONE_DIR/." "$RELEASE_DIR/"

mkdir -p -- "$RELEASE_DIR/.next/static"
cp -a -- "$REPOSITORY_ROOT/.next/static/." "$RELEASE_DIR/.next/static/"

for runtime_directory in public emails; do
    mkdir -p -- "$RELEASE_DIR/$runtime_directory"
    cp -a -- "$REPOSITORY_ROOT/$runtime_directory/." "$RELEASE_DIR/$runtime_directory/"
done

mkdir -p -- "$RELEASE_DIR/messages"
cp -a -- "$REPOSITORY_ROOT/messages/en.json" "$REPOSITORY_ROOT/messages/ro.json" "$RELEASE_DIR/messages/"

# Next copies root environment files into standalone output. They must never
# leave the build machine, even when an operator builds from a configured tree.
find "$RELEASE_DIR" -maxdepth 1 -type f \( -name '.env' -o -name '.env.*' \) -delete

# Optional platform packages leave broken pnpm symlinks in standalone output.
# They are not runtime files for linux-x64 and cannot be safely archived.
find "$RELEASE_DIR" -xtype l -delete

add_pnpm_alias() {
    local package_name="$1"
    local package_json
    local package_directory
    local alias_path
    local relative_target

    [[ ! -e "$RELEASE_DIR/node_modules/$package_name" ]] || return 0

    mapfile -t package_matches < <(
        find "$RELEASE_DIR/node_modules/.pnpm" -path "*/node_modules/$package_name/package.json" -print
    )
    (( ${#package_matches[@]} == 1 )) || {
        echo "Unable to identify one traced $package_name package." >&2
        exit 1
    }

    package_json="${package_matches[0]}"
    package_directory="$(dirname -- "$package_json")"
    alias_path="$RELEASE_DIR/node_modules/$package_name"
    mkdir -p -- "$(dirname -- "$alias_path")"
    relative_target="$(realpath --relative-to="$(dirname -- "$alias_path")" -- "$package_directory")"
    ln -s -- "$relative_target" "$alias_path"
}

# Next's pnpm standalone writer can omit these peer aliases even though its
# runtime resolves them from the release root.
add_pnpm_alias 'styled-jsx'
add_pnpm_alias 'react-dom'
add_pnpm_alias '@swc/helpers'

NSR_RELEASE_DIR="$RELEASE_DIR" python3 <<'PYTHON'
import os
from pathlib import Path

release = Path(os.environ['NSR_RELEASE_DIR']).resolve(strict=True)
for path in release.rglob('*'):
    if not path.is_symlink():
        continue
    target = path.resolve(strict=True)
    try:
        target.relative_to(release)
    except ValueError as error:
        raise SystemExit(f'Refusing to archive external symlink: {path} -> {target}') from error
PYTHON

NSR_RELEASE_DIR="$RELEASE_DIR" node <<'NODE'
const fs = require('fs');
const path = require('path');

const releaseDirectory = process.env.NSR_RELEASE_DIR;
const packagePath = path.join(releaseDirectory, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

packageJson.private = true;
packageJson.scripts = { start: 'node server.js' };

fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 4)}\n`, { mode: 0o644 });
NODE

printf '%s\n' "$COMMIT_SHA" > "$RELEASE_DIR/RELEASE_SHA"

NSR_RELEASE_DIR="$RELEASE_DIR" NSR_COMMIT_SHA="$COMMIT_SHA" node <<'NODE'
const fs = require('fs');
const path = require('path');

const metadata = {
    commit: process.env.NSR_COMMIT_SHA,
    repository: process.env.GITHUB_REPOSITORY || 'local',
    runId: process.env.GITHUB_RUN_ID || null,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
    workflowRef: process.env.GITHUB_WORKFLOW_REF || null,
    actor: process.env.GITHUB_ACTOR || null,
    builtAt: new Date().toISOString(),
    nodeVersion: process.version,
};

fs.writeFileSync(
    path.join(process.env.NSR_RELEASE_DIR, 'deployment-metadata.json'),
    `${JSON.stringify(metadata, null, 4)}\n`,
    { mode: 0o644 }
);
NODE

required_files=(
    server.js
    package.json
    RELEASE_SHA
    deployment-metadata.json
    .next/BUILD_ID
    public/join.html
    emails/welcome.html
    emails/email_validation.html
    emails/sign_in.html
    emails/registration_notification.html
    messages/en.json
    messages/ro.json
    node_modules/pm2/package.json
    node_modules/@prisma/client/package.json
    node_modules/@swc/helpers/package.json
)

for required_file in "${required_files[@]}"; do
    [[ -s "$RELEASE_DIR/$required_file" ]] || {
        echo "Required runtime file is missing: $required_file" >&2
        exit 1
    }
done

mapfile -d '' -t forbidden_environment_files < <(
    find "$RELEASE_DIR" -type f \( -name '.env' -o -name '.env.*' \) -print0
)
if (( ${#forbidden_environment_files[@]} != 0 )); then
    printf 'Refusing to package environment file: %s\n' "${forbidden_environment_files[@]}" >&2
    exit 1
fi

if find "$RELEASE_DIR" -type d -path '*/prisma/migrations' -print -quit | grep -q .; then
    echo 'Refusing to package Prisma migrations.' >&2
    exit 1
fi

(
    cd "$RELEASE_DIR"
    node -e "require.resolve('pm2');"
    node -e "require.resolve('@swc/helpers/_/_interop_require_default');"
    node -e "require.resolve('@prisma/client/runtime/client.js');"
    node -e "require.resolve('@prisma/client/runtime/query_compiler_fast_bg.mysql.mjs');"
    node -e "require.resolve('@prisma/client/runtime/query_compiler_fast_bg.mysql.wasm-base64.mjs');"
)

mkdir -p -- "$(dirname -- "$OUTPUT_ARCHIVE")"

tar \
    --hard-dereference \
    --sort=name \
    --mtime='UTC 1970-01-01' \
    --owner=0 \
    --group=0 \
    --numeric-owner \
    -C "$RELEASE_DIR" \
    -cf - . | gzip -n -9 > "$OUTPUT_ARCHIVE"

python3 "$VALIDATOR" "$OUTPUT_ARCHIVE" "$COMMIT_SHA" >/dev/null

readonly ARTIFACT_SHA256="$(sha256sum "$OUTPUT_ARCHIVE" | awk '{print $1}')"
readonly ARTIFACT_SIZE="$(stat -c '%s' "$OUTPUT_ARCHIVE")"

echo "Artifact: $OUTPUT_ARCHIVE"
echo "SHA-256: $ARTIFACT_SHA256"
echo "Bytes: $ARTIFACT_SIZE"
