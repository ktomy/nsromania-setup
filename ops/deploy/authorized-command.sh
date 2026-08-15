#!/usr/bin/env bash

set -Eeuo pipefail

export LC_ALL=C
export PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
umask 077

readonly INCOMING_DIR='/var/log/nightscout/incoming'
readonly UPLOAD_LOCK='/var/log/nightscout/.deployment-control/upload.lock'
readonly ACTIVATOR='/usr/local/sbin/nsromania-activate-release'
readonly MAX_UPLOAD_BYTES=1073741824
readonly RESERVED_BYTES=1073741824
readonly ORIGINAL_COMMAND="${SSH_ORIGINAL_COMMAND:-}"

UPLOAD_TEMP_FILE=''

cleanup_upload() {
    if [[ -n "$UPLOAD_TEMP_FILE" && -f "$UPLOAD_TEMP_FILE" && "$UPLOAD_TEMP_FILE" == "$INCOMING_DIR"/.upload-* ]]; then
        rm -f -- "$UPLOAD_TEMP_FILE"
    fi
}
trap cleanup_upload EXIT

fail() {
    echo "Deployment command rejected: $1" >&2
    exit 1
}

receive_upload() {
    local commit_sha="$1"
    local checksum="$2"
    local size_value="$3"
    local size=$((10#$size_value))
    local available_bytes
    local final_file
    local actual_size
    local actual_checksum
    local extra_bytes

    (( size > 0 && size <= MAX_UPLOAD_BYTES )) || fail 'artifact size is outside the allowed range'
    [[ -d "$INCOMING_DIR" && ! -L "$INCOMING_DIR" ]] || fail 'incoming directory is unavailable'

    [[ -f "$UPLOAD_LOCK" && ! -L "$UPLOAD_LOCK" ]] || fail 'upload lock is unavailable'
    exec 9<>"$UPLOAD_LOCK"
    flock -n 9 || fail 'another artifact upload is in progress'

    available_bytes="$(df -P -B1 "$INCOMING_DIR" | awk 'NR == 2 {print $4}')"
    [[ "$available_bytes" =~ ^[0-9]+$ ]] || fail 'unable to determine available space'
    (( available_bytes >= size + RESERVED_BYTES )) || fail 'insufficient disk space for artifact upload'

    UPLOAD_TEMP_FILE="$(mktemp --tmpdir="$INCOMING_DIR" ".upload-${commit_sha}.XXXXXXXX")"
    final_file="$INCOMING_DIR/${commit_sha}-${checksum}.tar.gz"

    head -c "$size" > "$UPLOAD_TEMP_FILE"
    actual_size="$(stat -c '%s' "$UPLOAD_TEMP_FILE")"
    [[ "$actual_size" == "$size" ]] || fail 'artifact stream ended before the declared size'

    extra_bytes="$(dd bs=1 count=1 status=none | wc -c)"
    [[ "$extra_bytes" == '0' ]] || fail 'artifact stream exceeds the declared size'

    actual_checksum="$(sha256sum "$UPLOAD_TEMP_FILE" | awk '{print $1}')"
    [[ "$actual_checksum" == "$checksum" ]] || fail 'artifact checksum mismatch'

    if [[ -e "$final_file" ]]; then
        [[ -f "$final_file" && ! -L "$final_file" ]] || fail 'existing artifact is not a regular file'
        [[ "$(stat -c '%s' "$final_file")" == "$size" ]] || fail 'existing artifact size differs'
        [[ "$(sha256sum "$final_file" | awk '{print $1}')" == "$checksum" ]] || fail 'existing artifact differs'
        rm -f -- "$UPLOAD_TEMP_FILE"
        echo "Artifact already uploaded: $commit_sha"
        UPLOAD_TEMP_FILE=''
        return 0
    fi

    chmod 0600 "$UPLOAD_TEMP_FILE"
    mv --no-clobber -T -- "$UPLOAD_TEMP_FILE" "$final_file"
    [[ -f "$final_file" && ! -L "$final_file" ]] || fail 'uploaded artifact was not placed safely'
    [[ "$(stat -c '%s' "$final_file")" == "$size" ]] || fail 'placed artifact size differs'
    [[ "$(sha256sum "$final_file" | awk '{print $1}')" == "$checksum" ]] || fail 'placed artifact checksum differs'
    rm -f -- "$UPLOAD_TEMP_FILE"
    UPLOAD_TEMP_FILE=''
    echo "Artifact uploaded: $commit_sha"
}

if [[ "$ORIGINAL_COMMAND" =~ ^upload\ ([0-9a-f]{40})\ ([0-9a-f]{64})\ ([1-9][0-9]{0,9})$ ]]; then
    receive_upload "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}"
elif [[ "$ORIGINAL_COMMAND" =~ ^deploy\ ([0-9a-f]{40})\ ([0-9a-f]{64})$ ]]; then
    exec </dev/null
    exec /usr/bin/sudo -n -- "$ACTIVATOR" "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
else
    fail 'only exact upload and deploy commands are permitted'
fi
