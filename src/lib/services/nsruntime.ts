import { resolveNightscoutNodeInterpreter } from '@/lib/services/nsnode';
import { PartialNSDomainWithEnvironments } from '@/types/domains';
import { callRemoteAgent } from './remoteagent';
import { getServerIds, isRemoteServer, MAIN_SERVER_ID, serverIdOf } from './servers';

export interface ProcessInfo {
    name: string;
    status?: string;
    cpu?: number;
    memory?: number;
    uptime?: number;
}

async function getLocalProcessesList(): Promise<ProcessInfo[]> {
    // connect to pm2 and get the list of processes, return the list

    const pm2 = await import('pm2');
    return new Promise((resolve, reject) => {
        pm2.connect((err) => {
            if (err) {
                console.error(err);
                pm2.disconnect();
                reject(err);
                return;
            }
            pm2.list((err, list) => {
                if (err) {
                    reject(err);
                } else {
                    const formattedProcesses = list
                        .filter((proc) => proc.name !== undefined)
                        .map((proc) => ({
                            name: proc.name!,
                            status: proc.pm2_env?.status,
                            cpu: proc.monit?.cpu,
                            memory: proc.monit?.memory,
                            uptime: proc.pm2_env?.pm_uptime,
                        }));
                    pm2.disconnect();
                    resolve(formattedProcesses);
                }
            });
        });
    });
}

// PM2 processes of one hosting server (the main server by default)
export async function getProcessesList(serverId: string = MAIN_SERVER_ID): Promise<ProcessInfo[]> {
    if (isRemoteServer(serverId)) {
        return callRemoteAgent<ProcessInfo[]>(serverId, ['pm2-list']);
    }
    return getLocalProcessesList();
}

// PM2 processes of every hosting server. A server that cannot be reached maps to null, so callers can report its
// domains as "unknown" instead of failing the whole page.
export async function getProcessesByServer(): Promise<Map<string, ProcessInfo[] | null>> {
    const serverIds = getServerIds();
    const lists = await Promise.all(
        serverIds.map(async (serverId) => {
            try {
                return await getProcessesList(serverId);
            } catch (error) {
                if (!isRemoteServer(serverId)) {
                    throw error;
                }
                console.error(`Unable to list PM2 processes on ${serverId}:`, error);
                return null;
            }
        })
    );
    return new Map(serverIds.map((serverId, index) => [serverId, lists[index]]));
}

// Status for a domain from getProcessesByServer(): PM2 status, 'not running', or 'unknown' if its server is unreachable
export function domainStatusFrom(
    processesByServer: Map<string, ProcessInfo[] | null>,
    domain: { domain: string; server?: string | null }
): string {
    const processes = processesByServer.get(serverIdOf(domain));
    if (!processes) {
        return 'unknown';
    }
    return processes.find((proc) => proc.name.endsWith(`_${domain.domain}`))?.status || 'not running';
}

type DomainRef = { domain?: string; server?: string | null };

export async function isDomainRunning(domain: DomainRef): Promise<boolean> {
    return (await getProcessesList(serverIdOf(domain))).some((proc) => proc.name.endsWith(`_${domain.domain}`));
}

// Status of the domain's PM2 process, or undefined when PM2 has no process for it
export async function getDomainProcessStatus(domain: DomainRef): Promise<string | undefined> {
    const proc = (await getProcessesList(serverIdOf(domain))).find((p) => p.name.endsWith(`_${domain.domain}`));
    return proc ? proc.status || 'unknown' : undefined;
}

export function domainProcessName(domain: PartialNSDomainWithEnvironments): string {
    return `11${(domain.id || 999).toString().padStart(3, '0')}_${domain.domain}`;
}

// Minimum share of online apps required before the PM2 process list may be saved.
// A degraded list (e.g. right after an interrupted resurrect) must never replace a good dump.
export const SAVE_MIN_ONLINE_RATIO = 0.9;

export function isProcessListHealthy(statuses: (string | undefined)[]): boolean {
    if (statuses.length === 0) {
        return false;
    }
    const online = statuses.filter((status) => status === 'online').length;
    return online / statuses.length >= SAVE_MIN_ONLINE_RATIO;
}

// Persist the PM2 process list (dump.pm2) so reboots resurrect the current set of sites.
// Never throws: a failed save must not fail the start/stop that preceded it.
export async function saveProcessListIfHealthy(serverId: string = MAIN_SERVER_ID): Promise<boolean> {
    if (isRemoteServer(serverId)) {
        try {
            const result = await callRemoteAgent<{ saved: boolean }>(serverId, ['pm2-save']);
            return result.saved;
        } catch (error) {
            console.error(`Failed to save PM2 process list on ${serverId}:`, error);
            return false;
        }
    }
    try {
        const pm2 = await import('pm2');
        return await new Promise<boolean>((resolve, reject) => {
            pm2.connect((err) => {
                if (err) {
                    pm2.disconnect();
                    reject(err);
                    return;
                }
                pm2.list((err, list) => {
                    if (err) {
                        pm2.disconnect();
                        reject(err);
                        return;
                    }
                    const apps = list.filter(
                        (proc) => !(proc.pm2_env as { pmx_module?: boolean } | undefined)?.pmx_module
                    );
                    const statuses = apps.map((proc) => proc.pm2_env?.status);
                    if (!isProcessListHealthy(statuses)) {
                        const online = statuses.filter((status) => status === 'online').length;
                        console.warn(`Not saving PM2 process list: only ${online}/${apps.length} apps online`);
                        pm2.disconnect();
                        resolve(false);
                        return;
                    }
                    pm2.dump((err) => {
                        pm2.disconnect();
                        if (err) {
                            reject(err);
                        } else {
                            resolve(true);
                        }
                    });
                });
            });
        });
    } catch (error) {
        console.error('Failed to save PM2 process list:', error);
        return false;
    }
}

export interface NightscoutProcessDefinition {
    name: string;
    script: 'server.js';
    cwd: string;
    env: { [key: string]: string };
    interpreter: string;
}

// PM2 definition of a domain's Nightscout process. Remote servers mirror the main server's NS_HOME and Node paths, so
// the directory and interpreter resolved here are valid there too (the host agent verifies them before starting).
export async function buildDomainProcess(
    domain: PartialNSDomainWithEnvironments
): Promise<NightscoutProcessDefinition> {
    let nsHome = process.env.NS_HOME;
    if (!nsHome) {
        throw new Error('NS_HOME environment variable is not set');
    }

    if (process.env.NODE_ENV === 'production') {
        if (domain.nsversion !== null) {
            nsHome += `/${domain.nsversion}/`;
        } else {
            nsHome += '/master/';
        }
    }
    const interpreter = await resolveNightscoutNodeInterpreter(nsHome);

    let nsEnvironment: { [key: string]: string } = {};
    nsEnvironment.ENABLE = domain.enable || '';
    nsEnvironment.SHOW_PLUGINS = domain.showPlugins || '';
    // domain.mmconnectUsername ? nsEnvironment.MMCONNECT_USER_NAME = domain.mmconnectUsername : null;
    // domain.mmconnectPassword ? nsEnvironment.MMCONNECT_PASSWORD = domain.mmconnectPassword : null;
    // domain.mmconnectServer ? nsEnvironment.MMCONNECT_SERVER = domain.mmconnectServer : null;
    if (domain.enable?.indexOf('bridge') !== -1) {
        domain.bridgeUsername ? (nsEnvironment.BRIDGE_USER_NAME = domain.bridgeUsername) : null;
        domain.bridgePassword ? (nsEnvironment.BRIDGE_PASSWORD = domain.bridgePassword) : null;
        domain.bridgeServer ? (nsEnvironment.BRIDGE_SERVER = domain.bridgeServer) : null;
    }
    nsEnvironment.API_SECRET = domain.apiSecret || '';
    domain.title ? (nsEnvironment.CUSTOM_TITLE = domain.title) : null;
    nsEnvironment.INSECURE_USE_HTTP = 'true';
    nsEnvironment.LANGUAGE = 'ro';
    nsEnvironment.PORT = (11000 + (domain.id || 999)).toString();
    nsEnvironment.THEME = 'colors';
    nsEnvironment.TIME_FORMAT = '24';
    // Nightscout closes pooled MongoDB connections idle for 30 s, but reloads data every 60 s, so each
    // reload re-authenticates its whole pool (~1,400 SCRAM logins/min across the server). Keep pooled
    // connections for 10 minutes instead. A per-domain environment value overrides this default.
    nsEnvironment.MONGO_MAX_IDLE_TIME_MS = '600000';

    let connectionStringInVariables = false;

    // add all the variables and values from domain.environments with variable as key and value as value
    domain.environments?.forEach((env) => {
        if (env.variable && env.value) {
            if (env.variable === 'MONGODB_URI' || env.variable === 'MONGO_CONNECTION') {
                connectionStringInVariables = true;
            }
            nsEnvironment[env.variable] = env.value;
        }
    });

    // Every server runs its own MongoDB on loopback, so the same URI is valid wherever the instance is hosted
    if (!connectionStringInVariables) {
        nsEnvironment.MONGODB_URI = `mongodb://${domain.domain}:${encodeURIComponent(domain.apiSecret || '')}@localhost:27017/${domain.domain}`;
    }

    return {
        name: domainProcessName(domain),
        script: 'server.js',
        cwd: nsHome,
        env: nsEnvironment,
        interpreter,
    };
}

export async function tryStartDomain(domain: PartialNSDomainWithEnvironments): Promise<string> {
    const definition = await buildDomainProcess(domain);
    const serverId = serverIdOf(domain);

    if (isRemoteServer(serverId)) {
        await callRemoteAgent(serverId, ['pm2-start'], definition, 120_000);
        console.log(`Started domain ${domain.domain} on ${serverId}`);
        return 'ok';
    }

    // connect to pm2 and start the domain
    const pm2 = await import('pm2');
    return new Promise((resolve, reject) => {
        pm2.connect((err) => {
            if (err) {
                console.error(err);
                pm2.disconnect();
                reject(err);
                return;
            }

            pm2.start(definition, (err, proc) => {
                if (err) {
                    reject(err);
                } else {
                    resolve('ok');
                }
            });
            console.log(`Started domain ${domain.domain}`);
        });
    });
}

export async function tryStopDomain(domain: PartialNSDomainWithEnvironments): Promise<string> {
    const serverId = serverIdOf(domain);
    if (isRemoteServer(serverId)) {
        await callRemoteAgent(serverId, ['pm2-delete', domainProcessName(domain)]);
        console.log(`Stopped domain ${domain.domain} on ${serverId}`);
        return 'ok';
    }

    // connect to pm2 and stop the domain
    const pm2 = await import('pm2');
    return new Promise((resolve, reject) => {
        pm2.connect((err) => {
            if (err) {
                console.error(err);
                pm2.disconnect();
                reject(err);
                return;
            }
            pm2.delete(domainProcessName(domain), (err, proc) => {
                if (err) {
                    reject(err);
                } else {
                    resolve('ok');
                }
            });
            console.log(`Stopped domain ${domain.domain}`);
        });
    });
}

// Replace a PM2 process that exists but is not online (stopped/errored) with a fresh one from the DB config
export async function tryRecreateDomain(domain: PartialNSDomainWithEnvironments): Promise<string> {
    await tryStopDomain(domain);
    return tryStartDomain(domain);
}
