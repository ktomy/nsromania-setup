// /src/app/api/domains/[id]/route.ts
import { DomainValidationError, getFullDOmainData, updateNSDomain } from '@/lib/services/domains';
import { authorizeDomainAccess } from '@/lib/services/domainAccess';
import { PartialNSDomainWithEnvironments } from '@/types/domains';

type Props = {
    params: Promise<{
        id: string;
    }>;
};

export async function GET(req: Request, props: Props) {
    const { id } = await props.params;
    const access = await authorizeDomainAccess(id);
    if (!access.ok) {
        return access.response;
    }

    try {
        const nsDomain = await getFullDOmainData(access.domainId);
        if (!nsDomain) {
            return new Response(JSON.stringify({ error: 'Not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        return new Response(JSON.stringify(nsDomain), {
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'An error occurred';
        console.error('Error fetching NS domains:' + message);
        return new Response(JSON.stringify({ error: 'Failed to fetch NS domains' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}

export async function PUT(req: Request, props: Props) {
    const { id } = await props.params;
    const access = await authorizeDomainAccess(id);
    if (!access.ok) {
        return access.response;
    }

    try {
        const body = (await req.json()) as PartialNSDomainWithEnvironments;
        const updatedDomain = await updateNSDomain(access.domainId, body, access.user);

        return new Response(JSON.stringify(updatedDomain), {
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) {
        if (error instanceof DomainValidationError) {
            return new Response(JSON.stringify({ error: error.message }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }
        const message = error instanceof Error ? error.message : 'An error occurred';
        console.error('Error updating NS domain:' + message);
        return new Response(JSON.stringify({ error: 'Failed to update NS domain' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}
