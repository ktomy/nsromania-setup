import { auth } from "@/auth";
import { createSubdomain, deleteSubdomain } from "@/lib/services/dnsmanagement";
import { getNSDomainById, isMyDOmain, updateNSDomain } from "@/lib/services/domains";
import { createVirtualHost, deleteVirtualHost } from "@/lib/services/nginxmanagement";
import { createDatabaseAndUser, deleteDatabaseAndUser } from "@/lib/services/nsdatbasea";
import { tryStartDomain } from "@/lib/services/nsruntime";
import { User } from "@prisma/client";
import { NextRequest } from "next/server";

type Props = {
    params: Promise<{
        id: string
    }>
}

export async function POST(req: NextRequest, props: Props) {
    const session = await auth();
    const params = await props.params
    const { id } = await params;

    if (!session || !session.user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
        });
    }

    if (!isMyDOmain(parseInt(id), session.user as User)) {
        return new Response(JSON.stringify({ error: "Not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
        });
    }

    const domain = await getNSDomainById(parseInt(id));
    if (!domain) {
        return new Response(JSON.stringify({ error: "Something went really wrong" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }

    if (domain.active === 1) {
        return new Response(JSON.stringify({ error: "Domain is active, deactivate first" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
        });
    }

    try {

        await deleteVirtualHost(domain.domain);

        await deleteSubdomain(domain.domain);

        if (domain.dbExists === 1) {
            await deleteDatabaseAndUser(domain.domain);
            updateNSDomain(domain.id, { dbExists: 0 });
        }

        return new Response(JSON.stringify("ok"), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    } catch (error) {
        return new Response(JSON.stringify({ error: "Failed to initialize domain" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }




}