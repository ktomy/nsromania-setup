import { getNSDomainById } from '@/lib/services/domains';
import { authorizeDomainAccess, isAdmin } from '@/lib/services/domainAccess';
import { DomainInitializationError, initializeDomainInfrastructure } from '@/lib/services/domainLifecycle';
import { NextRequest } from 'next/server';

type Props = {
    params: Promise<{
        id: string;
    }>;
};

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

// Optional body: { "server": "<hosting server id>" } (admins only). Without it the site's stored server is used.
async function readRequestedServer(req: NextRequest): Promise<{ server?: string } | null> {
    const text = await req.text();
    if (text.trim() === '') {
        return {};
    }
    try {
        const body = JSON.parse(text) as unknown;
        if (body === null || typeof body !== 'object' || Array.isArray(body)) {
            return null;
        }
        const server = (body as { server?: unknown }).server;
        if (server === undefined) {
            return {};
        }
        return typeof server === 'string' ? { server } : null;
    } catch {
        return null;
    }
}

export async function POST(req: NextRequest, props: Props) {
    const { id } = await props.params;
    const access = await authorizeDomainAccess(id);
    if (!access.ok) {
        return access.response;
    }

    const request = await readRequestedServer(req);
    if (request === null) {
        return jsonResponse({ error: 'Invalid request body' }, 400);
    }
    if (request.server !== undefined && !isAdmin(access.user)) {
        return jsonResponse({ error: 'Only admins can choose the hosting server' }, 403);
    }

    const domain = await getNSDomainById(access.domainId);
    if (!domain) {
        console.error('Domain not found');
        return jsonResponse({ error: 'Something went really wrong' }, 500);
    }

    if (domain.active === 0) {
        return jsonResponse({ error: 'Domain is not active, activate first' }, 400);
    }

    try {
        const result = await initializeDomainInfrastructure(domain, { server: request.server });
        return jsonResponse({ status: 'ok', server: result.server });
    } catch (error) {
        if (error instanceof DomainInitializationError) {
            return jsonResponse({ error: error.message }, error.status);
        }
        console.error('Failed to initialize domain', error);
        return jsonResponse({ error: 'Failed to initialize domain' }, 500);
    }
}
