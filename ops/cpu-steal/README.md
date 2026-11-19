# CPU steal and memory monitoring

Continuous, data-backed evidence of how much of the contracted CPU the hosting provider actually delivers to the
production VPS (`nsromania.info`, 8 vCPUs, KVM). It was installed on 2026-11-15 after hypervisor steal doubled from
9–12% to about 19% (10-minute samples up to 33%, 5-second samples above 40%) and overloaded the host. See
"Overload incident maintenance" in `ops/deploy/OPERATIONS.md`.

It also runs on the additional hosting server `d1.nsromania.info` (12 vCPUs) since 2026-11-18 07:43 UTC, to follow
its load and steal as instances move there. Same files and schema on both servers; select the server with
`NSROMANIA_SSH_TARGET` (default `ktomy@nsromania.info`):

```bash
NSROMANIA_SSH_TARGET=ktomy@d1.nsromania.info ./ops/cpu-steal/install.sh
NSROMANIA_SSH_TARGET=ktomy@d1.nsromania.info ./ops/cpu-steal/report.sh --from 2026-11-18 > d1-steal.md
```

On d1, sysstat (`HISTORY=60`) has collected since provisioning on 2026-11-17, so `--source sar` covers the time
before the collector started.

**Generate the report** (from the repository root; read-only, no sudo, prints Markdown):

```bash
./ops/cpu-steal/report.sh --from 2026-11-16 --to 2026-11-22 > steal-report.md
```

## Why steal

Steal is the time a vCPU was ready to run but the hypervisor gave the physical CPU to something else (other
tenants, host backups, snapshots). The guest kernel accounts it in the `steal` column of `/proc/stat`, the same
counter behind `top`/`vmstat`/`sar` "st". It is the provider's responsibility, and our own load cannot inflate it:
steal only accrues while our vCPUs want to run and are refused. The host has had almost no idle time since
2026-11-14, so steal there is directly lost capacity: effective vCPUs = 8 × (1 − steal).

CPU benchmarks are deliberately not used: our own load would distort them, and they would add load.

## Memory

Since 2026-11-19 20:18 UTC (both servers) each line also records memory. The point is to see how full RAM is and
whether that hurts: **memory in use** = 100% − `MemAvailable`/`MemTotal`, what the kernel cannot reclaim without
swapping (page cache it can drop counts as available, unlike `free`'s "used"); the **lowest available** memory among
the 5-second samples, so a short spike is not averaged away; swap in use, the swapping rate (`pswpin`/`pswpout`),
major page faults; **memory pressure** from PSI (`/proc/pressure/memory`): the share of the minute in which at least
one task (`some`) or every non-idle task (`full`) was stalled waiting for memory, the direct sign of a shortage; and
OOM kills (`oom_kill` in `/proc/vmstat`).

Before that only sysstat had memory data: one snapshot every 10 minutes (`sar -r -S -W`, kept 60 days; main since
2026-11-07, d1 since 2026-11-17). It showed main at 89–95% in use from 2026-11-07 to 2026-11-17, swap full (8.0 of
8.0 GiB) for days, available memory down to 2.6 GiB and commit up to 114%; after 200 sites moved to d1 on 2026-11-18,
about 58% in use, 25 GiB available and no swapping (3 GiB left in swap). d1 was at about 44% and had never swapped.

## What is collected

`nsromania-cpu-steal.service` runs a small Python program (stdlib only) that, every 5 seconds aligned to the UTC
clock, reads `/proc/stat` (aggregate and per-CPU counters, `procs_running`, `procs_blocked`) and `/proc/meminfo`.
Every minute it reads `/proc/loadavg`, `/proc/vmstat` and `/proc/pressure/memory` and appends one line to a monthly
CSV file. It never forks or runs external tools. A memory source that cannot be read (for example a kernel without
PSI) leaves its columns empty and logs once an hour; it never stops the CPU data.

Sampling design:

- **5-second sub-samples** catch bursts: `vmstat 5` showed 41% steal in single 5-second windows, which 10-minute
  sysstat samples average away. At 100 Hz, 5 s × 8 CPUs is 4,000 jiffies per sample (0.025% resolution).
- **1-minute lines** keep the data small (about 175 bytes/line with memory, about 8 MB/month) and give fine-grained
  percentiles; each line keeps the min/max of its 12 sub-samples and the highest single-vCPU steal, so bursts are
  not lost.
- **Cheap enough to run forever:** 24 short reads of `/proc` per minute plus 3 at the minute boundary. Measured on the loaded host: about 6 MB
  cgroup memory (12 MB RSS including shared libraries) and 0.02% of one vCPU (35 ms of CPU per 3 minutes). The
  unit caps it at `CPUQuota=5%` and `MemoryMax=64M`.
- **Robust under load:** percentages are ratios of kernel counter deltas, so a late wake-up only lengthens a
  sub-sample; `interval_s` records the measured period length.

## Server files

| Path | Purpose |
| --- | --- |
| `/usr/local/sbin/nsromania-cpu-steal` | collector (`collect_cpu_steal.py`), `root:root 0755` |
| `/etc/systemd/system/nsromania-cpu-steal.service` | unit, enabled in `multi-user.target`; `Restart=always`, `RestartSec=10`, no start limit; sandboxed (no network, read-only system, writes only its log directory) |
| `/var/log/nsromania-cpu-steal/steal-YYYY-MM.csv` | data, one file per UTC month, header line, `root:root 0644` (no secrets); November 2026 is split at the memory update: `steal-2026-11.csv` (old schema) and `steal-2026-11.2.csv` |
| `/var/log/sysstat/saYYYYMMDD` | sysstat data, 10-minute samples, independent second source |
| `/etc/sysstat/sysstat` | `HISTORY=60` (was 7); backup in `/var/log/nightscout/backup/sysstat-history-20261115T215121Z` |

Logs: `journalctl -u nsromania-cpu-steal`. Status: `systemctl status nsromania-cpu-steal`.

## CSV schema

One line per UTC minute; `start_utc` is the start of the minute, and the line is written when the minute ends.

| Column | Meaning |
| --- | --- |
| `start_utc` | period start, `YYYY-MM-DDTHH:MM:SSZ` |
| `interval_s` | measured period length (60.00; shorter for the last partial minute before a stop) |
| `samples` | number of 5-second sub-samples (12) |
| `nproc` | online CPUs seen by the guest |
| `user_pct`, `nice_pct`, `system_pct`, `irq_pct` (hard + soft IRQ), `iowait_pct`, `idle_pct`, `steal_pct` | aggregate CPU time shares over the minute; they sum to 100 (guest time is inside user/nice) |
| `steal_min_pct`, `steal_max_pct` | lowest/highest aggregate steal among the 5-second sub-samples; the sub-sample average is `steal_pct` |
| `steal_cpu_max_pct` | highest steal of any single vCPU in any 5-second sub-sample |
| `load1`, `load5`, `load15` | `/proc/loadavg` at the end of the minute |
| `runq_avg`, `runq_max` | `procs_running` across sub-samples (includes the collector itself) |
| `blocked_max` | highest `procs_blocked` |
| `mem_total_mib`, `mem_avail_mib` | `MemTotal`, and `MemAvailable` at the end of the minute (MiB) |
| `mem_avail_min_mib` | lowest `MemAvailable` among the 5-second samples |
| `swap_total_mib`, `swap_used_mib` | swap size and use (`SwapTotal − SwapFree`) at the end of the minute |
| `swapin_pages_s`, `swapout_pages_s` | pages swapped in/out per second over the minute (`pswpin`/`pswpout`, as `sar -W`) |
| `majflt_s` | major page faults per second (`pgmajfault`, as `sar -B`) |
| `mem_psi_some_pct`, `mem_psi_full_pct` | PSI memory pressure: % of the minute with some / all non-idle tasks stalled on memory |
| `oom_kills` | OOM kills during the minute |

The memory columns (from `mem_total_mib`) exist since 2026-11-19; an empty field means its source could not be read.

Restarts: a stop (`SIGTERM`) writes the partial minute; after a start, collection resumes at the next minute
boundary. A crash loses at most the current minute; a torn last line is terminated on the next start and skipped
by the report (it skips any line whose field count differs from its file's header). If the header ever changes,
the collector writes `steal-YYYY-MM.N.csv` instead of mixing schemas; the report and chart read every file of a month
and take the columns each file has.

Disk safety: about 8 MB/month (100 MB/year), kept indefinitely. The collector stops appending (and logs hourly) if
the filesystem has less than 2 GiB free or a month file reaches 64 MiB, and resumes when the condition clears.

## Install or update

```bash
./ops/cpu-steal/install.sh
```

It runs the tests, streams the collector, unit and `install-on-server.sh` over SSH (`ktomy`, strict host-key
checking) into a `mktemp -d` directory that is removed afterwards, and runs the installer with `sudo -n`. The
installer validates the files, backs up every file it replaces into `/var/log/nightscout/backup/cpu-steal-<UTC>`,
installs atomically, enables and (re)starts only `nsromania-cpu-steal.service` (stop, measure the data, start, so the
old collector's final partial minute does not count), waits up to 150 s for a new CSV line, and
restores the previous files if none appears. It touches nothing else (no PM2, Nightscout, panel, databases, nginx,
firewall or deployment locks).

## Generate the report

```bash
./ops/cpu-steal/report.sh --from 2026-11-16 --to 2026-11-22 > steal-report.md          # Markdown
./ops/cpu-steal/report.sh --from 2026-11-16 --to 2026-11-22 --csv hourly > hourly.csv  # chart data
./ops/cpu-steal/report.sh --from 2026-11-07 --to 2026-11-15 --source sar               # sysstat only
```

`report.sh` pipes `steal_report.py` to `python3 -I -` on the server (nothing is copied or left there) and passes
all arguments through (adding `--host` with the target's host name unless given). Dates are UTC; `--to` includes that day, `YYYY-MM-DDTHH:MM` gives exact bounds, and both
default to the last 7 days. Other options: `--contracted-vcpus N` (default: vCPUs the guest sees), `--top N`,
`--csv daily|hourly|minute`, `--no-sar`.

The Markdown contains: coverage and gaps; mean, p50/p95/p99 and maximum steal; the share of time above 10/20/30%
(1-minute averages and 5-second peaks); effective vCPUs versus contracted; breakdowns by day and by hour of day;
the worst 10-minute windows and minutes; a memory section (RAM, memory in use mean/p95/highest minute, lowest
available, swap in use, swapping and major-fault rates, memory pressure mean/highest/time above 1%, OOM kills with
their minutes, and a by-day table); and a cross-check against sysstat over the same 10-minute intervals. The CSV
outputs add memory columns (empty before 2026-11-19).
Use `--source sar` for periods before 2026-11-15 22:01 UTC, when the collector started (sysstat keeps 60 days).

Offline: copy the CSVs (`ssh … 'tar -C /var/log/nsromania-cpu-steal -cf - .' | tar -xf - -C DIR`) and run
`python3 ops/cpu-steal/steal_report.py --data-dir DIR --no-sar …`.

## Chart (HTML)

```bash
./ops/cpu-steal/chart.sh > steal-chart.html                                   # last 24 hours
./ops/cpu-steal/chart.sh --from 2026-11-16 --to 2026-11-22 > steal-week.html  # a whole week
./ops/cpu-steal/chart.sh --mark '2026-11-16T05:42|steal drops (avg 14.7% before, 8.8% after)|steal drops' > chart.html
```

One standalone page (no network needed; about 25 KB plus 75 KB per day of data) with CPU steal, our CPU use (user +
nice + system + IRQ, so our use + steal + idle = 100%) and the 1-minute load average on a shared time axis, each on
its own scale. It has summary figures, 1/5/10/30/60-minute resolution (it opens at the finest that keeps 400 points or
fewer), UTC or Romania time, a hover and arrow-key readout that adds idle, effective vCPUs and the highest 5-second
steal, a table view and dark mode. `--mark 'TIME|label[|short label]'` draws an annotated rule (repeatable; the short
label is used where the long one does not fit).

When the range has memory data, a fourth panel shows memory in use on a fixed 0–100% scale (the line starts where
memory was first recorded), two figures summarise memory in use and memory pressure, and the readout and table add
the lowest available memory, swap, swapping, major faults, pressure and OOM kills.

`chart.sh` streams only the month files the range needs from the server (`tar` to stdout; read-only, no sudo, nothing
written there) into a local temporary directory that it removes, then runs `steal_chart.py` with the
`steal_chart.html` template locally. `--from`/`--to` behave as in the report, but the default is the last 24 hours.
Offline: `python3 -I ops/cpu-steal/steal_chart.py --data-dir DIR --out chart.html`.

## Verification at installation (2026-11-15)

- `vmstat -t 5` started on a minute boundary versus the collector for the same minutes: 22:03 UTC steal 14.92% (5 s
  range 5–44) vs 14.96% (5.40–43.56); 22:04 UTC 14.83% (5–39) vs 14.96% (4.95–38.27). User and system time agreed
  within 0.2 percentage points (vmstat rounds to whole percent).
- `systemctl kill -s KILL`: restarted after 10 s (`NRestarts=1`), losing only the killed minute. `systemctl
  restart`: the partial minute was written (`interval_s=35.00`) and collection resumed at the next minute.
- Enabled via `multi-user.target.wants`; `systemd-analyze verify` clean; `systemd-analyze security` exposure 1.1.

## Email template for the provider

```text
Subject: VPS 45.134.39.79 (nsromania.info): X% of contracted vCPU capacity not delivered (CPU steal)

Hello,

Our VPS 45.134.39.79 is contracted with 8 vCPUs. Since <DATE> it has been receiving markedly less CPU
than contracted. We measure hypervisor steal time continuously: the Linux /proc/stat steal counter,
sampled every 5 seconds and aggregated per minute, cross-checked against sysstat (sar).

Between <FROM> and <TO> (UTC):
- mean steal <MEAN>%: on average the VM received <EFF> of 8 vCPUs (<LOST> vCPU withheld)
- p95 <P95>%, p99 <P99>%; steal exceeded 20% for <A20>% of the time and 30% for <A30>%
- worst 10-minute window: <WORST>% at <WHEN>; highest 5-second sample: <MAX5>%
- for comparison, steal averaged 9-12% before 2026-11-14 and about 19% on 2026-11-14/15

Steal only accrues while our vCPUs are ready to run and wait for a physical CPU, so it is capacity we
pay for but do not receive; our guest had almost no idle time during these periods. The full report
is attached.

Please tell us the cause (host oversubscription, neighbouring workloads, backups, snapshots or
migrations), and either move the VM to a less loaded host or adjust the service so that we receive the
contracted capacity. We would appreciate an answer by <DATE>.

Regards,
<NAME>
```

## Tests

```bash
python3 -I ops/cpu-steal/test_cpu_steal.py -v
```

They cover `/proc/stat` parsing and aggregation, `/proc/meminfo`, `/proc/vmstat` and PSI parsing with rates,
pressure and missing sources, the writer (header, monthly files, torn lines, schema change,
disk/size guards), a real 3-second collector run with `SIGTERM`, and the report (weighted percentiles,
thresholds, gaps, windows, CSV loading across schemas, `sadf` parsing, compressed sysstat files, Markdown and CSV
output including memory), and the chart (embedded rows with and without memory, annotations and escaping, default
range, month list, errors).
