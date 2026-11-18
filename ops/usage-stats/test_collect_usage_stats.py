import datetime as dt
import io
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import collect_usage_stats as c  # noqa: E402

DAY = dt.date(2026, 11, 15)


def line(host, ip='1.2.3.4', req='GET / HTTP/1.1', status=200, ua='Mozilla/5.0', day='15/Nov/2026'):
    return '{}:443 {} - - [{}:10:00:00 +0000] "{}" {} 123 "-" "{}"\n'.format(host, ip, day, req, status, ua)


class AggregateTest(unittest.TestCase):
    def test_counts_categories(self):
        lines = [
            line('amalia.nsromania.info', req='GET / HTTP/1.1'),
            line('amalia.nsromania.info', req='GET /socket.io/?EIO=4&transport=polling HTTP/1.1', status=101),
            line('amalia.nsromania.info', ip='5.6.7.8', req='POST /api/v1/entries HTTP/1.1'),
            line('amalia.nsromania.info', req='PUT /api/v1/treatments HTTP/1.1'),
            line('amalia.nsromania.info', req='GET /api/v1/entries/sgv.json?count=10 HTTP/1.1'),
        ]
        r = c.aggregate(lines, DAY)['amalia']
        self.assertEqual(r, {'hits': 5, 'ok_hits': 5, 'uploads': 2, 'api_reads': 1, 'web_hits': 2, 'unique_ips': 2})

    def test_ok_hits_exclude_errors_and_bots(self):
        lines = [
            line('x.nsromania.info', req='GET /wp-login.php HTTP/1.1', status=404),
            line('x.nsromania.info', status=502),
            line('x.nsromania.info', ua='Mozilla/5.0 (compatible; Googlebot/2.1)'),
            line('x.nsromania.info', status=304),
        ]
        r = c.aggregate(lines, DAY)['x']
        self.assertEqual(r['hits'], 4)
        self.assertEqual(r['ok_hits'], 1)

    def test_filters_other_days_old_format_and_foreign_hosts(self):
        lines = [
            line('a.nsromania.info', day='14/Nov/2026'),
            '1.2.3.4 - - [15/Nov/2026:10:00:00 +0000] "GET / HTTP/1.1" 200 1 "-" "ua"\n',
            line('evil.example.com'),
            line("x';drop table t;--.nsromania.info"),
            line('a.b.nsromania.info'),
            line('nsromania.info'),
            line('A.NSROMANIA.INFO'),
            'garbage\n',
        ]
        self.assertEqual(list(c.aggregate(lines, DAY)), ['a'])

    def test_malformed_request_still_counted_as_hit(self):
        r = c.aggregate([line('a.nsromania.info', req='-', status=400)], DAY)['a']
        self.assertEqual((r['hits'], r['ok_hits'], r['web_hits']), (1, 0, 0))


class SqlTest(unittest.TestCase):
    def test_build_sql_is_idempotent_upsert(self):
        stats = c.aggregate([line('a.nsromania.info'), line('b.nsromania.info')], DAY)
        sql = c.build_sql(DAY, stats)
        self.assertIn("DELETE FROM ns_domain_daily_stats WHERE day = '2026-11-15';", sql)
        self.assertIn("('a','2026-11-15',1,1,0,0,1,1)", sql)
        self.assertTrue(sql.startswith('START TRANSACTION;') and sql.rstrip().endswith('COMMIT;'))


class ForwarderTest(unittest.TestCase):
    def test_exclude_forwarders_skips_main_addresses(self):
        lines = [
            line('a.nsromania.info', ip='45.134.39.79'),
            line('a.nsromania.info', ip='2a0e:97c0:3ea:6c4::1'),
            line('a.nsromania.info', ip='9.9.9.9'),
        ]
        self.assertEqual(c.aggregate(lines, DAY)['a']['hits'], 3)
        r = c.aggregate(lines, DAY, c.MAIN_ADDRESSES)['a']
        self.assertEqual((r['hits'], r['unique_ips']), (1, 1))

    def test_json_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            log = os.path.join(tmp, 'access.log')
            open(log, 'w').write(line('a.nsromania.info') + line('a.nsromania.info', ip='45.134.39.79'))
            with mock.patch.object(c, 'LOG_GLOB', os.path.join(tmp, 'access.log*')), \
                    mock.patch('sys.stdout', new_callable=io.StringIO) as out, mock.patch('sys.stderr', io.StringIO()):
                self.assertEqual(c.main(['--json', '--exclude-forwarders', '--date', '2026-11-15']), 0)
        self.assertEqual(json.loads(out.getvalue()), {
            'day': '2026-11-15',
            'domains': {'a': {'hits': 1, 'ok_hits': 1, 'uploads': 0, 'api_reads': 0, 'web_hits': 1, 'unique_ips': 1}},
        })


class RemoteTest(unittest.TestCase):
    ROW = {'hits': 3, 'ok_hits': 2, 'uploads': 1, 'api_reads': 1, 'web_hits': 0, 'unique_ips': 2}

    def answer(self, domains, day='2026-11-15'):
        return {'ok': True, 'result': {'day': day, 'domains': domains}}

    def test_validate_and_merge(self):
        remote = c.validate_remote(self.answer({'b': self.ROW, 'a': self.ROW}), DAY)
        total = c.aggregate([line('a.nsromania.info')], DAY)
        c.merge(total, remote)
        self.assertEqual(total['a'], {'hits': 4, 'ok_hits': 3, 'uploads': 1, 'api_reads': 1, 'web_hits': 1,
                                      'unique_ips': 3})
        self.assertEqual(total['b'], self.ROW)

    def test_rejects_bad_answers(self):
        bad = [
            {'ok': False, 'error': 'boom'},
            self.answer({}, day='2026-11-14'),
            self.answer({"x';drop": self.ROW}),
            self.answer({'a.b': self.ROW}),
            self.answer({'a': {**self.ROW, 'hits': -1}}),
            self.answer({'a': {**self.ROW, 'hits': '3'}}),
            self.answer({'a': {k: v for k, v in self.ROW.items() if k != 'uploads'}}),
            [],
        ]
        for payload in bad:
            with self.assertRaises(RuntimeError, msg=payload):
                c.validate_remote(payload, DAY)

    def test_remote_servers_from_env(self):
        with tempfile.NamedTemporaryFile('w', suffix='.env') as env:
            env.write('DATABASE_URL="mysql://u:p@h/db"\nNS_REMOTE_SERVERS="d1"\n'
                      'NS_SERVER_D1_SSH="nsagent@31.220.43.162"\n')
            env.flush()
            self.assertEqual(c.remote_servers(env.name), [('d1', 'nsagent@31.220.43.162')])
            self.assertEqual(c.mysql_credentials(env.name).hostname, 'h')
        with tempfile.NamedTemporaryFile('w', suffix='.env') as env:
            env.write('NS_REMOTE_SERVERS="d1"\nNS_SERVER_D1_SSH="root@1.2.3.4; rm -rf /"\n')
            env.flush()
            with self.assertRaises(RuntimeError):
                c.remote_servers(env.name)
        with tempfile.NamedTemporaryFile('w', suffix='.env') as env:
            env.write('X=1\n')
            env.flush()
            self.assertEqual(c.remote_servers(env.name), [])


if __name__ == '__main__':
    unittest.main()
