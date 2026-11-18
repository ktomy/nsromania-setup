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

const mockCallRemoteAgent = jest.fn();
jest.mock('../remoteagent', () => ({
    callRemoteAgent: (...args: unknown[]) => mockCallRemoteAgent(...args),
}));

const { resolveNightscoutNodeInterpreter: mockResolveNightscoutNodeInterpreter } = jest.requireMock('../nsnode') as {
    resolveNightscoutNodeInterpreter: jest.Mock;
};
const {
    tryStartDomain,
    tryStopDomain,
    isProcessListHealthy,
    saveProcessListIfHealthy,
    domainStatusFrom,
    getProcessesByServer,
} = require('../nsruntime') as typeof import('../nsruntime');

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

    it('keeps pooled MongoDB connections for 10 minutes by default', async () => {
        await expect(tryStartDomain({ id: 7, domain: 'demo', environments: [] })).resolves.toBe('ok');

        expect(mockStart).toHaveBeenCalledWith(
            expect.objectContaining({
                env: expect.objectContaining({ MONGO_MAX_IDLE_TIME_MS: '600000' }),
            }),
            expect.any(Function)
        );
    });

    it('lets a domain environment variable override the MongoDB idle time default', async () => {
        const domain = {
            id: 7,
            domain: 'demo',
            environments: [{ variable: 'MONGO_MAX_IDLE_TIME_MS', value: '120000' }],
        } as PartialNSDomainWithEnvironments;

        await expect(tryStartDomain(domain)).resolves.toBe('ok');

        expect(mockStart).toHaveBeenCalledWith(
            expect.objectContaining({
                env: expect.objectContaining({ MONGO_MAX_IDLE_TIME_MS: '120000' }),
            }),
            expect.any(Function)
        );
    });

    it('passes stored variable names with invalid characters under their clean name', async () => {
        const domain = {
            id: 7,
            domain: 'demo',
            environments: [
                { variable: 'BASAL_RENDER:', value: 'default' },
                { variable: ' SHOW_FORECAST ', value: 'ar2' },
                { variable: ':', value: 'dropped' },
            ],
        } as PartialNSDomainWithEnvironments;

        await expect(tryStartDomain(domain)).resolves.toBe('ok');

        const { env } = mockStart.mock.calls[0][0] as { env: Record<string, string> };
        expect(env).toEqual(expect.objectContaining({ BASAL_RENDER: 'default', SHOW_FORECAST: 'ar2' }));
        expect(Object.keys(env).every((key) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key))).toBe(true);
    });

    it('fails clearly before connecting to PM2 when NS_HOME is missing', async () => {
        delete process.env.NS_HOME;

        await expect(tryStartDomain({ domain: 'demo' })).rejects.toThrow('NS_HOME environment variable is not set');
        expect(mockResolveNightscoutNodeInterpreter).not.toHaveBeenCalled();
        expect(mockConnect).not.toHaveBeenCalled();
    });
});

describe('remote hosting servers', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env = {
            ...originalEnv,
            NODE_ENV: 'production',
            NS_HOME: '/srv/nightscout',
            NS_REMOTE_SERVERS: 'd1',
            NS_SERVER_D1_HOSTNAME: 'd1.nsromania.info',
            NS_SERVER_D1_SSH: 'nsagent@31.220.43.162',
        };
        mockResolveNightscoutNodeInterpreter.mockResolvedValue('/resolved/node');
        mockCallRemoteAgent.mockResolvedValue({ name: '11007_demo', status: 'online' });
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    it('starts a remote site through the host agent with the same definition as a local start', async () => {
        const domain = {
            id: 7,
            domain: 'demo',
            apiSecret: 'secret',
            enable: '',
            nsversion: '15_0_7',
            environments: [],
        };

        await expect(tryStartDomain({ ...domain, server: 'd1' })).resolves.toBe('ok');
        await expect(tryStartDomain(domain)).resolves.toBe('ok');

        const [serverId, args, remoteDefinition] = mockCallRemoteAgent.mock.calls[0];
        expect(serverId).toBe('d1');
        expect(args).toEqual(['pm2-start']);
        expect(remoteDefinition).toEqual(mockStart.mock.calls[0][0]);
        expect(remoteDefinition).toEqual(
            expect.objectContaining({
                name: '11007_demo',
                script: 'server.js',
                cwd: '/srv/nightscout/15_0_7/',
                interpreter: '/resolved/node',
                env: expect.objectContaining({ PORT: '11007', MONGO_MAX_IDLE_TIME_MS: '600000' }),
            })
        );
        expect(mockStart).toHaveBeenCalledTimes(1);
    });

    it('stops a remote site through the host agent', async () => {
        await expect(tryStopDomain({ id: 7, domain: 'demo', server: 'd1' })).resolves.toBe('ok');
        expect(mockCallRemoteAgent).toHaveBeenCalledWith('d1', ['pm2-delete', '11007_demo']);
    });

    it('reports sites of an unreachable server as unknown instead of failing', async () => {
        mockList.mockImplementation((callback) =>
            callback(null, [{ name: '11001_local', pm2_env: { status: 'online' } }])
        );
        mockCallRemoteAgent.mockRejectedValue(new Error('ssh: connect to host failed'));
        jest.spyOn(console, 'error').mockImplementation(() => {});

        const processes = await getProcessesByServer();

        expect(domainStatusFrom(processes, { domain: 'local' })).toBe('online');
        expect(domainStatusFrom(processes, { domain: 'gone' })).toBe('not running');
        expect(domainStatusFrom(processes, { domain: 'remote', server: 'd1' })).toBe('unknown');
        expect(domainStatusFrom(processes, { domain: 'misconfigured', server: 'd9' })).toBe('unknown');
    });
});
