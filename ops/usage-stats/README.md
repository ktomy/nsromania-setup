# Instance usage statistics

Daily per-instance request counts, collected from the nginx access log into the standalone MySQL table
`ns_domain_daily_stats` (not part of the Prisma schema). Used to find Nightscout instances nobody visits.

## Columns

| Column | Meaning |
| --- | --- |
| `domain`, `day` | primary key; `domain` is the lowercased subdomain, so deleted or orphan instances still appear |
| `hits` | all requests |
| `ok_hits` | status 2xx/3xx/101, excluding bot/crawler/scanner user agents |
| `uploads` | POST/PUT to `/api/` (uploaders: xDrip, AAPS, Loop, bridges) |
| `api_reads` | GET to `/api/` (follower apps, watches) |
| `web_hits` | `/` and `/socket.io/` (web page viewers) |
| `unique_ips` | number of distinct client IPs; IPs themselves are not stored |

Starting rule of thumb: an instance with `ok_hits` below ~20 on every day of the last 30 days is unused.

```sql
SELECT d.id, d.domain, d.active, d.created, COALESCE(MAX(s.ok_hits), 0) AS max_ok_hits_30d
FROM ns_domain d
LEFT JOIN ns_domain_daily_stats s
       ON s.domain = LOWER(d.domain) AND s.day >= CURDATE() - INTERVAL 30 DAY
WHERE d.active = 1
GROUP BY d.id
HAVING max_ok_hits_30d < 20
ORDER BY max_ok_hits_30d;
```

## Requirements

nginx must log with the `vcombined` format (`$host:$server_port` prefix), configured in `/etc/nginx/nginx.conf`
since 2026-11-15. Lines in the old format are ignored.

## Files and installation

| Repository file | Server target | Mode |
| --- | --- | --- |
| `collect_usage_stats.py` | `/usr/local/sbin/nsromania-usage-stats` | `0755 root:root` |
| `nsromania-usage-stats.cron` | `/etc/cron.d/nsromania-usage-stats` | `0644 root:root` |
| `schema.sql` | applied once with the mysql CLI | |

Cron runs at 02:15 server time (after logrotate, which can fire up to 01:00) for the previous day, at the lowest CPU
and I/O priority, logging to syslog with tag `nsromania-usage-stats`. MySQL credentials come from `DATABASE_URL` in
the panel's `.env`; the script never prints them and passes them to `mysql` through a temporary `0600` options file.

Manual runs (as root): `nsromania-usage-stats --date YYYY-MM-DD` to (re)collect a day (it replaces that day's rows),
`--dry-run` to print the aggregate without writing. nginx keeps 14 days of logs, so that is the backfill limit.

## Tests

```bash
python3 -I ops/usage-stats/test_collect_usage_stats.py -v
```
