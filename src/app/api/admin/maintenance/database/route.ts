import { auth } from '@/auth';
import { User } from '@/generated/client';
import { getDatabaseMaintenanceSites, trimDatabaseForSites } from '@/lib/services/maintenance';
import { NextRequest } from 'next/server';

export async function GET() {
    const session = await auth();
    if (!session || !session.user || (session.user as User).role !== 'admin') {
        return json({ error: 'Unauthorized' }, 401);
    }

    try {
        return json(await getDatabaseMaintenanceSites());
    } catch (error) {
        return json({ error: error instanceof Error ? error.message : 'Unable to read database sizes' }, 500);
    }
}

export async function POST(req: NextRequest) {
    const session = await auth();
    if (!session || !session.user || (session.user as User).role !== 'admin') {
        return json({ error: 'Unauthorized' }, 401);
    }

    try {
        const body = await req.json();
        const days = body?.days;
        const siteIds = body?.siteIds;
        if (![30, 90, 180].includes(days)) {
            throw new Error('days must be 30, 90, or 180');
        }
        if (!Array.isArray(siteIds) || !siteIds.every((siteId: unknown) => Number.isInteger(siteId))) {
            throw new Error('siteIds must be an array of integers');
        }

        return json(await trimDatabaseForSites({ days, siteIds }));
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
