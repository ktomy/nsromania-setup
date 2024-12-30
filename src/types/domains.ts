import { NSDomain, NSDomainEnvironment, User } from "@prisma/client";

export interface GetDomainByIdResponse extends NSDomain {
    environments?: NSDomainEnvironment[];
    authUser?: User;
    status: string,
    dbInitialized: boolean,
}

export interface PartialNSDomainWithEnvironments extends Partial<NSDomain> {
    environments?: Partial<NSDomainEnvironment>[];
}