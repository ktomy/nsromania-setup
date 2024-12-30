// /src/app/api/domains/[id]/route.ts
import { getNSDomainById, isMyDOmain, updateNSDomain } from '@/lib/services/domains';
import { auth } from '@/auth';
import { User } from '@prisma/client';
import { GetDomainByIdResponse, PartialNSDomainWithEnvironments } from '@/types/domains';
import { getProcessesList } from '@/lib/services/nsruntime';
import { checkMongoDatabaseAndUser } from '@/lib/services/nsdatbasea';

type Props = {
    params: Promise<{
        id: string
    }>
}

export async function GET(req: Request, props: Props) {
    const params = await props.params
    const { id } = await params;
    const session = await auth();

    if (!session) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
        });
    }

    try {
        const nsDomain = await getNSDomainById(parseInt(id)) as GetDomainByIdResponse;
        if (!nsDomain) {
            return new Response(JSON.stringify({ error: "Not found" }), {
                status: 404,
                headers: { "Content-Type": "application/json" },
            });
        }

        const user = session.user as User;
        //console.log("User:", user);
        if (user.role !== "admin" && nsDomain.authUser?.id !== user.id) {
            return new Response(JSON.stringify({ error: "NS domain not found" }), {
                status: 404,
                headers: { "Content-Type": "application/json" },
            });
        }
        const processList = await getProcessesList();
        // check if a process having the domain name is running and if yes, set "status" field to the process's status
        nsDomain.status = processList.find(proc => proc.name.endsWith(nsDomain.domain))?.status || "not running";
        nsDomain.dbInitialized = await checkMongoDatabaseAndUser(nsDomain.domain, nsDomain.domain);

        return new Response(JSON.stringify(nsDomain), {
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

export async function PUT(req: Request, props: Props) {
    const params = await props.params;
    const { id } = await params;
    const session = await auth();

    if (!session) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
        });
    }

    try {
        if (!isMyDOmain(parseInt(id), session.user as User)) {
            return new Response(JSON.stringify({ error: "Not found" }), {
                status: 404,
                headers: { "Content-Type": "application/json" },
            });
        }

        const body = await req.json() as PartialNSDomainWithEnvironments;
        console.log("Body:", body);
        const updatedDomain = await updateNSDomain(parseInt(id), body);

        return new Response(JSON.stringify(updatedDomain), {
            headers: { "Content-Type": "application/json" },
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "An error occurred";
        console.error("Error updating NS domain:" + message);
        return new Response(
            JSON.stringify({ error: "Failed to update NS domain" }),
            {
                status: 500,
                headers: { "Content-Type": "application/json" },
            }
        );
    }
}