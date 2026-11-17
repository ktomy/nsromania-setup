import { NSDomain } from '@/generated/client';

const mockDeleteSubdomain = jest.fn();
const mockListSubdomains = jest.fn();
const mockUpdateNSDomain = jest.fn();
const mockDeleteVirtualHost = jest.fn();
const mockGetVirtualHosts = jest.fn();
const mockCheckMongoDatabaseAndUser = jest.fn();
const mockDeleteDatabaseAndUser = jest.fn();
const mockIsDomainRunning = jest.fn();
const mockTryStopDomain = jest.fn();
const mockCreateSubdomain = jest.fn();
const mockAssignServerBeforeInitialization = jest.fn();
const mockCreateVirtualHost = jest.fn();
const mockCreateDatabaseAndUser = jest.fn();

jest.mock('../dnsmanagement', () => ({
    createSubdomain: mockCreateSubdomain,
    deleteSubdomain: mockDeleteSubdomain,
    listSubdomains: mockListSubdomains,
}));

jest.mock('../domains', () => ({
    assignServerBeforeInitialization: mockAssignServerBeforeInitialization,
    updateNSDomain: mockUpdateNSDomain,
}));

jest.mock('../nginxmanagement', () => ({
    createVirtualHost: mockCreateVirtualHost,
    deleteVirtualHost: mockDeleteVirtualHost,
    getVirtualHosts: mockGetVirtualHosts,
}));

jest.mock('../nsdatbasea', () => ({
    checkMongoDatabaseAndUser: mockCheckMongoDatabaseAndUser,
    createDatabaseAndUser: mockCreateDatabaseAndUser,
    deleteDatabaseAndUser: mockDeleteDatabaseAndUser,
}));

jest.mock('../nsruntime', () => ({
    isDomainRunning: mockIsDomainRunning,
    tryStopDomain: mockTryStopDomain,
    saveProcessListIfHealthy: jest.fn().mockResolvedValue(true),
}));

const { destroyDomainInfrastructure, initializeDomainInfrastructure, DomainInitializationError } =
    require('../domainLifecycle') as typeof import('../domainLifecycle');

function domain(overrides: Partial<NSDomain> = {}): NSDomain {
    return {
        id: 10,
        active: 0,
        title: 'Site',
        domain: 'cleanup',
        port: 11010,
        dbExists: 1,
        apiSecret: 'secret',
        registrationLocale: 'ro',
        enable: '',
        showPlugins: '',
        mmconnectUsername: null,
        mmconnectPassword: null,
        mmconnectServer: null,
        bridgeUsername: null,
        bridgePassword: null,
        bridgeServer: null,
        created: new Date('2025-01-01T00:00:00.000Z'),
        lastUpdated: new Date('2025-01-01T00:00:00.000Z'),
        dbPassword: null,
        nsversion: null,
        authUserId: null,
        server: null,
        ...overrides,
    };
}

describe('destroyDomainInfrastructure', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockIsDomainRunning.mockResolvedValue(false);
        mockTryStopDomain.mockResolvedValue('ok');
        mockGetVirtualHosts.mockResolvedValue([]);
        mockDeleteVirtualHost.mockResolvedValue(undefined);
        mockListSubdomains.mockResolvedValue([]);
        mockDeleteSubdomain.mockResolvedValue(undefined);
        mockCheckMongoDatabaseAndUser.mockResolvedValue(false);
        mockDeleteDatabaseAndUser.mockResolvedValue(undefined);
        mockUpdateNSDomain.mockResolvedValue({});
    });

    it('stops a running site before deleting nginx, DNS, and Mongo resources', async () => {
        mockIsDomainRunning.mockResolvedValue(true);
        mockGetVirtualHosts.mockResolvedValue(['cleanup']);
        mockListSubdomains.mockResolvedValue(['cleanup']);
        mockCheckMongoDatabaseAndUser.mockResolvedValue(true);

        const result = await destroyDomainInfrastructure(domain());

        expect(mockTryStopDomain).toHaveBeenCalledWith(expect.objectContaining({ domain: 'cleanup' }));
        expect(mockDeleteVirtualHost).toHaveBeenCalledWith('cleanup', 'main');
        expect(mockDeleteSubdomain).toHaveBeenCalledWith('cleanup');
        expect(mockDeleteDatabaseAndUser).toHaveBeenCalledWith('cleanup', 'main');
        expect(mockUpdateNSDomain).toHaveBeenCalledWith(10, { dbExists: 0 });
        expect(result).toEqual({ stopped: true, nginxDeleted: true, dnsDeleted: true, databaseDeleted: true });
        expect(mockTryStopDomain.mock.invocationCallOrder[0]).toBeLessThan(
            mockDeleteVirtualHost.mock.invocationCallOrder[0]
        );
    });

    it('removes nginx and Mongo resources on the hosting server of a remote site', async () => {
        mockIsDomainRunning.mockResolvedValue(true);
        mockGetVirtualHosts.mockResolvedValue(['cleanup']);
        mockListSubdomains.mockResolvedValue(['cleanup']);
        mockCheckMongoDatabaseAndUser.mockResolvedValue(true);

        await destroyDomainInfrastructure(domain({ server: 'd1' }));

        expect(mockIsDomainRunning).toHaveBeenCalledWith(expect.objectContaining({ server: 'd1' }));
        expect(mockGetVirtualHosts).toHaveBeenCalledWith('d1');
        expect(mockDeleteVirtualHost).toHaveBeenCalledWith('cleanup', 'd1');
        expect(mockCheckMongoDatabaseAndUser).toHaveBeenCalledWith('cleanup', 'cleanup', 'd1');
        expect(mockDeleteDatabaseAndUser).toHaveBeenCalledWith('cleanup', 'd1');
        // DNS stays on the main server for every site
        expect(mockDeleteSubdomain).toHaveBeenCalledWith('cleanup');
    });

    it('tolerates missing nginx, DNS, and Mongo resources', async () => {
        const result = await destroyDomainInfrastructure(domain());

        expect(mockDeleteVirtualHost).not.toHaveBeenCalled();
        expect(mockDeleteSubdomain).not.toHaveBeenCalled();
        expect(mockDeleteDatabaseAndUser).not.toHaveBeenCalled();
        expect(mockUpdateNSDomain).not.toHaveBeenCalled();
        expect(result).toEqual({ stopped: false, nginxDeleted: false, dnsDeleted: false, databaseDeleted: false });
    });

    it('awaits the dbExists update after deleting Mongo resources', async () => {
        const calls: string[] = [];
        mockCheckMongoDatabaseAndUser.mockResolvedValue(true);
        mockDeleteDatabaseAndUser.mockImplementation(async () => {
            calls.push('delete');
        });
        mockUpdateNSDomain.mockImplementation(async () => {
            calls.push('update');
        });

        await destroyDomainInfrastructure(domain());

        expect(calls).toEqual(['delete', 'update']);
    });
});

describe('initializeDomainInfrastructure', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env = {
            ...originalEnv,
            NS_REMOTE_SERVERS: 'd1',
            NS_SERVER_D1_HOSTNAME: 'd1.nsromania.info',
            NS_SERVER_D1_SSH: 'nsagent@31.220.43.162',
        };
        mockCheckMongoDatabaseAndUser.mockResolvedValue(false);
        mockAssignServerBeforeInitialization.mockResolvedValue(true);
        mockCreateDatabaseAndUser.mockResolvedValue(undefined);
        mockCreateSubdomain.mockResolvedValue(undefined);
        mockCreateVirtualHost.mockResolvedValue(undefined);
        mockUpdateNSDomain.mockResolvedValue({});
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    const fresh = (overrides: Partial<NSDomain> = {}) => domain({ active: 1, dbExists: 0, ...overrides });

    it("places a new site on the admin's chosen server and creates everything there", async () => {
        jest.spyOn(console, 'log').mockImplementation(() => {});

        await expect(initializeDomainInfrastructure(fresh(), { server: 'd1' })).resolves.toEqual({ server: 'd1' });

        expect(mockCheckMongoDatabaseAndUser).toHaveBeenCalledWith('cleanup', 'cleanup', 'main');
        expect(mockAssignServerBeforeInitialization).toHaveBeenCalledWith(10, 'd1');
        expect(mockCreateDatabaseAndUser).toHaveBeenCalledWith('cleanup', 'secret', 'd1');
        expect(mockUpdateNSDomain).toHaveBeenCalledWith(10, { dbExists: 1 });
        expect(mockCreateSubdomain).toHaveBeenCalledWith('cleanup', 'd1');
        expect(mockCreateVirtualHost).toHaveBeenCalledWith('cleanup', 11010, 'd1');
        expect(mockAssignServerBeforeInitialization.mock.invocationCallOrder[0]).toBeLessThan(
            mockCreateDatabaseAndUser.mock.invocationCallOrder[0]
        );
    });

    it('can place a site preselected for d1 back on the main server', async () => {
        jest.spyOn(console, 'log').mockImplementation(() => {});

        await expect(initializeDomainInfrastructure(fresh({ server: 'd1' }), { server: 'main' })).resolves.toEqual({
            server: 'main',
        });
        expect(mockAssignServerBeforeInitialization).toHaveBeenCalledWith(10, 'main');
        expect(mockCreateSubdomain).toHaveBeenCalledWith('cleanup', 'main');
    });

    it('uses the stored server when none is chosen', async () => {
        await expect(initializeDomainInfrastructure(fresh({ server: 'd1' }))).resolves.toEqual({ server: 'd1' });

        expect(mockAssignServerBeforeInitialization).not.toHaveBeenCalled();
        expect(mockCheckMongoDatabaseAndUser).not.toHaveBeenCalled();
        expect(mockCreateDatabaseAndUser).toHaveBeenCalledWith('cleanup', 'secret', 'd1');
    });

    it('repeats DNS and nginx but not the database for a site that already has one', async () => {
        await initializeDomainInfrastructure(domain({ active: 1, dbExists: 1, server: 'd1' }), { server: 'd1' });

        expect(mockCreateDatabaseAndUser).not.toHaveBeenCalled();
        expect(mockCreateSubdomain).toHaveBeenCalledWith('cleanup', 'd1');
        expect(mockCreateVirtualHost).toHaveBeenCalledWith('cleanup', 11010, 'd1');
    });

    it.each([
        ['an unknown server', fresh(), 'd9', false, true, 400],
        ['a site that has a database', domain({ active: 1, dbExists: 1 }), 'd1', false, true, 409],
        ['a database found on the current server', fresh(), 'd1', true, true, 409],
        ['a site initialized meanwhile', fresh(), 'd1', false, false, 409],
    ])('refuses to move %s before creating anything', async (_, site, server, databaseExists, assigned, status) => {
        mockCheckMongoDatabaseAndUser.mockResolvedValue(databaseExists);
        mockAssignServerBeforeInitialization.mockResolvedValue(assigned);

        const attempt = initializeDomainInfrastructure(site, { server });

        await expect(attempt).rejects.toBeInstanceOf(DomainInitializationError);
        await expect(attempt).rejects.toMatchObject({ status });
        expect(mockCreateDatabaseAndUser).not.toHaveBeenCalled();
        expect(mockCreateSubdomain).not.toHaveBeenCalled();
        expect(mockCreateVirtualHost).not.toHaveBeenCalled();
    });
});
