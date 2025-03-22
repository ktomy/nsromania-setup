import { NextRequest } from 'next/server';
import { initiateEmailValidation } from '@/lib/services/registration';
import { validateCaptcha } from '@/lib/services/recaptcha';

export async function POST(req: NextRequest) {
    const { email, token } = await req.json();

    // if email does not like like an email (reges validation) or token is small or empty, return an error
    if (!email || !token || !email.match(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/) || token.length < 10) {
        return new Response(JSON.stringify({ error: 'Invalid email or token' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    if (process.env.NODE_ENV !== 'development' && !(await validateCaptcha(token))) {
        return new Response(JSON.stringify({ message: 'Failed to verify' }), {
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
        return new Response(JSON.stringify({ error: 'Failed to initialize email validation' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}
