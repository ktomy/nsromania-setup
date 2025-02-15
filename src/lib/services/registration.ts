import { prisma } from '../prisma'
import { NSDomain, User } from '@prisma/client'
import { sendValidationEmail } from './sendemail';
import { RegisterDomainRequest } from '@/types/domains';

export async function initiateEmailValidation(email: string) {
    // generate a validation code, save it to the database, send an email to the user
    // return the validation code


    const validationCode = Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
    const result = await prisma.register_email_validation.create({
        data: {
            email_address: email,
            validation_code: validationCode,
        }
    });

    sendValidationEmail(email, validationCode);

    return true;
}

export async function validateEmail(email: string, validationCode: string) {
    // check if the validation code is correct

    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);


    const validation = await prisma.register_email_validation.findFirst({
        where: {
            email_address: email,
            validation_code: validationCode,
            sent_at: {
                gte: tenMinutesAgo
            }
        }
    });

    if (validation) {
        return true;
    }

    return false;
}

export async function createRegistrationRequest(request: RegisterDomainRequest): Promise<boolean> {
    const registrationRequest = await prisma.register_request.create({
        data: {
            owner_name: request.ownerName,
            owner_email: request.ownerEmail,
            subdomain: request.domain,
            api_secret: request.apiSecret,
            title: request.title,
            data_source: request.dataSource,
            dexcom_server: request.dexcomServer,
            dexcom_username: request.dexcomUsername,
            dexcom_password: request.dexcomPassword,
            status: 'pending',
        }
    });

    return true;
}