import { spawn } from 'child_process';
import { getRemoteServer } from './servers';

// Calls the restricted host agent on a remote hosting server over SSH.
//
// The agent key on the remote server carries a forced command, so the arguments below are only the agent operation
// (passed to it as SSH_ORIGINAL_COMMAND) and never reach a shell. Host keys are pinned in NS_SERVERS_SSH_KNOWN_HOSTS
// and strict checking is always on. The agent answers with one JSON object: {"ok": true, "result": ...} or
// {"ok": false, "error": "..."}.

const DEFAULT_TIMEOUT_MS = 60_000;
const ARG_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;

export class RemoteAgentError extends Error {
    constructor(
        message: string,
        readonly serverId: string
    ) {
        super(message);
        this.name = 'RemoteAgentError';
    }
}

export function buildSshArguments(serverId: string, args: string[]): string[] {
    const server = getRemoteServer(serverId);
    const identity = process.env.NS_SERVERS_SSH_IDENTITY;
    const knownHosts = process.env.NS_SERVERS_SSH_KNOWN_HOSTS;
    if (!identity || !knownHosts) {
        throw new RemoteAgentError('NS_SERVERS_SSH_IDENTITY and NS_SERVERS_SSH_KNOWN_HOSTS must be set', serverId);
    }
    for (const arg of args) {
        if (!ARG_PATTERN.test(arg)) {
            throw new RemoteAgentError(`Invalid host agent argument: ${arg}`, serverId);
        }
    }

    return [
        '-F',
        '/dev/null',
        '-T',
        '-i',
        identity,
        '-o',
        'IdentitiesOnly=yes',
        '-o',
        `UserKnownHostsFile=${knownHosts}`,
        '-o',
        'GlobalKnownHostsFile=/dev/null',
        '-o',
        'StrictHostKeyChecking=yes',
        '-o',
        'BatchMode=yes',
        '-o',
        'ConnectTimeout=10',
        '-o',
        'ServerAliveInterval=15',
        '-o',
        'ServerAliveCountMax=3',
        // Everything after the destination is the remote command (the agent's SSH_ORIGINAL_COMMAND)
        '--',
        server.sshTarget,
        ...args,
    ];
}

export async function callRemoteAgent<T>(
    serverId: string,
    args: string[],
    input?: unknown,
    timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<T> {
    const sshArgs = buildSshArguments(serverId, args);

    const { code, stdout, stderr } = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
        (resolve, reject) => {
            const child = spawn(process.env.NS_SERVERS_SSH_BINARY || '/usr/bin/ssh', sshArgs, {
                stdio: ['pipe', 'pipe', 'pipe'],
                // Minimal environment: the panel's secrets must not leak into the ssh client process
                env: { NODE_ENV: process.env.NODE_ENV, PATH: '/usr/bin:/bin', HOME: process.env.HOME || '/root' },
            });
            const stdoutChunks: Buffer[] = [];
            const stderrChunks: Buffer[] = [];
            const timer = setTimeout(() => {
                child.kill('SIGTERM');
                reject(new RemoteAgentError(`Host agent ${args[0]} timed out after ${timeoutMs} ms`, serverId));
            }, timeoutMs);

            child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
            child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
            child.on('error', (error) => {
                clearTimeout(timer);
                reject(new RemoteAgentError(`Unable to run ssh: ${error.message}`, serverId));
            });
            child.on('close', (exitCode) => {
                clearTimeout(timer);
                resolve({
                    code: exitCode,
                    stdout: Buffer.concat(stdoutChunks).toString('utf8'),
                    stderr: Buffer.concat(stderrChunks).toString('utf8'),
                });
            });

            child.stdin.on('error', () => {
                // The agent may exit before reading stdin (e.g. a rejected command); the exit status reports why
            });
            child.stdin.end(input === undefined ? '' : JSON.stringify(input));
        }
    );

    let response: { ok?: boolean; result?: T; error?: string } | undefined;
    try {
        response = JSON.parse(stdout.trim().split('\n').pop() || '');
    } catch {
        response = undefined;
    }

    if (code === 0 && response?.ok === true) {
        return response.result as T;
    }

    const reason = response?.error || stderr.trim().split('\n').slice(-3).join(' ') || `exit code ${code}`;
    throw new RemoteAgentError(`Host agent ${args[0]} on ${serverId} failed: ${reason}`, serverId);
}
