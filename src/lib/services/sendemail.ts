//import { EmailParams, MailerSend, Recipient } from "mailersend";


export async function sendWelcomeEmail(to: string, subdomain: string, api_secret: string): Promise<boolean> {

    console.log("Sending welcome email to: ", to);

    ////////////// SendGrid ///////////////////////
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
        personalizations: [{
            to: [{ email: to }],
            dynamic_template_data: {
                subject: 'Bine ati venit la NSRomania!',
                subdomain: subdomain,
                api_secret: api_secret,
            },
        }]
    };

    const result = await sgMail.send(message);
    if (result[0].statusCode === 202) {
        console.log("Email sent");
        return true;
    } else {
        console.log("Email not sent");
        return false;
    }



    ////////////// Mailchimp ///////////////////////
    // const mailchimpClient = require("@mailchimp/mailchimp_transactional")
    //     (process.env.MAILCHIMP_API_KEY || '');

    // const response = await mailchimpClient.messages.sendTemplate({
    //     template_name: "welcome",
    //     template_content: [
    //         { name: "subdomain", content: subdomain },
    //         { name: "api_secret", content: api_secret }
    //     ],
    //     message: {

    //         to: [{ email: to, type: "to" }],
    //         from_email: "info@nsromania.info",
    //         from_name: "Echipa NSRomania",
    //         subject: "Bine ati venit la NSRomania!",
    //         headers: { "Reply-To": "artiom@gmail.com" },

    //     },
    // });
    // console.log(response);

    // if (response.status === "sent") {
    //     console.log("Email sent");
    //     return true;
    // } else {
    //     console.log("Email not sent");
    //     return false;
    // }


    ////////////// MailerSend ///////////////////////
    // const mailersend = new MailerSend({
    //     apiKey: process.env.MAILERSEND_API_KEY || '',
    // });

    // const recipients = [new Recipient(to)];

    // const personalization = [
    //     {
    //         email: to,
    //         data: {
    //             subdomain: subdomain,
    //             api_secret: api_secret,
    //         }
    //     }];

    // const emailParams = new EmailParams()
    //     .setFrom({ email: "info@nsromania.info", name: "Echipa NSRomania" })
    //     .setReplyTo({ email: "artiom@gmail.com" })
    //     .setTo(recipients)
    //     .setSubject("Bine ati venit la NSRomania!")
    //     .setTemplateId('v69oxl5x1qdg785k')
    //     .setPersonalization(personalization);

    // mailersend.email.send(emailParams);


}