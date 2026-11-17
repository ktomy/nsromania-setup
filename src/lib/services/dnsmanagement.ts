import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { promisify } from 'util';
import { getDnsTarget, MAIN_SERVER_ID } from './servers';

const execFileAsync = promisify(execFile);

const ZONE_NAME = 'nsromania.info';
const ZONE_FILE_PATH = '/etc/bind/zones/nsromania.info';
// Static records (apex, name servers, hosting servers, mail, setup, ...) that instance subdomains must never shadow
const ZONE_HEADER_PATH = '/etc/bind/zones/nsromania.info.header';
const NAMED_CHECKZONE = '/usr/bin/named-checkzone';
const RNDC = '/usr/sbin/rndc';

const CNAME_LINE = /^([A-Za-z0-9-]+)\s+IN\s+CNAME\s+(\S+)\s*$/;
const HEADER_OWNER = /^([A-Za-z0-9_][A-Za-z0-9_.-]*)\s/;

function validateSubdomain(subdomain: string) {
    if (!subdomain) {
        throw new Error('Subdomain name is required');
    }

    if (subdomain.length < 3) {
        throw new Error('Subdomain name must be at least 3 characters long');
    }

    if (subdomain.length > 63) {
        throw new Error('Subdomain name must be at most 63 characters long');
    }

    if (!/^[A-Za-z0-9-]+$/.test(subdomain)) {
        throw new Error('Subdomain name must only contain letters, numbers and hyphens');
    }
}

// Returns the zone text with every CNAME record of the subdomain removed and, when a target is given, exactly one
// record pointing to it appended. Labels compare case-insensitively, as DNS does.
export function setSubdomainRecord(zoneText: string, subdomain: string, target: string | null): string {
    const label = subdomain.toLowerCase();
    let result = zoneText
        .split('\n')
        .filter((line) => {
            const match = CNAME_LINE.exec(line);
            return !(match && match[1].toLowerCase() === label);
        })
        .join('\n');

    if (target) {
        if (result !== '' && !result.endsWith('\n')) {
            result += '\n';
        }
        result += `${subdomain}\tIN\tCNAME\t${target}\n`;
    }
    return result;
}

// Owner labels of the static zone header, relative to the zone apex (e.g. "setup", "d1", "ns1")
export function reservedLabels(headerText: string): Set<string> {
    const labels = new Set<string>();
    for (const line of headerText.split('\n')) {
        const match = HEADER_OWNER.exec(line);
        if (!match) {
            continue;
        }
        const owner = match[1].toLowerCase().replace(/\.$/, '');
        if (owner === ZONE_NAME) {
            continue;
        }
        labels.add(owner.endsWith(`.${ZONE_NAME}`) ? owner.slice(0, -(ZONE_NAME.length + 1)) : owner);
    }
    return labels;
}

async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

// The panel is a single process; serialize zone edits so concurrent initializations cannot lose each other's records
let zoneQueue: Promise<unknown> = Promise.resolve();

function withZoneLock<T>(operation: () => Promise<T>): Promise<T> {
    const run = zoneQueue.then(operation, operation);
    zoneQueue = run.catch(() => undefined);
    return run;
}

// Replace the zone file atomically after named-checkzone accepts the candidate, then reload only this zone.
// A rejected candidate leaves the live zone untouched.
async function writeZoneAndReload(zoneText: string) {
    const stat = await fs.stat(ZONE_FILE_PATH);
    const candidate = path.join(
        path.dirname(ZONE_FILE_PATH),
        `.${path.basename(ZONE_FILE_PATH)}.${process.pid}.${Date.now()}.candidate`
    );

    await fs.writeFile(candidate, zoneText, { mode: 0o600, flag: 'wx' });
    try {
        await fs.chown(candidate, stat.uid, stat.gid);
        await fs.chmod(candidate, stat.mode & 0o7777);
        if (await fileExists(NAMED_CHECKZONE)) {
            await execFileAsync(NAMED_CHECKZONE, ['-q', ZONE_NAME, candidate]);
        }
        await fs.rename(candidate, ZONE_FILE_PATH);
    } catch (error) {
        await fs.rm(candidate, { force: true });
        throw new Error(`Zone update rejected, live zone unchanged: ${error}`);
    }

    try {
        await execFileAsync(RNDC, ['reload', ZONE_NAME]);
    } catch (error) {
        throw new Error(`Failed to reload DNS: ${error}`);
    }
}

// Point the subdomain at the server hosting it, replacing any previous record (also used when moving a site)
export async function createSubdomain(subdomain: string, serverId: string = MAIN_SERVER_ID) {
    validateSubdomain(subdomain);
    const target = getDnsTarget(serverId);

    await withZoneLock(async () => {
        if (await fileExists(ZONE_HEADER_PATH)) {
            const reserved = reservedLabels(await fs.readFile(ZONE_HEADER_PATH, 'utf8'));
            if (reserved.has(subdomain.toLowerCase())) {
                throw new Error(`Subdomain ${subdomain} is reserved`);
            }
        }

        const zoneText = await fs.readFile(ZONE_FILE_PATH, 'utf8');
        const updated = setSubdomainRecord(zoneText, subdomain, target);
        if (updated !== zoneText) {
            await writeZoneAndReload(updated);
        }
    });
    console.log('Created subdomain:', subdomain, '->', target);
}

export async function deleteSubdomain(subdomain: string) {
    if (!subdomain) {
        throw new Error('Subdomain name is required');
    }

    await withZoneLock(async () => {
        const zoneText = await fs.readFile(ZONE_FILE_PATH, 'utf8');
        const updated = setSubdomainRecord(zoneText, subdomain, null);
        if (updated === zoneText) {
            throw new Error('Subdomain does not exist');
        }
        await writeZoneAndReload(updated);
    });
    console.log('Deleted subdomain:', subdomain);
}

export async function listSubdomains() {
    try {
        const zoneFile = await fs.readFile(ZONE_FILE_PATH, 'utf8');
        return zoneFile
            .split('\n')
            .map((line) => CNAME_LINE.exec(line)?.[1])
            .filter((label): label is string => label !== undefined);
    } catch (error) {
        throw new Error(`Failed to list subdomains: ${error}`);
    }
}
