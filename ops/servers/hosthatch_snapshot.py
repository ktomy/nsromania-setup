#!/usr/bin/env python3
"""Take a HostHatch snapshot of one server and keep only the newest snapshots this job made.

Runs from .github/workflows/d1-snapshot.yml; see ops/servers/HOSTHATCH-API.md. The API key comes from the
HOSTHATCH_API_KEY environment variable and is never printed.

Safety rules:
- The server's hostname is checked before anything changes.
- The job deletes only completed snapshots of that server whose name starts with the prefix (it renames each
  snapshot it takes to PREFIX + UTC time). Snapshots taken by hand, or of other servers, are never touched.
- The new snapshot must be completed before an old one is deleted, except when the account's snapshot limit is
  reached: then the oldest own snapshot is deleted first, but only while at least max(keep, 2) own snapshots exist,
  so one complete snapshot always remains.

Standard library only, compatible with Python 3.10.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import re
import sys
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from typing import Any, Callable

BASE_URL = 'https://console.hosthatch.com/api/v1'
USER_AGENT = 'nsromania-snapshot-job/1'
MAX_PAGES = 50


class JobError(Exception):
    """Stops the job. The message is safe to print."""


class ApiError(Exception):
    """An HTTP error answer from the API, with the problem details' `code` when there is one."""

    def __init__(self, method: str, path: str, status: int, data: Any):
        self.status = status
        self.data = data if isinstance(data, dict) else {}
        self.code = self.data.get('code')
        detail = self.data.get('detail') or ''
        super().__init__(f'{method} {path}: HTTP {status} {self.code or "(no code)"} {detail}'.rstrip())


def _retry_after(headers: Any) -> float | None:
    try:
        value = headers.get('Retry-After') if headers is not None else None
        return max(1.0, float(value)) if value is not None else None
    except (TypeError, ValueError):
        return None


class Api:
    """Minimal client. Every request this job sends is safe to repeat (GETs, the snapshot POST carries an
    Idempotency-Key, renaming is a PATCH with the same body, a repeated DELETE answers 404), so network errors,
    429 and 5xx answers are retried a few times."""

    def __init__(
        self,
        key: str,
        *,
        base_url: str = BASE_URL,
        urlopen: Callable[..., Any] = urllib.request.urlopen,
        sleep: Callable[[float], None] = time.sleep,
        log: Callable[[str], None] = print,
        attempts: int = 5,
    ):
        self._key = key
        self._base_url = base_url
        self._urlopen = urlopen
        self._sleep = sleep
        self._log = log
        self._attempts = attempts

    def request(self, method: str, path: str, body: Any = None, idempotency_key: str | None = None) -> Any:
        data = None if body is None else json.dumps(body).encode()
        for attempt in range(1, self._attempts + 1):
            req = urllib.request.Request(self._base_url + path, data=data, method=method)
            req.add_header('Authorization', f'Bearer {self._key}')
            req.add_header('Accept', 'application/json')
            req.add_header('User-Agent', USER_AGENT)
            if data is not None:
                req.add_header('Content-Type', 'application/json')
            if idempotency_key:
                req.add_header('Idempotency-Key', idempotency_key)
            last = attempt == self._attempts
            try:
                with self._urlopen(req, timeout=60) as resp:
                    raw = resp.read()
                    return json.loads(raw) if raw else None
            except urllib.error.HTTPError as err:
                payload = None
                content_type = err.headers.get('Content-Type', '') if err.headers is not None else ''
                if 'json' in content_type:
                    try:
                        payload = json.loads(err.read() or b'null')
                    except ValueError:
                        payload = None
                error = ApiError(method, path, err.code, payload)
                # A 502 that names an action or order means it was recorded: the caller polls it.
                recorded = error.data.get('action_id') or error.data.get('order_id')
                if last or recorded or not (err.code == 429 or err.code >= 500):
                    raise error from None
                # The edge's HTML 429 has no Retry-After: wait 60 s, as the docs say.
                wait = _retry_after(err.headers) or (60.0 if err.code == 429 else 15.0 * attempt)
                self._log(f'{method} {path}: HTTP {err.code}, retrying in {wait:.0f} s')
                self._sleep(wait + random.uniform(0, 3))
            except (urllib.error.URLError, TimeoutError, ConnectionError) as err:
                reason = getattr(err, 'reason', err)
                if last:
                    raise JobError(f'{method} {path}: network error: {reason}') from None
                self._log(f'{method} {path}: network error ({reason}), retrying')
                self._sleep(10.0 * attempt)
        raise AssertionError('unreachable')


class SnapshotJob:
    def __init__(
        self,
        api: Any,
        *,
        project: str,
        server_id: str,
        hostname: str,
        prefix: str,
        keep: int,
        dry_run: bool = False,
        timeout_s: float = 3 * 3600,
        log: Callable[[str], None] = print,
        sleep: Callable[[float], None] = time.sleep,
        monotonic: Callable[[], float] = time.monotonic,
        now: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
    ):
        self.api = api
        self.project = project
        self.server_id = server_id
        self.hostname = hostname
        self.prefix = prefix
        self.keep = keep
        self.dry_run = dry_run
        self.timeout_s = timeout_s
        self.log = log
        self.sleep = sleep
        self.monotonic = monotonic
        self.now = now
        self.summary: list[str] = []

    # Paths ---------------------------------------------------------------------------------------------------

    def _p(self, rest: str) -> str:
        return f'/projects/{self.project}/{rest}'

    # Reading -------------------------------------------------------------------------------------------------

    def list_snapshots(self) -> list[dict]:
        items: list[dict] = []
        for page in range(1, MAX_PAGES + 1):
            data = self.api.request('GET', self._p(f'snapshots/?page={page}&page_size=100'))
            items.extend(data.get('results') or [])
            if not data.get('next'):
                return items
        raise JobError(f'more than {MAX_PAGES} pages of snapshots')

    def own_completed(self, snapshots: list[dict]) -> list[dict]:
        """This job's completed snapshots of this server, oldest first."""
        own = [
            s
            for s in snapshots
            if s.get('server_id') == self.server_id
            and s.get('status') == 'completed'
            and isinstance(s.get('name'), str)
            and s['name'].startswith(self.prefix)
            and isinstance(s.get('id'), int)
        ]
        return sorted(own, key=lambda s: (s.get('created_at') or '', s['id']))

    @staticmethod
    def describe(snapshot: dict) -> str:
        return f"{snapshot.get('name')} (id {snapshot.get('id')}, {snapshot.get('created_at')})"

    # Steps ---------------------------------------------------------------------------------------------------

    def run(self) -> None:
        server = self.api.request('GET', self._p(f'servers/{self.server_id}/'))
        if server.get('hostname') != self.hostname:
            raise JobError(
                f'server {self.server_id} has hostname {server.get("hostname")!r}, expected {self.hostname!r}; '
                'nothing was changed'
            )
        self.log(f'Server {self.server_id} ({self.hostname}) is {server.get("status")}')

        snapshots = self.list_snapshots()
        own = self.own_completed(snapshots)
        self.log(
            f'{len(snapshots)} snapshot(s) in the project, {len(own)} completed one(s) made by this job: '
            + (', '.join(self.describe(s) for s in own) or 'none')
        )
        pending = [s for s in snapshots if s.get('server_id') == self.server_id and s.get('status') == 'pending']

        if self.dry_run:
            excess = own[: max(0, len(own) - (self.keep - 1))]
            self.note('Dry run: nothing was changed.')
            self.note(f'Would take a snapshot named {self.new_name()}.')
            if pending:
                self.note(f'Would refuse: snapshot {pending[0].get("id")} of this server is still pending.')
            for s in excess:
                self.note(f'Would then delete {self.describe(s)} (keeping the newest {self.keep}).')
            return

        if pending:
            raise JobError(f'snapshot {pending[0].get("id")} of this server is still pending; not starting another')

        name = self.new_name()
        known_ids = {s.get('id') for s in snapshots}
        action = self.start_snapshot(own)
        self.log(f'Snapshot action {action.get("id")} started')
        action = self.wait_for_action(action)
        snapshot_id = self.find_new_snapshot(action, known_ids)
        snapshot = self.wait_for_snapshot(snapshot_id)
        renamed = self.api.request('PATCH', self._p(f'snapshots/{snapshot_id}/'), {'name': name})
        snapshot = renamed if isinstance(renamed, dict) and renamed.get('id') == snapshot_id else snapshot
        snapshot['name'] = name
        self.note(f'Took snapshot {self.describe(snapshot)}, {snapshot.get("size_gb")} GB.')
        self.prune(snapshot)

    def new_name(self) -> str:
        return self.prefix + self.now().strftime('%Y%m%dT%H%MZ')

    def start_snapshot(self, own: list[dict]) -> dict:
        freed = False
        path = self._p(f'servers/{self.server_id}/actions/create-snapshot/')
        for _ in range(4):
            # A new key per attempt: each retry here follows a definite refusal, never a lost answer.
            try:
                return self.api.request('POST', path, idempotency_key=str(uuid.uuid4()))
            except ApiError as err:
                if err.code == 'upstream_error' and err.data.get('action_id'):
                    self.log(f'Action {err.data["action_id"]} was recorded but not confirmed yet; polling it')
                    return {'id': err.data['action_id'], 'status': 'running'}
                if err.code == 'action_in_progress' and err.data.get('action_id'):
                    self.log(f'Action {err.data["action_id"]} is running on the server; waiting for it to finish')
                    self.wait_for_action({'id': err.data['action_id'], 'status': 'running'}, require_success=False)
                    continue
                if err.code == 'snapshot_limit_reached' and not freed:
                    self.free_slot(own)
                    freed = True
                    continue
                raise JobError(f'could not start the snapshot: {err}') from None
        raise JobError('could not start the snapshot: the server stayed busy')

    def free_slot(self, own: list[dict]) -> None:
        if len(own) < max(self.keep, 2):
            raise JobError(
                f'the account snapshot limit is reached and only {len(own)} completed snapshot(s) were made by this '
                f'job (keeping {self.keep}); delete a snapshot taken by hand, or lower the retention. Nothing was '
                'deleted'
            )
        oldest = own.pop(0)
        self.note(f'Snapshot limit reached: deleted the oldest own snapshot {self.describe(oldest)} first.')
        self.delete(oldest)

    def wait_for_action(self, action: dict, require_success: bool = True) -> dict:
        action_id = action.get('id')
        deadline = self.monotonic() + self.timeout_s
        interval = 10.0
        while True:
            status = action.get('status')
            if status == 'success':
                return action
            if status == 'error':
                if not require_success:
                    return action
                error = action.get('error') or {}
                raise JobError(f'action {action_id} failed: {error.get("code")}: {error.get("message")}')
            if self.monotonic() >= deadline:
                raise JobError(f'action {action_id} still {status} after {self.timeout_s / 60:.0f} minutes')
            self.sleep(interval)
            interval = min(interval * 1.5, 60.0)
            action = self.api.request('GET', self._p(f'actions/{action_id}/'))
            self.log(f'Action {action_id}: {action.get("status")}')

    def find_new_snapshot(self, action: dict, known_ids: set) -> int:
        snapshot_id = (action.get('result') or {}).get('snapshot_id')
        if isinstance(snapshot_id, int):
            return snapshot_id
        # "when it can be told": otherwise find it in the list, which can lag a few minutes.
        for attempt in range(6):
            new = [
                s
                for s in self.list_snapshots()
                if s.get('server_id') == self.server_id and s.get('id') not in known_ids and s.get('status') != 'failed'
            ]
            if len(new) == 1 and isinstance(new[0].get('id'), int):
                return new[0]['id']
            if len(new) > 1:
                raise JobError(f'{len(new)} new snapshots of the server appeared; not guessing which is this one')
            if attempt < 5:
                self.sleep(60)
        raise JobError('the snapshot action succeeded but its snapshot did not appear in the list')

    def wait_for_snapshot(self, snapshot_id: int) -> dict:
        deadline = self.monotonic() + 30 * 60
        while True:
            snapshot = self.api.request('GET', self._p(f'snapshots/{snapshot_id}/'))
            status = snapshot.get('status')
            if status == 'completed':
                return snapshot
            if status == 'failed':
                error = snapshot.get('error') or {}
                raise JobError(f'snapshot {snapshot_id} failed: {error.get("code")}: {error.get("message")}')
            if self.monotonic() >= deadline:
                raise JobError(f'snapshot {snapshot_id} still {status} 30 minutes after its action succeeded')
            self.sleep(30)

    def prune(self, new: dict) -> None:
        # The new snapshot is the newest; the list can lag behind its rename, so it is placed last explicitly.
        own = [s for s in self.own_completed(self.list_snapshots()) if s['id'] != new['id']] + [new]
        excess = own[: max(0, len(own) - self.keep)]
        for snapshot in excess:
            self.delete(snapshot)
            self.note(f'Deleted the old snapshot {self.describe(snapshot)}.')
        kept = own[len(excess):]
        self.note(f'Kept {len(kept)} snapshot(s) made by this job: ' + ', '.join(self.describe(s) for s in kept))

    def delete(self, snapshot: dict) -> None:
        if not (
            snapshot.get('server_id') == self.server_id
            and isinstance(snapshot.get('name'), str)
            and snapshot['name'].startswith(self.prefix)
        ):
            raise AssertionError(f'refusing to delete a snapshot this job did not make: {snapshot!r}')
        try:
            self.api.request('DELETE', self._p(f'snapshots/{snapshot["id"]}/'))
        except ApiError as err:
            if err.status != 404:
                raise JobError(f'could not delete {self.describe(snapshot)}: {err}') from None
            self.log(f'{self.describe(snapshot)} was already gone')

    def note(self, line: str) -> None:
        self.log(line)
        self.summary.append(line)


def write_step_summary(title: str, lines: list[str]) -> None:
    path = os.environ.get('GITHUB_STEP_SUMMARY')
    if not path:
        return
    with open(path, 'a', encoding='utf-8') as fh:
        fh.write(f'### {title}\n\n' + ''.join(f'- {line}\n' for line in lines) + '\n')


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('--project', required=True, help='project slug')
    parser.add_argument('--server', required=True, help='server id (hex)')
    parser.add_argument('--hostname', required=True, help='expected hostname, checked before any change')
    parser.add_argument('--prefix', required=True, help='name prefix that marks the snapshots this job manages')
    parser.add_argument('--keep', type=int, required=True, help='how many own snapshots to keep, the new one included')
    parser.add_argument('--timeout-minutes', type=int, default=180)
    parser.add_argument('--dry-run', action='store_true', help='only read, and print what would be done')
    args = parser.parse_args(argv)

    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,63}', args.project):
        parser.error('invalid --project')
    if not re.fullmatch(r'[0-9a-f]{1,32}', args.server):
        parser.error('invalid --server')
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{2,40}', args.prefix):
        parser.error('invalid --prefix')
    if not 1 <= args.keep <= 20:
        parser.error('--keep must be between 1 and 20')

    key = os.environ.get('HOSTHATCH_API_KEY', '').strip()
    if not key:
        print('HOSTHATCH_API_KEY is not set', file=sys.stderr)
        return 2

    job = SnapshotJob(
        Api(key),
        project=args.project,
        server_id=args.server,
        hostname=args.hostname,
        prefix=args.prefix,
        keep=args.keep,
        dry_run=args.dry_run,
        timeout_s=args.timeout_minutes * 60,
    )
    title = f'Snapshot of {args.hostname}' + (' (dry run)' if args.dry_run else '')
    try:
        job.run()
    except (JobError, ApiError) as err:
        prefix = '::error::' if os.environ.get('GITHUB_ACTIONS') == 'true' else 'ERROR: '
        print(f'{prefix}{err}', file=sys.stderr)
        write_step_summary(title + ' failed', job.summary + [f'**Failed:** {err}'])
        return 1
    write_step_summary(title, job.summary)
    return 0


if __name__ == '__main__':
    sys.exit(main())
