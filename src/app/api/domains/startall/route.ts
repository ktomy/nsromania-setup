import { getAllNSDomains, getNSDomainById } from '@/lib/services/domains';
import { auth } from '@/auth';
import { NSDomain, User } from '@/generated/client';
import { NextRequest } from 'next/server';
import {
    domainStatusFrom,
    getProcessesByServer,
    saveProcessListIfHealthy,
    tryRecreateDomain,
    tryStartDomain,
} from '@/lib/services/nsruntime';
import { getServerIds, isRemoteServer, serverIdOf } from '@/lib/services/servers';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function POST(req: NextRequest) {
    const session = await auth();

    if (!session || !session.user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const user = session.user as User;
    if (user.role !== 'admin') {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const activeDomains = (await getAllNSDomains()).filter((d: NSDomain) => d.active);
    const processesByServer = await getProcessesByServer();
    const domainsWithStatus = activeDomains.map((domain) => ({
        ...domain,
        status: domainStatusFrom(processesByServer, domain),
    }));

    // 'unknown' means the domain's server could not be reached; leave those alone
    const toStart = domainsWithStatus.filter((domain) => !['online', 'launching', 'unknown'].includes(domain.status));
    const startDomain = async (domain: (typeof toStart)[number]) => {
        const fullDomain = await getNSDomainById(domain.id);
        if (!fullDomain) {
            return;
        }
        // PM2 keeps stopped/errored processes in its list; recreate those instead of starting a duplicate
        if (domain.status === 'not running') {
            await tryStartDomain(fullDomain);
        } else {
            await tryRecreateDomain(fullDomain);
        }
    };

    // Local starts run in parallel as before; remote ones go one at a time per server, as each is an SSH session
    const remoteServers = getServerIds().filter(isRemoteServer);
    await Promise.all([
        ...toStart.filter((domain) => !isRemoteServer(serverIdOf(domain))).map(startDomain),
        ...remoteServers.map(async (serverId) => {
            for (const domain of toStart.filter((candidate) => serverIdOf(candidate) === serverId)) {
                try {
                    await startDomain(domain);
                } catch (error) {
                    console.error(`Failed to start ${domain.domain} on ${serverId}:`, error);
                }
            }
        }),
    ]);

    for (const serverId of getServerIds()) {
        await saveProcessListIfHealthy(serverId);
    }

    return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' },
    });
}
