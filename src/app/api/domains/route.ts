import { getAllNSDomains, getNSDomainsByUserId } from '@/lib/services/domains';
import { auth } from '@/auth';
import { User } from '@prisma/client';
import { NextRequest } from 'next/server';

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
        return new Response(JSON.stringify(nsDomains), {
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