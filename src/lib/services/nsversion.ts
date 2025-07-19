import { promises as fs } from 'fs';
import path from 'path';

export interface NightscoutVersion {
    name: string;
    version: string;
    directoryName: string;
}

/**
 * Gets available Nightscout versions by reading directories in $NS_HOME/<directory_name>/
 * Each directory should contain a packages.json with {"name":"nightscout", "version":"x.y.z"}
 */
export async function getAvailableVersions(): Promise<NightscoutVersion[]> {
    try {
        // Get the path to NS_HOME where version directories are located
        const nsHome = process.env.NS_HOME;
        if (!nsHome) {
            console.warn('NS_HOME environment variable is not set. Versions functionality will not be available.');
            return [];
        }
        
        // Check if NS_HOME directory exists
        try {
            await fs.access(nsHome);
        } catch {
            console.warn(`NS_HOME directory not found at: ${nsHome}. Make sure NS_HOME is correctly configured.`);
            return [];
        }

        // Read all directories in NS_HOME folder
        const entries = await fs.readdir(nsHome, { withFileTypes: true });
        const directories = entries.filter(entry => entry.isDirectory()).map(entry => entry.name);

        const versions: NightscoutVersion[] = [];

        for (const directoryName of directories) {
            try {
                const packageJsonPath = path.join(nsHome, directoryName, 'package.json');

                // Check if package.json exists
                await fs.access(packageJsonPath);

                // Read and parse package.json
                const packageJsonContent = await fs.readFile(packageJsonPath, 'utf-8');
                const packageJson = JSON.parse(packageJsonContent);

                // Validate that it's a nightscout package
                if (packageJson.name === 'nightscout' && packageJson.version) {
                    versions.push({
                        name: packageJson.name,
                        version: packageJson.version,
                        directoryName: directoryName,
                    });
                }
            } catch (error) {
                console.warn(`Error reading package.json for directory ${directoryName}:`, error);
                // Continue with other directories
            }
        }

        if (versions.length === 0) {
            console.warn(`No valid Nightscout versions found in ${process.env.NS_HOME}.`);
            return [];
        }

        // Sort versions by version number (latest first)
        versions.sort((a, b) => {
            // Use semantic version comparison based on actual version numbers
            const aVersion = a.version.split('.').map(v => parseInt(v.replace(/\D+.*$/, ''), 10) || 0);
            const bVersion = b.version.split('.').map(v => parseInt(v.replace(/\D+.*$/, ''), 10) || 0);
            
            for (let i = 0; i < Math.max(aVersion.length, bVersion.length); i++) {
                const aNum = aVersion[i] || 0;
                const bNum = bVersion[i] || 0;
                if (aNum !== bNum) {
                    return bNum - aNum; // Descending order (latest first)
                }
            }
            
            // If versions are the same, sort by directory name alphabetically
            return a.directoryName.localeCompare(b.directoryName);
        });

        return versions;
    } catch (error) {
        console.error('Error getting available versions:', error);
        return [];
    }
}

/**
 * Gets a specific version by directory name
 */
export async function getVersionByDirectoryName(directoryName: string): Promise<NightscoutVersion | null> {
    const versions = await getAvailableVersions();
    return versions.find(v => v.directoryName === directoryName) || null;
}
