import datetime as dt
import os
import sys
import unittest

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


if __name__ == '__main__':
    unittest.main()
