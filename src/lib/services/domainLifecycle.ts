import { NSDomain } from '@/generated/client';
import { PartialNSDomainWithEnvironments } from '@/types/domains';
import { deleteSubdomain, listSubdomains } from './dnsmanagement';
import { updateNSDomain } from './domains';
import { deleteVirtualHost, getVirtualHosts } from './nginxmanagement';
import { checkMongoDatabaseAndUser, deleteDatabaseAndUser } from './nsdatbasea';
import { isDomainRunning, tryStopDomain } from './nsruntime';

export type DestroyDomainInfrastructureResult = {
    stopped: boolean;
    nginxDeleted: boolean;
    dnsDeleted: boolean;
    databaseDeleted: boolean;
};

export async function destroyDomainInfrastructure(
    domain: PartialNSDomainWithEnvironments | NSDomain
): Promise<DestroyDomainInfrastructureResult> {
    if (!domain.id || !domain.domain) {
        throw new Error('Domain id and name are required');
    }

    const result: DestroyDomainInfrastructureResult = {
        stopped: false,
        nginxDeleted: false,
        dnsDeleted: false,
        databaseDeleted: false,
    };

    if (await isDomainRunning(domain.domain)) {
        await tryStopDomain(domain);
        result.stopped = true;
    } else {
        console.log('Domain is not running, nothing to stop');
    }

    if ((await getVirtualHosts()).includes(domain.domain)) {
        await deleteVirtualHost(domain.domain);
        result.nginxDeleted = true;
    } else {
        console.log('Virtual host does not exist, nothing to delete');
    }

    if ((await listSubdomains()).includes(domain.domain)) {
        await deleteSubdomain(domain.domain);
        result.dnsDeleted = true;
    } else {
        console.log('Subdomain does not exist, nothing to delete');
    }

    if (await checkMongoDatabaseAndUser(domain.domain, domain.domain)) {
        await deleteDatabaseAndUser(domain.domain);
        await updateNSDomain(domain.id, { dbExists: 0 });
        result.databaseDeleted = true;
    } else {
        console.log('Database does not exist, nothing to delete');
    }

    return result;
}
