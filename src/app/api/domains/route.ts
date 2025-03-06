import { getAllNSDomains, getNSDomainsByUserId, createNSDomain } from '@/lib/services/domains';
import { auth } from '@/auth';
import { User } from '@prisma/client';
import { NextRequest } from 'next/server';
import { getProcessesList } from '@/lib/services/nsruntime';
import { CreateDomainRequest } from '@/types/domains';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function GET(req: NextRequest) {
    const session = await auth();

    if (!session || !session.user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
        });
    }
    const user = session.user as User;

    try {
        const nsDomains = user.role === "admin" ?
            await getAllNSDomains() :
            await getNSDomainsByUserId(user.id);
        const processes = await getProcessesList();
        const domainsWithStatus = nsDomains.map(domain => ({
            ...domain,
            status: processes?.find(p => p.name.endsWith("_" + domain.domain))?.status || 'not running'
        }));



        return new Response(JSON.stringify(domainsWithStatus), {
            headers: { "Content-Type": "application/json" },
        });
    } catch (error) {
        console.error("Error fetching NS domains:", error);
        return new Response(
            JSON.stringify({ error: "Failed to fetch NS domains" }),
            {
                status: 500,
                headers: { "Content-Type": "application/json" },
            }
        );
    }

}

// Create new NSDomain

export async function POST(req: NextRequest) {
    const session = await auth();

    if (!session || !session.user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
        });
    }

    const user = session.user as User;
    if (user.role !== "admin") {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
        });
    }

    try {
        const { domain } = await req.json() as { domain: CreateDomainRequest };;
        console.log("Domain:", domain);
        domain.dbExists = 0;

        const nsDomain = await createNSDomain(domain);
        return new Response(JSON.stringify(nsDomain), {
            headers: { "Content-Type": "application/json" },
        });
    } catch (error: unknown) {
        if (error instanceof Error && error.message === 'Domain name already exists') {
            return new Response(
                JSON.stringify({ error: "Domain name already exists" }),
                {
                    status: 400,
                    headers: { "Content-Type": "application/json" },
                }
            );
        }

        console.error("Error creating NS domain:", error);
        return new Response(
            JSON.stringify({ error: "Failed to create NS domain" }),
            {
                status: 500,
                headers: { "Content-Type": "application/json" },
            }
        );
    }
}