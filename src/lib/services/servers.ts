// Hosting servers that run Nightscout instances.
//
// The panel itself runs on the "main" server and manages its instances locally (PM2, nginx, MongoDB). Every
// additional server is listed in NS_REMOTE_SERVERS and managed through the restricted SSH host agent
// (ops/servers/nsromania-host-agent.py); its MongoDB is reached through an SSH tunnel on the main server.
//
// Environment, per remote server id <ID> (upper-cased in variable names):
//   NS_REMOTE_SERVERS="d1"                       comma-separated ids
//   NS_SERVER_<ID>_HOSTNAME="d1.nsromania.info"  DNS name that instance CNAME records point to
//   NS_SERVER_<ID>_SSH="nsagent@31.220.43.162"   SSH target of the host agent
//   NS_SERVER_<ID>_MONGO_URL="mongodb://..."     admin URL of the server's MongoDB (through the tunnel)
//   NS_SERVERS_SSH_IDENTITY, NS_SERVERS_SSH_KNOWN_HOSTS   key and pinned host keys for all remote servers
//   NS_DEFAULT_SERVER="d1"                       server preselected for new sites and when an admin initializes one
//   NS_MAIN_DNS_TARGET="nsromania.info."         CNAME target of instances on the main server

export const MAIN_SERVER_ID = 'main';

const SERVER_ID_PATTERN = /^[a-z][a-z0-9]{0,31}$/;
const HOSTNAME_PATTERN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
const SSH_TARGET_PATTERN = /^[a-z_][a-z0-9_-]{0,31}@[A-Za-z0-9.:-]{1,253}$/;

export interface RemoteServerConfig {
    id: string;
    hostname: string;
    sshTarget: string;
    mongoUrl?: string;
}

// What the UI may know about a server: no SSH target, no credentials
export interface HostingServerInfo {
    id: string;
    hostname: string;
}

export interface DomainServerRef {
    server?: string | null;
}

function serverEnv(id: string, name: string): string | undefined {
    const value = process.env[`NS_SERVER_${id.toUpperCase()}_${name}`];
    return value && value.trim() !== '' ? value.trim() : undefined;
}

export function getRemoteServers(): Map<string, RemoteServerConfig> {
    const servers = new Map<string, RemoteServerConfig>();
    const ids = (process.env.NS_REMOTE_SERVERS || '')
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id !== '');

    for (const id of ids) {
        if (!SERVER_ID_PATTERN.test(id) || id === MAIN_SERVER_ID) {
            throw new Error(`Invalid server id in NS_REMOTE_SERVERS: ${id}`);
        }
        const hostname = serverEnv(id, 'HOSTNAME');
        const sshTarget = serverEnv(id, 'SSH');
        if (!hostname || !HOSTNAME_PATTERN.test(hostname)) {
            throw new Error(`NS_SERVER_${id.toUpperCase()}_HOSTNAME is missing or invalid`);
        }
        if (!sshTarget || !SSH_TARGET_PATTERN.test(sshTarget)) {
            throw new Error(`NS_SERVER_${id.toUpperCase()}_SSH is missing or invalid`);
        }
        servers.set(id, { id, hostname, sshTarget, mongoUrl: serverEnv(id, 'MONGO_URL') });
    }

    return servers;
}

export function getServerIds(): string[] {
    return [MAIN_SERVER_ID, ...Array.from(getRemoteServers().keys())];
}

export function serverIdOf(domain: DomainServerRef | null | undefined): string {
    const server = domain?.server?.trim();
    return server ? server : MAIN_SERVER_ID;
}

export function isRemoteServer(serverId: string): boolean {
    return serverId !== MAIN_SERVER_ID;
}

export function getRemoteServer(serverId: string): RemoteServerConfig {
    const server = getRemoteServers().get(serverId);
    if (!server) {
        throw new Error(`Unknown hosting server: ${serverId}`);
    }
    return server;
}

// Fully qualified CNAME target for instances hosted on the given server
export function getDnsTarget(serverId: string): string {
    if (!isRemoteServer(serverId)) {
        const target = process.env.NS_MAIN_DNS_TARGET?.trim() || 'nsromania.info.';
        return target.endsWith('.') ? target : `${target}.`;
    }
    return `${getRemoteServer(serverId).hostname}.`;
}

// Server stored on newly created sites; null keeps them on the main server
export function getDefaultServerForNewDomains(): string | null {
    const configured = process.env.NS_DEFAULT_SERVER?.trim();
    if (!configured || configured === MAIN_SERVER_ID) {
        return null;
    }
    // Fail loudly on a typo instead of creating instances on a server the panel cannot manage
    getRemoteServer(configured);
    return configured;
}

// Server preselected when an admin initializes a site
export function getDefaultServerId(): string {
    return getDefaultServerForNewDomains() ?? MAIN_SERVER_ID;
}

export function getHostingServers(): HostingServerInfo[] {
    return [
        { id: MAIN_SERVER_ID, hostname: getDnsTarget(MAIN_SERVER_ID).replace(/\.$/, '') },
        ...Array.from(getRemoteServers().values()).map(({ id, hostname }) => ({ id, hostname })),
    ];
}
