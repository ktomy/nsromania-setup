import { getNSDomainById } from '@/lib/services/domains';
import { isDomainRunning, saveProcessListIfHealthy, tryStopDomain } from '@/lib/services/nsruntime';
import { serverIdOf } from '@/lib/services/servers';
import { authorizeDomainAccess } from '@/lib/services/domainAccess';
import { NextRequest } from 'next/server';

type Props = {
    params: Promise<{
        id: string;
    }>;
};

export async function POST(req: NextRequest, props: Props) {
    const { id } = await props.params;
    const access = await authorizeDomainAccess(id);
    if (!access.ok) {
        return access.response;
    }

    const domain = await getNSDomainById(access.domainId);
    if (!domain) {
        return new Response(JSON.stringify({ error: 'Something went really wrong' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
    try {
        if ((await isDomainRunning(domain)) === false) {
            return new Response(JSON.stringify({ error: 'Domain is not running' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const result = await tryStopDomain(domain);
        if (result === 'ok') {
            await saveProcessListIfHealthy(serverIdOf(domain));
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
