# HostHatch API (provider of d1)

`d1` (`d1.nsromania.info`) is a HostHatch VPS. HostHatch has a REST API for what the console does: server details,
power and reboot, reinstall, snapshots, reverse DNS, provider firewall, plan upgrades, orders and invoices. Notes
written 2026-11-19 from the docs and read-only calls; nothing was changed through the API.

This document contains no secret values.

## Documentation

- Overview: <https://docs.hosthatch.com/api/>. Every page also exists as Markdown with `index.md` appended, for
  example <https://docs.hosthatch.com/api/actions/index.md>.
- All pages in one file: <https://docs.hosthatch.com/llms-full.txt> (index: <https://docs.hosthatch.com/llms.txt>).
- OpenAPI: <https://docs.hosthatch.com/api/openapi.json>, also served without a key at `GET /openapi.json`.
- Ignore the "Legacy API" page: that is the old Peregrine API at `cloud.hosthatch.com`, a different service.

## Key and account

- The key is `D1_API_KEY` in the repository's local `.env` on the workstation (gitignored). It is not on any server.
  It acts as the account owner in every project of the account. Whether it was created read-only is not recorded:
  check the key list on the profile page (<https://console.hosthatch.com/users/profile/>, "API Keys") rather than
  sending a write to find out. Changing the account password revokes every key.
- Project `NSRomania`, slug **`default-22638`** (role `owner`). Every path below is under
  `/projects/default-22638/`.
- d1's server id is **`df9f48`** (server ids are hex strings; every other id is an integer).

Call it with the key passed through stdin, so it never appears on a command line or in `ps`:

```
K=$(grep '^D1_API_KEY=' .env | head -1 | cut -d= -f2- | tr -d '"'"'")
hh() { printf 'header = "Authorization: Bearer %s"\n' "$K" |
       curl -sS -K - -H 'Accept: application/json' "https://console.hosthatch.com/api/v1$1"; }
hh /projects/default-22638/servers/df9f48/ | jq .
```

For a change add `-X METHOD -H 'Content-Type: application/json' -d '{...}'`, and for an action or order also
`-H "Idempotency-Key: $(uuidgen)"` (see below).

## d1 as the API reported it (2026-11-19)

| Item | Value |
| --- | --- |
| Plan | `NVMe 64 GB`: 12 cores, 65536 MB RAM, 200 GB disk; location `AMS` (Amsterdam); image `ubuntu24` |
| IPv4 | 31.220.43.162 (gateway 31.220.43.1, /24), PTR `d1.nsromania.info` |
| IPv6 | `2a01:6f0:ffff:2d9d::/64` routed to the server (whether the host configures it is not checked here) |
| Private network | not eligible |
| Bandwidth | 15000 GB a month, not pooled; 18 GB used on 2026-11-19 |
| Provider firewall | no groups: all traffic reaches the server and UFW on the host is the firewall |
| Provider SSH keys | none (keys were installed by hand, see `README.md`) |
| Billing | monthly, `Active`, next due 2026-12-17; upgrade products `497` (NVMe 96 GB), `580` (128 GB), `581` (256 GB) |
| Snapshots | `9698` `d1_20261118_082429_UTC`, 4.1 GB, `completed` (took about 10 minutes); taken by hand, not managed by the weekly job |
| Action history | `server.reinstall` 2026-11-17 20:29 UTC; `server.create_snapshot` 2026-11-18 08:24 UTC |

## Conventions

- Base URL `https://console.hosthatch.com/api/v1`; **every path ends with `/`** (`/me/`, not `/me`). Version in the
  path; v1 changes only additively.
- JSON in and out. Errors are `application/problem+json` with a stable `code` (act on `code`, not `detail`), plus
  `action_id`, `order_id`, `snapshot_id` and similar where relevant.
- Lists: `?page=`/`?page_size=` (50 default, 100 max), envelope `{count, next, previous, results}`; a page past the
  end answers `404`.
- Money is a two-decimal string with `currency`; timestamps are UTC ISO 8601. Sizes carry the unit in the name. The
  docs call them integers, but the snapshot list returned `size_gb: 4.1`.
- `null` means unknown or unreadable at the moment, not "none". A `firewall_groups: null` does not mean no firewall.
- `GET /me/` returns the user's name and email: filter them out (`jq 'del(.email,.first_name,.last_name)'`) when the
  output lands in a log or transcript.

## Endpoints by risk

d1 serves about 200 live Nightscout sites. Use only the read-only calls without asking; every other call needs the
user's explicit go-ahead for that specific call.

| Risk | Endpoints |
| --- | --- |
| Read-only | every `GET`: `/me/`, `/projects/`, `servers/` and `servers/{id}/`, `servers/{id}/reverse-dns/`, `servers/{id}/actions/`, `actions/` and `actions/{id}/`, `snapshots/`, `firewall-groups/` (+ `rules/`), `ssh-keys/`, `isos/`, `orders/`, `/invoices/`, `products/`, `images/`, `locations/`, `pricing/`, `servers/{id}/upgrade-options/`, `servers/{id}/ip-change-options/` |
| Changes, no downtime | `PATCH servers/{id}/` (hostname only), `PUT`/`DELETE servers/{id}/reverse-dns/{address}/` (body `{"ptr": "name"}`, no trailing dot), SSH keys, snapshot rename, `actions/create-snapshot/` (uses the account's snapshot quota), `actions/enable-ipv6/`, `actions/enable-private-network/` |
| Downtime | `actions/reboot/`, `actions/shutdown/`, `actions/power-off/` (hard cut), `actions/power-on/`, `actions/mount-iso/` and `unmount-iso/` (both reboot) |
| Can cut off every site | `PUT servers/{id}/firewall-groups/` and rule changes in an attached group (see Firewall) |
| Destroys data | `actions/reinstall/` (wipes the disk), `actions/restore-snapshot/` (replaces the whole disk), `DELETE snapshots/{id}/` (not recoverable), `POST servers/{id}/cancel/` (`immediate` deletes the server now) |
| Costs money | `POST servers/` (new server), `servers/{id}/upgrade/`, `servers/{id}/bandwidth/`, `servers/{id}/ip-change/`, `POST /invoices/{id}/pay/` |
| Root password | `actions/reset-password/`: the new password comes back in `result.password` for 15 minutes; never print it |

Owner-only: ordering, upgrades, bandwidth, IP change, moving servers between projects, promo codes. Admin or owner:
password reset, cancel and withdraw cancellation. Everything else: any member.

## Actions

- Server operations are `POST servers/{id}/actions/<name>/` and answer `202` with an action. Poll
  `GET actions/{id}/` (not the list, which can lag minutes) every few seconds, less often over time, until `status`
  is `success` or `error`. `unknown` means the answer from the host was lost: keep polling. A running action ends as
  `error`/`timeout` after 24 hours.
- Power, reboot, reinstall, snapshot, ISO and IP-change actions are **exclusive** per server, including ones started
  in the console: a second answers `409 action_in_progress` with `action_id`. An exclusive action stuck in `unknown`
  blocks the server until it settles (support is told after 30 minutes, 4 hours for a snapshot).
- Send `Idempotency-Key: <new UUID>` with every action and order. Repeating the same request with the same key
  returns the original (`200`, `Idempotent-Replayed: true`); the same key with another body answers
  `409 idempotency_key_reused`. After `502 upstream_error` with an `action_id` or `order_id`, poll that instead of
  resending.
- `pending_changes: true` (for example after an upgrade) is applied only by a reboot **through the API or console**;
  a reboot from inside the server does not apply it.

## Snapshots

- Taken with `actions/create-snapshot/` (no body). They belong to the project, survive the server, can be restored
  onto any of the project's servers, and can seed a new server (`snapshot_id` instead of `image` when ordering).
- The owner's account has a snapshot limit across all projects (`409 snapshot_limit_reached`; failed snapshots don't
  count). The docs don't give the number.
- The docs don't say whether a snapshot of a running server is consistent for MongoDB. At best it is crash-consistent
  (like a power cut, which WiredTiger's journal recovers from); it is not a logical database backup.
- Restore overwrites the whole disk, also with a snapshot of another server; a restore that ends in `error` may have
  changed the disk already.
- Taking one does not disturb the server: during the 10-minute snapshot of 2026-11-18 08:24 UTC, d1's iowait stayed
  at 0.1–0.3%, its load was unchanged and at most one task was blocked (sysstat and `ops/cpu-steal` data).

## Scheduled snapshots

Since 2026-11-19 (decided with the user) the GitHub Actions workflow `.github/workflows/d1-snapshot.yml` takes a
snapshot of d1 every Sunday at 01:30 UTC and keeps the newest **2** snapshots it made.

- The logic is `ops/servers/hosthatch_snapshot.py` (stdlib Python, tests in `test_hosthatch_snapshot.py`, run by the
  workflow before it uses the key and by CI). It checks d1's hostname, refuses while a snapshot of d1 is pending,
  starts `create-snapshot` with an `Idempotency-Key`, polls the action and the snapshot until `completed`, renames it
  `auto-d1-YYYYMMDDTHHMMZ`, then deletes the oldest `auto-d1-*` snapshots of d1 beyond 2.
- It deletes only completed snapshots of d1 whose name starts with `auto-d1-`. Snapshots taken by hand (such as
  `d1_20261118_082429_UTC`) are never deleted, but they use slots of the account's snapshot limit. If the limit is
  reached, it deletes the oldest own snapshot first, but only while it has at least 2, so one complete snapshot
  always remains; otherwise it fails without deleting anything.
- The key is the environment secret `HOSTHATCH_API_KEY` of the GitHub environment `hosthatch` (main branch only),
  a dedicated HostHatch key that can write, named `gitlab-ci` in the HostHatch console (created 2026-11-19). It is not
  `D1_API_KEY` from the local `.env`. To rotate it: create the new key in the HostHatch console, replace the secret,
  revoke the old key.
- Run it by hand from **Actions → d1 snapshot → Run workflow** on `main`; tick "dry run" to see what it would take and
  delete without changing anything. Each run writes what it did to the run summary.
- A failed scheduled run is emailed by GitHub to whoever last changed the workflow's `cron` line. GitHub disables
  scheduled workflows after 60 days without repository activity; re-enable it on the Actions page if that happens.
- These are crash-consistent disk images (see the note above on MongoDB), not a logical database backup.

## Firewall

The provider firewall is separate from UFW on the host. There are only allow rules, rules are stateful, and a server
with no groups allows everything (d1's state). **As soon as one ingress group is attached, every inbound packet that
no ingress rule allows is dropped**, so attaching an empty or incomplete group cuts off SSH (panel agent, tunnel,
admin) and all sites at once. Before attaching one, it needs at least TCP 22, 80 and 443 from anywhere. Changes
apply in the background shortly after the response.

## Orders and upgrades

- `GET servers/{id}/upgrade-options/` lists products with prices and stock; `POST servers/{id}/upgrade/` with
  `{"product_id": N, "upgrade_disk": true|false}` answers `201` with an order. Poll `GET orders/{id}/` until
  `completed`, `cancelled` or `failed`.
- Orders are paid from account credit when it covers the invoice (the balance was `0.00` on 2026-11-19); otherwise
  the order waits in `awaiting_payment` until the invoice is paid in the console or with `POST /invoices/{id}/pay/`.
  An order cannot be withdrawn through the API.
- After an upgrade completes, the server shows `pending_changes: true` until an API or console reboot.

## Rate limits

Per key per minute: 300 reads, 60 writes, 10 orders. Over it: `429 rate_limited` with `Retry-After`. In front of
that, HostHatch's edge allows **60 requests a minute per IP address** across all keys and answers an HTML `429`
without `Retry-After` (wait 60 seconds). 20 failed key checks from one address in 10 minutes block every key from it
for the rest of the 10 minutes, a valid one too, so fix a failing key instead of retrying.
