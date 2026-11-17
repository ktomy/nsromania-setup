import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { buildSshArguments, callRemoteAgent } from '../remoteagent';

// A stand-in for /usr/bin/ssh: prints the remote command it received and reacts to it
const FAKE_SSH = `#!/bin/sh
for last; do :; done
input="$(cat)"
case "$last" in
  pm2-list) echo '{"ok": true, "result": [{"name": "11224_ktomy", "status": "online"}]}' ;;
  pm2-start) printf '{"ok": true, "result": %s}\\n' "$input" ;;
  refuse) echo '{"ok": false, "error": "invalid process name"}'; exit 1 ;;
  hang) sleep 5 ;;
  *) echo "ssh: connect to host failed" >&2; exit 255 ;;
esac
`;

describe('remote host agent client', () => {
    const originalEnv = process.env;
    let directory: string;

    beforeAll(async () => {
        directory = await fs.mkdtemp(path.join(os.tmpdir(), 'remoteagent-'));
        await fs.writeFile(path.join(directory, 'ssh'), FAKE_SSH, { mode: 0o755 });
    });

    afterAll(async () => {
        process.env = originalEnv;
        await fs.rm(directory, { recursive: true, force: true });
    });

    beforeEach(() => {
        process.env = {
            ...originalEnv,
            NS_REMOTE_SERVERS: 'd1',
            NS_SERVER_D1_HOSTNAME: 'd1.nsromania.info',
            NS_SERVER_D1_SSH: 'nsagent@31.220.43.162',
            NS_SERVERS_SSH_IDENTITY: '/root/.ssh/nsromania-servers/id_ed25519',
            NS_SERVERS_SSH_KNOWN_HOSTS: '/root/.ssh/nsromania-servers/known_hosts',
            NS_SERVERS_SSH_BINARY: path.join(directory, 'ssh'),
        };
    });

    it('pins host keys and ends options before the destination, so only the operation is the remote command', () => {
        const args = buildSshArguments('d1', ['pm2-delete', '11224_ktomy']);

        expect(args.slice(-4)).toEqual(['--', 'nsagent@31.220.43.162', 'pm2-delete', '11224_ktomy']);
        expect(args).toEqual(expect.arrayContaining(['StrictHostKeyChecking=yes', 'BatchMode=yes']));
        expect(args).toContain('UserKnownHostsFile=/root/.ssh/nsromania-servers/known_hosts');
        expect(args[args.indexOf('-F') + 1]).toBe('/dev/null');
    });

    it('refuses arguments the agent would not accept anyway', () => {
        expect(() => buildSshArguments('d1', ['pm2-delete', 'x; id'])).toThrow('Invalid host agent argument');
        expect(() => buildSshArguments('d1', ['vhost-create', '../etc', '1'])).toThrow('Invalid host agent argument');
        expect(() => buildSshArguments('d9', ['ping'])).toThrow('Unknown hosting server: d9');
    });

    it('requires the key and known hosts configuration', () => {
        delete process.env.NS_SERVERS_SSH_KNOWN_HOSTS;
        expect(() => buildSshArguments('d1', ['ping'])).toThrow('NS_SERVERS_SSH_KNOWN_HOSTS');
    });

    it('returns the agent result and sends input as JSON on stdin', async () => {
        await expect(callRemoteAgent('d1', ['pm2-list'])).resolves.toEqual([{ name: '11224_ktomy', status: 'online' }]);
        await expect(callRemoteAgent('d1', ['pm2-start'], { name: '11224_ktomy' })).resolves.toEqual({
            name: '11224_ktomy',
        });
    });

    it('reports agent refusals, connection failures and timeouts as errors', async () => {
        await expect(callRemoteAgent('d1', ['refuse'])).rejects.toThrow(
            'Host agent refuse on d1 failed: invalid process name'
        );
        await expect(callRemoteAgent('d1', ['ping'])).rejects.toThrow('ssh: connect to host failed');
        await expect(callRemoteAgent('d1', ['hang'], undefined, 300)).rejects.toThrow('timed out after 300 ms');
    });
});
