import { getAllNSDomains, getNSDomainsByUserId } from '@/lib/services/domains';
import { auth } from '@/auth';
import { NSDomain, User } from '@prisma/client';
import { NextRequest } from 'next/server';
import { create } from 'domain';
//import pm2 from 'pm2';


interface ProcessInfo {
    name: string;
    status?: string;
    cpu?: number;
    memory?: number;
    uptime?: number;
}

const getProcessesList = async (): Promise<ProcessInfo[]> => {
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

export async function GET(req: NextRequest) {
    const session = await auth();

    if (!session || !session.user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
        });
    }
    const user = session.user as User;

    try {
        const nsDomains = user.role === "admin" ?
            await getAllNSDomains() :
            await getNSDomainsByUserId(user.id);
        const processes = await getProcessesList();
        const domainsWithStatus = nsDomains.map(domain => ({
            ...domain,
            status: processes?.find(p => p.name.endsWith("_" + domain.domain))?.status || 'not running'
        }));



        return new Response(JSON.stringify(domainsWithStatus), {
            headers: { "Content-Type": "application/json" },
        });
    } catch (error) {
        console.error("Error fetching NS domains:", error);
        return new Response(
            JSON.stringify({ error: "Failed to fetch NS domains" }),
            {
                status: 500,
                headers: { "Content-Type": "application/json" },
            }
        );
    }

}

// Create new NSDomain

export async function POST(req: NextRequest) {
    const session = await auth();

    if (!session || !session.user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
        });
    }
    const user = session.user as User;
    if (user.role !== "admin") {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
        });
    }

    try {
        const { domain } = await req.json();
        domain.dbExists = false;

        const nsDomain = await createNSDomain(domain);
        return new Response(JSON.stringify(nsDomain), {
            headers: { "Content-Type": "application/json" },
        });
    } catch (error) {
        console.error("Error creating NS domain:", error);
        return new Response(
            JSON.stringify({ error: "Failed to create NS domain" }),
            {
                status: 500,
                headers: { "Content-Type": "application/json" },
            }
        );
    }
}

const createNSDomain = async (domain: NSDomain): Promise<NSDomain> => {
    return createNSDomain(domain);
}