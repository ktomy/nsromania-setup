import { NextRequest } from 'next/server';
import { validateSubdomain } from '@/lib/services/registration';
import { validateCaptcha } from '@/lib/services/recaptcha';
import { validateSubdomainRequestSchema } from '@/lib/validations';

export async function POST(req: NextRequest) {
    const body = await req.json();

    const parsed = validateSubdomainRequestSchema.safeParse(body);

    if (!parsed.success) {
        // Return the first validation error message
        return new Response(JSON.stringify({ error: parsed.error.issues[0].message }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }
    const { token, subdomain } = parsed.data;

    if (!(await validateCaptcha(token))) {
        return new Response(JSON.stringify({ error: 'Failed to verify captcha' }), {
            status: 405,
        });
    }

    if (!(await validateSubdomain(subdomain))) {
        return new Response(JSON.stringify({ error: 'Subdomain is already taken' }), {
            status: 409,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}
