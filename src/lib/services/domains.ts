import { prisma } from '../prisma'


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