import { PartialNSDomainWithEnvironments } from '@/types/domains';

const mockConnect = jest.fn((callback: (err?: Error | null) => void) => callback(null));
const mockStart = jest.fn((options: unknown, callback: (err?: Error | null, proc?: unknown) => void) =>
    callback(null, {})
);
const mockDisconnect = jest.fn();
const mockList = jest.fn();
const mockDump = jest.fn((callback: (err?: Error | null) => void) => callback(null));

jest.mock('pm2', () => ({
    connect: mockConnect,
    start: mockStart,
    disconnect: mockDisconnect,
    list: mockList,
    dump: mockDump,
}));

jest.mock(
    '../nsnode',
    () => ({
        resolveNightscoutNodeInterpreter: jest.fn(),
    }),
    { virtual: true }
);

const { resolveNightscoutNodeInterpreter: mockResolveNightscoutNodeInterpreter } = jest.requireMock('../nsnode') as {
    resolveNightscoutNodeInterpreter: jest.Mock;
};
const { tryStartDomain, isProcessListHealthy, saveProcessListIfHealthy } =
    require('../nsruntime') as typeof import('../nsruntime');

function processes(online: number, stopped: number, modules = 0) {
    return [
        ...Array.from({ length: online }, (_, i) => ({ name: `11${i}_on`, pm2_env: { status: 'online' } })),
        ...Array.from({ length: stopped }, (_, i) => ({ name: `12${i}_off`, pm2_env: { status: 'stopped' } })),
        ...Array.from({ length: modules }, (_, i) => ({
            name: `module${i}`,
            pm2_env: { status: 'stopped', pmx_module: true },
        })),
    ];
}

describe('isProcessListHealthy', () => {
    it('requires a non-empty list with at least 90% online', () => {
        expect(isProcessListHealthy([])).toBe(false);
        expect(
            isProcessListHealthy([
                'online',
                'online',
                'online',
                'online',
                'online',
                'online',
                'online',
                'online',
                'online',
                'stopped',
            ])
        ).toBe(true);
        expect(isProcessListHealthy(['online', 'stopped'])).toBe(false);
    });
});

describe('saveProcessListIfHealthy', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('dumps the process list when nearly all apps are online, ignoring PM2 modules', async () => {
        mockList.mockImplementation((callback) => callback(null, processes(50, 1, 3)));

        await expect(saveProcessListIfHealthy()).resolves.toBe(true);
        expect(mockDump).toHaveBeenCalledTimes(1);
        expect(mockDisconnect).toHaveBeenCalled();
    });

    it('refuses to overwrite the saved list with a degraded one', async () => {
        mockList.mockImplementation((callback) => callback(null, processes(2, 332)));

        await expect(saveProcessListIfHealthy()).resolves.toBe(false);
        expect(mockDump).not.toHaveBeenCalled();
    });

    it('reports failure instead of throwing when PM2 errors', async () => {
        mockList.mockImplementation((callback) => callback(new Error('rpc down')));
        jest.spyOn(console, 'error').mockImplementation(() => {});

        await expect(saveProcessListIfHealthy()).resolves.toBe(false);
        expect(mockDump).not.toHaveBeenCalled();
    });
});

describe('tryStartDomain', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env = {
            ...originalEnv,
            NODE_ENV: 'production',
            NS_HOME: '/srv/nightscout',
            NS_NODE_PATH: '/legacy/node',
        };
        mockResolveNightscoutNodeInterpreter.mockResolvedValue('/resolved/node');
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    it('starts Nightscout with the interpreter resolved for the domain Nightscout directory', async () => {
        const domain: PartialNSDomainWithEnvironments = {
            id: 7,
            domain: 'demo',
            apiSecret: 'secret',
            enable: 'bridge',
            showPlugins: 'careportal',
            nsversion: '15.0.2',
            environments: [],
        };

        await expect(tryStartDomain(domain)).resolves.toBe('ok');

        expect(mockResolveNightscoutNodeInterpreter).toHaveBeenCalledWith('/srv/nightscout/15.0.2/');
        expect(mockStart).toHaveBeenCalledWith(
            expect.objectContaining({
                cwd: '/srv/nightscout/15.0.2/',
                interpreter: '/resolved/node',
            }),
            expect.any(Function)
        );
    });

    it('fails clearly before connecting to PM2 when NS_HOME is missing', async () => {
        delete process.env.NS_HOME;

        await expect(tryStartDomain({ domain: 'demo' })).rejects.toThrow('NS_HOME environment variable is not set');
        expect(mockResolveNightscoutNodeInterpreter).not.toHaveBeenCalled();
        expect(mockConnect).not.toHaveBeenCalled();
    });
});
