import { CreateDomainRequest, GetDomainByIdResponse, PartialNSDomainWithEnvironments } from '@/types/domains';
import { prisma } from '../prisma';
import { getProcessesList } from './nsruntime';
import { getDefaultServerForNewDomains, isRemoteServer, serverIdOf } from './servers';
import { NSDomain, User } from '@/generated/client';
import { checkMongoDatabaseAndUser, getDbSize, getLastDbEntry } from './nsdatbasea';

export async function getAllNSDomains() {
    try {
        const domains = await prisma.nSDomain.findMany();
        return domains;
    } catch (error) {
        console.error('Error fetching NSDomains:', error);
        throw error;
    } finally {
        await prisma.$disconnect();
    }
}

export async function getNSDomainBySubdomain(subdomain: string) {
    const domain = prisma.nSDomain.findFirst({
        where: {
            domain: subdomain,
        },
    });

    return domain;
}

export async function getNSDomainById(id: number) {
    const domain = prisma.nSDomain.findFirst({
        where: {
            id: id,
        },
        include: {
            environments: true,
            authUser: true,
        },
    });

    return domain;
}

export async function getNSDomainsByUserId(id: string) {
    const domains = prisma.nSDomain.findMany({
        where: {
            authUserId: id,
        },
        include: {
            environments: true,
            authUser: true,
        },
    });

    return domains;
}

export async function getFullDOmainData(id: number): Promise<GetDomainByIdResponse | null> {
    const nsDomain = await getNSDomainById(id) as GetDomainByIdResponse;
    if (!nsDomain) {
        return null;
    }
    const serverId = serverIdOf(nsDomain);
    const processList = await getProcessesList(serverId);
    // check if a process having the domain name is running and if yes, set "status" field to the process's status
    nsDomain.status =
        processList.find((proc) => proc.name.endsWith(`_${nsDomain.domain}`))?.status || 'not running';
    nsDomain.dbInitialized = await checkMongoDatabaseAndUser(nsDomain.domain, nsDomain.domain, serverId);
    nsDomain.lastDbEntry = await getLastDbEntry(nsDomain.domain, serverId);
    nsDomain.dbSize = await getDbSize(nsDomain.domain, serverId);
    return nsDomain;
}

export async function createNSDomain(data: CreateDomainRequest) {
    if (data.ownerEmail == null) {
        throw new Error('Owner is required');
    }
    if (data.domain == null) {
        throw new Error('SubDomain is required');
    }
    if (data.apiSecret == null) {
        throw new Error('API Secret is required');
    }
    if (data.enable == null) {
        throw new Error('Enable field is required');
    }
    if (data.showPlugins == null) {
        throw new Error('Show Plugins field is required');
    }

    const existingDomain = await prisma.nSDomain.findUnique({
        where: {
            domain: data.domain,
        },
    });

    if (existingDomain) {
        throw new Error('Domain name already exists');
    }

    let user = await prisma.user.findUnique({
        where: {
            email: data.ownerEmail,
        },
    });

    if (!user) {
        // create new user record with email and name
        const newUser = await prisma.user.create({
            data: {
                email: data.ownerEmail,
                name: data.ownerName,
                role: 'user',
                loginAllowed: 1,
            },
        });
        user = newUser;
    }

    const domain = prisma.nSDomain.create({
        data: {
            domain: data.domain,
            authUserId: user.id,
            port: data.port ?? 0,
            title: data.title || 'Nightscout',
            apiSecret: data.apiSecret,
            enable: data.enable,
            showPlugins: data.showPlugins,
            mmconnectUsername: data.mmconnectUsername,
            mmconnectPassword: data.mmconnectPassword,
            mmconnectServer: data.mmconnectServer,
            bridgeUsername: data.bridgeUsername,
            bridgePassword: data.bridgePassword,
            bridgeServer: data.bridgeServer,
            dbPassword: data.dbPassword,
            nsversion: data.nsversion,
            // Never taken from the request: non-admin users can create domains too
            server: getDefaultServerForNewDomains(),
            active: data.active,
            dbExists: data.dbExists,
            environments: data.environments
                ? {
                      create: data.environments.map((env) => ({
                          variable: env.variable || '',
                          value: env.value || null,
                      })),
                  }
                : undefined,
        },
        include: {
            environments: true,
        },
    });

    return domain;
}

export async function isMyDOmain(domainId: number, user: User) {
    if (user == null) {
        return false;
    }
    if (user.role === 'admin') {
        return true;
    }
    // A missing id would drop the owner condition from the query below and match any site
    if (typeof user.id !== 'string' || user.id === '') {
        return false;
    }

    const domain = await prisma.nSDomain.findFirst({
        where: {
            id: domainId,
            authUserId: user.id,
        },
    });

    return !!domain;
}

// Places a site that has no database yet on another hosting server. The condition is part of the update, so a site
// that got initialized meanwhile keeps its server; moving an initialized site means copying its data
// (ops/servers/migrate-instance.sh). Returns whether the site was updated.
export async function assignServerBeforeInitialization(id: number, serverId: string): Promise<boolean> {
    const result = await prisma.nSDomain.updateMany({
        where: { id, dbExists: 0 },
        data: { server: isRemoteServer(serverId) ? serverId : null },
    });
    return result.count === 1;
}

// Records whether the site's MongoDB database and user exist; set by initialization and destroy only
export async function setDomainDbExists(id: number, dbExists: 0 | 1) {
    return prisma.nSDomain.update({
        where: { id },
        data: { dbExists },
    });
}

export async function updateNSDomain(id: number, data: PartialNSDomainWithEnvironments) {
    try {
        // MySQL refreshes last_updated whenever the row changes (ON UPDATE CURRENT_TIMESTAMP); set it explicitly too,
        // so that a save which only changes environment variables (another table) also counts as an edit
        const updateData: Partial<NSDomain> = { lastUpdated: new Date() };

        if (data.domain) updateData.domain = data.domain;
        if (data.authUserId) updateData.authUserId = data.authUserId;
        if (data.title) updateData.title = data.title;
        if (data.apiSecret) updateData.apiSecret = data.apiSecret;
        if (data.enable) updateData.enable = data.enable;
        if (data.showPlugins) updateData.showPlugins = data.showPlugins;
        if (data.mmconnectUsername) updateData.mmconnectUsername = data.mmconnectUsername;
        if (data.mmconnectPassword) updateData.mmconnectPassword = data.mmconnectPassword;
        if (data.mmconnectServer) updateData.mmconnectServer = data.mmconnectServer;
        if (data.bridgeUsername) updateData.bridgeUsername = data.bridgeUsername;
        if (data.bridgePassword) updateData.bridgePassword = data.bridgePassword;
        if (data.bridgeServer) updateData.bridgeServer = data.bridgeServer;
        if (data.dbPassword) updateData.dbPassword = data.dbPassword;
        if (data.nsversion) updateData.nsversion = data.nsversion;
        if (data.active !== undefined) updateData.active = data.active; // as it can be 0
        // dbExists is not editable here: it records whether initialization created the database and changes only
        // through setDomainDbExists (initialize/destroy). The edit form used to send 0 and reset it on every save.

        const updatedDomain = await prisma.nSDomain.update({
            where: { id },
            data: updateData,
        });

        if (data.environments == null) {
            return updatedDomain;
        }

        await prisma.nSDomainEnvironment.deleteMany({
            where: { nsDomainId: id },
        });

        for (const env of data.environments) {
            if (env.value != null) {
                await prisma.nSDomainEnvironment.create({
                    data: {
                        nsDomainId: id,
                        variable: env.variable || '',
                        value: env.value,
                    },
                });
            }
        }

        return updatedDomain;
    } catch (error) {
        console.error('Error updating NSDomain:', error);
        throw error;
    } finally {
        await prisma.$disconnect();
    }
}

export async function deleteNSDomainAndRelated(id: number) {
    try {
        let result = await prisma.nSDomainEnvironment.deleteMany({
            where: { nsDomainId: id },
        });
        console.log(`Deleted ${result.count} NSDomainEnvironment records for NSDomain ID ${id}`);

        // is it the only domain of the user?
        const domain = await prisma.nSDomain.findUnique({
            where: { id },
        });
        if (domain && domain.authUserId) {
            const user = await prisma.user.findUnique({
                where: { id: domain.authUserId },
            });
            if (user != null && user.role !== 'admin') {
            
                const userDomains = await prisma.nSDomain.findMany({
                    where: { authUserId: domain.authUserId },
                });
                if (userDomains.length === 1) {
                    // delete the user as well
                    const result1 = await prisma.account.deleteMany({
                        where: { userId: domain.authUserId },
                    });
                    const result2 = await prisma.authenticator.deleteMany({
                        where: { userId: domain.authUserId },
                    });
                    const result3 = await prisma.session.deleteMany({
                        where: { userId: domain.authUserId },
                    });
                    const result9 = await prisma.user.delete({
                        where: { id: domain.authUserId },
                    });
                    console.log(`Deleted User ID ${domain.authUserId} as it had only this domain, deleted rows: ${result ? 1 : 0}`);

                    // is there a related request? delete that one as well
                    let deleteRequestResult = await prisma.register_request.deleteMany({
                        where: { subdomain: domain.domain },
                    });
                    console.log(`Deleted ${deleteRequestResult.count} register_request records for subdomain ${domain.domain}`);
                }
            }
        }

        let domainSeleteResult = await prisma.nSDomain.delete({
            where: { id },
        });
        console.log(`Deleted NSDomain ID ${id}, deleted rows: ${domainSeleteResult ? 1 : 0}`);


    } catch (error) {
        console.error('Error deleting NSDomain and related records:', error);
        throw error;
    } finally {
        await prisma.$disconnect();
    }
}
