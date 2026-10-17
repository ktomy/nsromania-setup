import { getAllNSDomains, getNSDomainById } from '@/lib/services/domains';
import { auth } from '@/auth';
import { NSDomain, User } from '@/generated/client';
import { NextRequest } from 'next/server';
import {
    getProcessesList,
    saveProcessListIfHealthy,
    tryRecreateDomain,
    tryStartDomain,
} from '@/lib/services/nsruntime';

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
    const processes = await getProcessesList();
    const domainsWithStatus = activeDomains.map((domain) => ({
        ...domain,
        status: processes?.find((p) => p.name.endsWith('_' + domain.domain))?.status || 'not running',
    }));

    await Promise.all(
        domainsWithStatus
            .filter((domain) => !['online', 'launching'].includes(domain.status))
            .map(async (domain) => {
                const fullDomain = await getNSDomainById(domain.id);
                if (!fullDomain) {
                    return Promise.resolve();
                }
                // PM2 keeps stopped/errored processes in its list; recreate those instead of starting a duplicate
                if (domain.status === 'not running') {
                    return tryStartDomain(fullDomain);
                }
                return tryRecreateDomain(fullDomain);
            })
    );

    await saveProcessListIfHealthy();

    return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' },
    });
}
