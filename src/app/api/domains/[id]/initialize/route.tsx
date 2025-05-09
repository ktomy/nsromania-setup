import { auth } from '@/auth';
import { createSubdomain } from '@/lib/services/dnsmanagement';
import { getNSDomainById, isMyDOmain, updateNSDomain } from '@/lib/services/domains';
import { createVirtualHost } from '@/lib/services/nginxmanagement';
import { createDatabaseAndUser } from '@/lib/services/nsdatbasea';
import { User } from '@prisma/client';
import { NextRequest } from 'next/server';

type Props = {
    params: Promise<{
        id: string;
    }>;
};

export async function POST(req: NextRequest, props: Props) {
    const session = await auth();
    const params = await props.params;
    const { id } = await params;

    if (!session || !session.user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    if (!isMyDOmain(parseInt(id), session.user as User)) {
        return new Response(JSON.stringify({ error: 'Not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const domain = await getNSDomainById(parseInt(id));
    if (!domain) {
        console.error('Domain not found');
        return new Response(JSON.stringify({ error: 'Something went really wrong' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    if (domain.active === 0) {
        return new Response(JSON.stringify({ error: 'Domain is not active, activate first' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    try {
        if (domain.dbExists === 0) {
            await createDatabaseAndUser(domain.domain, domain.apiSecret);
            updateNSDomain(domain.id, { dbExists: 1 });
        }

        await createSubdomain(domain.domain);

        await createVirtualHost(domain.domain, domain.id + 11000);

        return new Response(JSON.stringify('ok'), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) {
        console.error('Failed to initialize domain', error);
        return new Response(JSON.stringify({ error: 'Failed to initialize domain' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}
