#!/usr/bin/env python3
"""Summarise hypervisor CPU steal (and memory) for a date range, for the hosting-provider report.

Primary source: the collector's 1-minute CSVs (/var/log/nsromania-cpu-steal/steal-YYYY-MM.csv),
each line built from 5-second /proc/stat sub-samples. Independent cross-check: the sysstat data
files (/var/log/sysstat/sa*, 10-minute samples), read with `sadf` when it is available. Lines
written since 2026-11-19 also carry memory columns (in use, swap, PSI memory pressure, OOM kills),
summarised in their own section.

Prints Markdown by default; --csv daily|hourly|minute prints a CSV for charts instead.
Dates are UTC; --to is inclusive when given as a date. Stdlib only (Python 3.8+), read-only.

Usage:
    steal_report.py --from 2026-11-16 --to 2026-11-22
    steal_report.py --from 2026-11-07 --to 2026-11-15 --source sar   # before the collector existed
    steal_report.py --from 2026-11-16 --to 2026-11-22 --csv hourly > hourly.csv
"""

import argparse
import bisect
import bz2
import calendar
import collections
import csv
import glob
import gzip
import lzma
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time

DATA_DIR = '/var/log/nsromania-cpu-steal'
SAR_DIR = '/var/log/sysstat'
THRESHOLDS = (10, 20, 30)
GAP_S = 300
DAY = 86400


MEM_ATTRS = ('mem_total', 'mem_avail', 'mem_avail_min', 'swap_total', 'swap_used', 'swapin', 'swapout', 'majflt',
             'psi_some', 'psi_full', 'oom')
# CSV column for each memory attribute (MiB, pages/s, faults/s, % of time, count).
MEM_COLUMNS = dict(zip(MEM_ATTRS, ('mem_total_mib', 'mem_avail_mib', 'mem_avail_min_mib', 'swap_total_mib',
                                   'swap_used_mib', 'swapin_pages_s', 'swapout_pages_s', 'majflt_s',
                                   'mem_psi_some_pct', 'mem_psi_full_pct', 'oom_kills')))


class Rec:
    __slots__ = ('start', 'interval', 'nproc', 'user', 'system', 'iowait', 'idle', 'steal', 'steal_min',
                 'steal_max', 'cpu_max', 'load1', 'runq') + MEM_ATTRS

    def __init__(self, start, interval, nproc, user, system, iowait, idle, steal, steal_min=None,
                 steal_max=None, cpu_max=None, load1=None, runq=None, **mem):
        self.start = start
        self.interval = interval
        self.nproc = nproc
        self.user = user
        self.system = system
        self.iowait = iowait
        self.idle = idle
        self.steal = steal
        self.steal_min = steal_min
        self.steal_max = steal_max
        self.cpu_max = cpu_max
        self.load1 = load1
        self.runq = runq
        for a in MEM_ATTRS:
            setattr(self, a, mem.pop(a, None))
        if mem:
            raise TypeError('unknown fields: %s' % ', '.join(sorted(mem)))

    @property
    def end(self):
        return self.start + self.interval


# ---------------------------------------------------------------- loading


def parse_utc(s):
    return calendar.timegm(time.strptime(s, '%Y-%m-%dT%H:%M:%SZ'))


def parse_bound(s, is_end):
    """YYYY-MM-DD (a whole day; --to includes it) or YYYY-MM-DDTHH:MM (exact) to epoch seconds."""
    try:
        if 'T' in s:
            return calendar.timegm(time.strptime(s.rstrip('Z'), '%Y-%m-%dT%H:%M'))
        t = calendar.timegm(time.strptime(s, '%Y-%m-%d'))
        return t + DAY if is_end else t
    except ValueError:
        raise argparse.ArgumentTypeError('expected YYYY-MM-DD or YYYY-MM-DDTHH:MM (UTC): %r' % s)


def _f(row, key):
    v = row.get(key)
    return None if v in (None, '') else float(v)


def load_collector(data_dir, t0, t1):
    """Return (records sorted by start, malformed row count, files read) within [t0, t1)."""
    recs = {}
    bad = 0
    used = []
    for path in sorted(glob.glob(os.path.join(data_dir, 'steal-*.csv'))):
        m = re.match(r'steal-(\d{4})-(\d{2})', os.path.basename(path))
        if m:
            y, mo = int(m.group(1)), int(m.group(2))
            m0 = calendar.timegm((y, mo, 1, 0, 0, 0))
            m1 = calendar.timegm((y + mo // 12, mo % 12 + 1, 1, 0, 0, 0))
            if m1 <= t0 or m0 >= t1:
                continue
        used.append(path)
        with open(path, newline='') as f:
            for row in csv.DictReader(f):
                try:
                    if None in row or None in row.values():
                        raise ValueError  # more or fewer fields than the header: a torn or foreign line
                    start = parse_utc(row['start_utc'])
                    steal = float(row['steal_pct'])
                    interval = float(row['interval_s'])
                    if interval <= 0 or not 0 <= steal <= 100:
                        raise ValueError
                    rec = Rec(start, interval, int(row['nproc']),
                              float(row['user_pct']) + float(row['nice_pct']),
                              float(row['system_pct']) + float(row['irq_pct']),
                              float(row['iowait_pct']), float(row['idle_pct']), steal,
                              _f(row, 'steal_min_pct'), _f(row, 'steal_max_pct'), _f(row, 'steal_cpu_max_pct'),
                              _f(row, 'load1'), _f(row, 'runq_avg'),
                              **{a: _f(row, col) for a, col in MEM_COLUMNS.items()})
                except (KeyError, ValueError, TypeError, AttributeError):
                    bad += 1
                    continue
                if t0 <= start < t1:
                    old = recs.get(start)
                    if old is None or rec.interval > old.interval:
                        recs[start] = rec
    return sorted(recs.values(), key=lambda r: r.start), bad, used


SA_RE = re.compile(r'^sa(\d{2}|\d{8})(?:\.(xz|gz|bz2))?$')
OPENERS = {'xz': lzma.open, 'gz': gzip.open, 'bz2': bz2.open}


def parse_sadf(text, nproc=None):
    """Parse `sadf -d -U FILE -- -u ALL` output into records (all-CPU lines only)."""
    out = []
    for line in text.splitlines():
        if not line or line.startswith('#'):
            continue
        f = line.split(';')
        if len(f) != 14 or f[3] != '-1':
            continue  # LINUX-RESTART markers, per-CPU lines
        try:
            interval, ts = int(f[1]), int(f[2])
            usr, nice, sys_, iowait, steal, irq, soft, guest, gnice, idle = (float(x) for x in f[4:14])
        except ValueError:
            continue
        if interval <= 0:
            continue
        out.append(Rec(ts - interval, float(interval), nproc, usr + nice + guest + gnice, sys_ + irq + soft,
                       iowait, idle, steal))
    return out


def sar_files(sar_dir, t0, t1):
    """Data files that can hold samples in [t0, t1): long names by date, short names by mtime."""
    picked = {}
    try:
        names = os.listdir(sar_dir)
    except OSError:
        return []
    for name in names:
        m = SA_RE.match(name)
        if not m:
            continue
        path = os.path.join(sar_dir, name)
        try:
            real = os.path.realpath(path)
            if len(m.group(1)) == 8:
                d0 = calendar.timegm(time.strptime(m.group(1), '%Y%m%d'))
                ok = d0 < t1 and d0 + DAY > t0 - 900
            else:
                mt = os.stat(path).st_mtime  # last write: the file's day (up to its 23:50 sample)
                ok = t0 - DAY < mt < t1 + DAY
        except (OSError, ValueError):
            continue
        if ok:
            picked[real] = m.group(2)
    return sorted(picked.items())


def load_sar(sar_dir, t0, t1):
    """Return (records, note). Never raises for a missing sysstat installation."""
    sadf = shutil.which('sadf') or '/usr/bin/sadf'
    if not os.access(sadf, os.X_OK):
        return [], 'sadf not found'
    files = sar_files(sar_dir, t0, t1)
    if not files:
        return [], 'no sysstat files for the range in %s' % sar_dir
    env = {'LC_ALL': 'C', 'TZ': 'UTC', 'PATH': '/usr/bin:/bin'}
    recs = {}
    with tempfile.TemporaryDirectory(prefix='steal-report-') as tmp:
        for path, comp in files:
            src = path
            if comp:
                src = os.path.join(tmp, 'sa')
                with OPENERS[comp](path, 'rb') as fin, open(src, 'wb') as fout:
                    shutil.copyfileobj(fin, fout)
            try:
                hdr = subprocess.run([sadf, '-H', src], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                     universal_newlines=True, env=env, timeout=60).stdout
                m = re.search(r'\((\d+) CPU\)', hdr)
                res = subprocess.run([sadf, '-d', '-U', src, '--', '-u', 'ALL'], stdout=subprocess.PIPE,
                                     stderr=subprocess.DEVNULL, universal_newlines=True, env=env, timeout=120)
            except (OSError, subprocess.SubprocessError):
                continue
            for r in parse_sadf(res.stdout, int(m.group(1)) if m else None):
                if t0 <= r.start < t1:
                    recs[r.start] = r
    return sorted(recs.values(), key=lambda r: r.start), '%d sysstat files' % len(files)


# ---------------------------------------------------------------- statistics


def wmean(pairs):
    tw = sum(w for _, w in pairs)
    return sum(v * w for v, w in pairs) / tw if tw else None


def wpct(pairs, q):
    """Weighted percentile (q in 0..100): smallest value whose cumulative weight reaches q%."""
    pairs = sorted(pairs)
    tw = sum(w for _, w in pairs)
    if not tw:
        return None
    target = tw * q / 100.0
    cum = 0.0
    for v, w in pairs:
        cum += w
        if cum >= target - 1e-9:
            return v
    return pairs[-1][0]


def frac_above(recs, th, attr='steal'):
    """Percentage of time (interval-weighted) during which `attr` exceeded `th`."""
    vals = [(getattr(r, attr), r.interval) for r in recs if getattr(r, attr) is not None]
    tw = sum(w for _, w in vals)
    return 100.0 * sum(w for v, w in vals if v > th) / tw if tw else None


def eff(r, contracted):
    return (r.nproc or contracted) * (1 - r.steal / 100.0)


def stats(recs, contracted):
    """Steal statistics for a set of records (1-minute or 10-minute periods)."""
    if not recs:
        return None
    pairs = [(r.steal, r.interval) for r in recs]
    effs = [(eff(r, contracted), r.interval) for r in recs]
    busy = [(100.0 - r.idle - r.iowait, r.interval) for r in recs]
    s = {
        'covered_s': sum(r.interval for r in recs),
        'n': len(recs),
        'mean': wmean(pairs),
        'p50': wpct(pairs, 50),
        'p95': wpct(pairs, 95),
        'p99': wpct(pairs, 99),
        'max': max(recs, key=lambda r: r.steal),
        'eff_mean': wmean(effs),
        'eff_p5': wpct(effs, 5),
        'eff_min': min(v for v, _ in effs),
        'idle': wmean([(r.idle, r.interval) for r in recs]),
        'busy_share': None,
        'above': {th: frac_above(recs, th) for th in THRESHOLDS},
        'above_5s': {th: frac_above(recs, th, 'steal_max') for th in THRESHOLDS},
        'max5': None,
        'load1': wmean([(r.load1, r.interval) for r in recs if r.load1 is not None]),
        'runq': wmean([(r.runq, r.interval) for r in recs if r.runq is not None]),
    }
    b = sum(v * w for v, w in busy)
    if b > 0:
        s['busy_share'] = 100.0 * sum(v * w for v, w in pairs) / b
    with5 = [r for r in recs if r.steal_max is not None]
    if with5:
        s['max5'] = max(with5, key=lambda r: r.steal_max)
    return s


def has_mem(r):
    return bool(r.mem_total) and r.mem_avail is not None


def mem_used(r):
    """Memory in use, % of RAM: 100 - MemAvailable/MemTotal (what cannot be reclaimed without swapping)."""
    return 100.0 * (1 - r.mem_avail / r.mem_total)


def low_avail(r):
    return r.mem_avail_min if r.mem_avail_min is not None else r.mem_avail


def swap_io(r):
    return r.swapin + r.swapout


def mem_stats(recs):
    """Memory statistics over the records that carry memory columns, or None."""
    m = [r for r in recs if has_mem(r)]
    if not m:
        return None
    used = [(mem_used(r), r.interval) for r in m]

    def worst(rs, key):
        rs = [r for r in rs if key(r) is not None]
        return max(rs, key=lambda r: (key(r), -r.start)) if rs else None  # earliest of equal values

    def mean(rs, key):
        rs = [r for r in rs if key(r) is not None]
        return wmean([(key(r), r.interval) for r in rs]) if rs else None

    with_io = [r for r in m if r.swapin is not None and r.swapout is not None]
    swap_totals = [r.swap_total for r in m if r.swap_total is not None]
    return {
        'covered_s': sum(r.interval for r in m),
        'first': m[0].start,
        'total': max(r.mem_total for r in m),
        'used_mean': wmean(used),
        'used_p95': wpct(used, 95),
        'used_max': worst(m, mem_used),
        'low': min(m, key=lambda r: (low_avail(r), r.start)),
        'swap_total': max(swap_totals) if swap_totals else None,
        'swap_mean': mean(m, lambda r: r.swap_used),
        'swap_max': worst(m, lambda r: r.swap_used),
        'swapio_mean': mean(with_io, swap_io),
        'swapio_max': worst(with_io, swap_io),
        'majflt_mean': mean(m, lambda r: r.majflt),
        'majflt_max': worst(m, lambda r: r.majflt),
        'psi_some_mean': mean(m, lambda r: r.psi_some),
        'psi_full_mean': mean(m, lambda r: r.psi_full),
        'psi_some_max': worst(m, lambda r: r.psi_some),
        'psi_full_max': worst(m, lambda r: r.psi_full),
        'psi_above1': frac_above(m, 1, 'psi_some'),
        'oom': [r for r in m if r.oom],
    }


def gaps(recs, t0, t1):
    out = []
    prev_end = t0
    for r in recs:
        if r.start - prev_end > GAP_S:
            out.append((prev_end, r.start))
        prev_end = max(prev_end, r.end)
    if recs and t1 - prev_end > GAP_S:
        out.append((prev_end, t1))
    return out


def windows(recs, size, contracted):
    """Aligned windows of `size` seconds with at least half coverage, sorted by mean steal."""
    buckets = collections.defaultdict(list)
    for r in recs:
        buckets[int(r.start // size * size)].append(r)
    out = []
    for start, rs in buckets.items():
        if sum(r.interval for r in rs) < size / 2:
            continue
        m5 = [r.steal_max for r in rs if r.steal_max is not None]
        out.append({
            'start': start,
            'end': start + size,
            'mean': wmean([(r.steal, r.interval) for r in rs]),
            'max5': max(m5) if m5 else None,
            'eff': wmean([(eff(r, contracted), r.interval) for r in rs]),
            'load1': wmean([(r.load1, r.interval) for r in rs if r.load1 is not None]),
        })
    out.sort(key=lambda w: (-w['mean'], w['start']))
    return out


def cross_check(primary, sar):
    """Per sar sample: the primary-source mean over the same interval, weighted by overlap (>=80% covered)."""
    by_start = sorted(primary, key=lambda r: r.start)
    starts = [r.start for r in by_start]
    longest = max((r.interval for r in by_start), default=0)
    out = []
    for s in sar:
        pairs = []
        i = bisect.bisect_left(starts, s.start - longest)
        while i < len(by_start) and by_start[i].start < s.end:
            r = by_start[i]
            ov = min(r.end, s.end) - max(r.start, s.start)
            if ov > 0:
                pairs.append((r.steal, ov))
            i += 1
        cov = sum(w for _, w in pairs)
        out.append((s, wmean(pairs) if cov >= 0.8 * s.interval else None))
    return out


# ---------------------------------------------------------------- output


def fmt_t(t, with_date=True):
    return time.strftime('%Y-%m-%d %H:%M' if with_date else '%H:%M', time.gmtime(t))


def pc(v, digits=1):
    return 'n/a' if v is None else ('%.' + str(digits) + 'f%%') % v


def num(v, digits=2):
    return 'n/a' if v is None else ('%.' + str(digits) + 'f') % v


def gib(mib, digits=1):
    return 'n/a' if mib is None else ('%.' + str(digits) + 'f GiB') % (mib / 1024.0)


def at(r, value):
    """'value (YYYY-MM-DD HH:MM)' for the record holding a maximum or minimum."""
    return 'n/a' if r is None else '%s (%s)' % (value, fmt_t(r.start))


def table(headers, rows):
    rows = [list(map(str, row)) for row in rows]
    keep = [i for i in range(len(headers)) if not rows or any(row[i] != 'n/a' for row in rows)]
    headers = [headers[i] for i in keep]
    rows = [[row[i] for i in keep] for row in rows]
    lines = ['| ' + ' | '.join(headers) + ' |', '|' + '|'.join(['---'] * len(headers)) + '|']
    lines += ['| ' + ' | '.join(str(c) for c in row) + ' |' for row in rows]
    return '\n'.join(lines)


def group(recs, keyfn):
    g = collections.OrderedDict()
    for r in recs:
        g.setdefault(keyfn(r), []).append(r)
    return g


def day_key(r):
    return time.strftime('%Y-%m-%d', time.gmtime(r.start))


def markdown(args, recs, sar, notes, t0, t1, contracted):
    now = time.time()
    s = stats(recs, contracted)
    t_end = min(t1, max([now] + [r.end for r in recs]))  # the range may still be in progress
    span = max(0.0, t_end - t0)
    src = ('collector, 1-minute periods built from 5-second /proc/stat samples' if args.source == 'collector'
           else 'sysstat (sar), 10-minute samples')
    out = ['# CPU steal report: %s, %s to %s UTC' % (args.host, fmt_t(t0), fmt_t(t1)), '',
           'Generated %s UTC. Source: %s.' % (fmt_t(now), src)]
    if not s:
        out += ['', '**No data in this range.** ' + '; '.join(notes)]
        return '\n'.join(out) + '\n'
    gl = gaps(recs, t0, t_end)
    out.append('Coverage: %.1f h of %.1f h elapsed in the range (%.1f%%); %d gap(s) longer than %d minutes.'
               % (s['covered_s'] / 3600, span / 3600, 100 * s['covered_s'] / span if span else 0, len(gl),
                  GAP_S // 60))
    has5 = s['max5'] is not None
    lost = contracted - s['eff_mean']
    out += ['', '## Summary', '',
            'Steal is the share of time a vCPU was ready to run but the hypervisor ran something else '
            '(Linux `/proc/stat`, the same counter as `top`/`vmstat`/`sar` "st"). With %d contracted vCPUs, '
            'effective vCPUs = vCPUs x (1 - steal).' % contracted, '']
    rows = [
        ('Contracted vCPUs (guest sees %s)' % '/'.join(str(n) for n in sorted({r.nproc for r in recs if r.nproc})),
         str(contracted)),
        ('Mean steal (time-weighted)', pc(s['mean'])),
        ('Median (p50) / p95 / p99 of %s averages' % ('1-minute' if args.source == 'collector' else '10-minute'),
         '%s / %s / %s' % (pc(s['p50']), pc(s['p95']), pc(s['p99']))),
        ('Highest %s average' % ('1-minute' if args.source == 'collector' else '10-minute'),
         '%s (%s)' % (pc(s['max'].steal), fmt_t(s['max'].start))),
    ]
    if has5:
        rows.append(('Highest 5-second sample', '%s (minute starting %s)'
                     % (pc(s['max5'].steal_max), fmt_t(s['max5'].start))))
    rows.append(('Time with steal above %s' % ' / '.join('%d%%' % t for t in THRESHOLDS),
                 ' / '.join(pc(s['above'][t]) for t in THRESHOLDS)))
    if has5:
        rows.append(('Minutes with a 5-second sample above %s' % ' / '.join('%d%%' % t for t in THRESHOLDS),
                     ' / '.join(pc(s['above_5s'][t]) for t in THRESHOLDS)))
    rows += [
        ('Effective vCPUs: mean', '%s of %d (%s vCPU, %s, withheld)'
         % (num(s['eff_mean']), contracted, num(lost), pc(100 * lost / contracted))),
        ('Effective vCPUs: worst 5%% of %s / minimum' % ('minutes' if args.source == 'collector' else 'samples'),
         '%s / %s' % (num(s['eff_p5']), num(s['eff_min']))),
        ('Mean idle (guest had no work)', pc(s['idle'])),
        ('Steal as share of busy CPU time (steal / (100 - idle - iowait))', pc(s['busy_share'])),
    ]
    if s['load1'] is not None:
        rows.append(('Mean load average (1 min) / run queue', '%s / %s' % (num(s['load1'], 1), num(s['runq'], 1))))
    out.append(table(['Metric', 'Value'], rows))
    dur = ('%.1f days' % (s['covered_s'] / DAY) if s['covered_s'] >= 2 * DAY
           else '%.1f hours' % (s['covered_s'] / 3600))
    out += ['', '**In short:** over %s of data the VM received on average %s of %d contracted vCPUs (%s less); '
            'steal exceeded 20%% (fewer than %s effective vCPUs) for %s of the time.'
            % (dur, num(s['eff_mean'], 1), contracted, pc(100 * lost / contracted),
               num(contracted * 0.8, 1), pc(s['above'][20]))]

    out += ['', '## By day (UTC)', '']
    rows = []
    for d, rs in group(recs, day_key).items():
        x = stats(rs, contracted)
        rows.append((d, num(x['covered_s'] / 3600, 1), pc(x['mean']), pc(x['p50']), pc(x['p95']), pc(x['max'].steal),
                     pc(x['max5'].steal_max) if x['max5'] else 'n/a', pc(x['above'][10]), pc(x['above'][20]),
                     pc(x['above'][30]), num(x['eff_mean']), pc(x['idle']), num(x['load1'], 1)))
    out.append(table(['Day', 'Hours', 'Mean', 'p50', 'p95', 'Max', 'Max 5 s', '>10%', '>20%', '>30%', 'Eff. vCPU',
                      'Idle', 'Load1'], rows))

    out += ['', '## By hour of day (UTC; Romania is UTC+2 in winter)', '']
    rows = []
    byhour = group(sorted(recs, key=lambda r: (time.gmtime(r.start).tm_hour, r.start)),
                   lambda r: time.gmtime(r.start).tm_hour)
    for h, rs in byhour.items():
        x = stats(rs, contracted)
        rows.append(('%02d:00' % h, num(x['covered_s'] / 3600, 1), pc(x['mean']), pc(x['p95']), pc(x['max'].steal),
                     pc(x['max5'].steal_max) if x['max5'] else 'n/a', pc(x['above'][20]), num(x['eff_mean'])))
    out.append(table(['Hour', 'Hours of data', 'Mean', 'p95', 'Max', 'Max 5 s', '>20%', 'Eff. vCPU'], rows))

    out += ['', '## Worst 10-minute windows', '']
    rows = [('%s-%s' % (fmt_t(w['start']), fmt_t(w['end'], False)), pc(w['mean']), pc(w['max5']), num(w['eff']),
             num(w['load1'], 1)) for w in windows(recs, 600, contracted)[:args.top]]
    out.append(table(['Window (UTC)', 'Mean steal', 'Max 5 s', 'Eff. vCPU', 'Load1'], rows))

    if args.source == 'collector':
        out += ['', '## Worst minutes', '']
        worst = sorted(recs, key=lambda r: (-r.steal, r.start))[:args.top]
        out.append(table(['Minute (UTC)', 'Steal', 'Min 5 s', 'Max 5 s', 'Max single vCPU (5 s)', 'Load1'],
                         [(fmt_t(r.start), pc(r.steal), pc(r.steal_min), pc(r.steal_max), pc(r.cpu_max),
                           num(r.load1, 1)) for r in worst]))

    if args.source == 'collector':
        out += memory_markdown(recs, t0, t_end)

    if args.source == 'collector':
        out += ['', '## Independent cross-check: sysstat (sar, 10-minute samples)', '']
        if sar:
            rows = []
            all_diffs = []
            for d, pairs in group(cross_check(recs, sar), lambda p: day_key(p[0])).items():
                comp = [(sv.steal, m, sv.interval) for sv, m in pairs if m is not None]
                diffs = [abs(a - b) for a, b, _ in comp]
                all_diffs += diffs
                rows.append((d, len(pairs), pc(wmean([(sv.steal, sv.interval) for sv, _ in pairs])),
                             pc(max(sv.steal for sv, _ in pairs)), len(comp),
                             pc(wmean([(a, w) for a, _, w in comp])) if comp else 'n/a',
                             pc(wmean([(b, w) for _, b, w in comp])) if comp else 'n/a',
                             num(max(diffs)) if diffs else 'n/a'))
            out.append(table(['Day', 'sar samples', 'sar mean', 'sar max', 'Compared', 'sar mean (compared)',
                              'Collector mean (same windows)', 'Max abs. diff (pp)'], rows))
            if all_diffs:
                out += ['', 'Over %d compared 10-minute windows the two sources differ by %.2f percentage points on '
                        'average (max %.2f).' % (len(all_diffs), sum(all_diffs) / len(all_diffs), max(all_diffs))]
        else:
            out.append('Not available (%s).' % ('skipped with --no-sar' if args.no_sar else notes[-1]))

    out += ['', '## Data quality', '']
    for a, b in gl[:args.top]:
        out.append('- Gap: %s to %s (%.0f min)' % (fmt_t(a), fmt_t(b), (b - a) / 60))
    if len(gl) > args.top:
        out.append('- ... %d more gaps' % (len(gl) - args.top))
    out += ['- ' + n for n in notes]
    return '\n'.join(out) + '\n'


def memory_markdown(recs, t0, t_end):
    """The '## Memory' section (collector source only)."""
    out = ['', '## Memory', '']
    m = mem_stats(recs)
    if not m:
        return out + ['Not recorded in this range: the collector writes memory columns since 2026-11-19.']
    out += ['Memory in use is 100% - MemAvailable/MemTotal: what the kernel cannot reclaim without swapping '
            '(reclaimable page cache counts as available). Memory pressure is Linux PSI (`/proc/pressure/memory`): '
            'the share of time in which at least one task (some) or every non-idle task (full) was stalled waiting '
            'for memory. Pressure, not swap in use, is the sign of a real shortage.', '']
    covered = sum(r.interval for r in recs)
    if m['covered_s'] < covered - 120:
        out += ['Memory columns cover %.1f h of the %.1f h with data (from %s UTC).'
                % (m['covered_s'] / 3600, covered / 3600, fmt_t(m['first'])), '']
    rows = [
        ('RAM', gib(m['total'])),
        ('Memory in use: mean / p95 / highest minute', '%s / %s / %s' % (
            pc(m['used_mean']), pc(m['used_p95']), at(m['used_max'], pc(mem_used(m['used_max']))))),
        ('Lowest available memory (5-second samples)', at(m['low'], gib(low_avail(m['low'])))),
    ]
    if m['swap_max'] is not None:
        rows.append(('Swap in use: mean / highest', '%s / %s of %s' % (
            gib(m['swap_mean'], 2), at(m['swap_max'], gib(m['swap_max'].swap_used, 2)), gib(m['swap_total']))))
    if m['swapio_max'] is not None:
        rows.append(('Swapping, pages in + out per second: mean / highest minute', '%s / %s' % (
            num(m['swapio_mean'], 1), at(m['swapio_max'], num(swap_io(m['swapio_max']), 1)))))
    if m['majflt_max'] is not None:
        rows.append(('Major page faults per second: mean / highest minute', '%s / %s' % (
            num(m['majflt_mean'], 1), at(m['majflt_max'], num(m['majflt_max'].majflt, 1)))))
    if m['psi_some_max'] is not None:
        rows += [
            ('Memory pressure, some / full: mean', '%s / %s' % (pc(m['psi_some_mean'], 2), pc(m['psi_full_mean'], 2))),
            ('Memory pressure, some / full: highest minute', '%s / %s' % (
                at(m['psi_some_max'], pc(m['psi_some_max'].psi_some, 2)),
                at(m['psi_full_max'], pc(m['psi_full_max'].psi_full, 2)))),
            ('Time with memory pressure (some) above 1%', pc(m['psi_above1'])),
        ]
    rows.append(('OOM kills', str(sum(int(r.oom) for r in m['oom']))))
    out.append(table(['Metric', 'Value'], rows))
    if m['oom']:
        out.append('')
        out += ['- %d OOM kill(s) in the minute starting %s UTC' % (int(r.oom), fmt_t(r.start)) for r in m['oom'][:20]]
        if len(m['oom']) > 20:
            out.append('- ... %d more minutes with OOM kills' % (len(m['oom']) - 20))

    out += ['', '### Memory by day (UTC)', '']
    rows = []
    for d, rs in group([r for r in recs if has_mem(r)], day_key).items():
        x = mem_stats(rs)
        rows.append((d, num(x['covered_s'] / 3600, 1), pc(x['used_mean']), pc(mem_used(x['used_max'])),
                     gib(low_avail(x['low'])), gib(x['swap_max'].swap_used, 2) if x['swap_max'] else 'n/a',
                     num(x['swapio_mean'], 1), pc(x['psi_some_mean'], 2),
                     pc(x['psi_some_max'].psi_some, 2) if x['psi_some_max'] else 'n/a',
                     str(sum(int(r.oom) for r in x['oom']))))
    out.append(table(['Day', 'Hours', 'In use', 'In use max', 'Lowest available', 'Swap max', 'Swap pages/s',
                      'Pressure (some)', 'Pressure max', 'OOM kills'], rows))
    return out


def opt(v, digits=2):
    return '' if v is None else num(v, digits)


def write_csv(kind, recs, contracted, stream):
    w = csv.writer(stream, lineterminator='\n')
    if kind == 'minute':
        w.writerow(['start_utc', 'interval_s', 'nproc', 'steal_pct', 'steal_max_5s_pct', 'idle_pct',
                    'effective_vcpus', 'load1', 'mem_used_pct', 'mem_avail_min_mib', 'swap_used_mib',
                    'mem_psi_some_pct', 'mem_psi_full_pct', 'oom_kills'])
        for r in recs:
            m = has_mem(r)
            w.writerow([fmt_t(r.start), num(r.interval), r.nproc or contracted, num(r.steal),
                        num(r.steal_max) if r.steal_max is not None else '', num(r.idle), num(eff(r, contracted)),
                        num(r.load1) if r.load1 is not None else '', num(mem_used(r)) if m else '',
                        opt(low_avail(r) if m else None, 0), opt(r.swap_used, 0), opt(r.psi_some), opt(r.psi_full),
                        opt(r.oom, 0)])
        return
    keyfn = day_key if kind == 'daily' else (lambda r: time.strftime('%Y-%m-%d %H:00', time.gmtime(r.start)))
    w.writerow([('day' if kind == 'daily' else 'hour') + '_utc', 'hours_of_data', 'steal_mean_pct', 'steal_p95_pct',
                'steal_max_pct', 'steal_max_5s_pct', 'pct_time_above_10', 'pct_time_above_20', 'pct_time_above_30',
                'effective_vcpus_mean', 'idle_mean_pct', 'load1_mean', 'mem_used_mean_pct', 'mem_used_max_pct',
                'mem_avail_min_mib', 'swap_used_max_mib', 'mem_psi_some_mean_pct', 'mem_psi_some_max_pct',
                'oom_kills'])
    for k, rs in group(recs, keyfn).items():
        x = stats(rs, contracted)
        m = mem_stats(rs)
        mem = ['', '', '', '', '', '', '']
        if m:
            mem = [num(m['used_mean']), num(mem_used(m['used_max'])), opt(low_avail(m['low']), 0),
                   opt(m['swap_max'].swap_used if m['swap_max'] else None, 0), opt(m['psi_some_mean']),
                   opt(m['psi_some_max'].psi_some if m['psi_some_max'] else None),
                   str(sum(int(r.oom) for r in m['oom']))]
        w.writerow([k, num(x['covered_s'] / 3600, 3), num(x['mean']), num(x['p95']), num(x['max'].steal),
                    num(x['max5'].steal_max) if x['max5'] else '', num(x['above'][10]), num(x['above'][20]),
                    num(x['above'][30]), num(x['eff_mean']), num(x['idle']),
                    num(x['load1']) if x['load1'] is not None else ''] + mem)


def main(argv=None):
    ap = argparse.ArgumentParser(prog='steal_report.py', description=__doc__.split('\n\n')[0])
    today = time.strftime('%Y-%m-%d', time.gmtime())
    ap.add_argument('--from', dest='t0', help='start date YYYY-MM-DD[THH:MM] UTC (default: 6 days before --to)')
    ap.add_argument('--to', dest='t1', default=today, help='end date, inclusive (default: today, UTC)')
    ap.add_argument('--source', choices=('collector', 'sar'), default='collector')
    ap.add_argument('--data-dir', default=DATA_DIR)
    ap.add_argument('--sar-dir', default=SAR_DIR)
    ap.add_argument('--no-sar', action='store_true', help='skip the sysstat cross-check')
    ap.add_argument('--contracted-vcpus', type=int, help='default: the vCPU count the guest sees')
    ap.add_argument('--top', type=int, default=10, help='rows in the worst-window tables (default 10)')
    ap.add_argument('--host', default='nsromania.info', help='name shown in the title')
    ap.add_argument('--csv', choices=('daily', 'hourly', 'minute'), help='print a CSV instead of Markdown')
    args = ap.parse_args(argv)
    try:
        t1 = parse_bound(args.t1, True)
        t0 = parse_bound(args.t0, False) if args.t0 else t1 - 7 * DAY
    except argparse.ArgumentTypeError as e:
        ap.error(str(e))
    if t0 >= t1:
        ap.error('--from must be before --to')

    notes = []
    sar = []
    if args.source == 'collector':
        recs, bad, files = load_collector(args.data_dir, t0, t1)
        notes.append('%d collector file(s) read from %s; %d malformed line(s) skipped'
                     % (len(files), args.data_dir, bad))
        if not args.no_sar and not args.csv:
            sar, note = load_sar(args.sar_dir, t0, t1)
            notes.append('sysstat: ' + note)
    else:
        recs, note = load_sar(args.sar_dir, t0, t1)
        notes.append('sysstat: ' + note)
    nprocs = [r.nproc for r in recs if r.nproc]
    contracted = args.contracted_vcpus or (max(nprocs) if nprocs else os.cpu_count() or 1)

    if args.csv:
        write_csv(args.csv, recs, contracted, sys.stdout)
    else:
        sys.stdout.write(markdown(args, recs, sar, notes, t0, t1, contracted))
    return 0


if __name__ == '__main__':
    sys.exit(main())
