// /src/app/api/domains/by-subdomain/[subdomain]/route.ts
import { auth } from '@/auth';
import { getNSDomainBySubdomain } from '@/lib/services/domains';
import { NextResponse } from 'next/server';

type Props = {
    params: Promise<{
        subdomain: string;
    }>;
};

// Used by the registration request pages, which are for admins only
export async function GET(request: Request, props: Props) {
    const session = await auth();
    if (session?.user?.role !== 'admin') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const params = await props.params;
    const { subdomain } = await params;

    const domain = await getNSDomainBySubdomain(subdomain);

    if (!domain) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Relative, so request headers (X-Forwarded-Host) cannot turn this into a redirect to another site
    return new NextResponse(null, { status: 307, headers: { Location: `/api/domains/${domain.id}` } });
}
