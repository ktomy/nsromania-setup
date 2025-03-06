import { getAllNSDomains, getNSDomainsByUserId, createNSDomain, getNSDomainById } from '@/lib/services/domains';
import { auth } from '@/auth';
import { NSDomain, User } from '@prisma/client';
import { NextRequest } from 'next/server';
import { getProcessesList, tryStartDomain } from '@/lib/services/nsruntime';

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
            .filter((domain) => domain.status === 'not running')
            .map(async (domain) => {
                const fullDomain = await getNSDomainById(domain.id);
                if (fullDomain) {
                    return tryStartDomain(fullDomain);
                }
                return Promise.resolve();
            })
    );

    return new Response(JSON.stringify({ success: true }), {
        headers: { 'Content-Type': 'application/json' },
    });
}
