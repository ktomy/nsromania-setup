import { auth } from '@/auth';
import {
    approveRegistrationRequest,
    getRegistrationRequestById,
    rejectRegistrationRequest,
} from '@/lib/services/registration';
import { User } from '@/generated/client';

type Props = {
    params: Promise<{
        id: string;
    }>;
};

export async function GET(req: Request, props: Props) {
    const session = await auth();
    const params = await props.params;
    const { id } = await params;

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

    const request = await getRegistrationRequestById(parseInt(id));

    if (!request) {
        return new Response(JSON.stringify({ error: 'Request not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    return new Response(JSON.stringify(request), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}

export async function POST(req: Request, props: Props) {
    const session = await auth();
    const params = await props.params;
    const { id } = await params;

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

    await approveRegistrationRequest(parseInt(id), user);

    return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}

export async function DELETE(req: Request, props: Props) {
    const session = await auth();
    const params = await props.params;
    const { id } = await params;

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

    await rejectRegistrationRequest(parseInt(id), user);

    return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}
