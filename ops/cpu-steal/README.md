# CPU steal monitoring

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

## What is collected

`nsromania-cpu-steal.service` runs a small Python program (stdlib only) that, every 5 seconds aligned to the UTC
clock, reads `/proc/stat` (aggregate and per-CPU counters, `procs_running`, `procs_blocked`). Every minute it reads
`/proc/loadavg` and appends one line to a monthly CSV file. It never forks or runs external tools.

Sampling design:

- **5-second sub-samples** catch bursts: `vmstat 5` showed 41% steal in single 5-second windows, which 10-minute
  sysstat samples average away. At 100 Hz, 5 s × 8 CPUs is 4,000 jiffies per sample (0.025% resolution).
- **1-minute lines** keep the data small (114 bytes/line, about 5 MB/month) and give fine-grained percentiles; each
  line keeps the min/max of its 12 sub-samples and the highest single-vCPU steal, so bursts are not lost.
- **Cheap enough to run forever:** 12 short reads of `/proc` per minute. Measured on the loaded host: about 6 MB
  cgroup memory (12 MB RSS including shared libraries) and 0.02% of one vCPU (35 ms of CPU per 3 minutes). The
  unit caps it at `CPUQuota=5%` and `MemoryMax=64M`.
- **Robust under load:** percentages are ratios of kernel counter deltas, so a late wake-up only lengthens a
  sub-sample; `interval_s` records the measured period length.

## Server files

| Path | Purpose |
| --- | --- |
| `/usr/local/sbin/nsromania-cpu-steal` | collector (`collect_cpu_steal.py`), `root:root 0755` |
| `/etc/systemd/system/nsromania-cpu-steal.service` | unit, enabled in `multi-user.target`; `Restart=always`, `RestartSec=10`, no start limit; sandboxed (no network, read-only system, writes only its log directory) |
| `/var/log/nsromania-cpu-steal/steal-YYYY-MM.csv` | data, one file per UTC month, header line, `root:root 0644` (no secrets) |
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

Restarts: a stop (`SIGTERM`) writes the partial minute; after a start, collection resumes at the next minute
boundary. A crash loses at most the current minute; a torn last line is terminated on the next start and skipped
by the report. If the header ever changes, the collector writes `steal-YYYY-MM.N.csv` instead of mixing schemas.

Disk safety: about 5 MB/month (60 MB/year), kept indefinitely. The collector stops appending (and logs hourly) if
the filesystem has less than 2 GiB free or a month file reaches 64 MiB, and resumes when the condition clears.

## Install or update

```bash
./ops/cpu-steal/install.sh
```

It runs the tests, streams the collector, unit and `install-on-server.sh` over SSH (`ktomy`, strict host-key
checking) into a `mktemp -d` directory that is removed afterwards, and runs the installer with `sudo -n`. The
installer validates the files, backs up every file it replaces into `/var/log/nightscout/backup/cpu-steal-<UTC>`,
installs atomically, enables and (re)starts only `nsromania-cpu-steal.service`, waits for a new CSV line, and
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
the worst 10-minute windows and minutes; and a cross-check against sysstat over the same 10-minute intervals.
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

They cover `/proc/stat` parsing and aggregation, the writer (header, monthly files, torn lines, schema change,
disk/size guards), a real 3-second collector run with `SIGTERM`, and the report (weighted percentiles,
thresholds, gaps, windows, CSV loading, `sadf` parsing, compressed sysstat files, Markdown and CSV output), and the chart
(embedded rows, annotations and escaping, default range, month list, errors).
