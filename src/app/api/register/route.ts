import { validateCaptcha } from '@/lib/services/recaptcha';
import {
    createRegistrationRequest,
    getAllRegistrationRequests,
    validateEmail,
    validateSubdomain,
} from '@/lib/services/registration';
import { auth } from '@/auth';
import { User } from '@prisma/client';
import { hasLocale } from 'next-intl';
import { locales } from '@/i18n/config';
import { getTranslations } from 'next-intl/server';
import { serverRegistrationRequestSchema } from '@/lib/validations';
import z from 'zod';

export async function POST(req: Request) {
    // email should look like an email, token should be long enough
    // domain should be an alphanumeric string of 2 to 16 characters, can only contain dashes, lowecase letters and numbers
    // data source can only be "Dexcom" or "API"
    // name can only contain letters and spaces
    // API secret should be a string of 12 characters

    // Setting up the translation
    const locale = req.headers.get('accept-language') ?? '';
    if (!hasLocale(locales, locale)) {
        return new Response(JSON.stringify({ error: 'Invalid locale' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }
    const t = await getTranslations({ locale, namespace: 'RegisterPage' });

    const body = await req.json();

    // Validate the request body using the Zod schema
    const parsed = serverRegistrationRequestSchema(t).safeParse(body);

    if (!parsed.success) {
        return new Response(JSON.stringify({ zodErrors: z.flattenError(parsed.error) }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const registrationRequest = parsed.data;

    console.log('Registration request:', registrationRequest);

    if (process.env.NODE_ENV !== 'development' && !(await validateCaptcha(registrationRequest.reCAPTCHAToken))) {
        return new Response(JSON.stringify({ error: t('errors.reCAPTCHA.failed') }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    if (!(await validateEmail(registrationRequest.ownerEmail, registrationRequest.emailVerificationToken))) {
        return new Response(JSON.stringify({ error: t('emailValidationCodeInvalid') }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    if (!(await validateSubdomain(registrationRequest.domain))) {
        return new Response(JSON.stringify({ error: t('subDomainAlreadyInUse') }), {
            status: 409,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    if (await createRegistrationRequest(registrationRequest)) {
        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } else {
        return new Response(JSON.stringify({ error: t('registrationFailed') }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function GET(_req: Request) {
    const session = await auth();

    if (!session || !session.user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const user = session.user as User;
    if (user.role !== 'admin') {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const registrationRequests = await getAllRegistrationRequests();

    return new Response(JSON.stringify(registrationRequests), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}
