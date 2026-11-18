// A module, so these mock names do not collide with other test files
export {};

const mockUpdate = jest.fn();
const mockDeleteMany = jest.fn();
const mockCreate = jest.fn();

jest.mock('../../prisma', () => ({
    prisma: {
        nSDomain: { update: mockUpdate },
        nSDomainEnvironment: { deleteMany: mockDeleteMany, create: mockCreate },
        $disconnect: jest.fn(),
    },
}));
jest.mock('../nsruntime', () => ({ getProcessesList: jest.fn() }));
jest.mock('../nsdatbasea', () => ({
    checkMongoDatabaseAndUser: jest.fn(),
    getDbSize: jest.fn(),
    getLastDbEntry: jest.fn(),
}));

const { setDomainDbExists, updateNSDomain } = require('../domains') as typeof import('../domains');

describe('site initialized flag (db_exists)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockUpdate.mockResolvedValue({ id: 7 });
    });

    it('cannot be changed by an edit, which used to reset it on every save', async () => {
        // The shape the edit form sent before the fix
        await updateNSDomain(7, { title: 'Site', apiSecret: 'secret', active: 1, dbExists: 0, port: 0 });

        expect(mockUpdate).toHaveBeenCalledTimes(1);
        const { data } = mockUpdate.mock.calls[0][0];
        expect(data).toEqual({ lastUpdated: expect.any(Date), title: 'Site', apiSecret: 'secret', active: 1 });
        expect(data).not.toHaveProperty('dbExists');
    });

    it('is set by initialization and destroy through its own function', async () => {
        await setDomainDbExists(7, 1);
        await setDomainDbExists(7, 0);

        expect(mockUpdate).toHaveBeenNthCalledWith(1, { where: { id: 7 }, data: { dbExists: 1 } });
        expect(mockUpdate).toHaveBeenNthCalledWith(2, { where: { id: 7 }, data: { dbExists: 0 } });
    });

    it('still lets an edit deactivate a site', async () => {
        await updateNSDomain(7, { active: 0 });

        expect(mockUpdate).toHaveBeenCalledWith({
            where: { id: 7 },
            data: { lastUpdated: expect.any(Date), active: 0 },
        });
    });
});

describe('site edits', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers({ now: new Date('2026-11-17T22:00:00.000Z') });
        mockUpdate.mockResolvedValue({ id: 7 });
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('record the time of the edit in last_updated', async () => {
        await updateNSDomain(7, { title: 'New title' });

        expect(mockUpdate.mock.calls[0][0].data.lastUpdated).toEqual(new Date('2026-11-17T22:00:00.000Z'));
    });

    it('record the time also when only environment variables change', async () => {
        await updateNSDomain(7, { environments: [{ variable: 'DISPLAY_UNITS', value: 'mmol' }] });

        expect(mockUpdate).toHaveBeenCalledWith({
            where: { id: 7 },
            data: { lastUpdated: new Date('2026-11-17T22:00:00.000Z') },
        });
        expect(mockDeleteMany).toHaveBeenCalledWith({ where: { nsDomainId: 7 } });
        expect(mockCreate).toHaveBeenCalledWith({ data: { nsDomainId: 7, variable: 'DISPLAY_UNITS', value: 'mmol' } });
    });

    it('store environment variable names without spaces or other invalid characters', async () => {
        await updateNSDomain(7, {
            environments: [
                { variable: 'LOOP_APNS_KEY ', value: 'key' },
                { variable: ' BASAL_RENDER:', value: 'default' },
                { variable: ' :', value: 'dropped' },
                { variable: '1ABC', value: 'dropped' },
            ],
        });

        expect(mockCreate).toHaveBeenCalledTimes(2);
        expect(mockCreate).toHaveBeenCalledWith({ data: { nsDomainId: 7, variable: 'LOOP_APNS_KEY', value: 'key' } });
        expect(mockCreate).toHaveBeenCalledWith({
            data: { nsDomainId: 7, variable: 'BASAL_RENDER', value: 'default' },
        });
    });
});
