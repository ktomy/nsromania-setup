#!/usr/bin/env python3

import importlib.util
import io
import pathlib
import socket
from contextlib import redirect_stdout
import unittest


MODULE_PATH = pathlib.Path(__file__).with_name('check_pm2_sites.py')
SPEC = importlib.util.spec_from_file_location('check_pm2_sites', MODULE_PATH)
check_pm2_sites = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(check_pm2_sites)


class CheckPm2SitesTest(unittest.TestCase):
    def test_extracts_processes_with_ports_from_pm2_json(self):
        processes = check_pm2_sites.extract_sites(
            [
                {
                    'pm_id': 7,
                    'name': '11005_demo',
                    'pm2_env': {
                        'status': 'online',
                        'pm_exec_path': '/opt/nightscout/master/server.js',
                        'env': {'PORT': '11005'},
                    },
                },
                {
                    'pm_id': 8,
                    'name': 'worker_without_port',
                    'pm2_env': {'status': 'online', 'env': {}},
                },
            ]
        )

        self.assertEqual(
            processes,
            [
                check_pm2_sites.SiteProcess(
                    pm_id=7,
                    name='11005_demo',
                    status='online',
                    port=11005,
                    url='http://127.0.0.1:11005/',
                )
            ],
        )

    def test_extracts_port_when_pm2_flattens_env_values(self):
        processes = check_pm2_sites.extract_sites(
            [
                {
                    'pm_id': 9,
                    'name': '11006_flat',
                    'pm2_env': {
                        'status': 'online',
                        'PORT': '11006',
                    },
                }
            ]
        )

        self.assertEqual(processes[0].port, 11006)
        self.assertEqual(processes[0].url, 'http://127.0.0.1:11006/')

    def test_non_online_process_is_failed_without_http_probe(self):
        site = check_pm2_sites.SiteProcess(
            pm_id=2,
            name='11002_stopped',
            status='stopped',
            port=11002,
            url='http://127.0.0.1:11002/',
        )

        result = check_pm2_sites.check_site(site, timeout=1.0, opener=lambda url, timeout: 200)

        self.assertEqual(result.ok, False)
        self.assertEqual(result.reason, 'pm2 status is stopped')

    def test_http_status_below_400_is_ok(self):
        site = check_pm2_sites.SiteProcess(
            pm_id=3,
            name='11003_ok',
            status='online',
            port=11003,
            url='http://127.0.0.1:11003/',
        )

        result = check_pm2_sites.check_site(site, timeout=1.0, opener=lambda url, timeout: 302)

        self.assertEqual(result.ok, True)
        self.assertEqual(result.http_status, 302)

    def test_http_status_400_or_higher_is_failed(self):
        site = check_pm2_sites.SiteProcess(
            pm_id=4,
            name='11004_bad',
            status='online',
            port=11004,
            url='http://127.0.0.1:11004/',
        )

        result = check_pm2_sites.check_site(site, timeout=1.0, opener=lambda url, timeout: 503)

        self.assertEqual(result.ok, False)
        self.assertEqual(result.reason, 'HTTP 503')

    def test_delete_uses_sudo_pm2_delete_for_failed_sites_only(self):
        failed = [
            check_pm2_sites.SiteCheckResult(
                site=check_pm2_sites.SiteProcess(1, 'bad', 'online', 11001, 'http://127.0.0.1:11001/'),
                ok=False,
                http_status=500,
                reason='HTTP 500',
            )
        ]
        commands = []

        check_pm2_sites.delete_failed_sites(failed, runner=lambda command: commands.append(command))

        self.assertEqual(commands, [['sudo', 'pm2', 'delete', '1']])

    def test_delete_batches_failed_sites_in_groups_of_10_by_default(self):
        failed = [
            check_pm2_sites.SiteCheckResult(
                site=check_pm2_sites.SiteProcess(index, f'bad_{index}', 'online', 11000 + index, f'http://127.0.0.1:{11000 + index}/'),
                ok=False,
                http_status=500,
                reason='HTTP 500',
            )
            for index in range(1, 24)
        ]
        commands = []

        check_pm2_sites.delete_failed_sites(failed, runner=lambda command: commands.append(command))

        self.assertEqual(
            commands,
            [
                ['sudo', 'pm2', 'delete', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
                ['sudo', 'pm2', 'delete', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20'],
                ['sudo', 'pm2', 'delete', '21', '22', '23'],
            ],
        )

    def test_check_sites_reports_start_and_per_site_progress(self):
        sites = [
            check_pm2_sites.SiteProcess(1, '11001_one', 'online', 11001, 'http://127.0.0.1:11001/'),
            check_pm2_sites.SiteProcess(2, '11002_two', 'online', 11002, 'http://127.0.0.1:11002/'),
        ]
        messages = []

        check_pm2_sites.check_sites(
            sites,
            timeout=1.0,
            opener=lambda url, timeout: 200,
            reporter=messages.append,
        )

        self.assertEqual(
            messages,
            [
                'Scanning 2 PM2 site(s) with 1s timeout...',
                '[1/2] Checking 11001_one at http://127.0.0.1:11001/ ... OK (HTTP 200)',
                '[2/2] Checking 11002_two at http://127.0.0.1:11002/ ... OK (HTTP 200)',
            ],
        )

    def test_print_statistics_counts_checked_timeouts_and_non_200(self):
        sites = [
            check_pm2_sites.SiteProcess(1, 'ok', 'online', 11001, 'http://127.0.0.1:11001/'),
            check_pm2_sites.SiteProcess(2, 'redirect', 'online', 11002, 'http://127.0.0.1:11002/'),
            check_pm2_sites.SiteProcess(3, 'timeout', 'online', 11003, 'http://127.0.0.1:11003/'),
        ]

        def opener(url, timeout):
            if url.endswith(':11001/'):
                return 200
            if url.endswith(':11002/'):
                return 302
            raise socket.timeout()

        results = check_pm2_sites.check_sites(sites, timeout=1.0, opener=opener)
        output = io.StringIO()

        with redirect_stdout(output):
            check_pm2_sites.print_statistics(results)

        self.assertEqual(
            output.getvalue(),
            '\nStatistics:\n'
            '  Checked: 3\n'
            '  Timeout: 1\n'
            '  Non-200 HTTP status: 1\n',
        )


if __name__ == '__main__':
    unittest.main()
