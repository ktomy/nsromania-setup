// /src/app/api/domains/by-subdomain/[subdomain]/route.ts
import { getNSDomainBySubdomain } from '@/lib/services/domains';
import { NextResponse } from 'next/server';

type Props = {
    params: Promise<{
        subdomain: string
    }>
}

export async function GET(request: Request, props: Props) {
    const params = await props.params
    const { subdomain } = await params;

    const domain = await getNSDomainBySubdomain(subdomain);

    if (!domain) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const currentUrl = new URL(request.url);
    const absoluteUrl = new URL(`/api/domains/${domain.id}`, currentUrl.origin);

    return NextResponse.redirect(absoluteUrl.toString());
}