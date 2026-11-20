// A module, so these mock names do not collide with other test files
export {};

const mockUpdate = jest.fn();
const mockFindUnique = jest.fn();
const mockCreateDomain = jest.fn();
const mockFindUser = jest.fn();
const mockDeleteMany = jest.fn();
const mockCreate = jest.fn();

jest.mock('../../prisma', () => ({
    prisma: {
        nSDomain: { update: mockUpdate, findUnique: mockFindUnique, create: mockCreateDomain },
        user: { findUnique: mockFindUser, create: jest.fn() },
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

jest.mock('../nsversion', () => ({
    getAvailableVersions: jest.fn().mockResolvedValue([{ directoryName: '15_0_7' }, { directoryName: 'master' }]),
}));
jest.mock('../servers', () => ({
    getDefaultServerForNewDomains: () => 'd1',
    isRemoteServer: () => false,
    serverIdOf: () => 'main',
}));

const domains = require('../domains') as typeof import('../domains');
const { setDomainDbExists, createNSDomain, DomainValidationError } = domains;

const ADMIN = { id: 'admin-id', role: 'admin', email: 'admin@example.com', name: 'Admin' } as never;
const OWNER = { id: 'owner-id', role: 'user', email: 'owner@example.com', name: 'Owner' } as never;
const CURRENT = { id: 7, domain: 'mysite', authUserId: 'owner-id', nsversion: '15_0_7' };

// Edits by the site's owner unless a test says otherwise
const updateNSDomain = (id: number, data: Parameters<typeof domains.updateNSDomain>[1], editor = OWNER) =>
    domains.updateNSDomain(id, data, editor);

describe('site initialized flag (db_exists)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockUpdate.mockResolvedValue({ id: 7 });
        mockFindUnique.mockResolvedValue(CURRENT);
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
        mockFindUnique.mockResolvedValue(CURRENT);
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

describe('site edit permissions', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockUpdate.mockResolvedValue({ id: 7 });
        mockFindUnique.mockResolvedValue(CURRENT);
    });

    it.each([
        ['NODE_OPTIONS', '--import data:text/javascript,process.exit()'],
        ['node_options', '--require /tmp/x.js'],
        ['LD_PRELOAD', '/tmp/x.so'],
        ['PORT', '11001'],
        ['OPENSSL_CONF', '/tmp/x.cnf'],
        ['PATH', '/tmp'],
    ])('refuse the environment variable %s, which would run code in the root PM2 process', async (variable, value) => {
        await expect(updateNSDomain(7, { environments: [{ variable, value }] })).rejects.toThrow(DomainValidationError);
        expect(mockUpdate).not.toHaveBeenCalled();
        expect(mockDeleteMany).not.toHaveBeenCalled();
    });

    it('do not let an owner rename the site or give it away', async () => {
        await expect(updateNSDomain(7, { domain: 'admin' })).rejects.toThrow('Only admins can rename a site');
        await expect(updateNSDomain(7, { authUserId: 'someone-else' })).rejects.toThrow('Only admins');
        expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('accept the unchanged name the edit form always sends', async () => {
        await updateNSDomain(7, { domain: 'mysite', title: 'T' });
        expect(mockUpdate).toHaveBeenCalledWith({
            where: { id: 7 },
            data: expect.objectContaining({ domain: 'mysite' }),
        });
    });

    it('let admins rename, but never to a reserved or malformed name', async () => {
        await updateNSDomain(7, { domain: 'newname' }, ADMIN);
        expect(mockUpdate).toHaveBeenCalledTimes(1);
        for (const name of ['admin', 'config', 'local', 'setup', 'a', 'x/../y', 'Upper']) {
            await expect(updateNSDomain(7, { domain: name }, ADMIN)).rejects.toThrow(DomainValidationError);
        }
    });

    it('accept only installed Nightscout versions', async () => {
        await updateNSDomain(7, { nsversion: 'master' });
        await expect(updateNSDomain(7, { nsversion: '../../tmp/evil' })).rejects.toThrow('Unknown Nightscout version');
    });
});

describe('site creation', () => {
    const request = {
        domain: 'newsite',
        apiSecret: 'secretsecret',
        enable: 'careportal',
        showPlugins: 'careportal',
        ownerEmail: 'victim@example.com',
        ownerName: 'Victim',
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockFindUnique.mockResolvedValue(null);
        mockFindUser.mockResolvedValue({ id: 'existing-user' });
        mockCreateDomain.mockResolvedValue({ id: 8 });
    });

    it('makes a non-admin creator the owner, whatever email the request names', async () => {
        await createNSDomain({ ...request }, OWNER);
        expect(mockFindUser).toHaveBeenCalledWith({ where: { email: 'owner@example.com' } });
    });

    it('lets an admin create a site for another owner', async () => {
        await createNSDomain({ ...request }, ADMIN);
        expect(mockFindUser).toHaveBeenCalledWith({ where: { email: 'victim@example.com' } });
    });

    it('refuses reserved names and reserved environment variables', async () => {
        await expect(createNSDomain({ ...request, domain: 'admin' }, ADMIN)).rejects.toThrow(DomainValidationError);
        await expect(
            createNSDomain({ ...request, environments: [{ variable: 'NODE_OPTIONS', value: 'x' }] }, OWNER)
        ).rejects.toThrow(DomainValidationError);
        expect(mockCreateDomain).not.toHaveBeenCalled();
    });
});
