#!/usr/bin/env bash
# Move the listed sites to SERVER one by one with migrate-instance.sh. Run as root on main, in the staging dir.
#   batch-migrate.sh LIST SERVER
# Stops when STOP exists next to this script, after 3 consecutive or 6 total failures. A failed migrate (after its
# backup directory exists) is rolled back immediately. Results: results.tsv (SUB, status, seconds).
set -uo pipefail
export LC_ALL=C PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
DIR="$(cd "$(dirname "$0")" && pwd)"
LIST="$1" SERVER="$2"
consecutive=0 failures=0 n=0
while read -r SUB; do
    [[ -n $SUB ]] || continue
    n=$((n + 1))
    if [[ -e $DIR/STOP ]]; then echo "STOP file present; stopping before $SUB"; break; fi
    echo "=== [$n] $SUB $(date -u +%FT%TZ)"
    before="$(ls -d /var/log/nightscout/backup/migrate-"$SUB"-* 2>/dev/null | wc -l)"
    start=$SECONDS
    if bash "$DIR/migrate-instance.sh" migrate "$SUB" "$SERVER"; then
        printf '%s\tok\t%s\n' "$SUB" $((SECONDS - start)) >> "$DIR/results.tsv"
        consecutive=0
    else
        after="$(ls -d /var/log/nightscout/backup/migrate-"$SUB"-* 2>/dev/null | wc -l)"
        if [[ $after -gt $before ]]; then
            echo "--- migrate failed after backup; rolling back $SUB"
            if bash "$DIR/migrate-instance.sh" rollback "$SUB" "$SERVER"; then st=failed-rolledback; else st=failed-ROLLBACK-FAILED; fi
        else
            st=failed-preflight
        fi
        printf '%s\t%s\t%s\n' "$SUB" "$st" $((SECONDS - start)) >> "$DIR/results.tsv"
        consecutive=$((consecutive + 1)); failures=$((failures + 1))
        [[ $st == failed-ROLLBACK-FAILED ]] && { echo 'rollback failed; stopping'; break; }
        [[ $consecutive -ge 3 || $failures -ge 6 ]] && { echo "too many failures ($consecutive consecutive, $failures total); stopping"; break; }
    fi
    sleep 2
done < "$LIST"
echo "=== batch finished $(date -u +%FT%TZ)"
