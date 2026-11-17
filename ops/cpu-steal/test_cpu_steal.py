import calendar
import io
import json
import lzma
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import collect_cpu_steal as c  # noqa: E402
import steal_report as r  # noqa: E402
import steal_chart as sc  # noqa: E402

STAT = """cpu  1000 10 200 5000 50 0 40 700 0 0
cpu0 500 5 100 2500 25 0 20 350 0 0
cpu1 500 5 100 2500 25 0 20 350 0 0
intr 123456 1 2 3
ctxt 999
btime 1
processes 77
procs_running 39
procs_blocked 2
softirq 1 2 3
"""


def snap(total, cpus, running=1, blocked=0, mono=0.0):
    return c.Snapshot(tuple(total), {k: tuple(v) for k, v in cpus.items()}, running, blocked, mono)


def counters(user=0, system=0, idle=0, iowait=0, steal=0):
    # user, nice, system, idle, iowait, irq, softirq, steal
    return [user, 0, system, idle, iowait, 0, 0, steal]


def add(a, b):
    return [x + y for x, y in zip(a, b)]


class ParseTest(unittest.TestCase):
    def test_parse_stat(self):
        s = c.parse_stat(STAT, mono=5.0)
        self.assertEqual(s.total, (1000, 10, 200, 5000, 50, 0, 40, 700))
        self.assertEqual(sorted(s.cpus), ['cpu0', 'cpu1'])
        self.assertEqual((s.running, s.blocked, s.mono), (39, 2, 5.0))

    def test_parse_stat_pads_short_lines_and_requires_aggregate(self):
        s = c.parse_stat('cpu  1 2 3 4\ncpu0 1 2 3 4\n')
        self.assertEqual(s.total, (1, 2, 3, 4, 0, 0, 0, 0))
        with self.assertRaises(ValueError):
            c.parse_stat('cpu0 1 2 3 4\n')

    def test_parse_loadavg(self):
        self.assertEqual(c.parse_loadavg('43.86 32.63 69.42 55/4812 2790031\n'), (43.86, 32.63, 69.42))

    def test_delta_clamps_backwards_counters(self):
        self.assertEqual(c.delta([10, 50], [15, 40]), [5, 0])
        self.assertIsNone(c.percentages([0, 0, 0]))


class PeriodTest(unittest.TestCase):
    def test_aggregates_sub_samples(self):
        z = counters()
        s0 = snap(z, {'cpu0': z, 'cpu1': z}, mono=100.0)
        # 5 s, 2 CPUs at 100 Hz = 1000 ticks: 10% steal (cpu0 20%, cpu1 0%)
        d1 = counters(user=880, steal=100, idle=20)
        s1 = snap(d1, {'cpu0': counters(user=390, steal=100, idle=10), 'cpu1': counters(user=490, idle=10)},
                  running=40, blocked=1, mono=105.0)
        # next 5 s: 30% steal (cpu1 60%)
        d2 = add(d1, counters(user=680, steal=300, idle=20))
        s2 = snap(d2, {'cpu0': add(s1.cpus['cpu0'], counters(user=490, idle=10)),
                       'cpu1': add(s1.cpus['cpu1'], counters(user=190, steal=300, idle=10))},
                  running=60, blocked=0, mono=110.02)
        p = c.Period(calendar.timegm((2026, 11, 15, 12, 0, 0)), s0)
        p.add(s0, s1)
        p.add(s1, s2)
        line = p.line(s2, (150.5, 140.25, 130.0))
        f = dict(zip(c.HEADER.split(','), line.split(',')))
        self.assertEqual(len(line.split(',')), len(c.HEADER.split(',')))
        self.assertEqual(f['start_utc'], '2026-11-15T12:00:00Z')
        self.assertEqual(f['interval_s'], '10.02')
        self.assertEqual((f['samples'], f['nproc']), ('2', '2'))
        self.assertEqual(f['steal_pct'], '20.00')
        self.assertEqual((f['steal_min_pct'], f['steal_max_pct'], f['steal_cpu_max_pct']), ('10.00', '30.00', '60.00'))
        self.assertEqual(f['user_pct'], '78.00')
        self.assertEqual(f['idle_pct'], '2.00')
        self.assertEqual((f['load1'], f['load5'], f['load15']), ('150.50', '140.25', '130.00'))
        self.assertEqual((f['runq_avg'], f['runq_max'], f['blocked_max']), ('50.0', '60', '1'))
        pct_sum = sum(float(f[k]) for k in ('user_pct', 'nice_pct', 'system_pct', 'irq_pct', 'iowait_pct',
                                            'idle_pct', 'steal_pct'))
        self.assertAlmostEqual(pct_sum, 100.0, places=1)

    def test_empty_period_and_cpu_hotplug(self):
        z = counters()
        s0 = snap(z, {'cpu0': z}, mono=0.0)
        p = c.Period(0, s0)
        self.assertIsNone(p.line(s0, (0, 0, 0)))
        s1 = snap(counters(user=150, steal=50), {'cpu0': counters(user=50, steal=50), 'cpu1': counters(user=100)},
                  mono=5.0)
        p.add(s0, s1)  # cpu1 appeared: ignored for the per-CPU max, counted for nproc
        f = dict(zip(c.HEADER.split(','), p.line(s1, (1, 1, 1)).split(',')))
        self.assertEqual((f['steal_pct'], f['steal_cpu_max_pct'], f['nproc']), ('25.00', '50.00', '2'))


class WriterTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.nov = calendar.timegm((2026, 11, 30, 23, 59, 0))
        self.dec = calendar.timegm((2026, 12, 1, 0, 0, 0))

    def tearDown(self):
        shutil.rmtree(self.dir)

    def read(self, name):
        with open(os.path.join(self.dir, name)) as f:
            return f.read()

    def test_header_once_and_monthly_files(self):
        w = c.Writer(self.dir, min_free=0)
        self.assertTrue(w.write(self.nov, 'a'))
        self.assertTrue(w.write(self.nov, 'b'))
        self.assertTrue(w.write(self.dec, 'c'))
        self.assertEqual(self.read('steal-2026-11.csv'), c.HEADER + '\na\nb\n')
        self.assertEqual(self.read('steal-2026-12.csv'), c.HEADER + '\nc\n')
        # a restarted collector appends without a second header
        self.assertTrue(c.Writer(self.dir, min_free=0).write(self.dec, 'd'))
        self.assertEqual(self.read('steal-2026-12.csv'), c.HEADER + '\nc\nd\n')
        self.assertEqual(os.stat(os.path.join(self.dir, 'steal-2026-12.csv')).st_mode & 0o777,
                         0o644 & ~_umask())

    def test_repairs_torn_last_line(self):
        with open(os.path.join(self.dir, 'steal-2026-11.csv'), 'w') as f:
            f.write(c.HEADER + '\nfull\ntorn,li')
        c.Writer(self.dir, min_free=0).write(self.nov, 'next')
        self.assertEqual(self.read('steal-2026-11.csv'), c.HEADER + '\nfull\ntorn,li\nnext\n')

    def test_other_schema_goes_to_new_file(self):
        with open(os.path.join(self.dir, 'steal-2026-11.csv'), 'w') as f:
            f.write('old,header\n1,2\n')
        c.Writer(self.dir, min_free=0).write(self.nov, 'x')
        self.assertEqual(self.read('steal-2026-11.csv'), 'old,header\n1,2\n')
        self.assertEqual(self.read('steal-2026-11.2.csv'), c.HEADER + '\nx\n')

    def test_disk_and_size_guards(self):
        with mock.patch.object(c, 'log') as log:
            self.assertFalse(c.Writer(self.dir, min_free=1 << 62).write(self.nov, 'x'))
            self.assertEqual(os.listdir(self.dir), [])
            w = c.Writer(self.dir, min_free=0, max_bytes=len(c.HEADER) + 3)
            self.assertTrue(w.write(self.nov, 'ab'))
            self.assertFalse(w.write(self.nov, 'cd'))
            self.assertFalse(w.write(self.nov, 'ef'))
            self.assertEqual(log.call_count, 2)  # rate-limited: once per guard
        self.assertEqual(self.read('steal-2026-11.csv'), c.HEADER + '\nab\n')


def _umask():
    m = os.umask(0)
    os.umask(m)
    return m


@unittest.skipUnless(os.path.exists('/proc/stat'), 'needs Linux /proc')
class CollectorProcessTest(unittest.TestCase):
    def test_runs_aligned_and_stops_cleanly(self):
        d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, d)
        p = subprocess.Popen([sys.executable, '-I', '-S', os.path.join(HERE, 'collect_cpu_steal.py'),
                              '--data-dir', d, '--step', '0.25', '--period', '1'],
                             stderr=subprocess.PIPE, universal_newlines=True)
        time.sleep(3.6)
        p.send_signal(signal.SIGTERM)
        _, err = p.communicate(timeout=10)
        self.assertEqual(p.returncode, 0, err)
        self.assertIn('stopped', err)
        (name,) = os.listdir(d)
        with open(os.path.join(d, name)) as f:
            lines = f.read().splitlines()
        self.assertEqual(lines[0], c.HEADER)
        rows = [dict(zip(c.HEADER.split(','), ln.split(','))) for ln in lines[1:]]
        self.assertGreaterEqual(len(rows), 2)
        for row in rows[:-1]:  # the last row may be the partial period written on SIGTERM
            self.assertAlmostEqual(float(row['interval_s']), 1.0, delta=0.2)
            self.assertEqual(row['samples'], '4')
        for row in rows:
            self.assertTrue(row['start_utc'].endswith('Z'))
            total = sum(float(row[k]) for k in ('user_pct', 'nice_pct', 'system_pct', 'irq_pct', 'iowait_pct',
                                                'idle_pct', 'steal_pct'))
            self.assertAlmostEqual(total, 100.0, delta=0.1)
        starts = [r.parse_utc(row['start_utc']) for row in rows]
        self.assertEqual(starts, sorted(set(starts)))


# ---------------------------------------------------------------- report

T0 = calendar.timegm((2026, 11, 16, 0, 0, 0))


def csv_line(start, steal, interval=60.0, idle=2.0, smax=None, load1=150.0, nproc=8):
    user = 100 - steal - idle - 8
    return ','.join([time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(start)), '%.2f' % interval, '12', str(nproc),
                     '%.2f' % user, '0.00', '6.00', '1.00', '1.00', '%.2f' % idle, '%.2f' % steal,
                     '%.2f' % max(0, steal - 2), '%.2f' % (steal + 5 if smax is None else smax), '%.2f' % (steal + 9),
                     '%.2f' % load1, '1.00', '1.00', '40.0', '60', '0'])


def make_recs(steals, start=T0, interval=60.0, nproc=8):
    return [r.Rec(start + i * interval, interval, nproc, 80 - s, 7, 1, 2, s, s - 2, s + 5, s + 9, 150.0, 40.0)
            for i, s in enumerate(steals)]


class StatsTest(unittest.TestCase):
    def test_weighted_percentiles(self):
        pairs = [(v, 1) for v in range(1, 101)]
        self.assertEqual(r.wpct(pairs, 50), 50)
        self.assertEqual(r.wpct(pairs, 95), 95)
        self.assertEqual(r.wpct(pairs, 99), 99)
        self.assertEqual(r.wpct(pairs, 100), 100)
        self.assertEqual(r.wpct([(10, 1), (30, 3)], 50), 30)
        self.assertEqual(r.wmean([(10, 1), (30, 3)]), 25)
        self.assertIsNone(r.wpct([], 50))

    def test_stats_known_distribution(self):
        recs = make_recs([10] * 70 + [25] * 20 + [35] * 10)
        s = r.stats(recs, 8)
        self.assertAlmostEqual(s['mean'], 15.5)
        self.assertEqual((s['p50'], s['p95'], s['p99']), (10, 35, 35))
        self.assertEqual(s['max'].steal, 35)
        self.assertEqual(s['max5'].steal_max, 40)
        self.assertEqual(s['above'], {10: 30.0, 20: 30.0, 30: 10.0})
        self.assertEqual(s['above_5s'], {10: 100.0, 20: 30.0, 30: 10.0})
        self.assertAlmostEqual(s['eff_mean'], 8 * (1 - 0.155))
        self.assertAlmostEqual(s['eff_min'], 8 * 0.65)
        self.assertAlmostEqual(s['busy_share'], 15.5 / 97 * 100)

    def test_interval_weighting(self):
        recs = [r.Rec(T0, 60, 8, 0, 0, 0, 0, 10), r.Rec(T0 + 60, 180, 8, 0, 0, 0, 0, 30)]
        s = r.stats(recs, 8)
        self.assertAlmostEqual(s['mean'], 25.0)
        self.assertEqual(s['above'][20], 75.0)

    def test_gaps_and_windows(self):
        recs = make_recs([10] * 20) + make_recs([40] * 10, start=T0 + 1800)
        self.assertEqual(r.gaps(recs, T0, T0 + 3600), [(T0 + 1200, T0 + 1800), (T0 + 2400, T0 + 3600)])
        w = r.windows(recs, 600, 8)
        self.assertEqual([x['start'] for x in w], [T0 + 1800, T0, T0 + 600])
        self.assertAlmostEqual(w[0]['mean'], 40)
        self.assertAlmostEqual(w[0]['eff'], 4.8)
        # windows with under half coverage are dropped
        self.assertEqual(r.windows(make_recs([50] * 4), 600, 8), [])


class LoadCollectorTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir)

    def write(self, name, lines, header=c.HEADER):
        with open(os.path.join(self.dir, name), 'w') as f:
            f.write(header + '\n' + '\n'.join(lines) + '\n')

    def test_range_dedupe_and_malformed(self):
        self.write('steal-2026-11.csv', [
            csv_line(T0 - 60, 99),                       # before the range
            csv_line(T0, 10),
            csv_line(T0, 12, interval=30.0),             # duplicate start, shorter: dropped
            'torn,li',
            csv_line(T0 + 60, 101),                      # invalid percentage
            csv_line(T0 + 120, 20),
        ])
        self.write('steal-2026-11.2.csv', [csv_line(T0 + 180, 30) + ',extra'], header=c.HEADER + ',new_col')
        self.write('steal-2026-09.csv', ['garbage'])     # month outside the range: not even read
        recs, bad, files = r.load_collector(self.dir, T0, T0 + 86400)
        self.assertEqual([(x.start - T0, x.steal) for x in recs], [(0, 10), (120, 20), (180, 30)])
        self.assertEqual(bad, 2)
        self.assertEqual(len(files), 2)
        self.assertAlmostEqual(recs[0].user, 80.0)
        self.assertEqual((recs[0].steal_max, recs[0].cpu_max, recs[0].load1), (15.0, 19.0, 150.0))

    def test_reads_collector_output(self):
        w = c.Writer(self.dir, min_free=0)
        w.write(T0, csv_line(T0, 17.5))
        recs, bad, _ = r.load_collector(self.dir, T0, T0 + 60)
        self.assertEqual((len(recs), bad, recs[0].steal), (1, 0, 17.5))


SADF = """# hostname;interval;timestamp;CPU;%usr;%nice;%sys;%iowait;%steal;%irq;%soft;%guest;%gnice;%idle
nsromania-new;599;1794701405;-1;75.21;0.42;4.00;0.05;19.23;0.00;0.54;0.00;0.00;0.55
nsromania-new;-1;1794701500;LINUX-RESTART\t(8 CPU)
nsromania-new;600;1794702004;-1;73.06;0.00;3.89;0.12;14.96;0.00;0.68;0.00;0.00;7.28
nsromania-new;600;1794702004;0;73.06;0.00;3.89;0.12;14.96;0.00;0.68;0.00;0.00;7.28
"""


class SarTest(unittest.TestCase):
    def test_parse_sadf(self):
        recs = r.parse_sadf(SADF, 8)
        self.assertEqual([(x.start, x.interval, x.steal) for x in recs],
                         [(1794701405 - 599, 599.0, 19.23), (1794702004 - 600, 600.0, 14.96)])
        self.assertAlmostEqual(recs[0].user, 75.63)
        self.assertEqual(recs[0].nproc, 8)

    def test_cross_check_weights_overlap(self):
        coll = make_recs([10] * 5 + [40] * 5, start=T0)  # 10 minutes
        sar = [r.Rec(T0 + 30, 600, 8, 0, 0, 0, 0, 25.0), r.Rec(T0 + 3600, 600, 8, 0, 0, 0, 0, 5.0)]
        (s1, m1), (s2, m2) = r.cross_check(coll, sar)
        self.assertAlmostEqual(m1, (10 * 270 + 40 * 300) / 570)  # 570 s of 600 s covered
        self.assertIsNone(m2)

    def test_file_selection_and_compressed_files(self):
        d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, d)
        with lzma.open(os.path.join(d, 'sa20261116.xz'), 'wb') as f:
            f.write(b'compressed-sa')
        for name in ('sa20261117', 'sa20261201', 'sar20261116', 'sa16'):
            with open(os.path.join(d, name), 'wb') as f:
                f.write(b'plain-sa')
        os.utime(os.path.join(d, 'sa16'), (T0 - 40 * 86400, T0 - 40 * 86400))  # last month's short name
        os.symlink('sa20261117', os.path.join(d, 'sa17'))
        picked = r.sar_files(d, T0, T0 + 2 * 86400)
        self.assertEqual([os.path.basename(p) for p, _ in picked], ['sa20261116.xz', 'sa20261117'])

        fake = os.path.join(d, 'fake-sadf')
        with open(fake, 'w') as f:
            f.write('#!/bin/sh\n'
                    'if [ "$1" = -H ]; then echo "Host: Linux (nsromania-new) (8 CPU)"; exit 0; fi\n'
                    'grep -q -e compressed-sa -e plain-sa "$3" || exit 1\n'
                    'cat "%s"\n' % os.path.join(d, 'canned'))
        os.chmod(fake, 0o755)
        with open(os.path.join(d, 'canned'), 'w') as f:
            f.write(SADF.replace('1794701405', str(T0 + 600)).replace('1794702004', str(T0 + 1200)))
        with mock.patch.object(r.shutil, 'which', return_value=fake):
            recs, note = r.load_sar(d, T0, T0 + 2 * 86400)
        self.assertEqual(note, '2 sysstat files')
        self.assertEqual([(x.start - T0, x.nproc) for x in recs], [(1, 8), (600, 8)])


class OutputTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir)
        lines = [csv_line(T0 + i * 60, 30.0 if 180 <= i < 240 else 10.0) for i in range(2 * 1440)]
        with open(os.path.join(self.dir, 'steal-2026-11.csv'), 'w') as f:
            f.write(c.HEADER + '\n' + '\n'.join(lines) + '\n')

    def run_main(self, *argv):
        out = io.StringIO()
        with mock.patch.object(sys, 'stdout', out):
            self.assertEqual(r.main(['--data-dir', self.dir, '--sar-dir', self.dir] + list(argv)), 0)
        return out.getvalue()

    def test_markdown(self):
        md = self.run_main('--from', '2026-11-16', '--to', '2026-11-17', '--top', '3')
        self.assertIn('# CPU steal report: nsromania.info, 2026-11-16 00:00 to 2026-11-18 00:00 UTC', md)
        self.assertIn('Coverage: 48.0 h of 48.0 h elapsed in the range (100.0%); 0 gap(s)', md)
        self.assertIn('| Mean steal (time-weighted) | 10.4% |', md)
        self.assertIn('| Time with steal above 10% / 20% / 30% | 2.1% / 2.1% / 0.0% |', md)
        self.assertIn('| 2026-11-16 | 24.0 | 10.8% |', md)
        self.assertIn('| 03:00 | 2.0 | 20.0% | 30.0% |', md)
        self.assertIn('| 2026-11-16 03:00-03:10 | 30.0% |', md)
        self.assertIn('Effective vCPUs: mean | 7.17 of 8 (0.83 vCPU, 10.4%, withheld)', md)
        self.assertIn('sysstat: no sysstat files', md)
        self.assertIn('**In short:** over 2.0 days of data the VM received on average 7.2 of 8', md)

    def test_partial_range_and_empty(self):
        md = self.run_main('--from', '2026-11-16T03:00', '--to', '2026-11-16T04:00')
        self.assertIn('| Mean steal (time-weighted) | 30.0% |', md)
        md = self.run_main('--from', '2026-10-01', '--to', '2026-10-02')
        self.assertIn('**No data in this range.**', md)

    def test_csv(self):
        out = self.run_main('--from', '2026-11-16', '--to', '2026-11-16', '--csv', 'hourly').splitlines()
        self.assertEqual(len(out), 25)
        self.assertTrue(out[0].startswith('hour_utc,hours_of_data,steal_mean_pct'))
        self.assertTrue(out[4].startswith('2026-11-16 03:00,1.000,30.00,30.00,30.00,35.00,100.00,100.00,0.00,'))
        daily = self.run_main('--from', '2026-11-16', '--to', '2026-11-17', '--csv', 'daily').splitlines()
        self.assertEqual(len(daily), 3)
        minute = self.run_main('--from', '2026-11-16', '--to', '2026-11-16', '--csv', 'minute').splitlines()
        self.assertEqual(len(minute), 1441)

    def test_bad_dates(self):
        with self.assertRaises(SystemExit), mock.patch.object(sys, 'stderr', io.StringIO()):
            r.main(['--from', '2026-11-17', '--to', '2026-11-16'])
        with self.assertRaises(SystemExit), mock.patch.object(sys, 'stderr', io.StringIO()):
            r.main(['--from', 'yesterday'])


class ChartTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir)
        lines = [csv_line(T0 + i * 60, 20.0 if i < 60 else 10.0) for i in range(120)] + ['torn,li']
        with open(os.path.join(self.dir, 'steal-2026-11.csv'), 'w') as f:
            f.write(c.HEADER + '\n' + '\n'.join(lines) + '\n')

    def run_chart(self, *argv):
        out, err = io.StringIO(), io.StringIO()
        with mock.patch.object(sys, 'stdout', out), mock.patch.object(sys, 'stderr', err):
            code = sc.main(['--data-dir', self.dir] + list(argv))
        return code, out.getvalue(), err.getvalue()

    @staticmethod
    def data(html):
        start = html.index('const D = ') + len('const D = ')
        return json.loads(html[start:html.index(';\n', start)])

    def test_embeds_rows_marks_and_escapes(self):
        code, html, err = self.run_chart('--from', '2026-11-16T00:00', '--to', '2026-11-16T01:30',
                                         '--mark', '2026-11-16T01:00|drop </script><b>x|drop')
        self.assertEqual(code, 0)
        d = self.data(html)
        self.assertEqual((d['from'], d['to'], d['nproc'], len(d['rows'])), (T0, T0 + 5400, 8, 90))
        # steal 20, our = user 70 + nice 0 + system 6 + irq 1, idle = idle 2 + iowait 1, load, runq, 5 s max
        self.assertEqual(d['rows'][0], [T0, 60.0, 20.0, 77.0, 3.0, 150.0, 40.0, 25.0])
        self.assertEqual(d['rows'][60][2], 10.0)
        self.assertEqual(d['marks'], [{'t': T0 + 3600, 'label': 'drop </script><b>x', 'short': 'drop'}])
        self.assertNotIn('</script><b>', html)
        self.assertEqual(html.count('</script>'), 1)
        self.assertNotIn(sc.PLACEHOLDER, html)
        self.assertIn('90 minutes from 1 file(s), 1 malformed line(s) skipped', err)

    def test_default_range_out_file_and_months(self):
        out = os.path.join(self.dir, 'chart.html')
        with mock.patch.object(sc.time, 'time', return_value=T0 + 7200 + 30):
            code, stdout, _ = self.run_chart('--out', out)
        self.assertEqual((code, stdout), (0, ''))
        with open(out) as f:
            d = self.data(f.read())
        self.assertEqual((d['from'], d['to'], len(d['rows'])), (T0 + 7200 - 86400, T0 + 7200, 120))
        self.assertEqual(self.run_chart('--list-months', '--from', '2026-11-30', '--to', '2027-01-01')[1],
                         '2026-11\n2026-12\n2027-01\n')
        self.assertEqual(self.run_chart('--list-months', '--from', '2026-11-30', '--to', '2026-12-31')[1],
                         '2026-11\n2026-12\n')

    def test_errors(self):
        code, html, err = self.run_chart('--from', '2026-10-01', '--to', '2026-10-02')
        self.assertEqual((code, html), (1, ''))
        self.assertIn('no collector data', err)
        for argv in (['--mark', 'no-label'], ['--mark', '2026-11-16T25:00|x'], ['--from', '2026-11-17', '--to', '2026-11-16']):
            with self.assertRaises(SystemExit), mock.patch.object(sys, 'stderr', io.StringIO()):
                sc.main(['--data-dir', self.dir] + argv)


if __name__ == '__main__':
    unittest.main()
