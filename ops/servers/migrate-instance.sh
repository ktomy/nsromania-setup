#!/usr/bin/env bash
# Move one Nightscout instance from the main server to an additional hosting server. Run as root on the main server
# (it reaches the target only through the panel's host agent key and MongoDB tunnel, so instance data and secrets go
# server to server):
#
#   migrate-instance.sh preflight SUBDOMAIN SERVER_ID   read-only checks
#   migrate-instance.sh rehearse  SUBDOMAIN SERVER_ID   no downtime: copy the live database to the target, verify the
#                                                       documents and the database user, then drop the copy again
#   migrate-instance.sh migrate   SUBDOMAIN SERVER_ID   copy and switch over (a few minutes of downtime)
#   migrate-instance.sh finalize  SUBDOMAIN SERVER_ID   after verification: drop the stopped app from main's PM2
#   migrate-instance.sh rollback  SUBDOMAIN SERVER_ID   before finalize: return the instance to the main server
#   migrate-instance.sh dropmain  SUBDOMAIN SERVER_ID   after finalize: drop main's copy of the database and its
#                                                       user once they match the move's dump exactly
#
# migrate: backs up the PM2 dump, the app definition, the vhost, the zone file and the panel rows; stops (does not
# delete) the app on main; copies its MongoDB database and database user to the target; starts the identical app
# definition there through the host agent and creates its vhost; health-checks it through the target's nginx; turns
# the main vhost into a forwarder to the target (covers resolvers that still cache the old CNAME); points the CNAME at
# the target; sets ns_domain.server; saves the target's PM2 list. The main copy of the database is kept as the
# rollback source. Everything is written to /var/log/nightscout/backup/migrate-SUBDOMAIN-<UTC>.
#
# Configuration comes from the panel's .env (NS_SERVER_<ID>_SSH, _HOSTNAME, _MONGO_URL, MONGO_URL); only the needed
# keys are parsed and none is printed. Requires the ns_domain.server column (ops/servers/README.md).

set -euo pipefail
export LC_ALL=C PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
umask 077

readonly ACTION="${1:-}" SUB="${2:-}" SERVER="${3:-}"
readonly PANEL_ENV=/var/log/nightscout/setup/.env
readonly NODE=/usr/local/nvm/versions/node/v22.12.0/bin/node
readonly PM2_BIN=/usr/local/lib/node_modules/pm2/bin/pm2
readonly ZONE=/etc/bind/zones/nsromania.info
readonly KEY=/root/.ssh/nsromania-servers/id_ed25519
readonly KNOWN_HOSTS=/root/.ssh/nsromania-servers/known_hosts
readonly DEPLOYMENT_LOCK=/var/log/nightscout/.deployment-control/deployment.lock
readonly BACKUP_ROOT=/var/log/nightscout/backup

[[ $EUID -eq 0 ]] || { echo 'must run as root on the main server' >&2; exit 1; }
[[ $ACTION =~ ^(preflight|rehearse|migrate|finalize|rollback|dropmain)$ ]] || { sed -n '2,26p' "$0"; exit 1; }
[[ $SUB =~ ^[A-Za-z0-9](-?[A-Za-z0-9])*$ && ${#SUB} -le 63 ]] || { echo 'invalid subdomain' >&2; exit 1; }
[[ $SERVER =~ ^[a-z][a-z0-9]{0,31}$ && $SERVER != main ]] || { echo 'invalid server id' >&2; exit 1; }

log() { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
fail() { echo "ERROR: $*" >&2; exit 1; }

pm2() { env -i HOME=/root PM2_HOME=/root/.pm2 PATH="$(dirname "$NODE"):/usr/bin:/bin" "$NODE" "$PM2_BIN" "$@"; }

panel_env() {
    python3 -I - "$PANEL_ENV" "$1" <<'PY'
import re, sys
for line in open(sys.argv[1]):
    match = re.match(r'^\s*' + re.escape(sys.argv[2]) + r'\s*=\s*(.*?)\s*$', line)
    if match:
        value = match.group(1)
        if len(value) >= 2 and value[0] == value[-1] and value[0] in '"\'':
            value = value[1:-1]
        print(value)
        break
PY
}

UPPER="$(tr '[:lower:]' '[:upper:]' <<<"$SERVER")"
SSH_TARGET="$(panel_env "NS_SERVER_${UPPER}_SSH")"
TARGET_HOSTNAME="$(panel_env "NS_SERVER_${UPPER}_HOSTNAME")"
[[ $SSH_TARGET =~ ^nsagent@([0-9.]+)$ ]] || fail "NS_SERVER_${UPPER}_SSH missing in $PANEL_ENV"
readonly TARGET_IP="${BASH_REMATCH[1]}"
[[ -n $TARGET_HOSTNAME ]] || fail "NS_SERVER_${UPPER}_HOSTNAME missing in $PANEL_ENV"

agent() {
    /usr/bin/ssh -F /dev/null -T -i "$KEY" -o IdentitiesOnly=yes -o "UserKnownHostsFile=$KNOWN_HOSTS" \
        -o GlobalKnownHostsFile=/dev/null -o StrictHostKeyChecking=yes -o BatchMode=yes -o ConnectTimeout=10 \
        -- "$SSH_TARGET" "$@"
}

agent_ok() {
    local output
    output="$(agent "$@" </dev/null)" || fail "host agent $1: $output"
    printf '%s\n' "$output"
}

# mongo_eval main|target SCRIPT: run mongosh with the admin URL in the environment, never on the command line
mongo_eval() {
    local url
    if [[ $1 == main ]]; then url="$(panel_env MONGO_URL)"; else url="$(panel_env "NS_SERVER_${UPPER}_MONGO_URL")"; fi
    [[ -n $url ]] || fail "MongoDB URL for $1 missing in $PANEL_ENV"
    MONGO_URI="$url" DB_NAME="$SUB" mongosh --quiet --nodb --eval "const conn = new Mongo(process.env.MONGO_URI); $2" \
        </dev/null
}

# mongo_tool_config main|target FILE: YAML config for mongodump/mongorestore (keeps the URL off the command line)
mongo_tool_config() {
    local url
    if [[ $1 == main ]]; then url="$(panel_env MONGO_URL)"; else url="$(panel_env "NS_SERVER_${UPPER}_MONGO_URL")"; fi
    printf 'uri: "%s"\n' "$url" > "$2"
}

COUNTS_JS='const d = conn.getDB(process.env.DB_NAME);
print(JSON.stringify(d.getCollectionNames().sort().map(c => [c, d.getCollection(c).countDocuments({})])));'

row() {
    # '|' is not whitespace, so empty fields keep their position when read
    mysql -N -B nightscout -e "SELECT CONCAT_WS('|', id, active, db_exists, IFNULL(nsversion, ''), IFNULL(server, ''))
        FROM ns_domain WHERE domain = '$SUB'"
}

app_json() {
    pm2 jlist 2>/dev/null | python3 -I -c '
import json, sys
name = sys.argv[1]
for line in sys.stdin:
    if line.startswith("["):
        for app in json.loads(line):
            if app.get("name") == name:
                print(json.dumps(app))
' "$1"
}

app_field() {
    python3 -I -c '
import json, sys
app = json.load(sys.stdin)
env = app["pm2_env"]
print({"status": env.get("status"), "cwd": env.get("pm_cwd"), "interpreter": env.get("exec_interpreter"),
       "port": env.get("env", {}).get("PORT"), "pm_id": app.get("pm_id")}[sys.argv[1]])' "$1"
}

# --- shared checks ----------------------------------------------------------------------------------------------

[[ "$(mysql -N -B -e "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'nightscout'
    AND table_name = 'ns_domain' AND column_name = 'server'")" == 1 ]] || fail 'ns_domain.server column is missing'

IFS='|' read -r ID ACTIVE DB_EXISTS NSVERSION CURRENT_SERVER < <(row) || true
[[ ${ID:-} =~ ^[0-9]+$ ]] || fail "no ns_domain row for $SUB"
NAME="11$(printf '%03d' "$ID")_$SUB"
PORT=$((11000 + ID))

preflight() {
    log "domain $SUB: id=$ID active=$ACTIVE db_exists=$DB_EXISTS nsversion=${NSVERSION:-<none>} server=${CURRENT_SERVER:-main}"
    [[ $ACTIVE == 1 && $DB_EXISTS == 1 ]] || fail 'the domain must be active and initialized'
    [[ -z $CURRENT_SERVER ]] || fail "the domain is already on ${CURRENT_SERVER}"

    APP="$(app_json "$NAME")"
    [[ -n $APP ]] || fail "PM2 app $NAME not found on the main server"
    log "main PM2: $NAME status=$(app_field status <<<"$APP") port=$(app_field port <<<"$APP")"
    [[ "$(app_field port <<<"$APP")" == "$PORT" ]] || fail 'PM2 port does not match the domain id'
    APP_CWD="$(app_field cwd <<<"$APP")"
    APP_INTERPRETER="$(app_field interpreter <<<"$APP")"
    log "main PM2: cwd=$APP_CWD interpreter=$APP_INTERPRETER"

    local ping
    ping="$(agent_ok ping)"
    log "target: $ping"
    local version_dir
    version_dir="$(basename "$(readlink -f "$APP_CWD")")"
    grep -q "\"$version_dir\"" <<<"$ping" || fail "Nightscout $version_dir is not installed on $SERVER"
    local target_apps
    target_apps="$(agent_ok pm2-list)"
    grep -q "\"$NAME\"" <<<"$target_apps" && fail "$NAME already exists on $SERVER"

    log "main database: $(mongo_eval main "$COUNTS_JS")"
    local target_dbs
    target_dbs="$(mongo_eval target 'print(JSON.stringify(conn.getDB("admin").adminCommand({listDatabases: 1, nameOnly: true}).databases.map(d => d.name)))')"
    grep -q "\"$SUB\"" <<<"$target_dbs" && fail "database $SUB already exists on $SERVER"
    log "target databases: $target_dbs"

    log "zone records: $(grep -ciE "^$SUB[[:space:]]+IN[[:space:]]+CNAME" "$ZONE")"
    [[ -f /etc/nginx/sites-available/$SUB ]] || fail "main vhost /etc/nginx/sites-available/$SUB missing"
    df -h / | tail -1
    log 'preflight ok'
}

USERS_JS='print(JSON.stringify(conn.getDB(process.env.DB_NAME).getUsers().users.map(u => [u.user, u.roles])));'

# copy_database DIR: dump the database and its users from main, restore them on the target and compare
copy_database() {
    local dir="$1" main_counts target_counts main_users target_users
    log 'copying the database and its user'
    mongo_tool_config main "$dir/.dump.yaml"
    mongo_tool_config target "$dir/.restore.yaml"
    # Called in a `||` context, where bash ignores `set -e`: every step checks its own status
    # A directory dump: mongorestore accepts --restoreDbUsersAndRoles only together with --db
    mongodump --config="$dir/.dump.yaml" --db="$SUB" --dumpDbUsersAndRoles --out="$dir/mongo" --gzip --quiet ||
        { rm -f "$dir/.dump.yaml" "$dir/.restore.yaml"; return 1; }
    mongorestore --config="$dir/.restore.yaml" --db="$SUB" --restoreDbUsersAndRoles --gzip --quiet "$dir/mongo/$SUB" ||
        { rm -f "$dir/.dump.yaml" "$dir/.restore.yaml"; return 1; }
    rm -f "$dir/.dump.yaml" "$dir/.restore.yaml"
    main_counts="$(mongo_eval main "$COUNTS_JS")"
    target_counts="$(mongo_eval target "$COUNTS_JS")"
    main_users="$(mongo_eval main "$USERS_JS")"
    target_users="$(mongo_eval target "$USERS_JS")"
    log "documents main:   $main_counts"
    log "documents target: $target_counts"
    log "users main: $main_users target: $target_users"
    [[ $main_counts == "$target_counts" ]] || { echo 'document counts differ' >&2; return 1; }
    [[ $main_users == "$target_users" && $target_users != '[]' ]] || { echo 'database users differ' >&2; return 1; }
}

drop_target_database() {
    mongo_eval target 'const d = conn.getDB(process.env.DB_NAME); d.dropAllUsers(); d.dropDatabase();
        print("dropped", process.env.DB_NAME, "on the target")'
}

rehearse() {
    preflight
    local dir
    dir="$(mktemp -d "$BACKUP_ROOT/rehearse-$SUB-XXXXXX")"
    # Counts may differ while the live instance keeps writing; the user and the restore itself are what matter here
    copy_database "$dir" || log 'counts differ (expected while the instance is online) or users missing; see above'
    drop_target_database
    rm -rf "$dir"
}

health_check() {
    # Through the target's nginx and certificate, bypassing DNS; 200 or 401 means Nightscout is answering
    local code
    for _ in $(seq 1 30); do
        code="$(/usr/bin/curl -sS -o /dev/null -w '%{http_code}' --max-time 10 \
            --resolve "$SUB.nsromania.info:443:$TARGET_IP" "https://$SUB.nsromania.info/api/v1/status.json" || true)"
        [[ $code == 200 || $code == 401 ]] && { log "target health: HTTP $code"; return 0; }
        sleep 2
    done
    return 1
}

set_cname() {
    local target="$1" candidate
    candidate="$(mktemp "$(dirname "$ZONE")/.migrate-candidate.XXXXXX")"
    python3 -I - "$ZONE" "$SUB" "$target" > "$candidate" <<'PY'
import re, sys
zone, label, target = sys.argv[1], sys.argv[2], sys.argv[3]
lines = [l for l in open(zone).read().split('\n')
         if not (re.match(r'^([A-Za-z0-9-]+)\s+IN\s+CNAME\s+\S+\s*$', l)
                 and l.split()[0].lower() == label.lower())]
text = '\n'.join(lines)
if not text.endswith('\n'):
    text += '\n'
sys.stdout.write(text + f'{label}\tIN\tCNAME\t{target}\n')
PY
    chown --reference="$ZONE" "$candidate"
    chmod --reference="$ZONE" "$candidate"
    named-checkzone -q nsromania.info "$candidate" || { rm -f "$candidate"; fail 'zone candidate rejected'; }
    mv -f "$candidate" "$ZONE"
    rndc reload nsromania.info >/dev/null
}

migrate() {
    exec 9<>"$DEPLOYMENT_LOCK"
    flock -n 9 || fail 'a deployment or another migration holds the deployment lock'
    preflight

    W="$BACKUP_ROOT/migrate-$SUB-$(date -u +%Y%m%dT%H%M%SZ)"
    install -d -m 0700 "$W"
    log "work and backup directory: $W"
    cp -a /root/.pm2/dump.pm2 "$W/dump.pm2"
    cp -a "/etc/nginx/sites-available/$SUB" "$W/vhost"
    cp -a "$ZONE" "$W/zone"
    mysqldump --no-tablespaces --skip-extended-insert nightscout ns_domain --where="id=$ID" > "$W/ns_domain.sql"
    mysqldump --no-tablespaces --skip-extended-insert --no-create-info nightscout ns_domain_environment \
        --where="ns_domain_id=$ID" > "$W/ns_domain_environment.sql"
    printf '%s\n' "$APP" > "$W/app.json"
    mysql -N -B nightscout -e "SELECT DISTINCT variable FROM ns_domain_environment WHERE ns_domain_id = $ID" \
        > "$W/environment-variables.txt"

    # The running values, restricted to the keys the panel sets (buildDomainProcess in src/lib/services/nsruntime.ts:
    # its fixed keys plus the domain's environment rows). PM2 also stores the environment of whoever started the app
    # (systemd, PM2 internals, possibly the panel's own configuration), which must not travel to another server.
    python3 -I - "$W/app.json" "$W/environment-variables.txt" > "$W/definition.json" <<'PY'
import json, sys
app = json.load(open(sys.argv[1]))
pm2_env = app['pm2_env']
panel_keys = {'ENABLE', 'SHOW_PLUGINS', 'BRIDGE_USER_NAME', 'BRIDGE_PASSWORD', 'BRIDGE_SERVER', 'API_SECRET',
              'CUSTOM_TITLE', 'INSECURE_USE_HTTP', 'LANGUAGE', 'PORT', 'THEME', 'TIME_FORMAT', 'MONGO_MAX_IDLE_TIME_MS',
              'MONGODB_URI', 'MONGO_CONNECTION'}
allowed = panel_keys | {line.strip() for line in open(sys.argv[2]) if line.strip()}
running = pm2_env.get('env', {})
env = {key: str(value) for key, value in running.items() if key in allowed}
print(json.dumps({'name': app['name'], 'script': 'server.js', 'cwd': pm2_env['pm_cwd'],
                  'interpreter': pm2_env['exec_interpreter'], 'env': env}))
dropped = sorted(key for key in running if key not in allowed)
print('not carried over:', ' '.join(dropped), file=sys.stderr)
PY
    log "definition: $(python3 -I -c 'import json,sys; d=json.load(open(sys.argv[1])); print(len(d["env"]), "variables:", " ".join(sorted(d["env"])))' "$W/definition.json")"

    log "stopping $NAME on main (kept in PM2 for rollback)"
    pm2 stop "$NAME" >/dev/null

    copy_database "$W" || fail 'database copy failed; main app is stopped, run rollback'

    log "starting $NAME on $SERVER"
    agent pm2-start < "$W/definition.json" || fail 'start on the target failed; run rollback'
    echo
    agent_ok vhost-create "$SUB" "$PORT"
    health_check || fail 'target health check failed; run rollback'

    log 'main vhost now forwards to the target'
    cat > "/etc/nginx/sites-available/$SUB" <<EOF
# Moved to $SERVER on $(date -u +%Y-%m-%d) (ops/servers/migrate-instance.sh). Forwards clients that still resolve
# $SUB.nsromania.info to the main server; remove once the CNAME change has propagated (original vhost: $W/vhost).
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name $SUB.nsromania.info;
    location / {
        proxy_pass                    https://$TARGET_IP;
        proxy_ssl_server_name         on;
        proxy_ssl_name                $SUB.nsromania.info;
        proxy_ssl_verify              on;
        proxy_ssl_trusted_certificate /etc/ssl/certs/ca-certificates.crt;
        include /etc/nginx/proxy_params;
    }
    include /etc/nginx/certs_paths;
}
EOF
    if ! nginx -t -q; then
        cp -a "$W/vhost" "/etc/nginx/sites-available/$SUB"
        fail 'nginx rejected the forwarder; original vhost restored; run rollback'
    fi
    systemctl reload nginx

    log "CNAME $SUB -> $TARGET_HOSTNAME."
    set_cname "$TARGET_HOSTNAME."
    log "ns_domain.server = $SERVER"
    [[ "$(mysql -N -B nightscout -e "UPDATE ns_domain SET server = '$SERVER' WHERE id = $ID AND domain = '$SUB'
        AND server IS NULL; SELECT ROW_COUNT();")" == 1 ]] || fail 'ns_domain update did not change exactly one row'

    agent_ok pm2-save
    sleep 3
    /usr/bin/curl -sS -o /dev/null -w "via main forwarder: HTTP %{http_code}\n" --max-time 10 \
        --resolve "$SUB.nsromania.info:443:127.0.0.1" "https://$SUB.nsromania.info/api/v1/status.json" || true
    log "migrated. Verify, then: $0 finalize $SUB $SERVER   (backup: $W)"
}

finalize() {
    exec 9<>"$DEPLOYMENT_LOCK"
    flock -n 9 || fail 'a deployment or another migration holds the deployment lock'
    [[ $CURRENT_SERVER == "$SERVER" ]] || fail "ns_domain.server is not $SERVER"
    agent_ok pm2-list | python3 -I -c '
import json, sys
apps = json.load(sys.stdin)["result"]
status = next((a["status"] for a in apps if a["name"] == sys.argv[1]), None)
sys.exit(0 if status == "online" else f"{sys.argv[1]} is not online on the target ({status})")' "$NAME"

    W="$BACKUP_ROOT/finalize-$SUB-$(date -u +%Y%m%dT%H%M%SZ)"
    install -d -m 0700 "$W"
    cp -a /root/.pm2/dump.pm2 /root/.pm2/dump.pm2.bak "$W/" 2>/dev/null || cp -a /root/.pm2/dump.pm2 "$W/"
    APP="$(app_json "$NAME")"
    if [[ -n $APP ]]; then
        [[ "$(app_field status <<<"$APP")" == stopped ]] || fail "$NAME on main is not stopped"
        pm2 delete "$NAME" >/dev/null
        log "deleted $NAME from main PM2"
    fi
    # Remove only this app from the saved lists (no global pm2 save; see ops/deploy/OPERATIONS.md)
    local dump
    for dump in /root/.pm2/dump.pm2 /root/.pm2/dump.pm2.bak; do
        [[ -f $dump ]] || continue
        python3 -I - "$dump" "$NAME" <<'PY'
import json, os, sys
path, name = sys.argv[1], sys.argv[2]
apps = json.load(open(path))
kept = [app for app in apps if app.get('name') != name]
if len(kept) != len(apps):
    with open(path + '.new', 'w') as handle:
        json.dump(kept, handle)
    os.chmod(path + '.new', os.stat(path).st_mode & 0o7777)
    os.replace(path + '.new', path)
print(f'{path}: {len(apps)} -> {len(kept)} apps')
PY
    done
    log "finalized (backup: $W). The main database $SUB is kept as a rollback source."
}

rollback() {
    exec 9<>"$DEPLOYMENT_LOCK"
    flock -n 9 || fail 'a deployment or another migration holds the deployment lock'
    W="$(ls -d "$BACKUP_ROOT/migrate-$SUB-"* 2>/dev/null | sort | tail -1)"
    [[ -d $W ]] || fail 'no migration backup found'
    APP="$(app_json "$NAME")"
    [[ -n $APP ]] || fail "$NAME is no longer in main PM2 (finalized); restore manually from $W"
    log "rolling back from $W (data written on $SERVER since the migration is NOT copied back)"
    agent pm2-delete "$NAME" </dev/null || true
    echo
    agent vhost-delete "$SUB" </dev/null || true
    echo
    cp -a "$W/vhost" "/etc/nginx/sites-available/$SUB"
    nginx -t -q && systemctl reload nginx
    set_cname 'nsromania.info.'
    mysql nightscout -e "UPDATE ns_domain SET server = NULL WHERE id = $ID AND domain = '$SUB'"
    pm2 restart "$NAME" >/dev/null
    log "restarted $NAME on main; the database copy on $SERVER was left in place"
}

# Runbook step 7: main's database copy may go once the move is finalized, the move's dump holds exactly the same
# documents and users, and nothing is connected to it. The restore command is written next to the dump.
dropmain() {
    exec 9<>"$DEPLOYMENT_LOCK"
    flock -n 9 || fail 'a deployment or another migration holds the deployment lock'
    [[ $CURRENT_SERVER == "$SERVER" ]] || fail "ns_domain.server is not $SERVER"
    [[ -z "$(app_json "$NAME")" ]] || fail "$NAME is still in main PM2; run finalize first"
    W="$(ls -d "$BACKUP_ROOT/migrate-$SUB-"* 2>/dev/null | sort | tail -1)"
    local dump="$W/mongo/$SUB"
    [[ -d $dump ]] || fail "no dump of $SUB in the migration backup"
    if ! mongo_eval main 'print(conn.getDB("admin").adminCommand({listDatabases: 1, nameOnly: true}).databases
            .some(d => d.name === process.env.DB_NAME) ? "present" : "absent")' | grep -qx present; then
        log "main has no database $SUB (already dropped)"
        return 0
    fi

    local summary dump_counts dump_users main_counts main_users connections
    # Document counts and user names straight from the BSON files (each document starts with its int32 length)
    summary="$(python3 -I -c '
import glob, gzip, json, os, struct, sys
def documents(path):
    data = gzip.open(path).read()
    offset, docs = 0, []
    while offset < len(data):
        size = struct.unpack_from("<i", data, offset)[0]
        docs.append(data[offset:offset + size])
        offset += size
    if offset != len(data):
        sys.exit("truncated BSON in " + path)
    return docs
counts = []
for path in sorted(glob.glob(os.path.join(sys.argv[1], "*.bson.gz"))):
    name = os.path.basename(path)[:-len(".bson.gz")]
    if not name.startswith("$admin."):
        counts.append([name, len(documents(path))])
users = []
users_file = os.path.join(sys.argv[1], "$admin.system.users.bson.gz")
if os.path.exists(users_file):
    for doc in documents(users_file):
        key = doc.find(b"\x02user\x00")
        if key < 0:
            sys.exit("user document without a name")
        start = key + len(b"\x02user\x00")
        length = struct.unpack_from("<i", doc, start)[0]
        users.append(doc[start + 4:start + 4 + length - 1].decode())
print(json.dumps(sorted(counts), separators=(",", ":")), json.dumps(sorted(users), separators=(",", ":")))
' "$dump")" || fail 'could not read the dump'
    read -r dump_counts dump_users <<<"$summary"
    main_counts="$(mongo_eval main "$COUNTS_JS")"
    main_users="$(mongo_eval main 'print(JSON.stringify(conn.getDB(process.env.DB_NAME).getUsers().users.map(u => u.user).sort()))')"
    log "documents dump: $dump_counts"
    log "documents main: $main_counts"
    log "users dump: $dump_users main: $main_users"
    [[ $dump_counts == "$main_counts" ]] || fail 'main differs from the dump; not dropping'
    [[ $dump_users == "$main_users" && $main_users != '[]' ]] || fail 'database users differ from the dump; not dropping'
    connections="$(mongo_eval main 'print(conn.getDB("admin").aggregate([{$currentOp: {allUsers: true, idleConnections: true}},
        {$match: {$or: [{"effectiveUsers.user": process.env.DB_NAME},
                        {ns: {$regex: "^" + process.env.DB_NAME.replace(/[-]/g, "\\-") + "\\."}}]}}]).toArray().length)')"
    [[ $connections == 0 ]] || fail "$connections connection(s) still use $SUB on main"

    {
        echo "Main's copy of the $SUB database and its user were dropped on $(date -u +%Y-%m-%dT%H:%M:%SZ) after the move to $SERVER was finalized."
        echo "mongo/$SUB holds them as they were at the move, verified document-for-document against main before the drop."
        echo 'To recreate them on main (run as root on main, with MONGO_URL from the panel .env in the environment, never echoed):'
        echo "  mongorestore --uri=\"\$MONGO_URL\" --gzip --db=$SUB --restoreDbUsersAndRoles $dump"
    } > "$W/RESTORE-MAIN-DB.txt"
    mongo_eval main 'const d = conn.getDB(process.env.DB_NAME); d.dropAllUsers(); d.dropDatabase();
        print("dropped", process.env.DB_NAME, "on main")'
    log "restore instructions: $W/RESTORE-MAIN-DB.txt"
}

"$ACTION"
