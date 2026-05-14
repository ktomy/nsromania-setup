import { auth } from '@/auth';
import { User } from '@/generated/client';
import { actionInactiveUsers } from '@/lib/services/maintenance';
import { NextRequest } from 'next/server';
import { parseMaintenanceActionRequest } from '../validation';

export async function POST(req: NextRequest) {
    const session = await auth();

    if (!session || !session.user || (session.user as User).role !== 'admin') {
        return json({ error: 'Unauthorized' }, 401);
    }

    try {
        const options = await parseMaintenanceActionRequest(req);
        const result = await actionInactiveUsers(options);
        return json(result);
    } catch (error) {
        return json({ error: error instanceof Error ? error.message : 'Invalid request' }, 400);
    }
}

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}
