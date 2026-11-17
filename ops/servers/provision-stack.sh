#!/usr/bin/env bash
# Phase 2 of preparing an additional Nightscout hosting server. Run as root on the new host after
# provision-base.sh and copy-from-main.sh:
#
#   provision-stack.sh STAGING_DIR REPO_OPS_DIR
#
# STAGING_DIR holds the files copied from the main server (copy-from-main.sh); REPO_OPS_DIR is a copy of this
# repository's ops/ directory. Installs, mirroring the main server:
#   - MongoDB 8.3 (official noble repo, main server's keyring), loopback-only with authorization, the main server's
#     mongod.conf, CPU priority/OOM drop-in, hourly bounded log rotation, and an admin user `nsadmin` whose password
#     is generated here and kept only in /root/.nsromania/mongo-admin.env (0600);
#   - Node 22.12.0 at /usr/local/nvm/versions/node/v22.12.0 and PM2 at /usr/local/lib/node_modules/pm2;
#   - Nightscout versions at /var/log/nightscout/versions (= /usr/local/nsromania/nightscout/versions);
#   - pm2-root.service with the reboot timeout and dump-guard protections, and pm2-logrotate;
#   - nginx with the main server's nginx.conf, proxy parameters, wildcard certificate and vhost template, an
#     HTTP->HTTPS redirect, and a default HTTPS server that sends unknown names to the setup panel.
# Replaced files are backed up to /var/log/nightscout/backup/provision-stack-<UTC>.

set -euo pipefail
export DEBIAN_FRONTEND=noninteractive LC_ALL=C

readonly STAGING="${1:?usage: provision-stack.sh STAGING_DIR REPO_OPS_DIR}"
readonly OPS="${2:?usage: provision-stack.sh STAGING_DIR REPO_OPS_DIR}"
readonly BACKUP="/var/log/nightscout/backup/provision-stack-$(date -u +%Y%m%dT%H%M%SZ)"
readonly NODE_DIR=/usr/local/nvm/versions/node/v22.12.0
readonly NODE="$NODE_DIR/bin/node"
readonly PM2=/usr/local/lib/node_modules/pm2/bin/pm2
readonly MONGO_SERIES=8.3

[[ $EUID -eq 0 ]] || { echo 'must run as root' >&2; exit 1; }
[[ -d $STAGING/etc && -d $STAGING/usr ]] || { echo "not a staging directory: $STAGING" >&2; exit 1; }
[[ -f $OPS/pm2/pm2-dump-guard.mjs ]] || { echo "not the repository ops directory: $OPS" >&2; exit 1; }

backup() {
    local target
    for target in "$@"; do
        [[ -e $target || -L $target ]] || continue
        install -d -m 0700 "$BACKUP"
        cp -a --parents "$target" "$BACKUP/"
    done
}

# install_file SOURCE TARGET MODE: back up a differing target, then replace it atomically
install_file() {
    local source="$1" target="$2" mode="$3"
    if [[ -e $target ]] && cmp -s "$source" "$target"; then
        chmod "$mode" "$target"
        return
    fi
    backup "$target"
    install -d -m 0755 "$(dirname "$target")"
    install -o root -g root -m "$mode" "$source" "$target.new"
    mv -f "$target.new" "$target"
    echo "installed $target"
}

echo '== MongoDB'
install_file "$STAGING/usr/share/keyrings/mongodb-server-8.0.gpg" /usr/share/keyrings/mongodb-server-8.0.gpg 0644
echo "deb [ arch=amd64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/$MONGO_SERIES multiverse" \
    > "$STAGING/mongodb-org.list"
install_file "$STAGING/mongodb-org.list" /etc/apt/sources.list.d/mongodb-org-$MONGO_SERIES.list 0644
apt-get update -q
apt-get -y -q -o Dpkg::Options::=--force-confold install mongodb-org
install_file "$STAGING/etc/mongod.conf" /etc/mongod.conf 0644
install_file "$OPS/mongod/mongod.service.d/priority.conf" /etc/systemd/system/mongod.service.d/priority.conf 0644
install_file "$STAGING/etc/logrotate.d/mongodb-server" /etc/logrotate.d/mongodb-server 0644
install_file "$STAGING/etc/systemd/system/nsromania-mongodb-logrotate.service" \
    /etc/systemd/system/nsromania-mongodb-logrotate.service 0644
install_file "$STAGING/etc/systemd/system/nsromania-mongodb-logrotate.timer" \
    /etc/systemd/system/nsromania-mongodb-logrotate.timer 0644
systemctl daemon-reload
systemctl enable --now mongod nsromania-mongodb-logrotate.timer
for _ in $(seq 1 30); do
    mongosh --quiet --eval 'db.runCommand({ ping: 1 }).ok' 2>/dev/null | grep -q 1 && break
    sleep 1
done

install -d -m 0700 /root/.nsromania
if [[ ! -s /root/.nsromania/mongo-admin.env ]]; then
    (umask 077 && printf 'MONGO_ADMIN_USER=nsadmin\nMONGO_ADMIN_PASSWORD=%s\n' "$(openssl rand -hex 24)" \
        > /root/.nsromania/mongo-admin.env)
fi
# Create the admin user unless its stored credentials already work. Before any user exists, MongoDB's localhost
# exception permits createUser (but not usersInfo). The password stays in this mongosh process's environment and
# never appears on a command line.
(
    set -a
    # shellcheck disable=SC1091
    . /root/.nsromania/mongo-admin.env
    set +a
    mongosh --quiet --nodb --eval '
        const user = process.env.MONGO_ADMIN_USER;
        const pwd = process.env.MONGO_ADMIN_PASSWORD;
        let present = false;
        try {
            present = new Mongo("mongodb://127.0.0.1:27017").getDB("admin").auth(user, pwd).ok === 1;
        } catch (error) {
            present = false;
        }
        if (present) {
            print("admin user " + user + " present");
        } else {
            new Mongo("mongodb://127.0.0.1:27017").getDB("admin").createUser({ user, pwd,
                roles: [{ role: "root", db: "admin" }] });
            print("created admin user " + user);
        }'
)
mongod --version | head -1

echo '== Node and PM2'
if [[ ! -x $NODE ]]; then
    install -d -m 0755 /usr/local/nvm/versions/node
    cp -a "$STAGING/$NODE_DIR" /usr/local/nvm/versions/node/
fi
if [[ ! -x $PM2 ]]; then
    install -d -m 0755 /usr/local/lib/node_modules
    cp -a "$STAGING/usr/local/lib/node_modules/pm2" /usr/local/lib/node_modules/
fi
for bin in pm2 pm2-dev pm2-docker pm2-runtime; do
    ln -sfn "../lib/node_modules/pm2/bin/$bin" "/usr/local/bin/$bin"
done
"$NODE" --version

echo '== Nightscout versions'
for version_dir in "$STAGING"/var/log/nightscout/versions/*; do
    name="$(basename "$version_dir")"
    target="/var/log/nightscout/versions/$name"
    [[ -e $target || -L $target ]] && continue
    install -d -m 0755 -o root -g nightscout /var/log/nightscout/versions
    cp -a "$version_dir" "$target"
    echo "installed Nightscout $name"
done
chgrp nightscout /var/log/nightscout/versions

echo '== PM2 service'
install_file "$OPS/pm2/pm2-dump-guard.mjs" /usr/local/sbin/nsromania-pm2-dump-guard.mjs 0755
install_file "$OPS/pm2/pm2-root.service.d/timeouts.conf" /etc/systemd/system/pm2-root.service.d/timeouts.conf 0644
install_file "$OPS/pm2/pm2-root.service.d/dump-guard.conf" /etc/systemd/system/pm2-root.service.d/dump-guard.conf 0644
sed 's/^After=network-online.target mysql.service mongod.service$/After=network-online.target mongod.service/' \
    "$STAGING/etc/systemd/system/pm2-root.service" > "$STAGING/pm2-root.service.d1"
install_file "$STAGING/pm2-root.service.d1" /etc/systemd/system/pm2-root.service 0644
systemctl daemon-reload
pm2_env=(env -i HOME=/root PM2_HOME=/root/.pm2 "PATH=$NODE_DIR/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin")
if ! systemctl is-active --quiet pm2-root; then
    # First start: create the daemon, add pm2-logrotate with the main server's settings, save an empty list
    "${pm2_env[@]}" "$NODE" "$PM2" ping >/dev/null
    if [[ ! -d /root/.pm2/modules/pm2-logrotate ]]; then
        "${pm2_env[@]}" "$NODE" "$PM2" install pm2-logrotate >/dev/null
    fi
    while read -r key value; do
        "${pm2_env[@]}" "$NODE" "$PM2" set "pm2-logrotate:$key" "$value" >/dev/null
    done < <(python3 -I -c '
import json, sys
for k, v in json.load(open(sys.argv[1]))["pm2-logrotate"].items():
    print(k, v)' "$STAGING/root/.pm2/module_conf.json")
    "${pm2_env[@]}" "$NODE" "$PM2" save --force >/dev/null
    "${pm2_env[@]}" "$NODE" "$PM2" kill >/dev/null
fi
systemctl enable --now pm2-root
"${pm2_env[@]}" "$NODE" "$PM2" ls

echo '== nginx'
install_file "$STAGING/etc/nginx/nginx.conf" /etc/nginx/nginx.conf 0644
install_file "$STAGING/etc/nginx/proxy_params" /etc/nginx/proxy_params 0644
install_file "$STAGING/etc/nginx/certs_paths" /etc/nginx/certs_paths 0644
install -d -m 0755 /etc/nginx/cert
install_file "$STAGING/etc/nginx/cert/star_nsromania_info.crt" /etc/nginx/cert/star_nsromania_info.crt 0644
install_file "$STAGING/etc/nginx/cert/star_nsromania_info.key" /etc/nginx/cert/star_nsromania_info.key 0600
install_file "$STAGING/etc/nginx/sites-available/_template" /etc/nginx/sites-available/_template 0644
install_file "$STAGING/etc/nginx/sites-available/default" /etc/nginx/sites-available/default 0644
cat > "$STAGING/00-default" <<'EOF'
# Names without their own vhost (e.g. a CNAME pointing here before initialization) go to the setup panel
server {
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    server_name _;
    return 301 https://setup.nsromania.info/;
    include /etc/nginx/certs_paths;
}
EOF
install_file "$STAGING/00-default" /etc/nginx/sites-available/00-default 0644
ln -sfn /etc/nginx/sites-available/00-default /etc/nginx/sites-enabled/00-default
ln -sfn /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo '== checks'
openssl x509 -in /etc/nginx/cert/star_nsromania_info.crt -noout -subject -enddate
ss -tlnp | awk '/LISTEN/ {print $4, $6}' | sed 's/users://'
[[ -d $BACKUP ]] && echo "backup: $BACKUP"
echo 'provision-stack: done'
