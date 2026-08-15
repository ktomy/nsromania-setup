#!/usr/bin/env bash

set -euo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

usage() {
    echo "Usage: $0 ARTIFACT COMMIT_SHA" >&2
    exit 2
}

[[ $# -eq 2 ]] || usage

readonly ARTIFACT="$(realpath -- "$1")"
readonly COMMIT_SHA="$2"

[[ "$COMMIT_SHA" =~ ^[0-9a-f]{40}$ ]] || usage
[[ "$(node --version)" == 'v22.12.0' ]] || {
    echo 'Artifact smoke test requires Node v22.12.0.' >&2
    exit 1
}

python3 "$SCRIPT_DIR/validate-artifact.py" "$ARTIFACT" "$COMMIT_SHA" >/dev/null

readonly TEMP_ROOT="$(mktemp -d)"
readonly RELEASE_DIR="$TEMP_ROOT/release"
readonly SERVER_LOG="$TEMP_ROOT/server.log"
readonly PORT_VALUE="$((31000 + RANDOM % 1000))"
SERVER_PID=''

cleanup() {
    if [[ -n "$SERVER_PID" ]]; then
        kill "$SERVER_PID" 2>/dev/null || true
        wait "$SERVER_PID" 2>/dev/null || true
    fi
    rm -rf -- "$TEMP_ROOT"
}
trap cleanup EXIT

mkdir -p -- "$RELEASE_DIR"
tar -xzf "$ARTIFACT" -C "$RELEASE_DIR"

(
    cd "$RELEASE_DIR"
    env \
        AUTH_SECRET='standalone-smoke-only-secret-value' \
        AUTH_TRUST_HOST='true' \
        DATABASE_URL='mysql://smoke:smoke@127.0.0.1:9/smoke_only' \
        MONGO_URL='mongodb://127.0.0.1:9/smoke_only' \
        HOSTNAME='127.0.0.1' \
        PORT="$PORT_VALUE" \
        NODE_ENV='production' \
        node server.js > "$SERVER_LOG" 2>&1
) &
SERVER_PID=$!

healthy=false
for _attempt in {1..30}; do
    if node "$SCRIPT_DIR/health-check.mjs" \
        "http://127.0.0.1:${PORT_VALUE}/api/health?deployment=${COMMIT_SHA}" \
        "$COMMIT_SHA" >/dev/null 2>&1; then
        healthy=true
        break
    fi
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
        break
    fi
    sleep 1
done

if [[ "$healthy" != 'true' ]]; then
    echo 'Standalone artifact did not become healthy.' >&2
    tail -n 100 "$SERVER_LOG" >&2 || true
    exit 1
fi

curl --fail --silent --show-error --max-time 5 \
    --output /dev/null "http://127.0.0.1:${PORT_VALUE}/join.html"

static_file="$(find "$RELEASE_DIR/.next/static" -type f -print -quit)"
[[ -n "$static_file" ]] || {
    echo 'Standalone artifact has no static files.' >&2
    exit 1
}
static_path="/_next/static/${static_file#"$RELEASE_DIR/.next/static/"}"
curl --fail --silent --show-error --max-time 5 \
    --output /dev/null "http://127.0.0.1:${PORT_VALUE}${static_path}"

echo "Standalone artifact smoke test passed: $COMMIT_SHA"
