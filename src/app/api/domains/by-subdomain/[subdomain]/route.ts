// /src/app/api/domains/by-subdomain/[subdomain]/route.ts
import { getNSDomainBySubdomain } from '@/lib/services/domains';
import { NextResponse } from 'next/server';

type Props = {
    params: Promise<{
        subdomain: string;
    }>;
};

export async function GET(request: Request, props: Props) {
    const params = await props.params;
    const { subdomain } = await params;

    const domain = await getNSDomainBySubdomain(subdomain);

    if (!domain) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const baseUrl = new URL(
        process.env.NODE_ENV === 'development'
            ? 'http://' + request.headers.get('host'):
        request.headers.get('x-forwarded-proto') +
            '://' +
            request.headers.get('x-forwarded-host') +
            ':' +
            request.headers.get('x-forwarded-port')
    );

    const absoluteUrl = new URL(`/api/domains/${domain.id}`, baseUrl);

    return NextResponse.redirect(absoluteUrl.toString());
}
