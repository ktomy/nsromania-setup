import { NextRequest, NextResponse } from 'next/server';
import { sendWelcomeEmail, sendValidationEmail, sendSignInEmail } from '@/lib/services/sendemail';
import { sendRegistrationNotificationEmail } from '@/lib/services/sendemail';

declare global {
  // Flag used only for local test endpoint to force real email sending in dev.
  // Defined also in sendemail.ts but redeclared here to satisfy the compiler without casting to any.
  var __forceSendEmails: boolean | undefined; // NOSONAR test utility flag
}

export async function POST(req: NextRequest) {

// This should work only on a dev server
if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
}

    const body = await req.json().catch(() => ({}));
  const { type = 'welcome', to = process.env.TEST_EMAIL_TO || 'test@example.com' } = body;

  let ok = false;
  // Allow forcing real email send in development: { force: true }
  if (process.env.NODE_ENV === 'development' && body.force) {
    globalThis.__forceSendEmails = true;
  }
  if (type === 'welcome') {
    ok = await sendWelcomeEmail(to, body.subdomain || 'demo', body.api_secret || 'secret');
  } else if (type === 'validation') {
    ok = await sendValidationEmail(to, body.token || '123456');
  } else if (type === 'signin') {
    await sendSignInEmail(to, body.url || 'https://nsromania.info/auth/callback');
    ok = true;
  } else if (type === 'registration') {
    const registrationRequest = {
      domain: body.subdomain || 'demo',
      ownerName: body.ownerName || 'Owner',
      ownerEmail: body.ownerEmail || to,
      dataSource: body.dataSource || 'xdrip',
      title: body.title || 'Demo Site',
      apiSecret: 'dummy',
      emailVerificationToken: 'token',
      reCAPTCHAToken: 'captcha',
      id: body.requestId || 9999
    } as unknown as Parameters<typeof sendRegistrationNotificationEmail>[0];
    await sendRegistrationNotificationEmail(registrationRequest, [{ email: to, name: 'Admin' }]);
    ok = true;
  }

  // Clear force flag to avoid affecting other requests
  if (globalThis.__forceSendEmails) {
    delete globalThis.__forceSendEmails;
  }

  return NextResponse.json({ sent: ok, type, forced: !!body.force });
}

export const GET = () => NextResponse.json({ usage: 'POST { type: welcome|validation|signin|registration, to?:string, force?:boolean }' });
