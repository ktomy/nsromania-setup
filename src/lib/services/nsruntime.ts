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
                        .filter(proc => proc.name !== undefined)
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

export async function tryStartDomain(domain: PartialNSDomainWithEnvironments): Promise<string> {
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
            let nsHome = process.env.NS_HOME
            if (process.env.NODE_ENV === 'production') {
                if (domain.nsversion !== null) {
                    nsHome += `/${domain.nsversion}/`
                }
            }

            let nsEnvironment: { [key: string]: string; } = {};
            nsEnvironment.ENABLE = domain.enable || '';
            nsEnvironment.SHOW_PLUGINS = domain.showPlugins || '';
            // domain.mmconnectUsername ? nsEnvironment.MMCONNECT_USERNAME = domain.mmconnectUsername : null;
            // domain.mmconnectPassword ? nsEnvironment.MMCONNECT_PASSWORD = domain.mmconnectPassword : null;
            // domain.mmconnectServer ? nsEnvironment.MMCONNECT_SERVER = domain.mmconnectServer : null;
            if (domain.enable?.indexOf('bridge') !== -1) {
                domain.bridgeUsername ? nsEnvironment.BRIDGE_USERNAME = domain.bridgeUsername : null;
                domain.bridgePassword ? nsEnvironment.BRIDGE_PASSWORD = domain.bridgePassword : null;
                domain.bridgeServer ? nsEnvironment.BRIDGE_SERVER = domain.bridgeServer : null;
            }
            nsEnvironment.API_SECRET = domain.apiSecret || '';
            domain.title ? nsEnvironment.CUSTOM_TITLE = domain.title : null;
            nsEnvironment.INSECURE_USE_HTTP = 'true';
            nsEnvironment.LANGUAGE = 'ro';
            nsEnvironment.PORT = (11000 + (domain.id || 999)).toString();
            nsEnvironment.THEME = 'colors';
            nsEnvironment.TIME_FORMAT = "24";

            nsEnvironment.MONGODB_URI = `mongodb://${domain.domain}:${domain.apiSecret}@localhost:27017/${domain.domain}`;

            // add all the variables and values from domain.environments with variable as key and value as value
            domain.environments?.forEach((env) => {
                if (env.variable && env.value) {
                    nsEnvironment[env.variable] = env.value;
                }
            });
            console.log("Environment", nsEnvironment);

            pm2.start({
                name: `11${(domain.id || 999).toString().padStart(3, '0')}_${domain.domain}`,
                script: 'server.js',
                cwd: nsHome,
                env: nsEnvironment,
                interpreter: process.env.NS_NODE_PATH,
            }, (err, proc) => {
                if (err) {
                    reject(err);
                } else {
                    resolve('ok');
                }
            });
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
        });
    });
}