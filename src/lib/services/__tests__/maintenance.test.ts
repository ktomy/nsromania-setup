import { NSDomain } from '@/generated/client';

const mockFindMany = jest.fn();
const mockFindUnique = jest.fn();
const mockUpdate = jest.fn();
const mockGetLastDbEntry = jest.fn();
const mockGetLastDbEntries = jest.fn();
const mockGetDbSizes = jest.fn();
const mockTrimDatabase = jest.fn();
const mockIsDomainRunning = jest.fn();
const mockTryStopDomain = jest.fn();
const mockDestroyDomainInfrastructure = jest.fn();

jest.mock('../../prisma', () => ({
    prisma: {
        nSDomain: {
            findMany: mockFindMany,
            findUnique: mockFindUnique,
            update: mockUpdate,
        },
    },
}));

jest.mock('../nsdatbasea', () => ({
    getLastDbEntry: mockGetLastDbEntry,
    getLastDbEntries: mockGetLastDbEntries,
    getDbSizes: mockGetDbSizes,
    trimDatabase: mockTrimDatabase,
}));

jest.mock('../nsruntime', () => ({
    isDomainRunning: mockIsDomainRunning,
    tryStopDomain: mockTryStopDomain,
}));

jest.mock(
    '../domainLifecycle',
    () => ({
        destroyDomainInfrastructure: mockDestroyDomainInfrastructure,
    }),
    { virtual: true }
);

const { actionInactiveUsers, getDatabaseMaintenanceSites, getInactiveUserPreview, trimDatabaseForSites } =
    require('../maintenance') as typeof import('../maintenance');

function domain(overrides: Partial<NSDomain>): NSDomain {
    return {
        id: 1,
        active: 1,
        title: 'Site',
        domain: 'site',
        port: 11001,
        dbExists: 1,
        apiSecret: 'secret',
        enable: 'bridge',
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

describe('maintenance inactive users service', () => {
    const now = new Date('2026-05-14T12:00:00.000Z');
    const oldGlucose = new Date('2026-01-01T00:00:00.000Z');
    const recentGlucose = new Date('2026-05-01T00:00:00.000Z');

    beforeEach(() => {
        jest.clearAllMocks();
        mockTryStopDomain.mockResolvedValue('ok');
        mockDestroyDomainInfrastructure.mockResolvedValue({
            stopped: false,
            nginxDeleted: false,
            dnsDeleted: false,
            databaseDeleted: false,
        });
        mockUpdate.mockImplementation(({ where, data }) => Promise.resolve({ ...domain({ id: where.id }), ...data }));
        mockIsDomainRunning.mockResolvedValue(true);
        mockGetLastDbEntries.mockImplementation(async (dbNames: string[]) => {
            const entries = new Map<string, Date | null>();
            for (const dbName of dbNames) {
                entries.set(dbName, await mockGetLastDbEntry(dbName));
            }
            return entries;
        });
        mockGetDbSizes.mockResolvedValue(new Map());
        mockTrimDatabase.mockResolvedValue({
            dbName: 'site',
            cutoff: '2026-02-13T12:00:00.000Z',
            deletedDocuments: 3,
            collections: [],
        });
    });

    it('does not include an old active site with recent glucose as an inactive candidate', async () => {
        mockFindMany.mockResolvedValue([domain({ id: 1, domain: 'recent' })]);
        mockGetLastDbEntry.mockResolvedValue(recentGlucose);

        const preview = await getInactiveUserPreview({ days: 90, now });

        expect(preview.counts.checked).toBe(1);
        expect(preview.counts.inactiveCandidates).toBe(0);
        expect(preview.sites).toHaveLength(1);
        expect(preview.sites[0].inactive).toBe(false);
        expect(preview.sites[0].status).toBe('active-recent-glucose');
    });

    it('includes an old active site with old glucose as an inactive candidate', async () => {
        mockFindMany.mockResolvedValue([domain({ id: 2, domain: 'old' })]);
        mockGetLastDbEntry.mockResolvedValue(oldGlucose);

        const preview = await getInactiveUserPreview({ days: 90, now });

        expect(preview.counts.inactiveCandidates).toBe(1);
        expect(preview.sites[0]).toEqual(
            expect.objectContaining({ id: 2, inactive: true, status: 'inactive-old-glucose' })
        );
    });

    it('includes an old active site with no database entries as an inactive candidate', async () => {
        mockFindMany.mockResolvedValue([domain({ id: 3, domain: 'empty' })]);
        mockGetLastDbEntry.mockResolvedValue(null);

        const preview = await getInactiveUserPreview({ days: 90, now });

        expect(preview.counts.inactiveCandidates).toBe(1);
        expect(preview.sites[0]).toEqual(
            expect.objectContaining({ id: 3, inactive: true, status: 'inactive-no-glucose' })
        );
    });

    it('queries only old active sites, skipping young and inactive records in the database query', async () => {
        mockFindMany.mockResolvedValue([]);

        await getInactiveUserPreview({ days: 90, now });

        expect(mockFindMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: {
                    active: 1,
                    created: {
                        lte: new Date('2026-02-13T12:00:00.000Z'),
                    },
                },
            })
        );
        expect(mockGetLastDbEntry).not.toHaveBeenCalled();
    });

    it('checks preview glucose entries in one Mongo batch', async () => {
        mockFindMany.mockResolvedValue([domain({ id: 10, domain: 'one' }), domain({ id: 11, domain: 'two' })]);
        mockGetLastDbEntries.mockResolvedValue(
            new Map([
                ['one', oldGlucose],
                ['two', recentGlucose],
            ])
        );

        await getInactiveUserPreview({ days: 90, now });

        expect(mockGetLastDbEntries).toHaveBeenCalledTimes(1);
        expect(mockGetLastDbEntries).toHaveBeenCalledWith(['one', 'two']);
        expect(mockGetLastDbEntry).not.toHaveBeenCalled();
    });

    it('rejects destroy without deactivate', async () => {
        await expect(actionInactiveUsers({ days: 90, siteIds: [1], actions: { destroy: true }, now })).rejects.toThrow(
            'Destroy requires deactivate'
        );
    });

    it('revalidates eligibility before mutating and skips no-longer-inactive sites', async () => {
        mockFindUnique.mockResolvedValue(domain({ id: 4, domain: 'became-active' }));
        mockGetLastDbEntry.mockResolvedValue(recentGlucose);

        const result = await actionInactiveUsers({
            days: 90,
            siteIds: [4],
            actions: { deactivate: true },
            now,
        });

        expect(result.counts.skipped).toBe(1);
        expect(mockUpdate).not.toHaveBeenCalled();
        expect(mockTryStopDomain).not.toHaveBeenCalled();
        expect(mockDestroyDomainInfrastructure).not.toHaveBeenCalled();
    });

    it('keeps processing when one site action fails', async () => {
        mockFindUnique
            .mockResolvedValueOnce(domain({ id: 5, domain: 'broken' }))
            .mockResolvedValueOnce(domain({ id: 6, domain: 'ok' }));
        mockGetLastDbEntry.mockResolvedValue(oldGlucose);
        mockTryStopDomain.mockRejectedValueOnce(new Error('pm2 failed')).mockResolvedValueOnce('ok');

        const result = await actionInactiveUsers({
            days: 90,
            siteIds: [5, 6],
            actions: { stop: true, deactivate: true },
            now,
        });

        expect(result.counts.failed).toBe(1);
        expect(result.counts.deactivated).toBe(1);
        expect(result.results).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: 5, result: 'failed', error: 'pm2 failed' }),
                expect.objectContaining({ id: 6, result: 'actioned' }),
            ])
        );
    });

    it('returns database sizes for every site', async () => {
        mockFindMany.mockResolvedValue([domain({ id: 1, domain: 'one' }), domain({ id: 2, domain: 'two', active: 0 })]);
        mockGetDbSizes.mockResolvedValue(
            new Map([
                ['one', { dbName: 'one', dataSize: 100, storageSize: 200 }],
                ['two', null],
            ])
        );

        const result = await getDatabaseMaintenanceSites();

        expect(result.sites).toEqual([
            expect.objectContaining({ id: 1, dataSize: 100, storageSize: 200, active: true }),
            expect.objectContaining({ id: 2, dataSize: null, storageSize: null, active: false }),
        ]);
    });

    it('accepts only the supported retention periods and trims selected sites', async () => {
        mockFindUnique.mockResolvedValue({
            ...domain({ id: 8, domain: 'selected' }),
            environments: [
                { id: 1, nsDomainId: 8, variable: 'MONGO_TREATMENTS_COLLECTION', value: 'custom-treatments' },
            ],
        });

        const result = await trimDatabaseForSites({ siteIds: [8], days: 30, now });

        expect(mockTrimDatabase).toHaveBeenCalledWith('selected', new Date('2026-04-14T12:00:00.000Z'), {
            entries: 'date',
            'custom-treatments': 'created_at',
            devicestatus: 'created_at',
            activity: 'created_at',
        });
        expect(result.results[0]).toEqual(expect.objectContaining({ id: 8, deletedDocuments: 3 }));
        await expect(trimDatabaseForSites({ siteIds: [8], days: 60 as never, now })).rejects.toThrow(
            'Retention must be 30, 90, or 180 days'
        );
    });
});
