
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