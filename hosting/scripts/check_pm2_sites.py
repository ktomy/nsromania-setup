#!/usr/bin/env python3

import argparse
import json
import socket
import subprocess
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Callable, Optional


OK_STATUS_MAX = 399
DELETE_BATCH_SIZE = 10


@dataclass(frozen=True)
class SiteProcess:
    pm_id: int
    name: str
    status: str
    port: int
    url: str


@dataclass(frozen=True)
class SiteCheckResult:
    site: SiteProcess
    ok: bool
    http_status: Optional[int]
    reason: str


@dataclass(frozen=True)
class SiteStatistics:
    checked: int
    timeout: int
    non_200: int


def read_pm2_processes() -> list[dict[str, Any]]:
    command = ['sudo', 'pm2', 'jlist']
    completed = subprocess.run(command, check=True, capture_output=True, text=True)
    data = json.loads(completed.stdout)
    if not isinstance(data, list):
        raise ValueError('Expected `sudo pm2 jlist` to return a JSON array')
    return data


def extract_sites(pm2_processes: list[dict[str, Any]]) -> list[SiteProcess]:
    sites: list[SiteProcess] = []

    for process in pm2_processes:
        pm_id = process.get('pm_id')
        if not isinstance(pm_id, int):
            continue

        pm2_env = process.get('pm2_env')
        if not isinstance(pm2_env, dict):
            continue

        port = parse_port(find_port(pm2_env, process))
        if port is None:
            continue

        name = process.get('name')
        status = pm2_env.get('status')
        sites.append(
            SiteProcess(
                pm_id=pm_id,
                name=name if isinstance(name, str) else f'pm_id_{pm_id}',
                status=status if isinstance(status, str) else 'unknown',
                port=port,
                url=f'http://127.0.0.1:{port}/',
            )
        )

    return sites


def find_port(pm2_env: dict[str, Any], process: dict[str, Any]) -> Any:
    env = pm2_env.get('env')
    if isinstance(env, dict) and env.get('PORT') is not None:
        return env.get('PORT')

    if pm2_env.get('PORT') is not None:
        return pm2_env.get('PORT')

    process_env = process.get('env')
    if isinstance(process_env, dict):
        return process_env.get('PORT')

    return None


def parse_port(value: Any) -> Optional[int]:
    try:
        port = int(str(value))
    except (TypeError, ValueError):
        return None

    if 1 <= port <= 65535:
        return port
    return None


def fetch_http_status(url: str, timeout: float) -> int:
    request = urllib.request.Request(url, method='GET', headers={'User-Agent': 'pm2-site-check/1.0'})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            response.read(1)
            return response.getcode()
    except urllib.error.HTTPError as error:
        return error.code


def check_site(
    site: SiteProcess,
    timeout: float,
    opener: Callable[[str, float], int] = fetch_http_status,
) -> SiteCheckResult:
    if site.status != 'online':
        return SiteCheckResult(site=site, ok=False, http_status=None, reason=f'pm2 status is {site.status}')

    try:
        status = opener(site.url, timeout)
    except TimeoutError:
        return SiteCheckResult(site=site, ok=False, http_status=None, reason=format_timeout(timeout))
    except socket.timeout:
        return SiteCheckResult(site=site, ok=False, http_status=None, reason=format_timeout(timeout))
    except urllib.error.URLError as error:
        if isinstance(error.reason, socket.timeout):
            return SiteCheckResult(site=site, ok=False, http_status=None, reason=format_timeout(timeout))
        return SiteCheckResult(site=site, ok=False, http_status=None, reason=f'connection error: {error.reason}')
    except OSError as error:
        return SiteCheckResult(site=site, ok=False, http_status=None, reason=f'connection error: {error}')

    if status <= OK_STATUS_MAX:
        return SiteCheckResult(site=site, ok=True, http_status=status, reason='OK')

    return SiteCheckResult(site=site, ok=False, http_status=status, reason=f'HTTP {status}')


def format_timeout(timeout: float) -> str:
    return f'timeout after {timeout:g}s'


def format_progress_result(result: SiteCheckResult) -> str:
    if result.ok:
        status = f'HTTP {result.http_status}' if result.http_status is not None else result.reason
        return f'OK ({status})'
    return f'FAILED ({result.reason})'


def check_sites(
    sites: list[SiteProcess],
    timeout: float,
    opener: Callable[[str, float], int] = fetch_http_status,
    reporter: Optional[Callable[[str], None]] = None,
) -> list[SiteCheckResult]:
    if reporter is not None:
        reporter(f'Scanning {len(sites)} PM2 site(s) with {timeout:g}s timeout...')

    results: list[SiteCheckResult] = []
    total = len(sites)
    for index, site in enumerate(sites, start=1):
        result = check_site(site, timeout, opener=opener)
        results.append(result)

        if reporter is not None:
            reporter(f'[{index}/{total}] Checking {site.name} at {site.url} ... {format_progress_result(result)}')

    return results


def print_failed_results(results: list[SiteCheckResult]) -> None:
    failed = [result for result in results if not result.ok]

    if not failed:
        print('All probed PM2 sites responded with OK HTTP status.')
        return

    print('PM2 sites with failed localhost HTTP checks:')
    print(f'{"pm_id":>5}  {"name":<32}  {"status":<10}  {"url":<28}  reason')
    print(f'{"-" * 5}  {"-" * 32}  {"-" * 10}  {"-" * 28}  {"-" * 20}')
    for result in failed:
        site = result.site
        print(f'{site.pm_id:>5}  {site.name:<32.32}  {site.status:<10.10}  {site.url:<28.28}  {result.reason}')


def collect_statistics(results: list[SiteCheckResult]) -> SiteStatistics:
    return SiteStatistics(
        checked=len(results),
        timeout=sum(1 for result in results if is_timeout_result(result)),
        non_200=sum(1 for result in results if result.http_status is not None and result.http_status != 200),
    )


def is_timeout_result(result: SiteCheckResult) -> bool:
    return result.http_status is None and result.reason.startswith('timeout after ')


def print_statistics(results: list[SiteCheckResult]) -> None:
    statistics = collect_statistics(results)
    print('')
    print('Statistics:')
    print(f'  Checked: {statistics.checked}')
    print(f'  Timeout: {statistics.timeout}')
    print(f'  Non-200 HTTP status: {statistics.non_200}')


def chunked(items: list[str], size: int) -> list[list[str]]:
    return [items[index : index + size] for index in range(0, len(items), size)]


def build_delete_commands(failed: list[SiteCheckResult], batch_size: int = DELETE_BATCH_SIZE) -> list[list[str]]:
    pm_ids = [str(result.site.pm_id) for result in failed]
    return [['sudo', 'pm2', 'delete', *batch] for batch in chunked(pm_ids, batch_size)]


def delete_failed_sites(
    failed: list[SiteCheckResult],
    runner: Callable[[list[str]], Any] = lambda command: subprocess.run(command, check=True),
) -> None:
    for command in build_delete_commands(failed):
        runner(command)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Check localhost HTTP status for PM2-managed Node sites.')
    parser.add_argument(
        '--timeout',
        type=float,
        default=1.0,
        help='HTTP timeout in seconds for each localhost check. Default: 1.0',
    )
    parser.add_argument(
        '--delete',
        action='store_true',
        help='Delete failed PM2 processes with `sudo pm2 delete <pm_id>`.',
    )
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    if args.timeout <= 0:
        print('--timeout must be greater than zero', file=sys.stderr)
        return 2

    reporter = lambda message: print(message, flush=True)

    reporter('Reading PM2 process list with `sudo pm2 jlist`...')
    sites = extract_sites(read_pm2_processes())
    results = check_sites(sites, args.timeout, reporter=reporter)
    failed = [result for result in results if not result.ok]

    print('')
    print_failed_results(results)

    if args.delete and failed:
        print('')
        print('Deleting failed PM2 processes:')
        for command in build_delete_commands(failed):
            print(f'  {" ".join(command)}')
        delete_failed_sites(failed)

    print_statistics(results)

    return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
