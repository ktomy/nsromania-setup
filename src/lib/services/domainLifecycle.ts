import { NSDomain } from '@/generated/client';
import { PartialNSDomainWithEnvironments } from '@/types/domains';
import { createSubdomain, deleteSubdomain, listSubdomains } from './dnsmanagement';
import { assignServerBeforeInitialization, updateNSDomain } from './domains';
import { createVirtualHost, deleteVirtualHost, getVirtualHosts } from './nginxmanagement';
import { checkMongoDatabaseAndUser, createDatabaseAndUser, deleteDatabaseAndUser } from './nsdatbasea';
import { isDomainRunning, saveProcessListIfHealthy, tryStopDomain } from './nsruntime';
import { getServerIds, serverIdOf } from './servers';

// A refusal the caller should report to the user with the given HTTP status
export class DomainInitializationError extends Error {
    constructor(
        message: string,
        readonly status: number
    ) {
        super(message);
        this.name = 'DomainInitializationError';
    }
}

export interface InitializeDomainOptions {
    // Hosting server chosen by an admin; it can differ from the stored one only while the site has no database
    server?: string;
}

/**
 * Creates the MongoDB database and user, the DNS record and the nginx vhost of a site, on its hosting server. Each
 * step is idempotent, so a failed initialization can be repeated.
 */
export async function initializeDomainInfrastructure(
    domain: NSDomain,
    options: InitializeDomainOptions = {}
): Promise<{ server: string }> {
    let serverId = serverIdOf(domain);
    const requested = options.server;

    if (requested !== undefined && !getServerIds().includes(requested)) {
        throw new DomainInitializationError(`Unknown hosting server: ${requested}`, 400);
    }

    if (requested !== undefined && requested !== serverId) {
        if (domain.dbExists !== 0) {
            throw new DomainInitializationError(
                `The site already has a database on ${serverId}; it can only be moved with a migration`,
                409
            );
        }
        if (await checkMongoDatabaseAndUser(domain.domain, domain.domain, serverId)) {
            throw new DomainInitializationError(
                `A database for this site already exists on ${serverId}; destroy it first or initialize there`,
                409
            );
        }
        if (!(await assignServerBeforeInitialization(domain.id, requested))) {
            throw new DomainInitializationError('The site was initialized meanwhile; reload and try again', 409);
        }
        console.log(`Domain ${domain.domain} placed on ${requested} (was ${serverId})`);
        serverId = requested;
    }

    if (domain.dbExists === 0) {
        await createDatabaseAndUser(domain.domain, domain.apiSecret, serverId);
        await updateNSDomain(domain.id, { dbExists: 1 });
    }

    await createSubdomain(domain.domain, serverId);
    await createVirtualHost(domain.domain, domain.id + 11000, serverId);

    return { server: serverId };
}

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

    const serverId = serverIdOf(domain);

    if (await isDomainRunning(domain)) {
        await tryStopDomain(domain);
        await saveProcessListIfHealthy(serverId);
        result.stopped = true;
    } else {
        console.log('Domain is not running, nothing to stop');
    }

    if ((await getVirtualHosts(serverId)).includes(domain.domain)) {
        await deleteVirtualHost(domain.domain, serverId);
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

    if (await checkMongoDatabaseAndUser(domain.domain, domain.domain, serverId)) {
        await deleteDatabaseAndUser(domain.domain, serverId);
        await updateNSDomain(domain.id, { dbExists: 0 });
        result.databaseDeleted = true;
    } else {
        console.log('Database does not exist, nothing to delete');
    }

    return result;
}
