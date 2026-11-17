import { deleteNSDomainAndRelated, getNSDomainById } from '@/lib/services/domains';
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

    if (domain.active === 1) {
        return new Response(JSON.stringify({ error: 'Domain is active, deactivate first' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    try {
        console.log('Deleting domain from the database:', domain.domain);
        await deleteNSDomainAndRelated(domain.id);

        return new Response(JSON.stringify('ok'), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) {
        console.error('Destroying domain error: ', error);
        return new Response(JSON.stringify({ error: 'Failed to initialize domain' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}
