import { getNSDomainBySubdomain } from '@/lib/services/domains';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function GET(req: NextRequest, { params }: { params: { subdomain: string } }) {
    const subdomain = params.subdomain;
    const domain = await getNSDomainBySubdomain(subdomain);

    if (!domain) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const absoluteUrl = new URL(`/api/domains/${domain.id}`, req.nextUrl.origin);

    return NextResponse.redirect(absoluteUrl.toString());
}