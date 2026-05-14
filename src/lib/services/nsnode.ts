import { Dirent, promises as fs } from 'fs';
import path from 'path';
import semver from 'semver';

const DEFAULT_NODE_RANGE = '>=14 <15';

interface NightscoutPackageJson {
    engines?: {
        node?: unknown;
    };
}

interface InstalledNodeInterpreter {
    version: string;
    nodePath: string;
}

async function readNightscoutPackageJson(nightscoutDirectory: string): Promise<NightscoutPackageJson> {
    const packageJsonPath = path.join(nightscoutDirectory, 'package.json');

    let packageJsonContent: string;
    try {
        packageJsonContent = await fs.readFile(packageJsonPath, 'utf-8');
    } catch (error) {
        throw new Error(`Unable to read Nightscout package.json at ${packageJsonPath}`, { cause: error });
    }

    try {
        const packageJson = JSON.parse(packageJsonContent);
        if (!packageJson || typeof packageJson !== 'object' || Array.isArray(packageJson)) {
            throw new Error('package.json must contain a JSON object');
        }

        return packageJson as NightscoutPackageJson;
    } catch (error) {
        throw new Error(`Invalid Nightscout package.json at ${packageJsonPath}`, { cause: error });
    }
}

async function getInstalledNodeInterpreters(versionsDirectory: string): Promise<InstalledNodeInterpreter[]> {
    let entries: Dirent[];

    try {
        entries = await fs.readdir(versionsDirectory, { withFileTypes: true });
    } catch (error) {
        throw new Error(`Unable to read NS_NODE_VERSIONS_DIR at ${versionsDirectory}`, { cause: error });
    }

    const interpreters: InstalledNodeInterpreter[] = [];

    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }

        const versionMatch = /^v(.+)$/.exec(entry.name);
        if (!versionMatch) {
            continue;
        }

        const version = semver.valid(versionMatch[1]);
        if (!version) {
            continue;
        }

        const nodePath = path.join(versionsDirectory, entry.name, 'bin', 'node');
        try {
            await fs.access(nodePath);
            interpreters.push({ version, nodePath });
        } catch {
            continue;
        }
    }

    return interpreters;
}

function getRequiredNodeRange(packageJson: NightscoutPackageJson): string {
    const engines = packageJson.engines;
    if (engines === undefined) {
        return DEFAULT_NODE_RANGE;
    }

    if (engines === null || typeof engines !== 'object' || Array.isArray(engines)) {
        throw new Error('Nightscout package.json engines must be an object when provided');
    }

    if (!Object.prototype.hasOwnProperty.call(engines, 'node')) {
        return DEFAULT_NODE_RANGE;
    }

    const configuredRange = engines.node;
    if (typeof configuredRange !== 'string') {
        throw new Error('Nightscout package.json engines.node must be a string when provided');
    }

    if (configuredRange.trim() === '') {
        throw new Error('Nightscout package.json engines.node must not be empty when provided');
    }

    const validRange = semver.validRange(configuredRange);
    if (!validRange) {
        throw new Error(`Invalid Nightscout engines.node range: ${configuredRange}`);
    }

    return configuredRange;
}

export async function resolveNightscoutNodeInterpreter(nightscoutDirectory: string): Promise<string> {
    const versionsDirectory = process.env.NS_NODE_VERSIONS_DIR;
    if (!versionsDirectory) {
        throw new Error('NS_NODE_VERSIONS_DIR environment variable is not set');
    }

    const packageJson = await readNightscoutPackageJson(nightscoutDirectory);
    const requiredRange = getRequiredNodeRange(packageJson);
    const installedInterpreters = await getInstalledNodeInterpreters(versionsDirectory);
    const matchingInterpreter = installedInterpreters
        .filter((interpreter) => semver.satisfies(interpreter.version, requiredRange))
        .sort((a, b) => semver.rcompare(a.version, b.version))[0];

    if (!matchingInterpreter) {
        throw new Error(`No installed Node interpreter satisfies Nightscout engines.node range ${requiredRange}`);
    }

    return matchingInterpreter.nodePath;
}
