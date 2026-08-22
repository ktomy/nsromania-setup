import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { getAvailableVersions, getLatestAvailableVersion } from '../nsversion';

describe('Nightscout version discovery', () => {
    const originalNsHome = process.env.NS_HOME;
    let tempRoot: string;
    let warnSpy: jest.SpiedFunction<typeof console.warn>;

    beforeEach(async () => {
        tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nsversion-'));
        process.env.NS_HOME = tempRoot;
        warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(async () => {
        warnSpy.mockRestore();
        if (originalNsHome === undefined) {
            delete process.env.NS_HOME;
        } else {
            process.env.NS_HOME = originalNsHome;
        }
        await fs.rm(tempRoot, { recursive: true, force: true });
    });

    async function installVersion(directoryName: string, version: unknown): Promise<void> {
        const versionDirectory = path.join(tempRoot, directoryName);
        await fs.mkdir(versionDirectory, { recursive: true });
        await fs.writeFile(
            path.join(versionDirectory, 'package.json'),
            JSON.stringify({ name: 'nightscout', version }),
            'utf-8'
        );
    }

    it('sorts installed versions by semantic version, newest first', async () => {
        await installVersion('version-15.0.9', '15.0.9');
        await installVersion('version-15.0.10-beta.1', '15.0.10-beta.1');
        await installVersion('version-15.0.10', '15.0.10');
        await installVersion('invalid-version', 'not-semver');

        const versions = await getAvailableVersions();

        expect(versions.map((version) => version.directoryName)).toEqual([
            'version-15.0.10',
            'version-15.0.10-beta.1',
            'version-15.0.9',
        ]);
    });

    it('returns the directory containing the highest semantic version', async () => {
        await installVersion('master', '15.0.9');
        await installVersion('version-15.0.10', '15.0.10');

        await expect(getLatestAvailableVersion()).resolves.toEqual(
            expect.objectContaining({ directoryName: 'version-15.0.10', version: '15.0.10' })
        );
    });

    it('fails when no installed Nightscout version is available', async () => {
        await expect(getLatestAvailableVersion()).rejects.toThrow('No installed Nightscout versions are available');
    });
});
