import { NSDomain, NSDomainEnvironment, User } from '@prisma/client';

export interface GetDomainByIdResponse extends NSDomain {
    environments?: NSDomainEnvironment[];
    authUser?: User;
    status: string;
    dbInitialized: boolean;
    dbSize: number | null;
    lastDbEntry: Date | null;
}

export interface PartialNSDomainWithEnvironments extends Partial<NSDomain> {
    environments?: Partial<NSDomainEnvironment>[];
}

export interface CreateDomainRequest extends PartialNSDomainWithEnvironments {
    ownerEmail: string;
    ownerName: string;
}

export interface RegisterDomainRequest {
    domain: string;
    title: string;
    apiSecret: string;
    ownerEmail: string;
    ownerName: string;
    dataSource: string;
    dexcomUsername?: string;
    dexcomPassword?: string;
    dexcomServer?: string;
    emailVerificationToken: string;
    reCAPTCHAToken: string;
    id?: number;
}
