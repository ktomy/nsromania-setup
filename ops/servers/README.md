# Additional hosting servers

Since 2026-11-17 Nightscout instances can run on more than one server. The setup panel, MySQL, DNS (BIND) and the
instances created before then stay on the main server (`nsromania.info`, 45.134.39.79). Each additional server runs
its own nginx, MongoDB and root PM2, exactly like the main server, and is controlled by the panel over SSH.

This document contains no secret values. Credentials live only in the files named below, on the servers.

## Servers

| Id | Host | Address | Hardware | Role |
| --- | --- | --- | --- | --- |
| `main` | `nsromania.info` | 45.134.39.79 | 8 vCPU | panel, MySQL, DNS, instances with `ns_domain.server IS NULL` |
| `d1` | `d1.nsromania.info` | 31.220.43.162 | 12 vCPU (EPYC 7763), 64 GB, 180 GB | instances with `ns_domain.server = 'd1'` |

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
  run. It accepts a fixed list of operations, validates every argument (process names `11<id>_<subdomain>` with the
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

Updating the agent: run `install-host-agent.sh` again with the new `host_agent.py`; it changes only what differs.

## Moving an instance

`migrate-instance.sh` runs as root on main, from a copy in a root-only staging directory:

```
migrate-instance.sh preflight SUB d1   # read-only
migrate-instance.sh rehearse  SUB d1   # no downtime: copy the database and its user to d1, compare, drop the copy
migrate-instance.sh migrate   SUB d1   # ~30 s downtime
migrate-instance.sh finalize  SUB d1   # after checking the instance: remove the stopped app from main's PM2 lists
migrate-instance.sh rollback  SUB d1   # before finalize; data written on d1 meanwhile is not copied back
```

`migrate` takes the deployment lock, backs up the PM2 dump, app definition, vhost, zone and panel rows to
`/var/log/nightscout/backup/migrate-SUB-<UTC>`, stops (not deletes) the app on main, copies the MongoDB database with
its user (`--dumpDbUsersAndRoles`, compared document counts and users), starts the same app definition on d1 through
the agent, creates the vhost there, checks `/api/v1/status.json` through d1's nginx and certificate, turns main's
vhost into a TLS-verified forwarder to d1 (for clients that still resolve the old CNAME), replaces the CNAME, sets
`ns_domain.server` and saves d1's PM2 list. The environment carried over is the running one restricted to the keys
the panel sets (its fixed keys plus the domain's environment rows); PM2 and systemd internals and anything inherited
from whoever started the app stay behind. The main database stays as the rollback source.

After the move: the forwarder vhost on main can be deleted once clients have followed the new CNAME (a few days), and
the main database copy dropped when rollback is no longer wanted. Both are manual.

### Moves done

| Instance | Date | Notes |
| --- | --- | --- |
| `ktomy` (id 224) | 2026-11-17 21:15 UTC | test move; 25 s downtime; backup `migrate-ktomy-20261117T211532Z`; not finalized yet; main DB copy and forwarder vhost kept |

## Certificates

Both servers serve the wildcard `*.nsromania.info` certificate from `/etc/nginx/cert/star_nsromania_info.crt` and
`.key` (0600). It expires **2026-12-31**. Install a renewed certificate on every server, then `nginx -t` and
`systemctl reload nginx` on each.

## Known gaps

- `ops/usage-stats` reads only main's nginx log: d1 instances are counted only while clients reach them through
  main's forwarder. Do not treat a moved instance as unused because of `ns_domain_daily_stats`.
- `ops/cpu-steal` is not installed on d1.
- d1 has no MongoDB backup job (neither has main at the time of writing).
