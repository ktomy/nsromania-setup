import { NextRequest } from 'next/server';
import { validateEmail } from '@/lib/services/registration';
import { validateCaptcha } from '@/lib/services/recaptcha';
import { getTranslations } from 'next-intl/server';
import { hasLocale } from 'next-intl';
import { locales } from '@/i18n/config';
import { validateVerificationCodeRequestSchema } from '@/lib/validations';

export async function POST(req: NextRequest) {
    // Setting up the translation
    const locale = req.headers.get('accept-language') ?? '';

    if (!hasLocale(locales, locale)) {
        return new Response(JSON.stringify({ error: 'Invalid locale' }), {
            status: 400,
        });
    }

    const t = await getTranslations({ locale, namespace: 'RegisterPage' });

    // Validate the request body against the schema
    const body = await req.json();
    const parsed = validateVerificationCodeRequestSchema(t).safeParse(body);

    if (!parsed.success) {
        return new Response(JSON.stringify({ error: parsed.error.issues[0].message }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const { email, token, code } = parsed.data;

    if (!(await validateCaptcha(token))) {
        return new Response(JSON.stringify({ error: t('errors.reCAPTCHA.failed') }), {
            status: 405,
        });
    }

    if (!(await validateEmail(email, code))) {
        return new Response(JSON.stringify({ error: t('emailValidationCodeInvalid') }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}
