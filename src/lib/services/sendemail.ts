import { EmailParams, MailerSend, Recipient } from "mailersend";


export async function sendWelcomeEmail(to: string, subdomain: string, api_secret: string) {

    const mailersend = new MailerSend({
        apiKey: process.env.MAILERSEND_API_KEY || '',
    });

    const recipients = [new Recipient(to)];

    const personalization = [
        {
            email: to,
            data: {
                subdomain: subdomain,
                api_secret: api_secret,
            }
        }];

    const emailParams = new EmailParams()
        .setFrom({ email: "info@nsromania.info", name: "Echipa NSRomania" })
        .setReplyTo({ email: "artiom@gmail.com" })
        .setTo(recipients)
        .setSubject("Bine ati venit la NSRomania!")
        .setTemplateId('v69oxl5x1qdg785k')
        .setPersonalization(personalization);

    mailersend.email.send(emailParams);
}