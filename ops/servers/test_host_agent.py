import io
import json
import os
import shutil
import stat
import sys
import tempfile
import textwrap
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import host_agent as agent  # noqa: E402

# Fake pm2 CLI: keeps its process list in $PM2_HOME/state.json
FAKE_PM2 = textwrap.dedent(
    """\
    import json, os, sys
    state_path = os.path.join(os.environ['PM2_HOME'], 'state.json')
    apps = json.load(open(state_path)) if os.path.exists(state_path) else []
    command = sys.argv[1]
    if command == 'jlist':
        print('some warning line')
        print(json.dumps(apps))
    elif command == 'start':
        for app in json.load(open(sys.argv[2]))['apps']:
            apps.append({'name': app['name'], 'pm2_env': {'status': os.environ.get('FAKE_STATUS', 'online'),
                         'definition': app}, 'monit': {'cpu': 0, 'memory': 1}})
    elif command == 'delete':
        apps = [app for app in apps if app['name'] != sys.argv[2]]
    elif command == 'save':
        open(os.path.join(os.environ['PM2_HOME'], 'saved'), 'w').write(str(len(apps)))
    else:
        sys.exit(2)
    json.dump(apps, open(state_path, 'w'))
    """
)

# Fake nginx: `nginx -t` fails when $FAIL_MARKER exists
FAKE_NGINX = '#!/bin/sh\n[ -e "{marker}" ] && {{ echo "emerg: bad config" >&2; exit 1; }}\nexit 0\n'

TEMPLATE = """server {
    listen 443 ssl;
    server_name [% subdomain %].nsromania.info;
    location / {
        proxy_pass         http://localhost:[% port %];
        include /etc/nginx/proxy_params;
    }
    include /etc/nginx/certs_paths;
}
"""


class AgentTestCase(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root)
        path = lambda *parts: os.path.join(self.root, *parts)  # noqa: E731

        for directory in ('pm2home', 'versions/15_0_7', 'node/v22.12.0/bin', 'available', 'enabled', 'errors', 'run'):
            os.makedirs(path(directory))
        for name in ('server.js', 'package.json'):
            open(path('versions/15_0_7', name), 'w').write('{}')
        os.symlink(path('versions/15_0_7'), path('versions/master'))
        node = path('node/v22.12.0/bin/node')
        open(node, 'w').write('')
        os.chmod(node, 0o755)
        open(path('available/_template'), 'w').write(TEMPLATE)
        open(path('available/00-default'), 'w').write('')
        open(path('available/default'), 'w').write('')
        open(path('fake_pm2.py'), 'w').write(FAKE_PM2)
        self.fail_marker = path('nginx-fails')
        open(path('nginx'), 'w').write(FAKE_NGINX.format(marker=self.fail_marker))
        os.chmod(path('nginx'), os.stat(path('nginx')).st_mode | stat.S_IEXEC)

        self.config = agent.Config(
            node=sys.executable,
            pm2=path('fake_pm2.py'),
            pm2_home=path('pm2home'),
            node_versions=path('node'),
            ns_versions=path('versions'),
            error_log_dir=path('errors'),
            sites_available=path('available'),
            sites_enabled=path('enabled'),
            vhost_backup_dir=path('backup'),
            run_dir=path('run'),
            lock_file=path('lock/agent.lock'),
            nginx=path('nginx'),
            systemctl='/bin/true',
        )
        self.path = path

    def definition(self, **overrides):
        value = {
            'name': '11224_ktomy',
            'script': 'server.js',
            'cwd': self.path('versions/15_0_7') + '/',
            'interpreter': self.path('node/v22.12.0/bin/node'),
            'env': {'PORT': '11224', 'API_SECRET': 'secret', 'MONGO_CONNECTION': 'mongodb://u:p@127.0.0.1/ktomy'},
        }
        value.update(overrides)
        return json.dumps(value)

    def run_op(self, command, stdin=''):
        return agent.run(command, io.StringIO(stdin), self.config)

    def state(self):
        return json.load(open(self.path('pm2home/state.json')))


class ValidationTest(AgentTestCase):
    def test_process_names_carry_the_instance_port(self):
        self.assertEqual(agent.parse_name('11224_ktomy'), (11224, 'ktomy'))
        self.assertEqual(agent.parse_name('11007_a-b'), (11007, 'a-b'))
        self.assertEqual(agent.parse_name('111000_big'), (12000, 'big'))
        for bad in ('11224_', '1224_ktomy', '11224_kt omy', '11224_-x', '11224_x;rm', '11abc_x', 'setup-ns', ''):
            with self.assertRaises(agent.AgentError, msg=bad):
                agent.parse_name(bad)

    def test_accepts_a_valid_definition_and_resolves_paths(self):
        result = agent.validate_definition(self.definition(cwd=self.path('versions/master')), self.config)
        self.assertEqual(result['cwd'], os.path.realpath(self.path('versions/15_0_7')))
        self.assertEqual(result['env']['PORT'], '11224')

    def test_rejects_unsafe_definitions(self):
        outside = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, outside)
        for name in ('server.js', 'package.json'):
            open(os.path.join(outside, name), 'w').write('{}')
        os.symlink(outside, self.path('versions/escape'))
        cases = {
            'cwd outside versions': self.definition(cwd=outside),
            'cwd escaping through a symlink': self.definition(cwd=self.path('versions/escape')),
            'cwd with ..': self.definition(cwd=self.path('versions/15_0_7/../../')),
            'cwd is the versions root': self.definition(cwd=self.path('versions')),
            'interpreter outside node versions': self.definition(interpreter='/bin/sh'),
            'port mismatch': self.definition(env={'PORT': '11225'}),
            'bad env key': self.definition(env={'PORT': '11224', 'BAD-KEY': 'x'}),
            'non-string env value': self.definition(env={'PORT': '11224', 'X': 1}),
            'other script': self.definition(script='evil.js'),
            'unknown field': json.dumps({**json.loads(self.definition()), 'node_args': ['--inspect']}),
            'not an object': '[]',
            'not JSON': '{',
        }
        for label, raw in cases.items():
            with self.assertRaises(agent.AgentError, msg=label):
                agent.validate_definition(raw, self.config)

    def test_dispatch_rejects_unknown_operations_and_wrong_arguments(self):
        for command in ('', 'rm -rf /', 'pm2-list extra', 'pm2-delete', 'vhost-create ktomy', 'bash'):
            with self.assertRaises(agent.AgentError, msg=command):
                self.run_op(command)
        with self.assertRaises(agent.AgentError):
            self.run_op('pm2-start', 'x' * (agent.MAX_STDIN + 1))


class Pm2Test(AgentTestCase):
    def test_start_uses_the_main_server_logging_layout(self):
        result = self.run_op('pm2-start', self.definition())
        self.assertEqual(result, {'name': '11224_ktomy', 'status': 'online'})
        app = self.state()[0]['pm2_env']['definition']
        self.assertEqual(app['out_file'], '/dev/null')
        self.assertEqual(app['error_file'], self.path('errors/11224_ktomy.log'))
        self.assertEqual(app['env']['NODE_ENV'], 'production')
        self.assertEqual(app['env']['API_SECRET'], 'secret')
        self.assertEqual(app['cwd'], os.path.realpath(self.path('versions/15_0_7')))
        self.assertEqual(os.listdir(self.path('run')), [], 'the temporary app file must be removed')

    def test_start_refuses_a_duplicate_and_delete_requires_an_existing_app(self):
        self.run_op('pm2-start', self.definition())
        with self.assertRaises(agent.AgentError):
            self.run_op('pm2-start', self.definition())
        with self.assertRaises(agent.AgentError):
            self.run_op('pm2-delete 11999_missing')
        self.assertEqual(self.run_op('pm2-delete 11224_ktomy'), {'name': '11224_ktomy'})
        self.assertEqual(self.state(), [])

    def test_list_skips_modules(self):
        json.dump(
            [
                {'name': 'pm2-logrotate', 'pm2_env': {'status': 'online', 'pmx_module': True}},
                {'name': '11224_ktomy', 'pm2_env': {'status': 'online', 'pm_uptime': 5}, 'monit': {'cpu': 1}},
            ],
            open(self.path('pm2home/state.json'), 'w'),
        )
        self.assertEqual(
            self.run_op('pm2-list'),
            [{'name': '11224_ktomy', 'status': 'online', 'cpu': 1, 'memory': None, 'uptime': 5}],
        )

    def test_save_only_a_healthy_list(self):
        self.run_op('pm2-start', self.definition())
        self.assertEqual(self.run_op('pm2-save'), {'saved': True, 'online': 1, 'total': 1})
        self.assertTrue(os.path.exists(self.path('pm2home/saved')))

        os.unlink(self.path('pm2home/saved'))
        state = self.state()
        state[0]['pm2_env']['status'] = 'stopped'
        json.dump(state, open(self.path('pm2home/state.json'), 'w'))
        self.assertEqual(self.run_op('pm2-save'), {'saved': False, 'online': 0, 'total': 1})
        self.assertFalse(os.path.exists(self.path('pm2home/saved')))


class VhostTest(AgentTestCase):
    def test_create_renders_the_template_and_is_idempotent(self):
        self.assertTrue(self.run_op('vhost-create ktomy 11224')['changed'])
        content = open(self.path('available/ktomy')).read()
        self.assertIn('server_name ktomy.nsromania.info;', content)
        self.assertIn('proxy_pass         http://localhost:11224;', content)
        self.assertEqual(os.readlink(self.path('enabled/ktomy')), self.path('available/ktomy'))
        self.assertFalse(self.run_op('vhost-create ktomy 11224')['changed'])
        self.assertEqual(self.run_op('vhost-list'), ['ktomy'])

    def test_create_rolls_back_when_nginx_rejects_the_config(self):
        open(self.fail_marker, 'w').close()
        with self.assertRaises(agent.AgentError):
            self.run_op('vhost-create ktomy 11224')
        self.assertFalse(os.path.exists(self.path('available/ktomy')))
        self.assertFalse(os.path.lexists(self.path('enabled/ktomy')))

    def test_update_restores_the_previous_vhost_on_failure(self):
        self.run_op('vhost-create ktomy 11224')
        open(self.fail_marker, 'w').close()
        with self.assertRaises(agent.AgentError):
            self.run_op('vhost-create ktomy 11300')
        self.assertIn('11224', open(self.path('available/ktomy')).read())

    def test_delete_keeps_a_backup(self):
        self.run_op('vhost-create ktomy 11224')
        result = self.run_op('vhost-delete ktomy')
        self.assertFalse(os.path.exists(self.path('available/ktomy')))
        self.assertFalse(os.path.lexists(self.path('enabled/ktomy')))
        self.assertIn('11224', open(result['backup']).read())
        with self.assertRaises(agent.AgentError):
            self.run_op('vhost-delete ktomy')

    def test_reserved_and_invalid_names_are_refused(self):
        for command in ('vhost-create default 11224', 'vhost-create setup 11224', 'vhost-create ../x 11224',
                        'vhost-create _template 11224', 'vhost-create ktomy 80', 'vhost-create ktomy 99999',
                        'vhost-delete 00-default', 'vhost-delete default'):
            with self.assertRaises(agent.AgentError, msg=command):
                self.run_op(command)


class MainTest(AgentTestCase):
    def test_main_prints_one_json_line_and_exit_status(self):
        with mock.patch.object(agent, 'CONFIG', self.config), mock.patch('os.geteuid', return_value=0), \
                mock.patch.dict(os.environ, {'SSH_ORIGINAL_COMMAND': 'bogus'}), \
                mock.patch('sys.stdout', new_callable=io.StringIO) as out, mock.patch('syslog.syslog'):
            self.assertEqual(agent.main(), 1)
        self.assertEqual(json.loads(out.getvalue()), {'ok': False, 'error': 'unknown operation'})


if __name__ == '__main__':
    unittest.main()
