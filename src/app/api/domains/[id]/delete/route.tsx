import { auth } from '@/auth';
import { deleteNSDomainAndRelated, getNSDomainById, isMyDOmain, updateNSDomain } from '@/lib/services/domains';
import { User } from '@/generated/client';
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
