#!/usr/bin/python3 -I
"""NSRomania host agent: the only interface the setup panel has to an additional hosting server.

Installed as /usr/local/libexec/nsromania-host-agent and reached exclusively through the `nsagent` SSH key, whose
forced command is `/usr/bin/sudo -n /usr/local/libexec/nsromania-host-agent`. sudo keeps only
SSH_ORIGINAL_COMMAND, which carries the operation and its arguments; pm2-start reads its process definition as JSON
from stdin. The agent answers with one JSON line, {"ok": true, "result": ...} or {"ok": false, "error": "..."}, and
exits 0 or 1.

Operations (every argument is validated; nothing is passed to a shell):
    ping                     host name and installed Nightscout versions
    pm2-list                 PM2 apps: name, status, cpu, memory, uptime
    pm2-start                start one Nightscout instance (stdin: name, script, cwd, interpreter, env)
    pm2-delete NAME          delete one Nightscout instance
    pm2-save                 save the PM2 list if at least 90% of apps are online (same rule as the panel)
    vhost-list               nginx instance vhosts
    vhost-create SUB PORT    render the main server's vhost template for SUB -> 127.0.0.1:PORT
    vhost-delete SUB         remove SUB's vhost (a copy is kept in the backup directory)
"""

import fcntl
import json
import os
import re
import socket
import subprocess
import sys
import syslog
import tempfile
import time
from dataclasses import dataclass


@dataclass
class Config:
    node: str = '/usr/local/nvm/versions/node/v22.12.0/bin/node'
    pm2: str = '/usr/local/lib/node_modules/pm2/bin/pm2'
    pm2_home: str = '/root/.pm2'
    node_versions: str = '/usr/local/nvm/versions/node'
    ns_versions: str = '/usr/local/nsromania/nightscout/versions'
    error_log_dir: str = '/var/log/nightscout/pm2-errors'
    sites_available: str = '/etc/nginx/sites-available'
    sites_enabled: str = '/etc/nginx/sites-enabled'
    vhost_backup_dir: str = '/var/log/nightscout/backup/vhosts'
    run_dir: str = '/run/nsromania-host-agent'
    lock_file: str = '/run/lock/nsromania-host-agent.lock'
    nginx: str = '/usr/sbin/nginx'
    systemctl: str = '/usr/bin/systemctl'


CONFIG = Config()

# Process names are 11<id padded to 3 digits>_<subdomain>; the instance port is 11000 + id
NAME_RE = re.compile(r'^11(\d{3,5})_([A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)$')
SUBDOMAIN_RE = re.compile(r'^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$')
ENV_KEY_RE = re.compile(r'^[A-Za-z_][A-Za-z0-9_]{0,127}$')
# Server-level vhosts on every hosting server that must never be listed, replaced or deleted as instances
RESERVED_VHOSTS = {'00-default', 'default', 'setup'}
MAX_STDIN = 256 * 1024
MAX_ENV_VARS = 256
MAX_ENV_VALUE = 16384
SAVE_MIN_ONLINE_RATIO = 0.9


class AgentError(Exception):
    pass


def log(message):
    syslog.syslog(syslog.LOG_INFO, message)


# --- validation -------------------------------------------------------------------------------------------------


def parse_name(name):
    match = NAME_RE.match(name or '')
    if not match:
        raise AgentError('invalid process name')
    domain_id = int(match.group(1))
    port = 11000 + domain_id
    if not 11001 <= port <= 65535:
        raise AgentError('process id out of range')
    return port, match.group(2)


def validate_subdomain(subdomain):
    if not SUBDOMAIN_RE.match(subdomain or '') or subdomain.lower() in RESERVED_VHOSTS:
        raise AgentError('invalid subdomain')
    return subdomain


def validate_port(value):
    if not re.fullmatch(r'[1-9][0-9]{4}', value or ''):
        raise AgentError('invalid port')
    port = int(value)
    if not 11001 <= port <= 65535:
        raise AgentError('port out of range')
    return port


def within(path, root):
    path, root = os.path.realpath(path), os.path.realpath(root)
    return os.path.commonpath([path, root]) == root and path != root


def validate_definition(raw, config=CONFIG):
    try:
        definition = json.loads(raw)
    except ValueError as error:
        raise AgentError(f'invalid JSON: {error}') from None
    if not isinstance(definition, dict):
        raise AgentError('definition must be an object')
    unknown = set(definition) - {'name', 'script', 'cwd', 'interpreter', 'env'}
    if unknown:
        raise AgentError(f'unknown fields: {sorted(unknown)}')

    name = definition.get('name')
    port, _subdomain = parse_name(name)

    if definition.get('script') != 'server.js':
        raise AgentError('script must be server.js')

    cwd = definition.get('cwd')
    if not isinstance(cwd, str) or not within(cwd, config.ns_versions):
        raise AgentError('cwd is not an installed Nightscout version')
    cwd = os.path.realpath(cwd)
    if not os.path.isfile(os.path.join(cwd, 'server.js')) or not os.path.isfile(os.path.join(cwd, 'package.json')):
        raise AgentError('cwd is not a Nightscout directory')

    interpreter = definition.get('interpreter')
    if not isinstance(interpreter, str) or not within(interpreter, config.node_versions):
        raise AgentError('interpreter is not an installed Node version')
    interpreter_real = os.path.realpath(interpreter)
    relative = os.path.relpath(interpreter_real, os.path.realpath(config.node_versions))
    if not re.fullmatch(r'v[0-9]+\.[0-9]+\.[0-9]+/bin/node', relative) or not os.access(interpreter_real, os.X_OK):
        raise AgentError('interpreter is not an installed Node version')

    env = definition.get('env')
    if not isinstance(env, dict) or not env or len(env) > MAX_ENV_VARS:
        raise AgentError('env must be a non-empty object')
    for key, value in env.items():
        if not ENV_KEY_RE.match(key):
            raise AgentError(f'invalid environment variable name: {key[:40]}')
        if not isinstance(value, str) or len(value) > MAX_ENV_VALUE or '\0' in value:
            raise AgentError(f'invalid value for {key}')
    if env.get('PORT') != str(port):
        raise AgentError('PORT does not match the process name')

    return {'name': name, 'cwd': cwd, 'interpreter': interpreter_real, 'env': env}


# --- PM2 ------------------------------------------------------------------------------------------------------


def pm2(args, config=CONFIG, timeout=120):
    environment = {
        'HOME': '/root',
        'PM2_HOME': config.pm2_home,
        'PATH': f'{os.path.dirname(config.node)}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    }
    try:
        completed = subprocess.run(
            [config.node, config.pm2, *args],
            env=environment,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired:
        raise AgentError(f'pm2 {args[0]} timed out') from None
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout).strip().splitlines()[-3:]
        raise AgentError(f'pm2 {args[0]} failed: {" ".join(detail)}')
    return completed.stdout


def pm2_apps(config=CONFIG):
    output = pm2(['jlist'], config)
    for line in output.splitlines():
        if line.startswith('['):
            apps = json.loads(line)
            return [app for app in apps if not (app.get('pm2_env') or {}).get('pmx_module')]
    raise AgentError('pm2 jlist returned no list')


def op_pm2_list(config=CONFIG):
    result = []
    for app in pm2_apps(config):
        env = app.get('pm2_env') or {}
        monit = app.get('monit') or {}
        if not app.get('name'):
            continue
        result.append(
            {
                'name': app['name'],
                'status': env.get('status'),
                'cpu': monit.get('cpu'),
                'memory': monit.get('memory'),
                'uptime': env.get('pm_uptime'),
            }
        )
    return result


def op_pm2_start(raw_definition, config=CONFIG):
    definition = validate_definition(raw_definition, config)
    name = definition['name']
    if any(app.get('name') == name for app in pm2_apps(config)):
        raise AgentError(f'{name} already exists')

    app = {
        'name': name,
        'script': 'server.js',
        'cwd': definition['cwd'],
        'interpreter': definition['interpreter'],
        'env': {'NODE_ENV': 'production', **definition['env']},
        # As on the main server: discard stdout, keep stderr per instance (rotated by pm2-logrotate)
        'out_file': '/dev/null',
        'error_file': os.path.join(config.error_log_dir, f'{name}.log'),
        'merge_logs': True,
    }
    os.makedirs(config.run_dir, mode=0o700, exist_ok=True)
    descriptor, path = tempfile.mkstemp(prefix=f'{name}.', suffix='.json', dir=config.run_dir)
    try:
        with os.fdopen(descriptor, 'w') as handle:
            json.dump({'apps': [app]}, handle)
        pm2(['start', path], config)
    finally:
        os.unlink(path)

    status = None
    for _ in range(10):
        status = next((a['status'] for a in op_pm2_list(config) if a['name'] == name), None)
        if status == 'online':
            break
        time.sleep(0.5)
    log(f'pm2-start {name}: {status}')
    return {'name': name, 'status': status}


def op_pm2_delete(name, config=CONFIG):
    parse_name(name)
    if not any(app.get('name') == name for app in pm2_apps(config)):
        raise AgentError(f'{name} does not exist')
    pm2(['delete', name], config)
    log(f'pm2-delete {name}')
    return {'name': name}


def op_pm2_save(config=CONFIG):
    statuses = [(app.get('pm2_env') or {}).get('status') for app in pm2_apps(config)]
    online = sum(1 for status in statuses if status == 'online')
    healthy = bool(statuses) and online / len(statuses) >= SAVE_MIN_ONLINE_RATIO
    if healthy:
        pm2(['save'], config)
    log(f'pm2-save: {online}/{len(statuses)} online, saved={healthy}')
    return {'saved': healthy, 'online': online, 'total': len(statuses)}


# --- nginx ----------------------------------------------------------------------------------------------------


def vhost_names(config=CONFIG):
    return sorted(
        entry
        for entry in os.listdir(config.sites_available)
        if SUBDOMAIN_RE.match(entry) and entry.lower() not in RESERVED_VHOSTS
    )


def nginx_test_and_reload(config=CONFIG):
    test = subprocess.run([config.nginx, '-t', '-q'], capture_output=True, text=True, check=False)
    if test.returncode != 0:
        return test.stderr.strip()
    subprocess.run([config.systemctl, 'reload', 'nginx'], capture_output=True, check=True)
    return None


def backup_vhost(subdomain, config=CONFIG):
    source = os.path.join(config.sites_available, subdomain)
    if not os.path.isfile(source):
        return None
    os.makedirs(config.vhost_backup_dir, mode=0o700, exist_ok=True)
    target = os.path.join(config.vhost_backup_dir, f'{subdomain}.{time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())}')
    with open(source, 'rb') as reader, open(target, 'wb') as writer:
        writer.write(reader.read())
    return target


def op_vhost_create(subdomain, port_value, config=CONFIG):
    validate_subdomain(subdomain)
    port = validate_port(port_value)
    with open(os.path.join(config.sites_available, '_template'), encoding='utf-8') as handle:
        template = handle.read()
    content = template.replace('[% subdomain %]', subdomain).replace('[% port %]', str(port))

    available = os.path.join(config.sites_available, subdomain)
    enabled = os.path.join(config.sites_enabled, subdomain)
    previous = None
    if os.path.isfile(available):
        with open(available, encoding='utf-8') as handle:
            previous = handle.read()
        if previous == content and os.path.islink(enabled):
            return {'subdomain': subdomain, 'port': port, 'changed': False}
        backup_vhost(subdomain, config)

    temporary = f'{available}.new'
    with open(temporary, 'w', encoding='utf-8') as handle:
        handle.write(content)
    os.chmod(temporary, 0o644)
    os.replace(temporary, available)
    created_link = False
    if not os.path.islink(enabled):
        os.symlink(available, enabled)
        created_link = True

    error = nginx_test_and_reload(config)
    if error:
        if previous is None:
            os.unlink(available)
        else:
            with open(available, 'w', encoding='utf-8') as handle:
                handle.write(previous)
        if created_link:
            os.unlink(enabled)
        raise AgentError(f'nginx rejected the vhost: {error}')
    log(f'vhost-create {subdomain} -> {port}')
    return {'subdomain': subdomain, 'port': port, 'changed': True}


def op_vhost_delete(subdomain, config=CONFIG):
    validate_subdomain(subdomain)
    available = os.path.join(config.sites_available, subdomain)
    enabled = os.path.join(config.sites_enabled, subdomain)
    if not os.path.isfile(available):
        raise AgentError(f'virtual host {subdomain} does not exist')
    backup = backup_vhost(subdomain, config)
    if os.path.islink(enabled):
        os.unlink(enabled)
    os.unlink(available)
    error = nginx_test_and_reload(config)
    if error:
        raise AgentError(f'nginx test failed after removing the vhost: {error}')
    log(f'vhost-delete {subdomain} (backup {backup})')
    return {'subdomain': subdomain, 'backup': backup}


# --- dispatch -------------------------------------------------------------------------------------------------


def op_ping(config=CONFIG):
    versions = sorted(
        entry
        for entry in os.listdir(config.ns_versions)
        if os.path.isfile(os.path.join(config.ns_versions, entry, 'package.json'))
    )
    return {'hostname': socket.getfqdn(), 'nightscoutVersions': versions}


# operation -> (argument count, needs stdin, mutates state, handler)
OPERATIONS = {
    'ping': (0, False, False, lambda args, stdin, config: op_ping(config)),
    'pm2-list': (0, False, False, lambda args, stdin, config: op_pm2_list(config)),
    'pm2-start': (0, True, True, lambda args, stdin, config: op_pm2_start(stdin, config)),
    'pm2-delete': (1, False, True, lambda args, stdin, config: op_pm2_delete(args[0], config)),
    'pm2-save': (0, False, True, lambda args, stdin, config: op_pm2_save(config)),
    'vhost-list': (0, False, False, lambda args, stdin, config: vhost_names(config)),
    'vhost-create': (2, False, True, lambda args, stdin, config: op_vhost_create(args[0], args[1], config)),
    'vhost-delete': (1, False, True, lambda args, stdin, config: op_vhost_delete(args[0], config)),
}


def run(command_line, stdin_reader, config=CONFIG):
    words = (command_line or '').split()
    if not words or words[0] not in OPERATIONS:
        raise AgentError('unknown operation')
    operation, arguments = words[0], words[1:]
    arg_count, needs_stdin, mutates, handler = OPERATIONS[operation]
    if len(arguments) != arg_count:
        raise AgentError(f'{operation} takes {arg_count} argument(s)')

    stdin = ''
    if needs_stdin:
        stdin = stdin_reader.read(MAX_STDIN + 1)
        if len(stdin) > MAX_STDIN:
            raise AgentError('input too large')

    if not mutates:
        return handler(arguments, stdin, config)

    os.makedirs(os.path.dirname(config.lock_file), exist_ok=True)
    with open(config.lock_file, 'a') as lock:
        deadline = time.monotonic() + 90
        while True:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() > deadline:
                    raise AgentError('another host agent operation is still running') from None
                time.sleep(0.2)
        return handler(arguments, stdin, config)


def main():
    syslog.openlog('nsromania-host-agent', syslog.LOG_PID, syslog.LOG_AUTH)
    if os.geteuid() != 0:
        print(json.dumps({'ok': False, 'error': 'the host agent must run as root'}))
        return 1
    command_line = os.environ.get('SSH_ORIGINAL_COMMAND') or ' '.join(sys.argv[1:])
    try:
        result = run(command_line, sys.stdin, CONFIG)
    except AgentError as error:
        log(f'rejected {command_line.split()[0] if command_line.split() else "<empty>"}: {error}')
        print(json.dumps({'ok': False, 'error': str(error)}))
        return 1
    except Exception as error:  # noqa: BLE001 - report every failure as JSON to the panel
        log(f'failed: {type(error).__name__}: {error}')
        print(json.dumps({'ok': False, 'error': f'{type(error).__name__}: {error}'}))
        return 1
    print(json.dumps({'ok': True, 'result': result}))
    return 0


if __name__ == '__main__':
    sys.exit(main())
