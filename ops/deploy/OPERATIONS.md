# Production deployment operations handoff

Read this file and `ops/deploy/README.md` before changing CI/CD, deployment helpers, PM2, production files, server permissions, SSH configuration, or application runtime behavior.

This document contains no secret values. Never add private keys, passwords, `.env` contents, database URLs, OAuth credentials, MongoDB credentials, or email credentials to it.

## Non-negotiable rules

1. Never run a Prisma migration, `db push`, seed, database CLI, database query, or database setup/check script against production during deployment work.
2. Never invoke `hosting/vps-setup.sh`, `hosting/scripts/04-database-setup.sh`, the legacy `deploy/deploy_on_server.sh`, or another hosting installer as part of CI/CD.
3. Before changing, replacing, or deleting any existing production file, create a timestamped, permission-restricted backup on the server. Do not prune backups automatically.
4. Production `.env` stays on the server. Do not source it, print it, upload it, put it in an artifact, or store its values in GitHub.
5. The server has multiple Node versions. Never use `nvm use stable` or an ambient `node`, `npm`, `pnpm`, or PM2 path for the panel.
6. Do not run a broad PM2 operation such as `restart all`, `delete all`, `pm2 kill`, `save`, or `resurrect`. Touch only the single audited process named `setup-ns`.
7. Do not modify firewall rules as part of deployment work.
8. Use strict SSH host-key verification. Do not make a runtime `ssh-keyscan` result the trust decision and do not disable host verification.

## Stable production topology

| Purpose | Value |
| --- | --- |
| Host | `nsromania.info` |
| Public IPv4 | `45.134.39.79` |
| Audited OS | Ubuntu 24.04.4 LTS |
| Canonical application base | `/var/log/nightscout` |
| Legacy path | `/usr/local/nsromania/nightscout` is a symlink to `/var/log/nightscout` |
| Live panel | `/var/log/nightscout/setup` |
| Application backups | `/var/log/nightscout/backup` |
| Application artifact inbox | `/var/log/nightscout/incoming` |
| Candidate extraction root | `/var/log/nightscout/.staging` |
| Deployment control | `/var/log/nightscout/.deployment-control` |
| Helper package inbox | `/var/log/nightscout/helper-updates` |
| GitHub deploy home | `/var/log/nightscout/.github-deploy-home` |
| Panel port | `127.0.0.1:11000` |
| Public URL | `https://setup.nsromania.info` |
| Health endpoint | `/api/health` (does not import or call auth/Prisma services) |

The live production environment file is `/var/log/nightscout/setup/.env`. Its last verified metadata was `ktomy:nightscout` mode `0600`. The application deployment copies it into a fully prepared candidate immediately before activation; it never includes it in the uploaded artifact.

### Node and PM2

The only supported panel runtime paths are:

```text
Node: /usr/local/nvm/versions/node/v22.12.0/bin/node
npm:  /usr/local/nvm/versions/node/v22.12.0/bin/npm
PM2:  /usr/local/lib/node_modules/pm2/bin/pm2
PM2_HOME: /root/.pm2
PM2 dump: /root/.pm2/dump.pm2
Process name: setup-ns
```

`setup-ns` belongs to the root PM2 daemon, not the `ktomy` PM2 daemon. Noninteractive SSH has a different PATH from an interactive shell, so use the absolute paths above with a minimal explicit environment.

The saved root PM2 definition intentionally remains the audited Node 22.12.0 `npm start` definition. Release artifacts rewrite `npm start` to `node server.js`, keeping reboot resurrection compatible. Do not run `pm2 save` without a separate review: root PM2 supervises hundreds of Nightscout processes, so saving the whole daemon has a much larger scope than this panel.

### Accounts and privilege boundaries

- `nsdeploy` is the locked GitHub Actions account. Its key has an OpenSSH forced command and `restrict`; it cannot obtain a shell or forward ports.
- `nsdeploy` has passwordless sudo only for `/usr/local/sbin/nsromania-activate-release` with validated arguments.
- `ktomy` is the ordinary administrative/upload account used by `update-server-helpers.sh`. Helper installation requires an interactive sudo password. Do not add a passwordless helper-update sudo rule.
- GitHub does not receive an administrative sudo password or any application/database secret.

The last verified GitHub deployment public-key fingerprint was:

```text
SHA256:4pilkCW2bjPgX+ch8sVa7WGu1AJ1Z5gulrNLRmgLIxM
```

Treat this as a dated verification value; re-verify it whenever the deployment key is rotated.

### Installed server helpers

| Repository source | Production target | Mode |
| --- | --- | --- |
| `activate-release.sh` | `/usr/local/sbin/nsromania-activate-release` | `0755` |
| `authorized-command.sh` | `/usr/local/libexec/nsromania-deploy-command` | `0755` |
| `validate-artifact.py` | `/usr/local/libexec/nsromania-validate-artifact` | `0755` |
| `health-check.mjs` | `/usr/local/libexec/nsromania-health-check.mjs` | `0755` |
| `port-check.mjs` | `/usr/local/libexec/nsromania-port-check.mjs` | `0755` |
| `nsromania-github-deploy.sudoers` | `/etc/sudoers.d/nsromania-github-deploy` | `0440` |
| `update-deploy-helpers-on-server.sh` | `/usr/local/sbin/nsromania-update-deploy-helpers` | `0755` |
| `validate-helper-update.py` | `/usr/local/libexec/nsromania-validate-helper-update` | `0755` |

The exact allowlist, target paths, and modes are enforced by `validate-helper-update.py` and cross-checked by tests. Update all helper definitions together; do not copy an individual helper over the installed root-owned file.

### Locks and unusual permissions

- `/var/log/nightscout/.deployment-control/deployment.lock`: root-owned `0600`; shared by application activation, helper installation, and bootstrap.
- `/var/log/nightscout/.deployment-control/helper-update.lock`: root-owned `0600`; serializes helper updates.
- `/var/log/nightscout/.deployment-control/upload.lock`: owned by `nsdeploy`, mode `0600`; serializes application artifact uploads.
- `/var/log/nightscout/.deployment-control` is currently root-owned mode `2711`.
- The private helper upload and work directories inherit setgid and are currently mode `2700`. The receiver permits only `0700` or `2700` with the exact expected owner/group.

Do not “normalize” the setgid modes without investigating the hosting filesystem and ownership model. They provide no group access because the group permission bits are zero.

## GitHub configuration

The manual workflow is `.github/workflows/deploy-production.yml`. It is `workflow_dispatch` only, refuses refs other than `refs/heads/main`, uses a constant production concurrency group, and does not cancel an active deployment.

The `production` GitHub Environment is configured with an exact `main` branch policy and a required reviewer. If the dispatcher is the only reviewer, self-review must remain permitted or a second reviewer must be configured.

Environment secrets:

- `PRODUCTION_SSH_PRIVATE_KEY`
- `PRODUCTION_SSH_KNOWN_HOSTS`

Environment variables:

- `PRODUCTION_SSH_HOST=nsromania.info`
- `PRODUCTION_SSH_PORT=22`
- `PRODUCTION_SSH_USER=nsdeploy`
- `PRODUCTION_URL=https://setup.nsromania.info`

Repository variable:

- `NEXT_PUBLIC_RECAPTCHA_SITE_KEY`

Do not add production `DATABASE_URL`, `SHADOW_DATABASE_URL`, `MONGO_URL`, OAuth, email, or other runtime credentials to GitHub.

The build job has no production environment or SSH key. A fresh protected deploy job downloads one opaque artifact, verifies its SHA-256 and size, and only then receives the environment-scoped SSH credentials.

## Normal application deployment

1. Ensure the desired commit is on `main` and CI is green.
2. Open **GitHub → Actions → Deploy production → Run workflow**.
3. Select `main` and approve the `production` environment gate.
4. Verify the run reports the exact requested commit from the public `/api/health` endpoint.

The workflow builds and tests with Node `22.12.0` and pnpm `10.32.0`. Prisma client generation uses a dummy unreachable URL; it does not use or contact production. The standalone artifact includes runtime files but explicitly excludes every `.env*` file and Prisma migrations.

Activation validates capacity, archive structure, the current application, pinned runtime, PM2 ownership, and DB-free health before changing the live directory. It then:

1. Prepares a complete sibling candidate.
2. Copies the server-only `.env` with mode `0600`.
3. Stops only `setup-ns`.
4. Atomically renames the complete live directory into a timestamped backup.
5. Moves the candidate into place.
6. Recreates only `setup-ns` using the exact Node interpreter and `server.js`.
7. Requires the exact commit locally and publicly.

On activation failure, the failed release is preserved and the prior release is restored and health-checked. A lost SSH connection (`HUP`) also enters rollback.

## Normal deployment-helper update

From a clean local checkout whose `main` exactly matches its upstream, run:

```bash
./ops/deploy/update-server-helpers.sh
```

That is the only normal command required. Do not run anything separately on the server.

The command:

1. Runs all deployment safeguard tests locally.
2. Packages exactly the eight allowlisted helpers with a manifest and checksum.
3. Uploads the package using key-based SSH as `ktomy`.
4. Requests the sudo password interactively on the server.
5. Uses the installed trusted validator before candidate code can run.
6. Backs up every existing target, the prior state file, directory metadata, and the validated package.
7. Atomically installs each file and verifies hashes, ownership, modes, sudoers syntax, PM2 PID, and DB-free health.
8. Restores every prior helper on `ERR`, `HUP`, `INT`, `TERM`, or post-install verification failure.

The receiver never starts, stops, restarts, reloads, deletes, saves, kills, or resurrects a PM2 process. It requires the application PID to be identical before and after the update.

The authoritative installed-helper record is:

```text
/var/log/nightscout/.deployment-control/helper-version.json
```

Uploaded helper packages and backups are intentionally retained. Do not infer the active helper version from the newest staging directory; read the state file and verify installed hashes.

## Bootstrap and recovery

`bootstrap-server.sh` is only for initial installation, recovery, or deployment-key/account changes. Normal helper edits use `update-server-helpers.sh`.

For bootstrap/recovery:

1. Use a new unique staging directory; never overwrite an older staging file.
2. Stage the complete `ops/deploy` helper set and the audited public key.
3. Compare local and remote SHA-256 values and verify the public-key fingerprint.
4. Record the root `setup-ns` PID before the operation.
5. Run the bootstrap interactively as root.
6. Record the backup path printed by bootstrap.
7. Verify the same PID, helper hashes/modes, sudoers, key restriction, and application health afterward.

Bootstrap acquires the shared deployment lock before taking the point-in-time helper backup. It does not restart the application or change firewall rules.

Do not delete a failed release, failed helper set, old staging directory, uploaded package, or backup during recovery. Preserve it first, diagnose the failure, and restore only from a verified backup. Any manual recovery change must itself be backed up before replacement.

## Safe validation commands

Local validation:

```bash
./ops/deploy/test.sh
git status --short
git rev-parse HEAD
git rev-parse '@{upstream}'
```

The local SSH client should use `-F /dev/null` because the development machine's system SSH client configuration was previously found with unsafe ownership. Always retain `StrictHostKeyChecking=yes`.

The production noninteractive shell does not currently expose `curl` on PATH. Use the pinned Node health helper instead:

```bash
/usr/local/nvm/versions/node/v22.12.0/bin/node \
    /usr/local/libexec/nsromania-health-check.mjs \
    http://127.0.0.1:11000/api/health \
    EXPECTED_COMMIT

/usr/local/nvm/versions/node/v22.12.0/bin/node \
    /usr/local/libexec/nsromania-health-check.mjs \
    https://setup.nsromania.info/api/health \
    EXPECTED_COMMIT
```

Read the live application commit from `/var/log/nightscout/setup/RELEASE_SHA`. Query root PM2 only with the explicit Node, PM2, `PM2_HOME=/root/.pm2`, and minimal PATH values documented above.

Always check both filesystems before a production write:

```bash
df -h / /var/log/nightscout
```

## Migration cutover and rollback window

Production traffic moved to `45.134.39.79` on 2026-08-23. The Porkbun API reports both
`ns1.nsromania.info` and `ns2.nsromania.info` glue records at the new address, and the old and new
authoritative servers both serve zone serial `2026082302` with the apex and nameserver A records at the new address.

The retired application host at `194.55.154.47` temporarily relays TCP ports 80 and 443 to the new VPS. Its Nginx
boot enablement is disabled, while `nsromania-cutover-relay-http.service` and
`nsromania-cutover-relay-https.service` are enabled and active. Keep that host and both relays available for at least
72 hours after every `.info` parent nameserver publishes the new glue. Do not infer completion only from recursive
resolver answers. Query every authoritative `.info` parent directly and allow at least one complete 3600-second glue
TTL after they all agree.

The old databases are a rollback source, not an active replica; they diverged as soon as traffic entered the new VPS.
A rollback after cutover therefore requires an explicit data reconciliation before routing writes back to the old
applications.

The new VPS uses native Nginx, BIND, MySQL, MongoDB, Node, and PM2 services. Docker was used only for the validated
MongoDB 6 to 7 to 8 storage upgrade and was purged after cutover. Retained recovery data on the new VPS includes:

```text
/srv/nsromania-migration/source-archives/mongodb-filesystem-20260822T205046Z.tar.zst
/srv/nsromania-migration/rollback/pre-final-logical-restore-mongodb8-20260822T234743Z
/srv/nsromania-migration/rollback/pre-final-mysql-20260822T234743Z.sql.zst
```

These paths are root-only and contain production data. Do not copy, inspect, or prune them during an ordinary
application deployment.

## Last verified production snapshot

This section records the new production VPS after migration on 2026-08-23. It is dated evidence, not a substitute for
read-only revalidation.

| Item | Verified value |
| --- | --- |
| Live application commit | `9be6cc676902d0b439fb4e3de7f98934142f5c59` |
| Root PM2 | 355 applications plus one module; all applications online on unique loopback ports |
| HTTP port validation | 355 checked; 355 HTTP 200; zero timeouts; zero non-200 responses |
| Panel saved command | `/usr/local/nvm/versions/node/v22.12.0/bin/npm start` |
| Panel cwd | `/var/log/nightscout/setup` |
| Panel health | Local and public health matched the exact live commit |
| Deployment account | Locked `nsdeploy`; forced command and restricted key installed |
| Deployment helpers | All eight files matched the audited repository checksums and modes |
| MongoDB | Native 8.3.8, FCV 8.0, loopback-only authentication; 360 databases and 3,559 collections |
| MySQL | Native 8.0.46, loopback-only; all migrated `nightscout` and `acme` tables checked OK |
| DNS | BIND zone serial `2026082302`; Porkbun ns1/ns2 glue set to `45.134.39.79` |
| `/` and `/var/log/nightscout` capacity | 338 GiB total, about 238 GiB available, 30% used |
| Emergency swap | 8 GiB, enabled, `vm.swappiness=1`, unused at verification |
| UFW | Active; public SSH, DNS, HTTP, and HTTPS rules installed |

The one-time deployment bootstrap backup created during migration is:

```text
/var/log/nightscout/backup/bootstrap-20260823T012112Z
```

## Previous production snapshot

This section is historical evidence, not a substitute for read-only revalidation. It was recorded on 2026-08-15 after the helper updater was installed and exercised successfully.

| Item | Verified value |
| --- | --- |
| Installed helper source commit | `b5362ea88e7926a1353e4756e2adfa5a77c3bcd4` |
| Helper source CI run | `31896062530`, successful |
| Live application commit | `21fac7a891bfd730f67f151e255ed24f96113573` |
| Last successful manual deployment run | `31892535646` |
| Helper package SHA-256 | `31dc37a7f102c6bdbff13a450ca60e8b7bdaf7fb475c99517001ec5eef2f3467` |
| Helper state | `installed` at `2026-08-15T16:41:57Z` |
| `setup-ns` PID | `3940846` before and after bootstrap/helper update |
| Root PM2 | 352 records total; exactly one `setup-ns`, status `online` |
| Panel command | `/var/log/nightscout/setup/server.js` |
| Panel cwd | `/var/log/nightscout/setup` |
| Panel interpreter | `/usr/local/nvm/versions/node/v22.12.0/bin/node` |
| Local/public health | Healthy at exact live commit |
| `/var/log` capacity | 50 GiB total, about 10 GiB available, 79% used |
| `/` capacity during initial audit | About 271 MiB available, 97% used; not rechecked at final validation, so check it before future writes |
| UFW | Inactive; deliberately left unchanged |

Relevant retained backups:

```text
/var/log/nightscout/backup/20260815T152605Z-before-21fac7a891bfd730f67f151e255ed24f96113573
/var/log/nightscout/backup/bootstrap-20260815T151650Z
/var/log/nightscout/backup/bootstrap-20260815T163346Z
/var/log/nightscout/backup/bootstrap-20260815T164127Z
/var/log/nightscout/backup/helpers-20260815T164157Z-before-b5362ea88e7926a1353e4756e2adfa5a77c3bcd4.gXj3wGhU
```

The successful helper backup contains all eight previous installed helpers, directory metadata, the validated package/checksum, and a record that the state file did not previously exist. Earlier stopped preflight attempts and their staging data were deliberately retained rather than deleted.

No production database command, query, migration, seed, or connection was used while creating or validating this deployment system.
