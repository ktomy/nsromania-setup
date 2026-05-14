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

jest.mock('../dnsmanagement', () => ({
    deleteSubdomain: mockDeleteSubdomain,
    listSubdomains: mockListSubdomains,
}));

jest.mock('../domains', () => ({
    updateNSDomain: mockUpdateNSDomain,
}));

jest.mock('../nginxmanagement', () => ({
    deleteVirtualHost: mockDeleteVirtualHost,
    getVirtualHosts: mockGetVirtualHosts,
}));

jest.mock('../nsdatbasea', () => ({
    checkMongoDatabaseAndUser: mockCheckMongoDatabaseAndUser,
    deleteDatabaseAndUser: mockDeleteDatabaseAndUser,
}));

jest.mock('../nsruntime', () => ({
    isDomainRunning: mockIsDomainRunning,
    tryStopDomain: mockTryStopDomain,
}));

const { destroyDomainInfrastructure } = require('../domainLifecycle') as typeof import('../domainLifecycle');

function domain(overrides: Partial<NSDomain> = {}): NSDomain {
    return {
        id: 10,
        active: 0,
        title: 'Site',
        domain: 'cleanup',
        port: 11010,
        dbExists: 1,
        apiSecret: 'secret',
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
        expect(mockDeleteVirtualHost).toHaveBeenCalledWith('cleanup');
        expect(mockDeleteSubdomain).toHaveBeenCalledWith('cleanup');
        expect(mockDeleteDatabaseAndUser).toHaveBeenCalledWith('cleanup');
        expect(mockUpdateNSDomain).toHaveBeenCalledWith(10, { dbExists: 0 });
        expect(result).toEqual({ stopped: true, nginxDeleted: true, dnsDeleted: true, databaseDeleted: true });
        expect(mockTryStopDomain.mock.invocationCallOrder[0]).toBeLessThan(
            mockDeleteVirtualHost.mock.invocationCallOrder[0]
        );
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
