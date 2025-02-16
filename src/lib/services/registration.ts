import { prisma } from '../prisma'
import { NSDomain, register_request, User } from '@prisma/client'
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

export async function getAllRegistrationRequests(): Promise<register_request[]> {
    const requests = await prisma.register_request.findMany();
    return requests;
}

export async function approveRegistrationRequest(id: number, approvingUser: User) {
    const request = await prisma.register_request.findUnique({
        where: {
            id: id
        }
    });

    if (!request) {
        return false;
    }

    let user = await prisma.user.findUnique({
        where: {
            email: request!.owner_email
        }
    });

    if (!user) {
        user = await prisma.user.create({
            data: {
                email: request!.owner_email,
                role: 'user',
                name: request!.owner_name,
            }
        });

    }

    let enable = "";
    let showPlugins = "";
    switch (request?.data_source) {
        case "Dexcom":
            enable = "careportal iob cob cage sage rawbg cors dbsize bridge";
            showPlugins = "cob iob sage cage careportal";
            break;
        case "API":
            enable = "careportal iob cob cage sage rawbg cors dbsize";
            showPlugins = "cob iob sage cage careportal";
            break;
        default:
            throw new Error("Invalid data source");
    }

    await prisma.nSDomain.create({
        data: {
            domain: request.subdomain,
            authUserId: user?.id,
            enable: enable,
            showPlugins: showPlugins,
            bridgeServer: request.dexcom_server,
            bridgeUsername: request.dexcom_username,
            bridgePassword: request.dexcom_password,
            apiSecret: request.api_secret,
            active: 1,
            title: request.title!,
            port: 0,
        }
    });

    await prisma.register_request.update({
        where: {
            id: id,
            chnged_by: approvingUser.id,
        },
        data: {
            status: 'approved'
        }
    });
}

export async function rejectRegistrationRequest(id: number, rejectingUser: User) {
    await prisma.register_request.update({
        where: {
            id: id,
            chnged_by: rejectingUser.id,
        },
        data: {
            status: 'rejected'
        }
    });
}