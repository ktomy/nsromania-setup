import {
    getDefaultServerForNewDomains,
    getDefaultServerId,
    getDnsTarget,
    getHostingServers,
    getRemoteServers,
    getServerIds,
    serverIdOf,
} from '../servers';

describe('hosting servers configuration', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        process.env = {
            ...originalEnv,
            NS_REMOTE_SERVERS: 'd1',
            NS_SERVER_D1_HOSTNAME: 'd1.nsromania.info',
            NS_SERVER_D1_SSH: 'nsagent@31.220.43.162',
            NS_SERVER_D1_MONGO_URL: 'mongodb://admin:pw@127.0.0.1:27118/?authSource=admin',
        };
        delete process.env.NS_DEFAULT_SERVER;
        delete process.env.NS_MAIN_DNS_TARGET;
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    it('lists the main server first, then the configured remote servers', () => {
        expect(getServerIds()).toEqual(['main', 'd1']);
        expect(getRemoteServers().get('d1')).toEqual({
            id: 'd1',
            hostname: 'd1.nsromania.info',
            sshTarget: 'nsagent@31.220.43.162',
            mongoUrl: 'mongodb://admin:pw@127.0.0.1:27118/?authSource=admin',
        });
    });

    it('treats a missing server as the main server', () => {
        expect(serverIdOf({ server: null })).toBe('main');
        expect(serverIdOf({ server: '  ' })).toBe('main');
        expect(serverIdOf({})).toBe('main');
        expect(serverIdOf({ server: 'd1' })).toBe('d1');
    });

    it('works without any remote server', () => {
        delete process.env.NS_REMOTE_SERVERS;
        expect(getServerIds()).toEqual(['main']);
    });

    it('rejects invalid configuration', () => {
        process.env.NS_REMOTE_SERVERS = 'd1,Bad-Id';
        expect(() => getRemoteServers()).toThrow('Invalid server id');
        process.env.NS_REMOTE_SERVERS = 'main';
        expect(() => getRemoteServers()).toThrow('Invalid server id');
        process.env.NS_REMOTE_SERVERS = 'd1';
        process.env.NS_SERVER_D1_SSH = 'root@host; rm -rf /';
        expect(() => getRemoteServers()).toThrow('NS_SERVER_D1_SSH');
        process.env.NS_SERVER_D1_SSH = 'nsagent@31.220.43.162';
        delete process.env.NS_SERVER_D1_HOSTNAME;
        expect(() => getRemoteServers()).toThrow('NS_SERVER_D1_HOSTNAME');
    });

    it('points CNAME records at the hosting server', () => {
        expect(getDnsTarget('main')).toBe('nsromania.info.');
        expect(getDnsTarget('d1')).toBe('d1.nsromania.info.');
        process.env.NS_MAIN_DNS_TARGET = 'example.org';
        expect(getDnsTarget('main')).toBe('example.org.');
        expect(() => getDnsTarget('d2')).toThrow('Unknown hosting server: d2');
    });

    it('places new domains on the configured default server', () => {
        expect(getDefaultServerForNewDomains()).toBeNull();
        process.env.NS_DEFAULT_SERVER = 'main';
        expect(getDefaultServerForNewDomains()).toBeNull();
        process.env.NS_DEFAULT_SERVER = 'd1';
        expect(getDefaultServerForNewDomains()).toBe('d1');
        process.env.NS_DEFAULT_SERVER = 'd9';
        expect(() => getDefaultServerForNewDomains()).toThrow('Unknown hosting server: d9');
    });

    it('preselects the default server when initializing', () => {
        expect(getDefaultServerId()).toBe('main');
        process.env.NS_DEFAULT_SERVER = 'd1';
        expect(getDefaultServerId()).toBe('d1');
    });

    it('describes the servers for the UI without SSH targets or credentials', () => {
        expect(getHostingServers()).toEqual([
            { id: 'main', hostname: 'nsromania.info' },
            { id: 'd1', hostname: 'd1.nsromania.info' },
        ]);
    });
});
