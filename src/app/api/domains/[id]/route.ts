import { NextApiRequest } from 'next';
import { getNSDomainById } from '@/lib/services/domains';
import { auth } from '@/auth';
import { User } from '@prisma/client';


export async function GET(req: NextApiRequest, { params }: { params: { id: string } }) {
    const session = await auth();

    if (!session || !session.user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
        });
    }

    const { id } = await params;
    try {
        const nsDomains = await getNSDomainById(parseInt(id));
        if (!nsDomains) {
            return new Response(JSON.stringify({ error: "NS domain not found" }), {
                status: 404,
                headers: { "Content-Type": "application/json" },
            });
        }

        const user = session.user as User;


        if (user.role !== "admin" && nsDomains.authUser?.id !== user.id) {
            return new Response(JSON.stringify({ error: "NS domain not found" }), {
                status: 404,
                headers: { "Content-Type": "application/json" },
            });
        }
        return new Response(JSON.stringify(nsDomains), {
            headers: { "Content-Type": "application/json" },
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "An error occurred";
        console.error("Error fetching NS domains:" + message);
        return new Response(
            JSON.stringify({ error: "Failed to fetch NS domains" }),
            {
                status: 500,
                headers: { "Content-Type": "application/json" },
            }
        );
    }

}