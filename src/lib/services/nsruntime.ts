import { resolveNightscoutNodeInterpreter } from '@/lib/services/nsnode';
import { PartialNSDomainWithEnvironments } from '@/types/domains';

interface ProcessInfo {
    name: string;
    status?: string;
    cpu?: number;
    memory?: number;
    uptime?: number;
}

export async function getProcessesList(): Promise<ProcessInfo[]> {
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

export async function isDomainRunning(domain: string): Promise<boolean> {
    return (await getProcessesList()).some((proc) => proc.name.endsWith(`_${domain}`));
}

// Status of the domain's PM2 process, or undefined when PM2 has no process for it
export async function getDomainProcessStatus(domain: string): Promise<string | undefined> {
    const proc = (await getProcessesList()).find((p) => p.name.endsWith(`_${domain}`));
    return proc ? proc.status || 'unknown' : undefined;
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
export async function saveProcessListIfHealthy(): Promise<boolean> {
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

export async function tryStartDomain(domain: PartialNSDomainWithEnvironments): Promise<string> {
    // connect to pm2 and start the domain
    const pm2 = await import('pm2');
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

    return new Promise((resolve, reject) => {
        pm2.connect((err) => {
            if (err) {
                console.error(err);
                pm2.disconnect();
                reject(err);
                return;
            }

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

            if (!connectionStringInVariables) {
                nsEnvironment.MONGODB_URI = `mongodb://${domain.domain}:${encodeURIComponent(domain.apiSecret || '')}@localhost:27017/${domain.domain}`;
            }

            // console.log("Environment", nsEnvironment);

            pm2.start(
                {
                    name: `11${(domain.id || 999).toString().padStart(3, '0')}_${domain.domain}`,
                    script: 'server.js',
                    cwd: nsHome,
                    env: nsEnvironment,
                    interpreter,
                },
                (err, proc) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve('ok');
                    }
                }
            );
            console.log(`Started domain ${domain.domain}`);
        });
    });
}

export async function tryStopDomain(domain: PartialNSDomainWithEnvironments): Promise<string> {
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
            pm2.delete(`11${(domain.id || 999).toString().padStart(3, '0')}_${domain.domain}`, (err, proc) => {
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
