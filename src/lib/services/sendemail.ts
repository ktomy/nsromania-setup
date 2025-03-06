//import { EmailParams, MailerSend, Recipient } from "mailersend";

export async function sendWelcomeEmail(to: string, subdomain: string, api_secret: string): Promise<boolean> {
    console.log('Sending welcome email to: ', to);

    const sgMail = require('@sendgrid/mail');
    sgMail.setApiKey(process.env.SENDGRID_API_KEY || '');

    const message = {
        from: {
            email: 'info@nsromania.info',
            name: 'Echipa NSRomania',
        },
        reply_to: {
            email: 'artiom+nsromania@gmail.com',
            name: 'Echipa NSRomania',
        },
        template_id: 'd-48ae487d34f04dd494b270435769fc57',
        personalizations: [
            {
                to: [{ email: to }],
                dynamic_template_data: {
                    subject: 'Bine ati venit la NSRomania!',
                    subdomain: subdomain,
                    api_secret: api_secret,
                },
            },
        ],
    };

    const result = await sgMail.send(message);
    if (result[0].statusCode === 202) {
        console.log('Email sent');
        return true;
    } else {
        console.log('Email not sent');
        return false;
    }
}

export async function sendValidationEmail(to: string, token: string): Promise<boolean> {
    console.log('Sending email verification email to: ', to);
    const sgMail = require('@sendgrid/mail');
    sgMail.setApiKey(process.env.SENDGRID_API_KEY || '');

    const message = {
        from: {
            email: 'info@nsromania.info',
            name: 'Echipa NSRomania',
        },
        reply_to: {
            email: 'artiom+nsromania@gmail.com',
            name: 'Echipa NSRomania',
        },
        template_id: 'd-9195de0b48ad4a29831743197374746d',
        personalizations: [
            {
                to: [{ email: to }],
                dynamic_template_data: {
                    subject: 'Validare adresa de e-mail',
                    token: token,
                },
            },
        ],
    };

    const result = await sgMail.send(message);
    if (result[0].statusCode === 202) {
        console.log('Email sent');
        return true;
    } else {
        console.log('Email not sent');
        return false;
    }
}
