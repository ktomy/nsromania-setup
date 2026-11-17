#!/usr/bin/env python3
"""Draw CPU steal, our CPU use and the load average for a time range as one standalone HTML page.

Reads the collector's 1-minute CSVs (steal-YYYY-MM.csv) with steal_report.py's loader, embeds the
rows in the steal_chart.html template and writes the page. The page needs no network: it aggregates
to 1, 5, 10, 30 or 60-minute points itself and has a hover/keyboard readout, a table view and dark
mode. Normally run through chart.sh, which first copies the month files the range needs from
production. Dates are UTC; --to is inclusive when given as a date. Stdlib only, read-only.

Usage:
    steal_chart.py --data-dir DIR > chart.html                                    # last 24 hours
    steal_chart.py --data-dir DIR --from 2026-11-16 --to 2026-11-22 --out week.html
    steal_chart.py --data-dir DIR --mark '2026-11-16T05:42|steal drops (14.7% before, 8.8% after)|steal drops'
    steal_chart.py --list-months --from 2026-11-16 --to 2026-12-02                # months chart.sh fetches
"""

import argparse
import calendar
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import steal_report as sr  # noqa: E402

TEMPLATE = os.path.join(HERE, 'steal_chart.html')
PLACEHOLDER = '/*__DATA__*/null'


def months(t0, t1):
    """YYYY-MM strings of the months overlapping [t0, t1)."""
    y, m = time.gmtime(t0)[:2]
    out = []
    while calendar.timegm((y, m, 1, 0, 0, 0)) < t1:
        out.append('%04d-%02d' % (y, m))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def parse_mark(s):
    """'YYYY-MM-DDTHH:MM|label[|short label]' -> {'t', 'label', 'short'}."""
    when, sep, rest = s.partition('|')
    label, _, short = rest.partition('|')
    if not sep or not label.strip():
        raise argparse.ArgumentTypeError("expected 'YYYY-MM-DDTHH:MM|label[|short label]': %r" % s)
    return {'t': sr.parse_bound(when, False), 'label': label.strip(), 'short': short.strip() or label.strip()}


def build(recs, t0, t1, marks, host):
    """Return the page with the records embedded. Row: [start, interval, steal, our, idle, load1, runq, max5]."""
    rows = []
    for r in recs:
        rows.append([
            r.start,
            round(r.interval, 2),
            round(r.steal, 2),
            round(r.user + r.system, 2),  # user + nice + system + irq: the work our services got done
            round(r.idle + r.iowait, 2),
            r.load1 if r.load1 is not None else 0.0,
            round(r.runq, 1) if r.runq is not None else 0.0,
            round(r.steal_max if r.steal_max is not None else r.steal, 1),
        ])
    nprocs = [r.nproc for r in recs if r.nproc]
    data = {
        'from': t0,
        'to': t1,
        'nproc': max(nprocs) if nprocs else 1,
        'host': host,
        'marks': marks,
        'rows': rows,
        'generated': time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime()),
    }
    # '<\/' keeps a label such as '</script>' from ending the script element; JSON reads it back as '</'.
    payload = json.dumps(data, separators=(',', ':')).replace('</', '<\\/')
    with open(TEMPLATE, encoding='utf-8') as f:
        html = f.read()
    if html.count(PLACEHOLDER) != 1:
        raise RuntimeError('%s must contain %s exactly once' % (TEMPLATE, PLACEHOLDER))
    return html.replace(PLACEHOLDER, payload)


def main(argv=None):
    ap = argparse.ArgumentParser(prog='steal_chart.py', description=__doc__.split('\n\n')[0])
    ap.add_argument('--from', dest='t0', help='start, YYYY-MM-DD[THH:MM] UTC (default: 24 hours before --to)')
    ap.add_argument('--to', dest='t1', help='end, YYYY-MM-DD (inclusive) or YYYY-MM-DDTHH:MM UTC (default: now)')
    ap.add_argument('--data-dir', default=sr.DATA_DIR)
    ap.add_argument('--out', help='write the page to this file instead of stdout')
    ap.add_argument('--mark', action='append', default=[], metavar="'TIME|LABEL[|SHORT]'",
                    help='draw an annotated rule at TIME (UTC); SHORT is used where LABEL does not fit; repeatable')
    ap.add_argument('--host', default='nsromania.info', help='name shown under the title')
    ap.add_argument('--list-months', action='store_true', help='print the YYYY-MM months the range needs and exit')
    args = ap.parse_args(argv)
    try:
        t1 = sr.parse_bound(args.t1, True) if args.t1 else int(time.time()) // 60 * 60
        t0 = sr.parse_bound(args.t0, False) if args.t0 else t1 - sr.DAY
        marks = [parse_mark(m) for m in args.mark]
    except argparse.ArgumentTypeError as e:
        ap.error(str(e))
    if t0 >= t1:
        ap.error('--from must be before --to')

    if args.list_months:
        sys.stdout.write(''.join(m + '\n' for m in months(t0, t1)))
        return 0

    recs, bad, files = sr.load_collector(args.data_dir, t0, t1)
    span = '%s to %s UTC' % (sr.fmt_t(t0), sr.fmt_t(t1))
    if not recs:
        sys.stderr.write('steal_chart.py: no collector data from %s in %s\n' % (span, args.data_dir))
        return 1
    html = build(recs, t0, t1, marks, args.host)
    if args.out:
        with open(args.out, 'w', encoding='utf-8') as f:
            f.write(html)
    else:
        sys.stdout.write(html)
    sys.stderr.write('steal_chart.py: %s: %d minutes from %d file(s), %d malformed line(s) skipped%s\n'
                     % (span, len(recs), len(files), bad, ' -> ' + args.out if args.out else ''))
    return 0


if __name__ == '__main__':
    sys.exit(main())
