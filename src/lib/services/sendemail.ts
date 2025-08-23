import { RegisterDomainRequest } from '@/types/domains';
import * as fs from 'fs/promises';
import * as path from 'path';

// Brevo (Sendinblue) transactional email API client
import Brevo from '@getbrevo/brevo';

// Basic singleton client so we don't re-init for every email
let brevoClient: Brevo.TransactionalEmailsApi | null = null;

function getClient() {
    if (!brevoClient) {
        brevoClient = new Brevo.TransactionalEmailsApi();
        brevoClient.setApiKey(Brevo.TransactionalEmailsApiApiKeys.apiKey, process.env.BREVO_API_KEY || '');
    }
    return brevoClient;
}

function renderTemplate(html: string, variables: Record<string, string | number | undefined>) {
    // Supports {{var}} or {{{var}}}
    return html.replace(/\{\{\{?\s*(\w+)\s*\}?\}\}/g, (_, key) => {
        const val = variables[key];
        return val === undefined || val === null ? '' : String(val);
    });
}

async function loadTemplate(templateName: string): Promise<string> {
    const filePath = path.join(process.cwd(), 'emails', `${templateName}.html`);
    return fs.readFile(filePath, 'utf8');
}

interface SendEmailOptions {
    to: { email: string; name?: string }[];
    subject: string;
    template: string; // template file name without extension
    variables: Record<string, string | number | undefined>;
    from?: { email: string; name?: string };
    replyTo?: { email: string; name?: string };
}

async function sendEmailViaBrevo(opts: SendEmailOptions): Promise<boolean> {
    try {
        if (!process.env.BREVO_API_KEY) {
            console.warn('BREVO_API_KEY is not set');
        }
        const htmlRaw = await loadTemplate(opts.template);
        const html = renderTemplate(htmlRaw, opts.variables);

        const client = getClient();
        await client.sendTransacEmail({
            to: opts.to.map((t) => ({ email: t.email, name: t.name })),
            subject: opts.subject,
            htmlContent: html,
            sender: opts.from || { email: 'info@nsromania.info', name: 'Echipa NSRomania' },
            replyTo: opts.replyTo || { email: 'artiom+nsromania@gmail.com', name: 'Echipa NSRomania' },
        });
        console.log('Email sent via Brevo:', opts.subject);
        return true;
    } catch (e) {
        console.error('Failed to send email via Brevo', e);
        return false;
    }
}

export async function sendWelcomeEmail(to: string, subdomain: string, api_secret: string): Promise<boolean> {
    return sendEmailViaBrevo({
        to: [{ email: to }],
        subject: 'Bine ati venit la NSRomania!',
        template: 'welcome',
        variables: { subdomain, api_secret },
    });
}

export async function sendValidationEmail(to: string, token: string): Promise<boolean> {
    return sendEmailViaBrevo({
        to: [{ email: to }],
        subject: 'Validare adresa de e-mail',
        template: 'email_validation',
        variables: { token },
    });
}

export async function sendSignInEmail(email: string, url: string) {
    await sendEmailViaBrevo({
        to: [{ email }],
        subject: 'Intrare in cont NSRomania',
        template: 'sign_in',
        variables: { url },
        from: { email: 'login@nsromania.info', name: 'NSRomania' },
    });
}

export async function sendRegistrationNotificationEmail(
    request: RegisterDomainRequest,
    adminEmails: { name: string; email: string }[]
) {
    await sendEmailViaBrevo({
        to: adminEmails,
        subject: 'Notificare cerere inregistrare NSRomania',
        template: 'registration_notification',
        variables: {
            subdomain: request.domain,
            ownerName: request.ownerName,
            ownerEmail: request.ownerEmail,
            dataSource: request.dataSource,
            title: request.title,
            requestId: request.id,
        },
        from: { email: 'notifications@nsromania.info', name: 'NSRomania' },
    });
}
