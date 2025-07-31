import { NextRequest } from 'next/server';
import { initiateEmailValidation } from '@/lib/services/registration';
import { validateCaptcha } from '@/lib/services/recaptcha';
import { validateEmailRequestSchema } from '@/lib/validations';
import { getTranslations } from 'next-intl/server';
import { hasLocale } from 'next-intl';
import { locales } from '@/i18n/config';

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

    const parsed = validateEmailRequestSchema(t).safeParse(body);

    if (!parsed.success) {
        return new Response(JSON.stringify({ error: parsed.error.issues[0].message }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const { email, token } = parsed.data;
    if (process.env.NODE_ENV !== 'development' && !(await validateCaptcha(token))) {
        return new Response(JSON.stringify({ error: t('errors.reCAPTCHA.failed') }), {
            status: 405,
        });
    }

    const initiateValidationResult = await initiateEmailValidation(email);

    if (initiateValidationResult) {
        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } else {
        return new Response(JSON.stringify({ error: t('validationEmailFailed') }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}
