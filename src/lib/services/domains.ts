import { PartialNSDomainWithEnvironments } from '@/types/domains';
import { prisma } from '../prisma'
import { NSDomain, User } from '@prisma/client'


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

export async function getNSDomainById(id: number) {
    const domain = prisma.nSDomain.findFirst({
        where: {
            id: id,
        },
        include: {
            environments: true,
            authUser: true
        }
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
            authUser: true
        }
    });

    return domains;
}

export async function createNSDomain(data: NSDomain) {
    const existingDomain = await prisma.nSDomain.findUnique({
        where: {
            domain: data.domain,
        },
    });

    if (existingDomain) {
        throw new Error('Domain name already exists');
    }

    const domain = prisma.nSDomain.create({
        data: {
            ...data
        },
        include: {
            environments: true,
        }
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

    const domain = await prisma.nSDomain.findFirst({
        where: {
            id: domainId,
            authUserId: user.id,
        },
    });

    return !!domain;
}

export async function updateNSDomain(id: number, data: PartialNSDomainWithEnvironments) {
    try {
        const updateData: Partial<NSDomain> = {};

        if (data.domain) updateData.domain = data.domain;
        if (data.authUserId) updateData.authUserId = data.authUserId;
        if (data.active !== undefined) updateData.active = data.active;
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