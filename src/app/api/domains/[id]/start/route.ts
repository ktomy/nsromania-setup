import { auth } from '@/auth';
import { getNSDomainById, isMyDOmain } from '@/lib/services/domains';
import { isDomainRunning, tryStartDomain } from '@/lib/services/nsruntime';
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

    if (await isDomainRunning(domain.domain)) {
        return new Response(JSON.stringify({ error: 'Domain is already running' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    try {
        const result = await tryStartDomain(domain);
        if (result === 'ok') {
            return new Response(JSON.stringify({ message: 'Domain started' }), {
                headers: { 'Content-Type': 'application/json' },
            });
        } else {
            return new Response(JSON.stringify({ error: result }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
            });
        }
    } catch (error) {
        console.error('Error starting domain:', error);
        return new Response(JSON.stringify({ error: 'Failed to start domain' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}
