#!/usr/bin/env python3
"""Long-running CPU steal and memory collector for the hosting servers.

Reads /proc/stat and /proc/meminfo every STEP seconds (aligned to the UTC clock) and appends one
aggregated CSV line per PERIOD (aligned to the minute) to DATA_DIR/steal-YYYY-MM.csv. At each
period boundary it also reads /proc/loadavg, /proc/vmstat and /proc/pressure/memory. It only
reads /proc, never forks, and sleeps between samples, so it costs far less than one vmstat run
per minute.

Percentages and rates come from kernel counters (deltas between snapshots), so a late wake-up
under heavy load makes a sub-sample longer but never makes it wrong. `interval_s` is the measured
length of each period. Memory fields are left empty when their /proc file cannot be read, so a
kernel without PSI (or a read error) never stops the CPU data.

Usage (normally started by nsromania-cpu-steal.service):
    nsromania-cpu-steal [--data-dir DIR] [--step 5] [--period 60]
"""

import argparse
import math
import os
import signal
import sys
import time

DATA_DIR = '/var/log/nsromania-cpu-steal'
STEP_S = 5
PERIOD_S = 60
MIN_FREE_BYTES = 2 * 1024**3  # stop appending when the filesystem has less than 2 GiB free
MAX_FILE_BYTES = 64 * 1024**2  # ~13x the expected ~5 MB/month; guards against a runaway writer
LOG_EVERY_S = 3600  # rate limit for repeated write warnings

# First eight /proc/stat cpu columns. guest/guest_nice are already included in user/nice.
CPU_FIELDS = ('user', 'nice', 'system', 'idle', 'iowait', 'irq', 'softirq', 'steal')
I_USER, I_NICE, I_SYSTEM, I_IDLE, I_IOWAIT, I_IRQ, I_SOFTIRQ, I_STEAL = range(8)

MEMINFO_FIELDS = ('MemTotal', 'MemAvailable', 'SwapTotal', 'SwapFree')  # KiB
VMSTAT_FIELDS = ('pswpin', 'pswpout', 'pgmajfault', 'oom_kill')  # cumulative counts

# The memory columns were appended on 2026-11-19; a header change starts a new file (see Writer.resolve).
HEADER = (
    'start_utc,interval_s,samples,nproc,user_pct,nice_pct,system_pct,irq_pct,iowait_pct,idle_pct,'
    'steal_pct,steal_min_pct,steal_max_pct,steal_cpu_max_pct,load1,load5,load15,runq_avg,runq_max,blocked_max,'
    'mem_total_mib,mem_avail_mib,mem_avail_min_mib,swap_total_mib,swap_used_mib,swapin_pages_s,swapout_pages_s,'
    'majflt_s,mem_psi_some_pct,mem_psi_full_pct,oom_kills'
)


class Snapshot:
    __slots__ = ('total', 'cpus', 'running', 'blocked', 'mono')

    def __init__(self, total, cpus, running, blocked, mono=0.0):
        self.total = total
        self.cpus = cpus
        self.running = running
        self.blocked = blocked
        self.mono = mono


def parse_stat(text, mono=0.0):
    """Parse /proc/stat text into a Snapshot (aggregate + per-CPU counters, run queue)."""
    total = None
    cpus = {}
    running = blocked = 0
    for line in text.splitlines():
        if line.startswith('cpu'):
            parts = line.split()
            vals = [int(x) for x in parts[1:9]]
            vals += [0] * (8 - len(vals))
            if parts[0] == 'cpu':
                total = tuple(vals)
            else:
                cpus[parts[0]] = tuple(vals)
        elif line.startswith('procs_running '):
            running = int(line.split()[1])
        elif line.startswith('procs_blocked '):
            blocked = int(line.split()[1])
    if total is None:
        raise ValueError('no aggregate cpu line in /proc/stat')
    return Snapshot(total, cpus, running, blocked, mono)


def parse_loadavg(text):
    parts = text.split()
    return float(parts[0]), float(parts[1]), float(parts[2])


def parse_meminfo(text):
    """Return {field: KiB} for the MEMINFO_FIELDS present in /proc/meminfo text."""
    out = {}
    for line in text.splitlines():
        name, sep, rest = line.partition(':')
        if sep and name in MEMINFO_FIELDS:
            out[name] = int(rest.split()[0])
    return out


def parse_vmstat(text):
    """Return {field: count} for the VMSTAT_FIELDS present in /proc/vmstat text."""
    out = {}
    for line in text.splitlines():
        parts = line.split()
        if len(parts) == 2 and parts[0] in VMSTAT_FIELDS:
            out[parts[0]] = int(parts[1])
    return out


def parse_pressure(text):
    """Return {'some': us, 'full': us}: cumulative stall time from /proc/pressure/memory text."""
    out = {}
    for line in text.splitlines():
        parts = line.split()
        if parts and parts[0] in ('some', 'full'):
            for p in parts[1:]:
                if p.startswith('total='):
                    out[parts[0]] = int(p[len('total='):])
    return out


class Counters:
    """Cumulative memory counters read at a period boundary (vmstat counts, PSI microseconds)."""

    __slots__ = ('vm', 'psi', 'mono')

    def __init__(self, vm, psi, mono=0.0):
        self.vm = vm
        self.psi = psi
        self.mono = mono


def memory_fields(info, avail_min, c0, c1):
    """CSV fields for the memory columns; '' wherever the source was unavailable."""
    def mib(kib):
        return '' if kib is None else str(kib // 1024)

    total, avail = info.get('MemTotal'), info.get('MemAvailable')
    swap_total, swap_free = info.get('SwapTotal'), info.get('SwapFree')
    swap_used = swap_total - swap_free if swap_total is not None and swap_free is not None else None
    dt = c1.mono - c0.mono if c0 is not None and c1 is not None else 0.0

    def diff(src0, src1, key):
        if dt <= 0 or key not in src0 or key not in src1:
            return None
        return max(0, src1[key] - src0[key])  # a counter reset (never expected) counts as zero

    def rate(key):
        d = diff(c0.vm, c1.vm, key) if dt > 0 else None
        return '' if d is None else '%.2f' % (d / dt)

    def psi(key):
        d = diff(c0.psi, c1.psi, key) if dt > 0 else None
        return '' if d is None else '%.2f' % min(100.0, d / (dt * 1e4))  # us / (dt s * 1e6 us/s) * 100%

    oom = diff(c0.vm, c1.vm, 'oom_kill') if dt > 0 else None
    return [mib(total), mib(avail), mib(avail_min), mib(swap_total), mib(swap_used), rate('pswpin'),
            rate('pswpout'), rate('pgmajfault'), psi('some'), psi('full'), '' if oom is None else str(oom)]


def delta(a, b):
    # Counters are monotonic, but iowait is known to step backwards on some kernels: clamp.
    return [max(0, y - x) for x, y in zip(a, b)]


def percentages(d):
    tot = sum(d)
    if tot <= 0:
        return None
    return [100.0 * x / tot for x in d]


class Period:
    """Accumulates sub-samples for one output line."""

    def __init__(self, start_epoch, first):
        self.start = start_epoch
        self.first = first
        self.steal = []
        self.cpu_max = None
        self.runq = []
        self.blocked_max = 0
        self.meminfo = {}  # the latest /proc/meminfo sample
        self.avail_min = None  # lowest MemAvailable (KiB) among the sub-samples

    def add(self, prev, cur):
        p = percentages(delta(prev.total, cur.total))
        if p is not None:
            self.steal.append(p[I_STEAL])
        for name, vals in cur.cpus.items():
            old = prev.cpus.get(name)
            if old is None:
                continue  # CPU came online between snapshots
            q = percentages(delta(old, vals))
            if q is not None and (self.cpu_max is None or q[I_STEAL] > self.cpu_max):
                self.cpu_max = q[I_STEAL]
        self.runq.append(cur.running)
        self.blocked_max = max(self.blocked_max, cur.blocked)

    def add_mem(self, info):
        """Record one /proc/meminfo sample ({} when it could not be read)."""
        if not info:
            return
        self.meminfo = info
        avail = info.get('MemAvailable')
        if avail is not None and (self.avail_min is None or avail < self.avail_min):
            self.avail_min = avail

    def line(self, last, load, c0=None, c1=None):
        """Return the CSV line for this period ending at snapshot `last`, or None if empty.

        c0/c1 are the memory counters read at the start and end of the period (None if unreadable)."""
        p = percentages(delta(self.first.total, last.total))
        if p is None or not self.steal:
            return None
        start = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(self.start))
        fields = [
            start,
            '%.2f' % (last.mono - self.first.mono),
            str(len(self.steal)),
            str(len(last.cpus)),
            '%.2f' % p[I_USER],
            '%.2f' % p[I_NICE],
            '%.2f' % p[I_SYSTEM],
            '%.2f' % (p[I_IRQ] + p[I_SOFTIRQ]),
            '%.2f' % p[I_IOWAIT],
            '%.2f' % p[I_IDLE],
            '%.2f' % p[I_STEAL],
            '%.2f' % min(self.steal),
            '%.2f' % max(self.steal),
            '%.2f' % (self.cpu_max if self.cpu_max is not None else max(self.steal)),
            '%.2f' % load[0],
            '%.2f' % load[1],
            '%.2f' % load[2],
            '%.1f' % (sum(self.runq) / len(self.runq)),
            str(max(self.runq)),
            str(self.blocked_max),
        ]
        fields += memory_fields(self.meminfo, self.avail_min, c0, c1)
        return ','.join(fields)


def log(msg):
    print(msg, file=sys.stderr, flush=True)


class Writer:
    """Appends lines to one CSV per UTC month, with a header, newline repair and disk guards."""

    def __init__(self, data_dir, min_free=MIN_FREE_BYTES, max_bytes=MAX_FILE_BYTES):
        self.data_dir = data_dir
        self.min_free = min_free
        self.max_bytes = max_bytes
        self.paths = {}
        self.last_warn = {}

    def warn(self, key, msg):
        now = time.monotonic()
        if now - self.last_warn.get(key, -LOG_EVERY_S) >= LOG_EVERY_S:
            self.last_warn[key] = now
            log(msg)

    def path_for(self, start_epoch):
        month = time.strftime('%Y-%m', time.gmtime(start_epoch))
        path = self.paths.get(month)
        if path is None:
            path = self.resolve(month)
            self.paths = {month: path}  # only the current month is ever written
        return path

    def resolve(self, month):
        """Pick the month file; never append to a file whose header is from another schema."""
        n = 1
        while True:
            name = 'steal-%s.csv' % month if n == 1 else 'steal-%s.%d.csv' % (month, n)
            path = os.path.join(self.data_dir, name)
            try:
                with open(path, 'rb') as f:
                    head = f.readline().rstrip(b'\r\n')
                    if head and head != HEADER.encode():
                        n += 1
                        continue
                    if head:
                        f.seek(-1, os.SEEK_END)
                        if f.read(1) != b'\n':
                            # Torn last line from a crash: terminate it so it stays one bad row.
                            with open(path, 'ab') as g:
                                g.write(b'\n')
            except FileNotFoundError:
                pass
            return path

    def write(self, start_epoch, line):
        try:
            st = os.statvfs(self.data_dir)
            if st.f_bavail * st.f_frsize < self.min_free:
                self.warn('disk', 'free space below %d bytes, not writing' % self.min_free)
                return False
            path = self.path_for(start_epoch)
            try:
                size = os.path.getsize(path)
            except FileNotFoundError:
                size = 0
            if size >= self.max_bytes:
                self.warn('size', '%s reached %d bytes, not writing' % (path, self.max_bytes))
                return False
            data = (line + '\n') if size else (HEADER + '\n' + line + '\n')
            fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o644)
            try:
                os.write(fd, data.encode())
            finally:
                os.close(fd)
            return True
        except OSError as e:
            self.warn('oserror', 'write failed: %s' % e)
            return False


class Stop(Exception):
    pass


class Collector:
    def __init__(self, data_dir, step, period, proc_dir='/proc'):
        if step <= 0 or period < step or abs(period / step - round(period / step)) > 1e-9:
            raise ValueError('period must be a positive multiple of step')
        self.step = step
        self.period = period
        self.stat_path = os.path.join(proc_dir, 'stat')
        self.loadavg_path = os.path.join(proc_dir, 'loadavg')
        self.meminfo_path = os.path.join(proc_dir, 'meminfo')
        self.vmstat_path = os.path.join(proc_dir, 'vmstat')
        self.pressure_path = os.path.join(proc_dir, 'pressure', 'memory')
        self.writer = Writer(data_dir)
        self.sleeping = False
        self.stop_requested = False

    def snapshot(self):
        with open(self.stat_path) as f:
            text = f.read()
        return parse_stat(text, time.monotonic())

    def loadavg(self):
        with open(self.loadavg_path) as f:
            return parse_loadavg(f.read())

    def read_optional(self, path, parse):
        """Parse a /proc file whose absence or failure must not stop collection; {} on error."""
        try:
            with open(path) as f:
                return parse(f.read())
        except (OSError, ValueError, IndexError) as e:
            self.writer.warn(path, 'cannot read %s: %s' % (path, e))
            return {}

    def meminfo(self):
        return self.read_optional(self.meminfo_path, parse_meminfo)

    def counters(self):
        mono = time.monotonic()
        return Counters(self.read_optional(self.vmstat_path, parse_vmstat),
                        self.read_optional(self.pressure_path, parse_pressure), mono)

    def on_signal(self, signum, frame):
        # Interrupt only the sleep; while sampling or writing, stop after the current step.
        self.stop_requested = True
        if self.sleeping:
            raise Stop()

    def sleep_until(self, target):
        self.sleeping = True
        try:
            if self.stop_requested:
                raise Stop()
            while True:
                d = target - time.time()
                if d <= 0:
                    return
                time.sleep(d)
        finally:
            self.sleeping = False

    def floor(self, t, unit):
        return math.floor(t / unit + 1e-9) * unit

    def run(self):
        signal.signal(signal.SIGTERM, self.on_signal)
        signal.signal(signal.SIGINT, self.on_signal)
        try:
            self.sleep_until(self.floor(time.time(), self.period) + self.period)
        except Stop:
            return
        prev = self.snapshot()
        mem_prev = self.counters()
        per = Period(self.floor(time.time(), self.period), prev)
        log('collecting: step %gs, period %gs, %d CPUs, writing to %s'
            % (self.step, self.period, len(prev.cpus), self.writer.data_dir))
        while not self.stop_requested:
            try:
                self.sleep_until(self.floor(time.time(), self.step) + self.step)
            except Stop:
                break
            cur = self.snapshot()
            per.add(prev, cur)
            per.add_mem(self.meminfo())
            prev = cur
            tick = self.floor(time.time(), self.step)
            # A backwards clock step longer than one sample also closes the period.
            if tick >= per.start + self.period or tick < per.start - self.step:
                mem_prev = self.emit(per, cur, mem_prev)
                per = Period(self.floor(tick, self.period), cur)
        # Stopping: keep the partial period (its interval_s is shorter than the period).
        cur = self.snapshot()
        if cur.mono - prev.mono >= 1.0:
            per.add(prev, cur)
            per.add_mem(self.meminfo())
        else:
            cur = prev
        if cur.mono - per.first.mono >= 1.0:
            self.emit(per, cur, mem_prev)
        log('stopped')

    def emit(self, per, last, mem_prev):
        """Write the period's line; return the memory counters read now (the next period's start)."""
        mem_cur = self.counters()
        line = per.line(last, self.loadavg(), mem_prev, mem_cur)
        if line:
            self.writer.write(per.start, line)
        return mem_cur


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--data-dir', default=DATA_DIR)
    ap.add_argument('--step', type=float, default=STEP_S, help='sub-sample interval in seconds (default 5)')
    ap.add_argument('--period', type=float, default=PERIOD_S, help='seconds per CSV line (default 60)')
    ap.add_argument('--proc-dir', default='/proc', help=argparse.SUPPRESS)
    args = ap.parse_args(argv)
    if not os.path.isdir(args.data_dir):
        ap.error('data directory does not exist: %s' % args.data_dir)
    Collector(args.data_dir, args.step, args.period, args.proc_dir).run()
    return 0


if __name__ == '__main__':
    sys.exit(main())
