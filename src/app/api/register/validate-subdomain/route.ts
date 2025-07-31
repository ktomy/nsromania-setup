import { NextRequest } from 'next/server';
import { validateSubdomain } from '@/lib/services/registration';
import { validateCaptcha } from '@/lib/services/recaptcha';
import { validateSubdomainRequestSchema } from '@/lib/validations';
import { hasLocale } from 'next-intl';
import { locales } from '@/i18n/config';
import { getTranslations } from 'next-intl/server';

export async function POST(req: NextRequest) {
    // Setting up the translation
    const locale = req.headers.get('accept-language') ?? '';

    if (!hasLocale(locales, locale)) {
        return new Response(JSON.stringify({ error: 'Invalid locale' }), {
            status: 400,
        });
    }

    const t = await getTranslations({ locale, namespace: 'RegisterPage' });

    // Parsing the request body
    const body = await req.json();

    const parsed = validateSubdomainRequestSchema(t).safeParse(body);

    if (!parsed.success) {
        // Return the first validation error message
        return new Response(JSON.stringify({ error: parsed.error.issues[0].message }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }
    const { token, subdomain } = parsed.data;

    if (!(await validateCaptcha(token))) {
        return new Response(JSON.stringify({ error: t('errors.reCAPTCHA.failed') }), {
            status: 405,
        });
    }

    if (!(await validateSubdomain(subdomain))) {
        return new Response(JSON.stringify({ error: t('errors.subdomain.taken') }), {
            status: 409,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}
