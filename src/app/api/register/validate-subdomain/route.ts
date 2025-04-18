import { NextRequest } from 'next/server';
import { validateSubdomain } from '@/lib/services/registration';
import { validateCaptcha } from '@/lib/services/recaptcha';

export async function POST(req: NextRequest) {
    const { token, subdomain } = (await req.json()) as { token: string; subdomain: string };

    if (!token || !subdomain || !subdomain.match(/^[a-z0-9]{1,32}$/) || token.length < 10) {
        return new Response(JSON.stringify({ error: 'Invalid subdomain or token' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    if (!(await validateCaptcha(token))) {
        return new Response(JSON.stringify({ message: 'Failed to verify' }), {
            status: 405,
        });
    }

    if (!(await validateSubdomain(subdomain))) {
        return new Response(JSON.stringify({ error: 'Invalid subdomain' }), {
            status: 409,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}
