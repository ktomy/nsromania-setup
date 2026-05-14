import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { resolveNightscoutNodeInterpreter } from '../nsnode';

describe('resolveNightscoutNodeInterpreter', () => {
    const originalNsNodeVersionsDir = process.env.NS_NODE_VERSIONS_DIR;
    let tempRoot: string;
    let nightscoutDirectory: string;
    let versionsDirectory: string;

    beforeEach(async () => {
        tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nsnode-'));
        nightscoutDirectory = path.join(tempRoot, 'nightscout');
        versionsDirectory = path.join(tempRoot, 'node-versions');

        await fs.mkdir(nightscoutDirectory, { recursive: true });
        await fs.mkdir(versionsDirectory, { recursive: true });
        process.env.NS_NODE_VERSIONS_DIR = versionsDirectory;
    });

    afterEach(async () => {
        process.env.NS_NODE_VERSIONS_DIR = originalNsNodeVersionsDir;
        await fs.rm(tempRoot, { recursive: true, force: true });
    });

    async function writeNightscoutPackageJson(packageJson: unknown): Promise<void> {
        await fs.writeFile(path.join(nightscoutDirectory, 'package.json'), JSON.stringify(packageJson), 'utf-8');
    }

    async function installNodeVersion(version: string): Promise<string> {
        const nodePath = path.join(versionsDirectory, `v${version}`, 'bin', 'node');
        await fs.mkdir(path.dirname(nodePath), { recursive: true });
        await fs.writeFile(nodePath, '');
        return nodePath;
    }

    it('selects Node 22 when engines.node is >=20.x and Node 22 is available', async () => {
        await writeNightscoutPackageJson({ engines: { node: '>=20.x' } });
        await installNodeVersion('14.21.3');
        await installNodeVersion('20.11.1');
        const node22Path = await installNodeVersion('22.11.0');

        await expect(resolveNightscoutNodeInterpreter(nightscoutDirectory)).resolves.toBe(node22Path);
    });

    it('falls back to a Node 14-compatible range when engines.node is missing', async () => {
        await writeNightscoutPackageJson({});
        const node14Path = await installNodeVersion('14.21.3');
        await installNodeVersion('20.11.1');
        await installNodeVersion('22.11.0');

        await expect(resolveNightscoutNodeInterpreter(nightscoutDirectory)).resolves.toBe(node14Path);
    });

    it('selects the newest installed version satisfying the required range', async () => {
        await writeNightscoutPackageJson({ engines: { node: '>=20 <22' } });
        await installNodeVersion('20.10.0');
        const node20NewerPath = await installNodeVersion('20.11.1');
        await installNodeVersion('14.21.3');
        await installNodeVersion('22.11.0');

        await expect(resolveNightscoutNodeInterpreter(nightscoutDirectory)).resolves.toBe(node20NewerPath);
    });

    it('fails clearly when NS_NODE_VERSIONS_DIR is missing', async () => {
        await writeNightscoutPackageJson({ engines: { node: '>=20.x' } });
        delete process.env.NS_NODE_VERSIONS_DIR;

        await expect(resolveNightscoutNodeInterpreter(nightscoutDirectory)).rejects.toThrow(
            'NS_NODE_VERSIONS_DIR environment variable is not set'
        );
    });

    it('fails clearly when the Nightscout package.json is missing', async () => {
        await installNodeVersion('20.11.1');

        await expect(resolveNightscoutNodeInterpreter(nightscoutDirectory)).rejects.toThrow(
            `Unable to read Nightscout package.json at ${path.join(nightscoutDirectory, 'package.json')}`
        );
    });

    it('fails clearly when the Nightscout package.json is invalid JSON', async () => {
        await fs.writeFile(path.join(nightscoutDirectory, 'package.json'), '{invalid', 'utf-8');
        await installNodeVersion('20.11.1');

        await expect(resolveNightscoutNodeInterpreter(nightscoutDirectory)).rejects.toThrow(
            `Invalid Nightscout package.json at ${path.join(nightscoutDirectory, 'package.json')}`
        );
    });

    it('fails clearly when package metadata has a malformed engines field', async () => {
        await writeNightscoutPackageJson({ engines: '>=20' });
        await installNodeVersion('20.11.1');

        await expect(resolveNightscoutNodeInterpreter(nightscoutDirectory)).rejects.toThrow(
            'Nightscout package.json engines must be an object when provided'
        );
    });

    it('fails clearly when package metadata has a non-string engines.node field', async () => {
        await writeNightscoutPackageJson({ engines: { node: 20 } });
        await installNodeVersion('20.11.1');

        await expect(resolveNightscoutNodeInterpreter(nightscoutDirectory)).rejects.toThrow(
            'Nightscout package.json engines.node must be a string when provided'
        );
    });

    it('fails clearly when package metadata has an empty engines.node field', async () => {
        await writeNightscoutPackageJson({ engines: { node: '' } });
        await installNodeVersion('14.21.3');

        await expect(resolveNightscoutNodeInterpreter(nightscoutDirectory)).rejects.toThrow(
            'Nightscout package.json engines.node must not be empty when provided'
        );
    });

    it('fails clearly when package metadata has a null engines.node field', async () => {
        await writeNightscoutPackageJson({ engines: { node: null } });
        await installNodeVersion('14.21.3');

        await expect(resolveNightscoutNodeInterpreter(nightscoutDirectory)).rejects.toThrow(
            'Nightscout package.json engines.node must be a string when provided'
        );
    });

    it('fails without fallback when no installed Node version satisfies the required range', async () => {
        await writeNightscoutPackageJson({ engines: { node: '>=22 <23' } });
        await installNodeVersion('14.21.3');
        await installNodeVersion('20.11.1');

        await expect(resolveNightscoutNodeInterpreter(nightscoutDirectory)).rejects.toThrow(
            'No installed Node interpreter satisfies Nightscout engines.node range >=22 <23'
        );
    });

    it('fails clearly when the versions directory cannot be read', async () => {
        await writeNightscoutPackageJson({ engines: { node: '>=20.x' } });
        process.env.NS_NODE_VERSIONS_DIR = path.join(tempRoot, 'missing-versions');

        await expect(resolveNightscoutNodeInterpreter(nightscoutDirectory)).rejects.toThrow(
            `Unable to read NS_NODE_VERSIONS_DIR at ${process.env.NS_NODE_VERSIONS_DIR}`
        );
    });
});
