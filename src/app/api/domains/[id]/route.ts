// /src/app/api/domains/[id]/route.ts
import { getNSDomainById } from '@/lib/services/domains';
import { auth } from '@/auth';
import { User } from '@prisma/client';

type Props = {
    params: Promise<{
        id: string
    }>
}

export async function GET(req: Request, props: Props) {
    const params = await props.params
    const { id } = await params;
    const session = await auth();

    if (!session || !session.user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
        });
    }

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