# Additional hosting servers

Since 2026-11-17 Nightscout instances can run on more than one server. The setup panel, MySQL, DNS (BIND) and the
instances created before then stay on the main server (`nsromania.info`, 45.134.39.79). Each additional server runs
its own nginx, MongoDB and root PM2, exactly like the main server, and is controlled by the panel over SSH.

This document contains no secret values. Credentials live only in the files named below, on the servers.

## Servers

| Id | Host | Address | Hardware | Role |
| --- | --- | --- | --- | --- |
| `main` | `nsromania.info` | 45.134.39.79 | 8 vCPU | panel, MySQL, DNS, instances with `ns_domain.server IS NULL` |
| `d1` | `d1.nsromania.info` (PTR set) | 31.220.43.162 | 12 vCPU (EPYC 7763), 64 GB, 180 GB | instances with `ns_domain.server = 'd1'` |

d1 is a HostHatch VPS. Its provider API (server details, power, snapshots, reverse DNS, provider firewall, upgrades),
the key's location and which calls are safe are in [`HOSTHATCH-API.md`](HOSTHATCH-API.md).

d1 was provisioned on 2026-11-17 to mirror main: Ubuntu 24.04, MongoDB 8.3 (auth enforced, loopback only,
`CPUWeight=1000`/`OOMScoreAdjust=-900`), Node `v22.12.0` and PM2 at the same pinned paths, `pm2-root.service` with the
dump guard and timeouts from `ops/pm2/`, `pm2-logrotate`, the same nginx `proxy_params`, `certs_paths`, vhost
`_template` and wildcard certificate, Nightscout versions in `/var/log/nightscout/versions` (with the
`/usr/local/nsromania/nightscout` symlink), UFW allowing only 22/80/443, SSH keys only (no root, no passwords). Admin
login is `ktomy` with sudo. The MongoDB admin credentials are in `/root/.nsromania/mongo-admin.env` (0600). An extra
`00-default` vhost answers unknown names on 443 with a redirect to the panel.

## How the panel reaches a server

```
panel (main, root PM2) ──ssh nsagent@d1 <operation>──▶ forced command: sudo nsromania-host-agent
           │                                              (pm2 start/delete/list/save, vhost create/delete/list)
           └── MongoDB driver ─▶ 127.0.0.1:27118 ──nsromania-server-tunnel@d1──▶ d1 127.0.0.1:27017
```

- `ns_domain.server` (nullable `VARCHAR(32)`; NULL = main) says where an instance lives. Every PM2, nginx and
  MongoDB call in the panel is routed by it (`src/lib/services/servers.ts`, `remoteagent.ts`). DNS is always
  edited on main: an instance's CNAME points at `d1.nsromania.info.` instead of `nsromania.info.`.
- An admin chooses the server when initializing a site for the first time (dialog on the site page, preselected
  `NS_DEFAULT_SERVER`, `d1` in production; unset = main). New sites also store that default. The choice is accepted
  only while the site has no database (`ns_domain.db_exists = 0` and none found on its current server); afterwards
  the server is fixed and moving the site needs `migrate-instance.sh`. Site owners who initialize their own site get
  the stored server and cannot choose. The site page shows the server and its hostname.
- **Host agent** (`host_agent.py` → `/usr/local/libexec/nsromania-host-agent`): the only thing the panel's key can
  run. Besides PM2 and vhost operations (including `pm2-describe` and `vhost-forward`, used only to move an instance
  back to main) it answers the read-only `usage-stats YYYY-MM-DD` used by the usage
  statistics job on main (`ops/usage-stats/README.md`), which needs the collector installed at
  `/usr/local/sbin/nsromania-usage-stats`. It accepts a fixed list of operations, validates every argument (process names `11<id>_<subdomain>` with the
  matching port, Nightscout `cwd` and Node interpreter inside the installed version trees, environment size and
  names), takes a lock for changes, refuses the reserved vhosts (`00-default`, `default`, `setup`), backs up vhosts it
  replaces or deletes to `/var/log/nightscout/backup/vhosts`, and logs to syslog (`journalctl -t nsromania-host-agent`).
  `pm2-save` saves only when at least 90% of apps are online, like the panel on main. Tests:
  `python3 -m unittest ops/servers/test_host_agent.py`.
- **Key**: `/root/.ssh/nsromania-servers/id_ed25519` on main. On d1 it is the only key of the locked system user
  `nsagent`, whose home and `authorized_keys` are root-owned, with
  `restrict,port-forwarding,permitopen="127.0.0.1:27017",from="<main addresses>",command="sudo -n <agent>"`.
  sudo allows exactly the agent with no arguments; the operation travels in `SSH_ORIGINAL_COMMAND`.
- **Host keys** are pinned in `/root/.ssh/nsromania-servers/known_hosts` (strict checking, never learned at runtime).
  d1: `ssh-ed25519`, `SHA256:Vq5yxhueuoiW/+HC37Zz7UGR4dDZSz91ZQKXxPLUaL4`.
- **Tunnel**: `nsromania-server-tunnel@d1.service` (enabled, `Restart=always`), configured by
  `/etc/nsromania/servers/d1.env` (`SSH_TARGET`, `LOCAL_PORT=27118`).
- **Panel `.env`** (on main only): `NS_REMOTE_SERVERS="d1"`, `NS_SERVER_D1_HOSTNAME`, `NS_SERVER_D1_SSH`,
  `NS_SERVER_D1_MONGO_URL` (the d1 admin user via `127.0.0.1:27118`), `NS_SERVERS_SSH_IDENTITY`,
  `NS_SERVERS_SSH_KNOWN_HOSTS`, `NS_DEFAULT_SERVER="d1"`. Added 2026-11-17; the previous file is in
  `/var/log/nightscout/backup/multi-server-20261117T211226Z/` together with the `ns_domain` dump taken before the DDL.

## Failure behavior

- **d1 down or unreachable**: its instances are down. The panel keeps working for main's instances; d1 instances show
  status `unknown`, and "start all" skips them. Starting, stopping or creating a d1 instance fails with the SSH error.
- **Main down**: d1 instances keep running and serving data, and `pm2-root` on d1 resurrects them after a reboot, but
  the panel is unavailable and **DNS is served only by main** (`ns1`/`ns2` are both 45.134.39.79): once resolvers'
  caches expire (TTL 300 s), d1 instances become unreachable by name too. A secondary DNS provider (planned: Porkbun)
  removes this dependency.

## Adding a server

All scripts back up anything they replace under `/var/log/nightscout/backup/<step>-<UTC>` on the server they change.

1. DNS on main: add `<id> IN A <address>` to `/etc/bind/zones/nsromania.info.header`, increment the serial,
   `named-checkzone`, `rndc reload nsromania.info`. Ask the provider for the matching reverse DNS (PTR).
2. On the new server as root: `provision-base.sh FQDN ktomy KEYS_FILE` (user, packages, swap, UFW, hostname), then
   `harden-ssh.sh` after confirming key login works.
3. From a workstation: `copy-from-main.sh` (Node, PM2, Nightscout versions, nginx files and certificate, MongoDB and
   PM2 units; verified by checksum), then on the server `provision-stack.sh STAGING_DIR REPO_OPS_DIR`.
4. On main: `setup-panel-access.sh key` (once), then on the server
   `install-host-agent.sh host_agent.py PANEL_KEY.pub "45.134.39.79,2a0e:97c0:3ea:6c4::1"`, then on main
   `setup-panel-access.sh server ID nsagent@ADDRESS HOST_KEY_FILE LOCAL_PORT nsromania-server-tunnel@.service`
   with the host key verified out of band and a free local port.
5. Add the `NS_REMOTE_SERVERS`/`NS_SERVER_<ID>_*` keys to the panel `.env` (backup first, never print it) and restart
   the panel through a normal deployment.
6. Install the usage collector on the server: `ops/usage-stats/collect_usage_stats.py` →
   `/usr/local/sbin/nsromania-usage-stats` (`0755 root:root`, no cron), and check from main with
   `nsromania-usage-stats --dry-run` that the server's line appears.
7. Install the CPU steal, load and memory collector: `NSROMANIA_SSH_TARGET=ktomy@HOST ./ops/cpu-steal/install.sh` (see
   `ops/cpu-steal/README.md`; d1 since 2026-11-18).

Updating the agent: run `install-host-agent.sh` again with the new `host_agent.py`; it changes only what differs.

Practical notes from adding d1:

- Install Ubuntu 24.04: MongoDB publishes no server packages for newer releases. The provider's root password is
  needed only to install the first SSH key; `harden-ssh.sh` then disables passwords and root login.
- Server ids match `^[a-z][a-z0-9]{0,31}$` and must not be `main`. Each server needs its own free local tunnel port
  on main (`d1` uses 27118; take 27119 for the next one).
- Verify the new host key out of band (provider console) before `setup-panel-access.sh server`; it is pinned and
  never learned at runtime.
- Stage scripts on a server in a new root-only directory and run them from there, for example:
  `tar -C ops/servers -cf - FILES | ssh ... "sudo install -d -m 0700 /root/staging-servers-<UTC> && sudo tar -C
  /root/staging-servers-<UTC> -xf - --no-same-owner"`. Use `ssh -n` (or `</dev/null`) for commands that must not
  read the local stdin.
- Afterwards add the server to the table above, to the topology table in `ops/deploy/OPERATIONS.md` and, if it
  becomes the default for new sites, set `NS_DEFAULT_SERVER`.

## Moving an instance

`migrate-instance.sh` runs as root on main, from a copy in a root-only staging directory:

```
migrate-instance.sh preflight SUB d1   # read-only
migrate-instance.sh rehearse  SUB d1   # no downtime: copy the database and its user to d1, compare, drop the copy
migrate-instance.sh migrate   SUB d1   # ~30 s downtime
migrate-instance.sh finalize  SUB d1   # after checking the instance: remove the stopped app from main's PM2 lists
migrate-instance.sh rollback  SUB d1   # before finalize; data written on d1 meanwhile is not copied back
migrate-instance.sh dropmain  SUB d1   # after finalize: drop main's database copy once it matches the move's dump
```

`migrate` takes the deployment lock, backs up the PM2 dump, app definition, vhost, zone and panel rows to
`/var/log/nightscout/backup/migrate-SUB-<UTC>`, stops (not deletes) the app on main, copies the MongoDB database with
its user (`--dumpDbUsersAndRoles`, compared document counts and users), starts the same app definition on d1 through
the agent, creates the vhost there, checks `/api/v1/status.json` through d1's nginx and certificate, turns main's
vhost into a TLS-verified forwarder to d1 (for clients that still resolve the old CNAME), replaces the CNAME, sets
`ns_domain.server` and saves d1's PM2 list. The environment carried over is the running one restricted to the keys
the panel sets (its fixed keys plus the domain's environment rows); PM2 and systemd internals and anything inherited
from whoever started the app stay behind. The main database stays as the rollback source.

After the move: the forwarder vhost on main can be deleted once clients have followed the new CNAME, and the main
database copy dropped when rollback is no longer wanted. Both are manual (see the runbook).

### Moving an instance back to main

The reverse direction (since 2026-11-20) has its own actions; `SERVER` is still the additional server, now the source:

```
migrate-instance.sh preflight-back SUB d1   # read-only
migrate-instance.sh migrate-back   SUB d1   # ~30 s downtime
migrate-instance.sh finalize-back  SUB d1   # after checking: save d1's PM2 list without the app
migrate-instance.sh rollback-back  SUB d1   # before dropremote; data written on main meanwhile is not copied back
migrate-instance.sh dropremote     SUB d1   # after finalize-back: drop d1's database copy once it matches the dump
```

`preflight-back` needs the site active, initialized and on d1, its app online there with the matching port, its
Nightscout version and Node interpreter installed on main, no app or database of that name on main, and main's vhost
either absent or still the forwarder to d1. `migrate-back` takes the deployment lock and backs up main's `dump.pm2` and
`dump.pm2.bak`, main's vhost (if any), the zone, the panel rows and the app as d1 runs it (agent `pm2-describe`) to
`/var/log/nightscout/backup/migrateback-SUB-<UTC>`. It builds the definition with the same allowlist as a forward move,
deletes the app on d1 (the definition stays in the backup for `rollback-back`), copies the database and its user to
main and compares them, starts the definition in main's root PM2 with the panel's log layout, creates main's vhost from
`_template`, checks `/api/v1/status.json` through main's nginx, turns d1's vhost into a TLS-verified forwarder to main
(agent `vhost-forward`, target address fixed in the agent), points the CNAME at `nsromania.info.`, sets
`ns_domain.server` to NULL and adds only this app to main's `dump.pm2`/`dump.pm2.bak` (no global save). d1's saved PM2
list still has the app until `finalize-back`; d1's database copy stays until `dropremote` (restore command in
`RESTORE-D1-DB.txt` next to the dump). Verify as in runbook step 5, with the site answering from main. d1's forwarder is
removed later with the agent's `vhost-delete SUB` once d1's nginx log shows no more requests for it.

### Runbook

From a workstation, with `MAIN` being the strict-host-key SSH command for `ktomy@nsromania.info`
(`ssh -F /dev/null -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$HOME/.ssh/known_hosts -o BatchMode=yes -i
$HOME/.ssh/id_rsa ktomy@nsromania.info`; `ktomy` has passwordless sudo on main and d1):

1. **Stage** the script from the repository: copy `migrate-instance.sh` into a new `/root/staging-servers-<UTC>`
   directory on main (as in the notes above) and compare `sha256sum` with the local file. Re-stage after every change
   to the script.
2. **Preflight** (read-only): `sudo bash STAGE/migrate-instance.sh preflight SUB d1`. It needs the site active,
   initialized (`db_exists = 1`) and on main, its PM2 app with the matching port, its Nightscout version installed on
   the target, and no app or database of that name there yet.
3. **Rehearse** (optional, no downtime): copies the live database to the target, compares users and documents, and
   drops the copy again. Counts may differ while the site writes; useful to time large databases.
4. **Migrate**: `sudo bash STAGE/migrate-instance.sh migrate SUB d1`. The downtime is the database copy plus about
   20 s (`ktomy`, 13 MB compressed: 25 s). It refuses to run while a deployment holds the lock. On any failure it
   stops with the next step to take, normally `rollback`.
5. **Verify**: `https://SUB.nsromania.info/api/v1/status.json` answers and `/api/v1/entries.json?count=1` shows new
   entries arriving; the site page in the panel shows `Server: d1 (d1.nsromania.info)` and status online; on main
   the agent lists it online:
   `sudo /usr/bin/ssh -n -F /dev/null -T -i /root/.ssh/nsromania-servers/id_ed25519 -o IdentitiesOnly=yes -o
   UserKnownHostsFile=/root/.ssh/nsromania-servers/known_hosts -o StrictHostKeyChecking=yes -o BatchMode=yes --
   nsagent@31.220.43.162 pm2-list`. Ask the owner (or the user) to confirm before finalizing.
6. **Finalize**: `sudo bash STAGE/migrate-instance.sh finalize SUB d1` deletes the stopped app from main's PM2 and
   removes only its entry from `dump.pm2` and `dump.pm2.bak` (backup `finalize-SUB-<UTC>`). After this, `rollback` no
   longer works; returning the site is a manual restore from the backups.
7. **Drop main's database copy** when rollback is no longer wanted: `sudo bash STAGE/migrate-instance.sh dropmain
   SUB d1` (after `finalize`) does every check below, writes the restore command and drops the copy; it refuses when
   anything differs. Done by hand it is: check that the dump in
   `migrate-SUB-<UTC>/mongo/SUB` has exactly the documents of main's copy (per collection, plus the user), that no
   connection uses it (`$currentOp` with `allUsers`, `idleConnections`, matching `effectiveUsers.user` or `ns`), and
   that `ns_domain.server` is the target; then `dropUser` and `dropDatabase` on main with `mongosh` (URL from the
   panel `.env` in the environment, never on the command line) and write the restore command into
   `RESTORE-MAIN-DB.txt` next to the dump:
   `mongorestore --uri="$MONGO_URL" --gzip --db=SUB --restoreDbUsersAndRoles .../mongo/SUB`.
8. **Remove main's forwarder** once main's nginx log shows no more requests for the site, for example
   `sudo grep '^SUB.nsromania.info' /var/log/nginx/access.log | awk -F'"' '{print $6}' | sort | uniq -c` (requests
   per user agent; in the `vcombined` format the time is the 5th space-separated field; the log keeps 14 days). Back
   up `/etc/nginx/sites-available/SUB`, remove it and the `/etc/nginx/sites-enabled/SUB` symlink, `nginx -t`,
   `systemctl reload nginx`.
9. **Record** the move in the table below and in the `ops/deploy/OPERATIONS.md` change table.

`rusu-sofia` (id 767) failed in the batch of 2026-11-18: its `ns_domain_environment` had variable names ending in `:`
(`BASAL_RENDER:`, `LOOP_DEVELOPER_TEAM_ID:`, `LOOP_PUSH_SERVER_ENVIRONMENT:`), which the host agent rejects, and the
rollback restarted it on main within 30 s. The names were fixed the same day (see `ops/deploy/OPERATIONS.md`) and it
moved on 2026-11-19 (moves table). A failed attempt leaves the database copy on the target, which preflight refuses:
back it up with `mongodump` and drop it there first. Since `84bfda7` the panel keeps variable names valid when they
are typed, saved and started.

Lessons from the first move (`ktomy`): browsers followed the new CNAME (TTL 300 s) within 20 minutes, but an ESP32
glucose display (`ESP32HTTPClient`) kept calling main's address; such devices resolve DNS once at boot and follow
only after a restart. Since 2026-11-18 usage statistics include each server's own nginx log (forwarded requests are
counted once, on main). With forwarders in both directions each server's count skips requests from the other
servers' addresses: d1 skips main's (`--exclude-forwarders`), main skips the additional servers' (since 2026-11-20).

### Moves done

| Instance | Date | Notes |
| --- | --- | --- |
| `ktomy` (id 224) | 2026-11-17 21:15 UTC | test move; 25 s downtime; backup `migrate-ktomy-20261117T211532Z`; finalized 22:05 (`finalize-ktomy-20261117T220554Z`); main DB copy dropped 22:10 after checking it against the backup's dump (`RESTORE-MAIN-DB.txt` there); forwarder vhost on main removed 22:24 after the ESP32 display was restarted and moved to d1 (`forwarder-ktomy-20261117T222442Z`) |
| 200 smallest sites (by MongoDB storage + index size, 0.3–65.6 MB) | 2026-11-18 02:30–05:19 UTC | `batch-migrate.sh`; 27–77 s downtime each (average 48 s); all 200 online on d1 and answering through public DNS afterwards. Finalized and main's database copies dropped 06:50–07:30 (`dropmain`); forwarders removed at 06:52 for the 155 sites that had no request on main after their move, 45 kept. List, per-site results and log: `/var/log/nightscout/backup/batch-migrate-20261118T023056Z` (per-site backups `migrate-SUB-20261118T*`). `rusu-sofia` failed and was rolled back automatically, see below |
| `rusu-sofia` (id 767) | 2026-11-19 22:17 UTC | after its failed attempt of 2026-11-18: the stale copy on d1 was dumped to `d1-leftover-rusu-sofia-20261119T221718Z` (on main) and dropped; then `migrate` with 35 s downtime, backup `migrate-rusu-sofia-20261119T221750Z`; new entries arrived on d1 at 22:21; finalized 22:23 (`finalize-rusu-sofia-20261119T222344Z`); main database copy dropped 22:32 after matching the dump (`RESTORE-MAIN-DB.txt` there); forwarder vhost still on main |
| forwarder cleanup | 2026-11-19 22:26 UTC | 44 of the 46 remaining forwarders on main removed after checking that day's log (no requests, a scanner only, or the client already on d1); `bali` and `rusu-sofia` kept. Backup `forwarders-20261119T222613Z` |
| 80 largest sites (by MongoDB storage + index size, 136–302 MB, 13.8 GB together) | 2026-11-19 22:36–23:45 UTC | `batch-migrate.sh`, biggest first, as a memory-pressure test of d1; 40–68 s downtime each (average 50 s), no failures; all 80 answered through public DNS from d1 afterwards. Finalized and main's database copies dropped 23:46–00:03 (`cleanup-batch.sh`: `finalize` + `dropmain` per site, stops at the first failure); forwarders kept. d1 went from 35.3 to 20.9 GB available (about 180 MB per site), no swap, memory PSI 0. List, results, `batch.log`, `cleanup.log`: `/var/log/nightscout/backup/batch-migrate-20261119T223623Z` (per site `migrate-SUB-2026111[9]T*`, `finalize-SUB-*`) |
| forwarder cleanup | 2026-11-20 10:26 UTC | 73 of the 82 forwarders on main removed: no request since 15 minutes after the move (52) or none in the last 4 hours (21, including `rusu-sofia`); 9 still in use kept (`andreicozos`, `bali`, `dariusica`, `edithardeleanu`, `hun`, `ioanatopala`, `kitty`, `mirunaamelie`, `tudoramaliaalex`). Backup `forwarders-20261120T102641Z` |
| `ktomy` (id 224) back to main | 2026-11-20 10:37 UTC | first move back (`migrate-back`), as a test of the reverse direction; about 27 s downtime; documents and user identical; new entries on main from 10:41; `finalize-back` 10:42 (d1 saved 281/281 online); d1 database copy dropped 10:42 after matching the dump (`RESTORE-D1-DB.txt`); forwarder vhost on d1 kept. Backup `migrateback-ktomy-20261120T103707Z` |

## Certificates

Both servers serve the wildcard `*.nsromania.info` certificate from `/etc/nginx/cert/star_nsromania_info.crt` and
`.key` (0600). It expires **2026-12-31**. Install a renewed certificate on every server, then `nginx -t` and
`systemctl reload nginx` on each.

## Extending the migration tooling

`migrate-instance.sh` is one bash script run as root on main; every action first runs the shared checks (schema
column, `ns_domain` row, PM2 name `11<id padded to 3>_SUB` and port `11000 + id`). Keep these invariants when
changing it:

- Changing actions take the deployment lock (`flock` on `deployment.lock`) and write every file and row they change
  to `/var/log/nightscout/backup/<action>-SUB-<UTC>` first. `preflight` stays read-only.
- Reach the target only through the host agent operations (`host_agent.py`: `ping`, `pm2-list`, `pm2-describe`,
  `pm2-start` with the definition on stdin, `pm2-delete`, `pm2-save`, `vhost-create`, `vhost-forward`,
  `vhost-delete`, `vhost-list`, `usage-stats`)
  and the MongoDB tunnel. A new remote operation means changing `host_agent.py` and its tests, then re-running
  `install-host-agent.sh` on every server.
- Secrets never reach a command line or the output: MongoDB URLs go through the environment (`mongo_eval`) or a
  temporary 0600 YAML `--config` (`mongo_tool_config`), and only named keys are read from the panel `.env`.
- The environment carried to the target is an allowlist that mirrors `buildDomainProcess` in
  `src/lib/services/nsruntime.ts` (fixed keys plus the domain's `ns_domain_environment` rows). Update both together.
- Never run a global PM2 `save`, `restart all` or similar on main; change single entries in the dump files as
  `finalize` (`dump_remove`) and `migrate-back` (`dump_add`) do. On the target, `pm2-save` saves only when at least
  90% of apps are online.
- Backup directories of moves back use the prefix `migrateback-`, never `migrate-back-`: a forward lookup
  `migrate-SUB-<stamp>` for a site named `back-SUB` would match the latter.
- Edit the zone only through `set_cname` (candidate file, `named-checkzone`, atomic replace, `rndc reload`).

`batch-migrate.sh LIST SERVER` (run as root on main from the staging directory, normally with `setsid nohup`) runs
`migrate` for each subdomain in LIST in turn, rolls a site back immediately when `migrate` fails after creating its
backup, writes `results.tsv` (subdomain, outcome, seconds) next to itself, and stops when a `STOP` file appears
there, after 3 consecutive or 6 total failures, or when a rollback fails. It does not finalize. It reads LIST once
at start, so to change the queue create `STOP`, wait for `batch finished` in the log and start it again with a new
list.

Pitfalls already hit: a backup directory lookup with `migrate-$SUB-*` also matches sites named `SUB-something`
(`glicemia` matched `glicemia-eliza`), so lookups use the exact `-<UTC stamp>` suffix (`STAMP_GLOB`); inside a function
called in a `||` context bash ignores `set -e`, so each step needs its own `|| return 1`; `--quiet` hides `mongorestore`
errors; `mongorestore --restoreDbUsersAndRoles` works only with a directory dump restored with `--db`; parse `mysql`
output with a non-whitespace separator (`|`) so empty fields keep their position; `ssh` without `-n` swallows a script
piped to the outer shell.

Not supported yet (candidates for extension):

- moving a site directly between two additional servers (move it back to main, then on);
- `rehearse` for the reverse direction;
- several sites in one lock and one backup directory (`batch-migrate.sh` runs `migrate` once per site);
- `finalize`, `dropmain` and step 8 for many sites at once (on 2026-11-18 a loop ran `finalize` + `dropmain` per
  site, on 2026-11-19 the one-off `cleanup-batch.sh` in the batch directory did the same from `results.tsv`, and a
  one-off script removed forwarders without traffic; see the moves table);
- automating runbook step 8 (checking forwarder traffic and removing the vhost);
- moving from the panel instead of the shell.

There are no automated tests for `migrate-instance.sh`. Check changes with `bash -n` (and `shellcheck` when
available), then `preflight`, `preflight-back` and `rehearse` against a live site, which change nothing visible. The host agent has
unit tests: `python3 -m unittest ops/servers/test_host_agent.py`.

## Known gaps

- Usage statistics before 2026-11-18 cover only main's nginx log: for days before that, d1 instances show only
  forwarder traffic. Do not treat a moved instance as unused because of those rows.
- d1 has no MongoDB backup job (neither has main at the time of writing). Since 2026-11-19 a weekly provider snapshot
  of d1's whole disk is taken (newest 2 kept, `HOSTHATCH-API.md`, "Scheduled snapshots"); it is crash-consistent,
  not a logical database dump.
