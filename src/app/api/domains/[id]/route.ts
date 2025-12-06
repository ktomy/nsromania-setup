// /src/app/api/domains/[id]/route.ts
import { getFullDOmainData, isMyDOmain, updateNSDomain } from '@/lib/services/domains';
import { auth } from '@/auth';
import { User } from '@/generated/client';
import {  PartialNSDomainWithEnvironments } from '@/types/domains';

type Props = {
    params: Promise<{
        id: string;
    }>;
};

export async function GET(req: Request, props: Props) {
    const params = await props.params;
    const { id } = await params;
    const session = await auth();

    if (!session) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    try {
        const nsDomain = await getFullDOmainData(parseInt(id));
        if (!nsDomain) {
            return new Response(JSON.stringify({ error: 'Not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const user = session.user as User;
        //console.log("User:", user);
        if (user.role !== 'admin' && nsDomain.authUser?.id !== user.id) {
            return new Response(JSON.stringify({ error: 'NS domain not found' }), {
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
    const params = await props.params;
    const { id } = await params;
    const session = await auth();

    if (!session) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    try {
        if (!isMyDOmain(parseInt(id), session.user as User)) {
            return new Response(JSON.stringify({ error: 'Not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const body = (await req.json()) as PartialNSDomainWithEnvironments;
        console.log('Body:', body);
        const updatedDomain = await updateNSDomain(parseInt(id), body);

        return new Response(JSON.stringify(updatedDomain), {
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'An error occurred';
        console.error('Error updating NS domain:' + message);
        return new Response(JSON.stringify({ error: 'Failed to update NS domain' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}
