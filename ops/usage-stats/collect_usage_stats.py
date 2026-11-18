#!/usr/bin/env python3
"""Aggregate daily per-instance request counts from the nginx access log into MySQL.

Reads nginx logs written in the `vcombined` format (`$host:$server_port` prefix) and
upserts one row per (domain, day) into `ns_domain_daily_stats`. Re-running for the same
day replaces that day's rows, so the job is idempotent and can be used for backfills.

On the main server the counts of every additional hosting server (`NS_REMOTE_SERVERS` in the
panel .env) are fetched through its host agent (`usage-stats DAY`, which runs this script there
with --json --exclude-forwarders) and added before writing.

Only counts are stored: no IP addresses, paths or user agents leave the log files.

Usage:
    collect_usage_stats.py                    # yesterday (UTC server time), main + remote servers
    collect_usage_stats.py --date 2026-11-15  # a specific day
    collect_usage_stats.py --dry-run          # print the aggregate instead of writing
    collect_usage_stats.py --no-remote        # this server's log only
    collect_usage_stats.py --json --exclude-forwarders   # on an additional server: print JSON, no MySQL
"""

import argparse
import datetime as dt
import glob
import gzip
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.parse

LOG_GLOB = '/var/log/nginx/access.log*'
ENV_FILE = '/var/log/nightscout/setup/.env'
BASE_DOMAIN = 'nsromania.info'
TABLE = 'ns_domain_daily_stats'
# Main server addresses: on an additional server, requests from these are main's forwarder vhosts relaying clients
# that still resolve the old CNAME. Main's own log already counts them, so --exclude-forwarders skips them.
MAIN_ADDRESSES = frozenset({'45.134.39.79', '2a0e:97c0:3ea:6c4::1'})
SSH_IDENTITY = '/root/.ssh/nsromania-servers/id_ed25519'
SSH_KNOWN_HOSTS = '/root/.ssh/nsromania-servers/known_hosts'
SERVER_ID_RE = re.compile(r'^[a-z][a-z0-9]{0,31}$')
SSH_TARGET_RE = re.compile(r'^nsagent@[0-9A-Za-z.:-]+$')

# $host:$server_port $remote_addr - $remote_user [$time_local] "$request" $status $bytes "$referer" "$ua"
LINE_RE = re.compile(
    r'^(?P<host>\S+):\d+ (?P<ip>\S+) \S+ \S+ \[(?P<day>\d{2}/\w{3}/\d{4}):[^\]]*\] '
    r'"(?P<request>[^"]*)" (?P<status>\d{3}) \S+ "[^"]*" "(?P<ua>[^"]*)"'
)
# Host header is client-controlled: accept only a single DNS label under the base domain.
SUBDOMAIN_RE = re.compile(r'^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.' + re.escape(BASE_DOMAIN) + r'$')
BOT_RE = re.compile(
    r'bot|crawl|spider|slurp|scan|zgrab|masscan|nmap|headless|wget|libwww|censys|expanse',
    re.IGNORECASE,
)
FIELDS = ('hits', 'ok_hits', 'uploads', 'api_reads', 'web_hits')
COUNTERS = FIELDS + ('unique_ips',)


def is_ok_status(status):
    return status == 101 or 200 <= status < 400


def classify(method, path):
    """Return the set of request categories for a method/path pair."""
    path = path.split('?', 1)[0]
    cats = set()
    if path.startswith('/api/'):
        if method in ('POST', 'PUT'):
            cats.add('uploads')
        elif method == 'GET':
            cats.add('api_reads')
    if path == '/' or path.startswith('/socket.io/'):
        cats.add('web_hits')
    return cats


def parse_line(line, day_token):
    """Parse one log line. Returns (subdomain, ip, categories, ok) or None if not counted."""
    if day_token not in line:
        return None
    m = LINE_RE.match(line)
    if not m or m.group('day') != day_token:
        return None
    sm = SUBDOMAIN_RE.match(m.group('host').lower())
    if not sm:
        return None
    parts = m.group('request').split(' ')
    method, path = (parts[0], parts[1]) if len(parts) >= 2 else ('', '')
    status = int(m.group('status'))
    ok = is_ok_status(status) and not BOT_RE.search(m.group('ua'))
    return sm.group(1), m.group('ip'), classify(method, path), ok


def aggregate(lines, day, exclude_ips=frozenset()):
    """Aggregate an iterable of log lines for one date into {subdomain: counters}."""
    day_token = day.strftime('%d/%b/%Y')
    stats = {}
    ips = {}
    for line in lines:
        parsed = parse_line(line, day_token)
        if not parsed:
            continue
        sub, ip, cats, ok = parsed
        if ip in exclude_ips:
            continue
        row = stats.setdefault(sub, dict.fromkeys(FIELDS, 0))
        row['hits'] += 1
        if ok:
            row['ok_hits'] += 1
        for cat in cats:
            row[cat] += 1
        ips.setdefault(sub, set()).add(ip)
    for sub, row in stats.items():
        row['unique_ips'] = len(ips[sub])
    return stats


def candidate_logs(day):
    """Log files that can contain lines for `day`: anything modified on or after that day."""
    start = dt.datetime.combine(day, dt.time.min).timestamp()
    return sorted(p for p in glob.glob(LOG_GLOB) if os.path.getmtime(p) >= start)


def read_lines(paths):
    for path in paths:
        opener = gzip.open if path.endswith('.gz') else open
        with opener(path, 'rt', encoding='utf-8', errors='replace') as fh:
            yield from fh


def build_sql(day, stats):
    """Build the upsert SQL. Subdomains are regex-validated and counters are ints."""
    cols = ('domain', 'day') + FIELDS + ('unique_ips',)
    stmts = [
        'START TRANSACTION;',
        "DELETE FROM {} WHERE day = '{}';".format(TABLE, day.isoformat()),
    ]
    rows = sorted(stats.items())
    for i in range(0, len(rows), 200):
        values = ',\n'.join(
            "('{}','{}',{})".format(sub, day.isoformat(), ','.join(str(int(r[c])) for c in cols[2:]))
            for sub, r in rows[i:i + 200]
        )
        stmts.append('INSERT INTO {} ({}) VALUES\n{};'.format(TABLE, ','.join(cols), values))
    stmts.append('COMMIT;')
    return '\n'.join(stmts) + '\n'


def panel_env(key, env_file=ENV_FILE):
    """Read one key from the panel .env without sourcing or printing it; None when absent."""
    pattern = re.compile(r'^\s*' + re.escape(key) + r'\s*=\s*(.*?)\s*$')
    with open(env_file) as fh:
        for line in fh:
            match = pattern.match(line)
            if match:
                value = match.group(1)
                if len(value) >= 2 and value[0] == value[-1] and value[0] in '"\'':
                    value = value[1:-1]
                return value
    return None


def mysql_credentials(env_file=ENV_FILE):
    url = panel_env('DATABASE_URL', env_file)
    if not url:
        raise RuntimeError('DATABASE_URL not found in ' + env_file)
    return urllib.parse.urlparse(url)


def remote_servers(env_file=ENV_FILE):
    """[(server id, ssh target)] of the additional hosting servers configured for the panel."""
    servers = []
    for server in (panel_env('NS_REMOTE_SERVERS', env_file) or '').replace(',', ' ').split():
        if not SERVER_ID_RE.match(server) or server == 'main':
            raise RuntimeError('invalid server id in NS_REMOTE_SERVERS: ' + server[:40])
        target = panel_env('NS_SERVER_{}_SSH'.format(server.upper()), env_file) or ''
        if not SSH_TARGET_RE.match(target):
            raise RuntimeError('NS_SERVER_{}_SSH missing or invalid'.format(server.upper()))
        servers.append((server, target))
    return servers


def validate_remote(payload, day):
    """Check a host agent answer and return its {subdomain: counters}."""
    if not isinstance(payload, dict) or not payload.get('ok'):
        error = payload.get('error') if isinstance(payload, dict) else payload
        raise RuntimeError('agent error: {}'.format(str(error)[:200]))
    result = payload.get('result')
    if (not isinstance(result, dict) or result.get('day') != day.isoformat()
            or not isinstance(result.get('domains'), dict)):
        raise RuntimeError('unexpected agent answer')
    stats = {}
    for sub, row in result['domains'].items():
        if not isinstance(sub, str) or not SUBDOMAIN_RE.match(sub + '.' + BASE_DOMAIN) or not isinstance(row, dict):
            raise RuntimeError('invalid domain in agent answer')
        clean = {}
        for c in COUNTERS:
            value = row.get(c)
            if not isinstance(value, int) or isinstance(value, bool) or value < 0:
                raise RuntimeError('invalid counter {} for {}'.format(c, sub))
            clean[c] = value
        stats[sub] = clean
    return stats


def fetch_remote(target, day, env_file=ENV_FILE):
    """Ask one server's host agent for its counts of `day` (read-only operation)."""
    identity = panel_env('NS_SERVERS_SSH_IDENTITY', env_file) or SSH_IDENTITY
    known_hosts = panel_env('NS_SERVERS_SSH_KNOWN_HOSTS', env_file) or SSH_KNOWN_HOSTS
    command = [
        '/usr/bin/ssh', '-n', '-F', '/dev/null', '-T', '-i', identity, '-o', 'IdentitiesOnly=yes',
        '-o', 'UserKnownHostsFile=' + known_hosts, '-o', 'GlobalKnownHostsFile=/dev/null',
        '-o', 'StrictHostKeyChecking=yes', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20',
        '--', target, 'usage-stats', day.isoformat(),
    ]
    completed = subprocess.run(command, capture_output=True, text=True, timeout=900, check=False)
    try:
        payload = json.loads(completed.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        raise RuntimeError('ssh exit {}: {}'.format(completed.returncode, completed.stderr.strip()[-200:])) from None
    return validate_remote(payload, day)


def merge(total, extra):
    """Add the counters of `extra` into `total`. unique_ips is summed: a client seen on two servers counts twice."""
    for sub, row in extra.items():
        into = total.setdefault(sub, dict.fromkeys(COUNTERS, 0))
        for c in COUNTERS:
            into[c] += row[c]
    return total


def run_mysql(sql):
    u = mysql_credentials()
    fd, cnf = tempfile.mkstemp()
    try:
        os.chmod(cnf, 0o600)
        with os.fdopen(fd, 'w') as fh:
            fh.write('[client]\nuser={}\npassword={}\nhost={}\nport={}\n'.format(
                urllib.parse.unquote(u.username or ''), urllib.parse.unquote(u.password or ''),
                u.hostname or 'localhost', u.port or 3306))
        db = u.path.lstrip('/').split('?')[0]
        subprocess.run(['mysql', '--defaults-extra-file=' + cnf, '--batch', db], input=sql, text=True, check=True)
    finally:
        os.unlink(cnf)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--date', type=dt.date.fromisoformat, help='day to collect (default: yesterday)')
    ap.add_argument('--dry-run', action='store_true', help='print the aggregate instead of writing')
    ap.add_argument('--json', action='store_true', help='print this server\'s aggregate as JSON (no MySQL, no remotes)')
    ap.add_argument('--exclude-forwarders', action='store_true',
                    help='skip requests from the main server (its forwarder vhosts; counted in main\'s log)')
    ap.add_argument('--no-remote', action='store_true', help='do not add the counts of additional servers')
    args = ap.parse_args(argv)
    day = args.date or (dt.date.today() - dt.timedelta(days=1))

    paths = candidate_logs(day)
    exclude = MAIN_ADDRESSES if args.exclude_forwarders else frozenset()
    stats = aggregate(read_lines(paths), day, exclude)
    total = sum(r['hits'] for r in stats.values())
    summary = '{}: {} domains, {} hits from {} file(s)'.format(day, len(stats), total, len(paths))
    if args.json:
        print(summary, file=sys.stderr)
        print(json.dumps({'day': day.isoformat(), 'domains': stats}, sort_keys=True))
        return 0
    print(summary)

    status = 0
    if not args.no_remote:
        for server, target in remote_servers():
            try:
                remote = fetch_remote(target, day)
            except (RuntimeError, OSError, subprocess.TimeoutExpired) as error:
                print('{}: FAILED: {}'.format(server, error), file=sys.stderr)
                status = 2
                continue
            print('{}: {} domains, {} hits'.format(server, len(remote), sum(r['hits'] for r in remote.values())))
            merge(stats, remote)

    if args.dry_run:
        for sub, r in sorted(stats.items(), key=lambda kv: -kv[1]['hits']):
            print(sub, *(r[c] for c in COUNTERS), sep='\t')
        return status
    if not stats:
        print('no matching lines; nothing written')
        return status
    run_mysql(build_sql(day, stats))
    print('written' + (' (incomplete: a server failed; re-run with --date {})'.format(day) if status else ''))
    return status


if __name__ == '__main__':
    sys.exit(main())
