import { PartialNSDomainWithEnvironments } from '@/types/domains';

const mockConnect = jest.fn((callback: (err?: Error | null) => void) => callback(null));
const mockStart = jest.fn((options: unknown, callback: (err?: Error | null, proc?: unknown) => void) =>
    callback(null, {})
);
const mockDisconnect = jest.fn();

jest.mock('pm2', () => ({
    connect: mockConnect,
    start: mockStart,
    disconnect: mockDisconnect,
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
const { tryStartDomain } = require('../nsruntime') as typeof import('../nsruntime');

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
