#!/usr/bin/env bash
# Move one Nightscout instance between the main server and an additional hosting server, in either direction. Run as
# root on the main server (it reaches the other server only through the panel's host agent key and MongoDB tunnel, so
# instance data and secrets go server to server). SERVER_ID is always the additional server.
#
# Main -> SERVER_ID:
#   migrate-instance.sh preflight SUBDOMAIN SERVER_ID   read-only checks
#   migrate-instance.sh rehearse  SUBDOMAIN SERVER_ID   no downtime: copy the live database to the target, verify the
#                                                       documents and the database user, then drop the copy again
#   migrate-instance.sh migrate   SUBDOMAIN SERVER_ID   copy and switch over (a few minutes of downtime)
#   migrate-instance.sh finalize  SUBDOMAIN SERVER_ID   after verification: drop the stopped app from main's PM2
#   migrate-instance.sh rollback  SUBDOMAIN SERVER_ID   before finalize: return the instance to the main server
#   migrate-instance.sh dropmain  SUBDOMAIN SERVER_ID   after finalize: drop main's copy of the database and its
#                                                       user once they match the move's dump exactly
#
# SERVER_ID -> main (back):
#   migrate-instance.sh preflight-back SUBDOMAIN SERVER_ID   read-only checks
#   migrate-instance.sh migrate-back   SUBDOMAIN SERVER_ID   copy and switch over to main (about a minute of downtime)
#   migrate-instance.sh finalize-back  SUBDOMAIN SERVER_ID   after verification: save the server's PM2 list without it
#   migrate-instance.sh rollback-back  SUBDOMAIN SERVER_ID   before dropremote: return the instance to the server
#   migrate-instance.sh dropremote     SUBDOMAIN SERVER_ID   after finalize-back: drop the server's copy of the
#                                                            database and its user once they match the move's dump
#
# migrate: backs up the PM2 dump, the app definition, the vhost, the zone file and the panel rows; stops (does not
# delete) the app on main; copies its MongoDB database and database user to the target; starts the identical app
# definition there through the host agent and creates its vhost; health-checks it through the target's nginx; turns
# the main vhost into a forwarder to the target (covers resolvers that still cache the old CNAME); points the CNAME at
# the target; sets ns_domain.server; saves the target's PM2 list. The main copy of the database is kept as the
# rollback source. Everything is written to /var/log/nightscout/backup/migrate-SUBDOMAIN-<UTC>.
#
# migrate-back: the same in reverse. Backs up main's PM2 dumps, vhost (if any), the zone file and the panel rows plus
# the instance's definition as the server runs it (agent pm2-describe); deletes the app on the server (its definition
# is kept for rollback-back); copies the database and its user to main; starts the same definition in main's root PM2
# and adds only that app to dump.pm2/dump.pm2.bak (no global save); creates main's vhost from its template and
# health-checks it; turns the server's vhost into a forwarder to main (agent vhost-forward); points the CNAME at main;
# sets ns_domain.server to NULL. The server's copy of the database is kept as the rollback source. Backup directory:
# /var/log/nightscout/backup/migrateback-SUBDOMAIN-<UTC> (a prefix that no forward lookup can match).
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
# Backup directories end in -<UTC stamp>; a bare * would also match sites named SUB-something (glicemia-eliza)
readonly STAMP_GLOB='[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z'
readonly NS_VERSIONS=/usr/local/nsromania/nightscout/versions
readonly NODE_VERSIONS=/usr/local/nvm/versions/node
readonly ERROR_LOG_DIR=/var/log/nightscout/pm2-errors

[[ $EUID -eq 0 ]] || { echo 'must run as root on the main server' >&2; exit 1; }
[[ $ACTION =~ ^(preflight|rehearse|migrate|finalize|rollback|dropmain|preflight-back|migrate-back|finalize-back|rollback-back|dropremote)$ ]] ||
    { sed -n '2,40p' "$0"; exit 1; }
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

# copy_database DIR [FROM TO]: dump the database and its users from FROM (default main), restore them on TO (default
# target) and compare
copy_database() {
    local dir="$1" from="${2:-main}" to="${3:-target}" from_counts to_counts from_users to_users
    log "copying the database and its user ($from -> $to)"
    mongo_tool_config "$from" "$dir/.dump.yaml"
    mongo_tool_config "$to" "$dir/.restore.yaml"
    # Called in a `||` context, where bash ignores `set -e`: every step checks its own status
    # A directory dump: mongorestore accepts --restoreDbUsersAndRoles only together with --db
    mongodump --config="$dir/.dump.yaml" --db="$SUB" --dumpDbUsersAndRoles --out="$dir/mongo" --gzip --quiet ||
        { rm -f "$dir/.dump.yaml" "$dir/.restore.yaml"; return 1; }
    mongorestore --config="$dir/.restore.yaml" --db="$SUB" --restoreDbUsersAndRoles --gzip --quiet "$dir/mongo/$SUB" ||
        { rm -f "$dir/.dump.yaml" "$dir/.restore.yaml"; return 1; }
    rm -f "$dir/.dump.yaml" "$dir/.restore.yaml"
    from_counts="$(mongo_eval "$from" "$COUNTS_JS")" || return 1
    to_counts="$(mongo_eval "$to" "$COUNTS_JS")" || return 1
    from_users="$(mongo_eval "$from" "$USERS_JS")" || return 1
    to_users="$(mongo_eval "$to" "$USERS_JS")" || return 1
    log "documents $from: $from_counts"
    log "documents $to: $to_counts"
    log "users $from: $from_users $to: $to_users"
    [[ $from_counts == "$to_counts" ]] || { echo 'document counts differ' >&2; return 1; }
    [[ $from_users == "$to_users" && $to_users != '[]' ]] || { echo 'database users differ' >&2; return 1; }
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
    # Through that server's nginx and certificate (default: the target), bypassing DNS; 200 or 401 means Nightscout
    # is answering
    local code address="${1:-$TARGET_IP}"
    for _ in $(seq 1 30); do
        code="$(/usr/bin/curl -sS -o /dev/null -w '%{http_code}' --max-time 10 \
            --resolve "$SUB.nsromania.info:443:$address" "https://$SUB.nsromania.info/api/v1/status.json" || true)"
        [[ $code == 200 || $code == 401 ]] && { log "health via $address: HTTP $code"; return 0; }
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

# make_definition APP_JSON VARIABLES_FILE: the PM2 definition to start elsewhere, from the running app (main: a
# `pm2 jlist` entry; a server: the agent's pm2-describe result). Only the keys the panel sets travel
# (buildDomainProcess in src/lib/services/nsruntime.ts: its fixed keys plus the domain's environment rows). PM2 also
# stores the environment of whoever started the app (systemd, PM2 internals, possibly the panel's own configuration),
# which must not travel to another server.
make_definition() {
    python3 -I - "$1" "$2" <<'PY'
import json, sys
app = json.load(open(sys.argv[1]))
if 'pm2_env' in app:
    pm2_env = app['pm2_env']
    running, cwd, interpreter = pm2_env.get('env', {}), pm2_env['pm_cwd'], pm2_env['exec_interpreter']
else:
    running, cwd, interpreter = app['env'], app['cwd'], app['interpreter']
panel_keys = {'ENABLE', 'SHOW_PLUGINS', 'BRIDGE_USER_NAME', 'BRIDGE_PASSWORD', 'BRIDGE_SERVER', 'API_SECRET',
              'CUSTOM_TITLE', 'INSECURE_USE_HTTP', 'LANGUAGE', 'PORT', 'THEME', 'TIME_FORMAT', 'MONGO_MAX_IDLE_TIME_MS',
              'MONGODB_URI', 'MONGO_CONNECTION'}
allowed = panel_keys | {line.strip() for line in open(sys.argv[2]) if line.strip()}
env = {key: str(value) for key, value in running.items() if key in allowed}
print(json.dumps({'name': app['name'], 'script': 'server.js', 'cwd': cwd, 'interpreter': interpreter, 'env': env}))
dropped = sorted(key for key in running if key not in allowed)
print('not carried over:', ' '.join(dropped), file=sys.stderr)
PY
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

    # The running values, restricted to the keys the panel sets (see make_definition)
    make_definition "$W/app.json" "$W/environment-variables.txt" > "$W/definition.json"
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

# dump_remove / dump_add: change only this app's entry in main's saved PM2 lists (no global pm2 save; see
# ops/deploy/OPERATIONS.md). A saved entry is the app's pm2_env without pm_id and instances, as `pm2 save` writes it.
dump_remove() {
    local dump
    for dump in /root/.pm2/dump.pm2 /root/.pm2/dump.pm2.bak; do
        [[ -f $dump ]] || continue
        python3 -I - "$dump" "$NAME" <<'PY' || return 1
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
}

# dump_add APP_FILE: APP_FILE holds the app's `pm2 jlist` entry
dump_add() {
    local dump
    for dump in /root/.pm2/dump.pm2 /root/.pm2/dump.pm2.bak; do
        [[ -f $dump ]] || continue
        python3 -I - "$dump" "$NAME" "$1" <<'PY' || return 1
import json, os, sys
path, name = sys.argv[1], sys.argv[2]
entry = dict(json.load(open(sys.argv[3]))['pm2_env'])
entry.pop('pm_id', None)
entry.pop('instances', None)
if entry.get('name') != name or entry.get('status') != 'online':
    sys.exit(f'{name}: unexpected PM2 entry')
apps = json.load(open(path))
kept = [app for app in apps if app.get('name') != name]
kept.append(entry)
with open(path + '.new', 'w') as handle:
    json.dump(kept, handle)
os.chmod(path + '.new', os.stat(path).st_mode & 0o7777)
os.replace(path + '.new', path)
print(f'{path}: {len(apps)} -> {len(kept)} apps')
PY
    done
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
    dump_remove
    log "finalized (backup: $W). The main database $SUB is kept as a rollback source."
}

rollback() {
    exec 9<>"$DEPLOYMENT_LOCK"
    flock -n 9 || fail 'a deployment or another migration holds the deployment lock'
    W="$(ls -d "$BACKUP_ROOT/migrate-$SUB-"$STAMP_GLOB 2>/dev/null | sort | tail -1)"
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

# Runbook step 7: the source's database copy may go once the move is finalized, the move's dump holds exactly the
# same documents and users, and nothing is connected to it. The restore command is written next to the dump.
# drop_source_copy SIDE PREFIX: SIDE is the source (main or target), PREFIX the move's backup directory prefix.
drop_source_copy() {
    local side="$1" prefix="$2" where uri_name
    if [[ $side == main ]]; then where=main; uri_name=MONGO_URL; else where="$SERVER"; uri_name="NS_SERVER_${UPPER}_MONGO_URL"; fi
    W="$(ls -d "$BACKUP_ROOT/$prefix-$SUB-"$STAMP_GLOB 2>/dev/null | sort | tail -1)"
    local dump="$W/mongo/$SUB"
    [[ -d $dump ]] || fail "no dump of $SUB in the migration backup ($prefix)"
    if [[ "$(has_database "$side")" != present ]]; then
        log "$where has no database $SUB (already dropped)"
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
    main_counts="$(mongo_eval "$side" "$COUNTS_JS")"
    main_users="$(mongo_eval "$side" 'print(JSON.stringify(conn.getDB(process.env.DB_NAME).getUsers().users.map(u => u.user).sort()))')"
    log "documents dump: $dump_counts"
    log "documents $where: $main_counts"
    log "users dump: $dump_users $where: $main_users"
    [[ $dump_counts == "$main_counts" ]] || fail "$where differs from the dump; not dropping"
    [[ $dump_users == "$main_users" && $main_users != '[]' ]] || fail 'database users differ from the dump; not dropping'
    connections="$(mongo_eval "$side" 'print(conn.getDB("admin").aggregate([{$currentOp: {allUsers: true, idleConnections: true}},
        {$match: {$or: [{"effectiveUsers.user": process.env.DB_NAME},
                        {ns: {$regex: "^" + process.env.DB_NAME.replace(/[-]/g, "\\-") + "\\."}}]}}]).toArray().length)')"
    [[ $connections == 0 ]] || fail "$connections connection(s) still use $SUB on $where"

    local restore="$W/RESTORE-MAIN-DB.txt"
    [[ $side == main ]] || restore="$W/RESTORE-${UPPER}-DB.txt"
    {
        echo "The $where copy of the $SUB database and its user were dropped on $(date -u +%Y-%m-%dT%H:%M:%SZ) after the move away from $where was finalized."
        echo "mongo/$SUB holds them as they were at the move, verified document-for-document against $where before the drop."
        echo "To recreate them on $where (run as root on main, with $uri_name from the panel .env in the environment, never echoed):"
        echo "  mongorestore --uri=\"\$$uri_name\" --gzip --db=$SUB --restoreDbUsersAndRoles $dump"
    } > "$restore"
    WHERE="$where" mongo_eval "$side" 'const d = conn.getDB(process.env.DB_NAME); d.dropAllUsers(); d.dropDatabase();
        print("dropped", process.env.DB_NAME, "on", process.env.WHERE)'
    log "restore instructions: $restore"
}

dropmain() {
    exec 9<>"$DEPLOYMENT_LOCK"
    flock -n 9 || fail 'a deployment or another migration holds the deployment lock'
    [[ $CURRENT_SERVER == "$SERVER" ]] || fail "ns_domain.server is not $SERVER"
    [[ -z "$(app_json "$NAME")" ]] || fail "$NAME is still in main PM2; run finalize first"
    drop_source_copy main migrate
}

# --- server -> main ---------------------------------------------------------------------------------------------

describe_target() {
    local output
    output="$(agent pm2-describe "$NAME" </dev/null)" || fail "host agent pm2-describe: $output"
    python3 -I -c 'import json, sys; print(json.dumps(json.loads(sys.stdin.read())["result"]))' <<<"$output"
}

target_field() {
    python3 -I -c 'import json, sys; d = json.load(sys.stdin); print(d.get(sys.argv[1]) if sys.argv[1] != "PORT" else d["env"].get("PORT"))' "$1"
}

# has_database main|target: prints present or absent
has_database() {
    mongo_eval "$1" 'print(conn.getDB("admin").adminCommand({listDatabases: 1, nameOnly: true}).databases
        .some(d => d.name === process.env.DB_NAME) ? "present" : "absent")'
}

# target_has_app: whether the server's PM2 has the app
target_has_app() {
    local apps
    apps="$(agent_ok pm2-list)"
    grep -q "\"$NAME\"" <<<"$apps"
}

# main's vhost may be absent (forwarder removed) or still the forwarder to the server; anything else is unexpected
main_vhost_state() {
    local file="/etc/nginx/sites-available/$SUB"
    if [[ ! -e $file ]]; then echo absent
    elif grep -q "^[[:space:]]*proxy_pass[[:space:]]*https://$TARGET_IP;" "$file"; then echo forwarder
    else echo other; fi
}

preflight_back() {
    log "domain $SUB: id=$ID active=$ACTIVE db_exists=$DB_EXISTS nsversion=${NSVERSION:-<none>} server=${CURRENT_SERVER:-main}"
    [[ $ACTIVE == 1 && $DB_EXISTS == 1 ]] || fail 'the domain must be active and initialized'
    [[ $CURRENT_SERVER == "$SERVER" ]] || fail "the domain is not on $SERVER"

    TARGET_APP="$(describe_target)"
    local status port cwd interpreter version_dir
    status="$(target_field status <<<"$TARGET_APP")"
    port="$(target_field PORT <<<"$TARGET_APP")"
    cwd="$(target_field cwd <<<"$TARGET_APP")"
    interpreter="$(target_field interpreter <<<"$TARGET_APP")"
    log "$SERVER PM2: $NAME status=$status port=$port cwd=$cwd interpreter=$interpreter"
    [[ $status == online ]] || fail "$NAME is not online on $SERVER"
    [[ $port == "$PORT" ]] || fail 'PM2 port does not match the domain id'
    version_dir="$(basename "$cwd")"
    [[ -f $NS_VERSIONS/$version_dir/server.js ]] || fail "Nightscout $version_dir is not installed on main"
    [[ $interpreter == "$NODE_VERSIONS"/v*/bin/node && -x $interpreter ]] || fail "interpreter $interpreter not on main"

    [[ -z "$(app_json "$NAME")" ]] || fail "$NAME already exists in main PM2"
    local target_vhosts
    target_vhosts="$(agent_ok vhost-list)"
    grep -q "\"$SUB\"" <<<"$target_vhosts" || fail "$SERVER has no vhost $SUB"
    log "$SERVER database: $(mongo_eval target "$COUNTS_JS")"
    [[ "$(has_database main)" == absent ]] || fail "database $SUB already exists on main"

    local vhost
    vhost="$(main_vhost_state)"
    log "main vhost: $vhost"
    [[ $vhost != other ]] || fail "/etc/nginx/sites-available/$SUB exists and is not a forwarder to $SERVER"
    [[ -f /etc/nginx/sites-available/_template ]] || fail 'main vhost template missing'
    log "zone records: $(grep -ciE "^$SUB[[:space:]]+IN[[:space:]]+CNAME" "$ZONE")"
    df -h / | tail -1
    log 'preflight-back ok'
}

main_vhost_create() {
    local file="/etc/nginx/sites-available/$SUB" link="/etc/nginx/sites-enabled/$SUB"
    sed -e "s/\[% subdomain %\]/$SUB/g" -e "s/\[% port %\]/$PORT/g" /etc/nginx/sites-available/_template > "$file.new"
    chmod 0644 "$file.new"
    mv -f "$file.new" "$file"
    [[ -L $link ]] || ln -s "$file" "$link"
    nginx -t -q || return 1
    systemctl reload nginx
}

# Main vhost back as it was before migrate-back: the forwarder from the backup, or none
main_vhost_restore() {
    if [[ -f $W/main-vhost ]]; then
        cp -a "$W/main-vhost" "/etc/nginx/sites-available/$SUB"
        [[ -L /etc/nginx/sites-enabled/$SUB ]] || ln -s "/etc/nginx/sites-available/$SUB" "/etc/nginx/sites-enabled/$SUB"
    else
        rm -f "/etc/nginx/sites-enabled/$SUB" "/etc/nginx/sites-available/$SUB"
    fi
    nginx -t -q && systemctl reload nginx
}

migrate_back() {
    exec 9<>"$DEPLOYMENT_LOCK"
    flock -n 9 || fail 'a deployment or another migration holds the deployment lock'
    preflight_back

    W="$BACKUP_ROOT/migrateback-$SUB-$(date -u +%Y%m%dT%H%M%SZ)"
    install -d -m 0700 "$W"
    log "work and backup directory: $W"
    cp -a /root/.pm2/dump.pm2 "$W/dump.pm2"
    if [[ -f /root/.pm2/dump.pm2.bak ]]; then cp -a /root/.pm2/dump.pm2.bak "$W/dump.pm2.bak"; fi
    if [[ -f /etc/nginx/sites-available/$SUB ]]; then cp -a "/etc/nginx/sites-available/$SUB" "$W/main-vhost"; fi
    cp -a "$ZONE" "$W/zone"
    mysqldump --no-tablespaces --skip-extended-insert nightscout ns_domain --where="id=$ID" > "$W/ns_domain.sql"
    mysqldump --no-tablespaces --skip-extended-insert --no-create-info nightscout ns_domain_environment \
        --where="ns_domain_id=$ID" > "$W/ns_domain_environment.sql"
    printf '%s\n' "$TARGET_APP" > "$W/target-app.json"
    mysql -N -B nightscout -e "SELECT DISTINCT variable FROM ns_domain_environment WHERE ns_domain_id = $ID" \
        > "$W/environment-variables.txt"
    # The definition the server runs, restricted like a forward move; rollback-back starts exactly this again there
    make_definition "$W/target-app.json" "$W/environment-variables.txt" > "$W/definition.json"
    log "definition: $(python3 -I -c 'import json,sys; d=json.load(open(sys.argv[1])); print(len(d["env"]), "variables:", " ".join(sorted(d["env"])))' "$W/definition.json")"

    log "deleting $NAME on $SERVER (definition kept in $W for rollback-back)"
    agent_ok pm2-delete "$NAME"

    copy_database "$W" target main || fail 'database copy failed; the app is stopped everywhere, run rollback-back'

    log "starting $NAME on main"
    # Same layout as the panel and the host agent: stdout discarded, stderr per instance (pm2-logrotate)
    python3 -I - "$W/definition.json" "$ERROR_LOG_DIR" > "$W/.main-app.json" <<'PY'
import json, os, sys
d = json.load(open(sys.argv[1]))
print(json.dumps({'apps': [{'name': d['name'], 'script': 'server.js', 'cwd': d['cwd'], 'interpreter': d['interpreter'],
                            'env': {'NODE_ENV': 'production', **d['env']}, 'out_file': '/dev/null',
                            'error_file': os.path.join(sys.argv[2], d['name'] + '.log'), 'merge_logs': True}]}))
PY
    pm2 start "$W/.main-app.json" >/dev/null || { rm -f "$W/.main-app.json"; fail 'start on main failed; run rollback-back'; }
    rm -f "$W/.main-app.json"
    local status=''
    for _ in $(seq 1 20); do
        APP="$(app_json "$NAME")"
        status="$(app_field status <<<"$APP" 2>/dev/null || true)"
        [[ $status == online ]] && break
        sleep 1
    done
    [[ $status == online ]] || fail "$NAME is $status on main; run rollback-back"

    main_vhost_create || fail 'nginx rejected the main vhost; run rollback-back'
    health_check 127.0.0.1 || fail 'main health check failed; run rollback-back'

    log "$SERVER vhost now forwards to main"
    agent_ok vhost-forward "$SUB"
    log "CNAME $SUB -> nsromania.info."
    set_cname 'nsromania.info.'
    log 'ns_domain.server = NULL (main)'
    [[ "$(mysql -N -B nightscout -e "UPDATE ns_domain SET server = NULL WHERE id = $ID AND domain = '$SUB'
        AND server = '$SERVER'; SELECT ROW_COUNT();")" == 1 ]] || fail 'ns_domain update did not change exactly one row'

    printf '%s\n' "$APP" > "$W/main-app.json"
    dump_add "$W/main-app.json" || fail "could not add $NAME to main's saved PM2 lists (backups in $W)"
    sleep 3
    /usr/bin/curl -sS -o /dev/null -w "via $SERVER forwarder: HTTP %{http_code}\n" --max-time 10 \
        --resolve "$SUB.nsromania.info:443:$TARGET_IP" "https://$SUB.nsromania.info/api/v1/status.json" || true
    log "migrated back. Verify, then: $0 finalize-back $SUB $SERVER   (backup: $W)"
}

finalize_back() {
    exec 9<>"$DEPLOYMENT_LOCK"
    flock -n 9 || fail 'a deployment or another migration holds the deployment lock'
    [[ -z $CURRENT_SERVER ]] || fail "ns_domain.server is $CURRENT_SERVER, not main"
    APP="$(app_json "$NAME")"
    [[ -n $APP && "$(app_field status <<<"$APP")" == online ]] || fail "$NAME is not online on main"
    if target_has_app; then fail "$NAME still exists on $SERVER"; fi
    local saved
    saved="$(agent_ok pm2-save)"
    echo "$saved"
    grep -q '"saved": true' <<<"$saved" || fail "$SERVER did not save its PM2 list (fewer than 90% online)"
    log "finalized: $SERVER's saved PM2 list no longer has $NAME. Its database copy stays until dropremote."
}

rollback_back() {
    exec 9<>"$DEPLOYMENT_LOCK"
    flock -n 9 || fail 'a deployment or another migration holds the deployment lock'
    W="$(ls -d "$BACKUP_ROOT/migrateback-$SUB-"$STAMP_GLOB 2>/dev/null | sort | tail -1)"
    [[ -d $W && -f $W/definition.json ]] || fail 'no migrate-back backup with a definition found'
    [[ "$(has_database target)" == present ]] ||
        fail "$SERVER no longer has the database $SUB (dropremote ran); restore manually from $W"
    log "rolling back from $W (data written on main since the move is NOT copied back)"
    if [[ -n "$(app_json "$NAME")" ]]; then
        pm2 delete "$NAME" >/dev/null
        log "deleted $NAME from main PM2"
    fi
    dump_remove
    main_vhost_restore
    agent_ok vhost-create "$SUB" "$PORT"
    if ! target_has_app; then
        agent pm2-start < "$W/definition.json" || fail "start on $SERVER failed"
        echo
    fi
    set_cname "$TARGET_HOSTNAME."
    mysql nightscout -e "UPDATE ns_domain SET server = '$SERVER' WHERE id = $ID AND domain = '$SUB'"
    agent_ok pm2-save
    log "$NAME runs on $SERVER again; the database copy on main was left in place"
}

dropremote() {
    exec 9<>"$DEPLOYMENT_LOCK"
    flock -n 9 || fail 'a deployment or another migration holds the deployment lock'
    [[ -z $CURRENT_SERVER ]] || fail "ns_domain.server is $CURRENT_SERVER, not main"
    APP="$(app_json "$NAME")"
    [[ -n $APP && "$(app_field status <<<"$APP")" == online ]] || fail "$NAME is not online on main"
    if target_has_app; then fail "$NAME still exists on $SERVER; run finalize-back first"; fi
    drop_source_copy target migrateback
}

case $ACTION in
    preflight-back) preflight_back ;;
    migrate-back) migrate_back ;;
    finalize-back) finalize_back ;;
    rollback-back) rollback_back ;;
    *) "$ACTION" ;;
esac
