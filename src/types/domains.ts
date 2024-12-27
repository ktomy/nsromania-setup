import { NSDomain, NSDomainEnvironment, User } from "@prisma/client";

export interface GetDomainByIdResponse extends NSDomain {
    environments?: NSDomainEnvironment[];
    authUser?: User;
    status: string,
    dbInitialized: boolean,
}