import { auth } from '@/auth';
import { User } from '@/generated/client';
import { isMyDOmain } from './domains';

export type DomainAccess = { ok: true; user: User; domainId: number } | { ok: false; response: Response };

function errorResponse(error: string, status: number): Response {
    return new Response(JSON.stringify({ error }), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

// Ids are positive MySQL INT values; anything else cannot be a site
const DOMAIN_ID_PATTERN = /^[1-9][0-9]{0,8}$/;

/**
 * Authorization for every per-site API route (/api/domains/[id]/...): the signed-in user must own the site or be an
 * admin. Routes call this before reading or changing anything. Other users get 404, the same answer as for a site
 * that does not exist, so site ids cannot be probed.
 */
export async function authorizeDomainAccess(id: string): Promise<DomainAccess> {
    const session = await auth();
    if (!session?.user) {
        return { ok: false, response: errorResponse('Unauthorized', 401) };
    }

    const user = session.user as User;
    if (!DOMAIN_ID_PATTERN.test(id)) {
        return { ok: false, response: errorResponse('Not found', 404) };
    }

    const domainId = Number(id);
    if (!(await isMyDOmain(domainId, user))) {
        return { ok: false, response: errorResponse('Not found', 404) };
    }

    return { ok: true, user, domainId };
}

export function isAdmin(user: User): boolean {
    return user.role === 'admin';
}
