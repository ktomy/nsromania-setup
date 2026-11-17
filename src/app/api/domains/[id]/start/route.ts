import { getNSDomainById } from '@/lib/services/domains';
import {
    getDomainProcessStatus,
    saveProcessListIfHealthy,
    tryRecreateDomain,
    tryStartDomain,
} from '@/lib/services/nsruntime';
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

    if (domain.active === 0) {
        return new Response(JSON.stringify({ error: 'Domain is not active, activate first' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const processStatus = await getDomainProcessStatus(domain);
    if (processStatus === 'online' || processStatus === 'launching') {
        return new Response(JSON.stringify({ error: 'Domain is already running' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    try {
        // A stopped/errored PM2 process still occupies the name; recreate it from the current config
        const result = processStatus ? await tryRecreateDomain(domain) : await tryStartDomain(domain);
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
