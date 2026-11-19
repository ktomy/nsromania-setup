import io
import json
import os
import sys
import unittest
import urllib.error
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import hosthatch_snapshot as hs  # noqa: E402

PROJECT = 'proj'
SERVER = 'df9f48'
PREFIX = 'auto-d1-'
NOW = datetime(2026, 11, 22, 1, 30, tzinfo=timezone.utc)


def snap(id_, name, created, server=SERVER, status='completed'):
    return {'id': id_, 'name': name, 'status': status, 'server_id': server, 'created_at': created, 'size_gb': 4.1}


class FakeApi:
    """In-memory HostHatch project: one server, its snapshots and actions."""

    def __init__(self, snapshots, hostname='d1', limit=10, busy_action=None, action_result_has_id=True,
                 action_fails=False):
        self.hostname = hostname
        self.snapshots = {s['id']: dict(s) for s in snapshots}
        self.limit = limit
        self.busy_action = busy_action  # id of an exclusive action running on the server
        self.action_result_has_id = action_result_has_id
        self.action_fails = action_fails
        self.actions = {}
        self.calls = []
        self.next_id = 1000

    def _error(self, method, path, status, code, **extra):
        return hs.ApiError(method, path, status, {'code': code, 'detail': code, **extra})

    def request(self, method, path, body=None, idempotency_key=None):
        self.calls.append((method, path, body))
        base = f'/projects/{PROJECT}/'
        assert path.startswith(base), path
        rest = path[len(base):]
        if method == 'GET' and rest == f'servers/{SERVER}/':
            return {'id': SERVER, 'hostname': self.hostname, 'status': 'running'}
        if method == 'GET' and rest.startswith('snapshots/?'):
            results = sorted(self.snapshots.values(), key=lambda s: s['created_at'])
            return {'count': len(results), 'next': None, 'previous': None, 'results': [dict(s) for s in results]}
        if method == 'POST' and rest == f'servers/{SERVER}/actions/create-snapshot/':
            assert idempotency_key
            if self.busy_action is not None:
                self.actions[self.busy_action] = {'id': self.busy_action, 'status': 'running', 'polls': 1}
                busy, self.busy_action = self.busy_action, None
                raise self._error(method, path, 409, 'action_in_progress', action_id=busy)
            counted = [s for s in self.snapshots.values() if s['status'] != 'failed']
            if len(counted) >= self.limit:
                raise self._error(method, path, 409, 'snapshot_limit_reached')
            self.next_id += 1
            snapshot_id = self.next_id
            self.snapshots[snapshot_id] = snap(snapshot_id, f'{SERVER}_x.qcow2', '2026-11-22T01:30:05Z',
                                               status='pending')
            self.next_id += 1
            action = {'id': self.next_id, 'status': 'running', 'polls': 2, 'snapshot_id': snapshot_id}
            self.actions[action['id']] = action
            return {'id': action['id'], 'status': 'running', 'result': {}, 'error': None}
        if method == 'GET' and rest.startswith('actions/'):
            action = self.actions[int(rest.split('/')[1])]
            action['polls'] -= 1
            if action['polls'] > 0:
                return {'id': action['id'], 'status': 'running', 'result': {}, 'error': None}
            if 'snapshot_id' in action:
                if self.action_fails:
                    del self.snapshots[action['snapshot_id']]
                    return {'id': action['id'], 'status': 'error', 'result': {},
                            'error': {'code': 'failed', 'message': 'boom'}}
                self.snapshots[action['snapshot_id']]['status'] = 'completed'
                result = {'snapshot_id': action['snapshot_id']} if self.action_result_has_id else {}
                return {'id': action['id'], 'status': 'success', 'result': result, 'error': None}
            return {'id': action['id'], 'status': 'success', 'result': {}, 'error': None}
        if rest.startswith('snapshots/') and rest.count('/') == 2:
            snapshot_id = int(rest.split('/')[1])
            if snapshot_id not in self.snapshots:
                raise self._error(method, path, 404, 'not_found')
            if method == 'GET':
                return dict(self.snapshots[snapshot_id])
            if method == 'PATCH':
                self.snapshots[snapshot_id]['name'] = body['name']
                return dict(self.snapshots[snapshot_id])
            if method == 'DELETE':
                del self.snapshots[snapshot_id]
                return None
        raise AssertionError(f'unexpected call {method} {path}')

    def writes(self):
        return [(m, p) for m, p, _ in self.calls if m != 'GET']

    def names(self):
        return sorted(s['name'] for s in self.snapshots.values())


def make_job(api, keep=2, dry_run=False):
    clock = [0.0]

    def sleep(seconds):
        clock[0] += seconds

    return hs.SnapshotJob(api, project=PROJECT, server_id=SERVER, hostname='d1', prefix=PREFIX, keep=keep,
                          dry_run=dry_run, log=lambda line: None, sleep=sleep, monotonic=lambda: clock[0],
                          now=lambda: NOW)


MANUAL = snap(9698, 'd1_20261118_082429_UTC', '2026-11-18T08:24:29Z')
OTHER_SERVER = snap(500, 'auto-d1-20261101T0130Z', '2026-11-01T01:30:00Z', server='aaaaaa')
A1 = snap(10, 'auto-d1-20261108T0130Z', '2026-11-08T01:30:00Z')
A2 = snap(11, 'auto-d1-20261115T0130Z', '2026-11-15T01:30:00Z')


class SnapshotJobTest(unittest.TestCase):
    def test_takes_renames_and_keeps_newest_two(self):
        api = FakeApi([MANUAL, OTHER_SERVER, A1, A2])
        make_job(api).run()
        self.assertEqual(
            api.names(),
            sorted(['d1_20261118_082429_UTC', 'auto-d1-20261101T0130Z', 'auto-d1-20261115T0130Z',
                    'auto-d1-20261122T0130Z']),
        )
        deletes = [p for m, p in api.writes() if m == 'DELETE']
        self.assertEqual(deletes, [f'/projects/{PROJECT}/snapshots/10/'])

    def test_first_run_deletes_nothing(self):
        api = FakeApi([MANUAL])
        make_job(api).run()
        self.assertEqual(api.names(), ['auto-d1-20261122T0130Z', 'd1_20261118_082429_UTC'])
        self.assertNotIn('DELETE', [m for m, _ in api.writes()])

    def test_limit_reached_frees_oldest_own_snapshot_then_retries(self):
        api = FakeApi([MANUAL, A1, A2], limit=3)
        make_job(api).run()
        self.assertEqual(api.names(), ['auto-d1-20261115T0130Z', 'auto-d1-20261122T0130Z', 'd1_20261118_082429_UTC'])

    def test_limit_reached_without_enough_own_snapshots_deletes_nothing(self):
        api = FakeApi([MANUAL, A2], limit=2)
        with self.assertRaisesRegex(hs.JobError, 'snapshot limit is reached'):
            make_job(api).run()
        self.assertEqual(api.names(), ['auto-d1-20261115T0130Z', 'd1_20261118_082429_UTC'])
        self.assertNotIn('DELETE', [m for m, _ in api.writes()])

    def test_keep_one_never_frees_its_only_snapshot_first(self):
        api = FakeApi([A2], limit=1)
        with self.assertRaises(hs.JobError):
            make_job(api, keep=1).run()
        self.assertEqual(api.names(), ['auto-d1-20261115T0130Z'])

    def test_wrong_hostname_changes_nothing(self):
        api = FakeApi([A1, A2], hostname='main')
        with self.assertRaisesRegex(hs.JobError, 'hostname'):
            make_job(api).run()
        self.assertEqual(api.writes(), [])

    def test_failed_action_deletes_nothing(self):
        api = FakeApi([MANUAL, A1, A2], action_fails=True)
        with self.assertRaisesRegex(hs.JobError, 'failed: failed: boom'):
            make_job(api).run()
        self.assertEqual(api.names(), sorted(['auto-d1-20261108T0130Z', 'auto-d1-20261115T0130Z',
                                              'd1_20261118_082429_UTC']))

    def test_waits_for_running_action_then_retries(self):
        api = FakeApi([A1, A2], busy_action=77)
        make_job(api).run()
        self.assertEqual(api.names(), ['auto-d1-20261115T0130Z', 'auto-d1-20261122T0130Z'])
        self.assertIn(('GET', f'/projects/{PROJECT}/actions/77/'), [(m, p) for m, p, _ in api.calls])

    def test_finds_snapshot_when_action_result_has_no_id(self):
        api = FakeApi([A2], action_result_has_id=False)
        make_job(api).run()
        self.assertEqual(api.names(), ['auto-d1-20261115T0130Z', 'auto-d1-20261122T0130Z'])

    def test_pending_snapshot_blocks_a_new_one(self):
        api = FakeApi([A2, snap(12, 'x', '2026-11-21T00:00:00Z', status='pending')])
        with self.assertRaisesRegex(hs.JobError, 'still pending'):
            make_job(api).run()
        self.assertEqual(api.writes(), [])

    def test_dry_run_only_reads(self):
        api = FakeApi([MANUAL, A1, A2])
        job = make_job(api, dry_run=True)
        job.run()
        self.assertEqual(api.writes(), [])
        self.assertTrue(any('Would then delete auto-d1-20261108T0130Z' in line for line in job.summary))
        self.assertFalse(any('auto-d1-20261115T0130Z (id' in line and 'delete' in line for line in job.summary))

    def test_delete_refuses_foreign_snapshot(self):
        job = make_job(FakeApi([]))
        with self.assertRaises(AssertionError):
            job.delete(MANUAL)
        with self.assertRaises(AssertionError):
            job.delete(OTHER_SERVER)


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class ApiTest(unittest.TestCase):
    def http_error(self, status, body, content_type='application/problem+json', headers=None):
        hdrs = {'Content-Type': content_type, **(headers or {})}

        class Headers(dict):
            def get(self, key, default=None):
                return super().get(key, default)

        return urllib.error.HTTPError('https://x/', status, 'err', Headers(hdrs), io.BytesIO(body))

    def test_sends_bearer_key_and_idempotency_key(self):
        seen = []

        def urlopen(req, timeout):
            seen.append(req)
            return FakeResponse(b'{"id": 1}')

        api = hs.Api('secret-key', urlopen=urlopen, sleep=lambda s: None, log=lambda line: None)
        self.assertEqual(api.request('POST', '/p/', idempotency_key='k1'), {'id': 1})
        self.assertEqual(seen[0].get_header('Authorization'), 'Bearer secret-key')
        self.assertEqual(seen[0].get_header('Idempotency-key'), 'k1')
        self.assertEqual(seen[0].full_url, hs.BASE_URL + '/p/')

    def test_retries_html_429_after_60_seconds(self):
        answers = [self.http_error(429, b'<html>', 'text/html'), FakeResponse(b'{"ok": true}')]
        slept = []

        def urlopen(req, timeout):
            answer = answers.pop(0)
            if isinstance(answer, Exception):
                raise answer
            return answer

        api = hs.Api('k', urlopen=urlopen, sleep=slept.append, log=lambda line: None)
        self.assertEqual(api.request('GET', '/p/'), {'ok': True})
        self.assertGreaterEqual(slept[0], 60)

    def test_problem_code_is_raised_without_retry(self):
        calls = []

        def urlopen(req, timeout):
            calls.append(req)
            raise self.http_error(409, json.dumps({'code': 'snapshot_limit_reached', 'detail': 'full'}).encode())

        api = hs.Api('k', urlopen=urlopen, sleep=lambda s: None, log=lambda line: None)
        with self.assertRaises(hs.ApiError) as ctx:
            api.request('POST', '/p/')
        self.assertEqual(ctx.exception.code, 'snapshot_limit_reached')
        self.assertEqual(len(calls), 1)

    def test_502_with_action_id_is_not_retried(self):
        calls = []

        def urlopen(req, timeout):
            calls.append(req)
            raise self.http_error(502, json.dumps({'code': 'upstream_error', 'action_id': 5}).encode())

        api = hs.Api('k', urlopen=urlopen, sleep=lambda s: None, log=lambda line: None)
        with self.assertRaises(hs.ApiError) as ctx:
            api.request('POST', '/p/', idempotency_key='k')
        self.assertEqual(ctx.exception.data['action_id'], 5)
        self.assertEqual(len(calls), 1)

    def test_error_message_never_contains_the_key(self):
        def urlopen(req, timeout):
            raise urllib.error.URLError('connection refused')

        api = hs.Api('very-secret', urlopen=urlopen, sleep=lambda s: None, log=lambda line: None, attempts=2)
        with self.assertRaises(hs.JobError) as ctx:
            api.request('GET', '/p/')
        self.assertNotIn('very-secret', str(ctx.exception))


if __name__ == '__main__':
    unittest.main()
