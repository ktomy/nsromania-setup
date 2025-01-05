import { exec } from "child_process";
import { promises as fs } from "fs";

export async function createSubdomain(subdomain: string) {

    if (!subdomain) {
        throw new Error('Subdomain name is required');
    }

    if (subdomain.length < 3) {
        throw new Error('Subdomain name must be at least 3 characters long');
    }

    if (subdomain.length > 32) {
        throw new Error('Subdomain name must be at most 63 characters long');
    }

    if (!/^[a-z0-9-]+$/.test(subdomain)) {
        throw new Error('Subdomain name must only contain lowercase letters, numbers and hyphens');
    }

    // Read and modify the zone file
    const zoneFilePath = '/etc/bind/zones/nsromania.info';
    const newEntry = `${subdomain}\tIN\tCNAME\tnsromania.info.\n`;

    try {
        // Append the new subdomain entry to the zone file
        await fs.appendFile(zoneFilePath, newEntry);

        let lastErrorOutput: string | null = null;
        try {
            const { stdout, stderr } = await exec('rndc reload');
            lastErrorOutput = stderr?.read();
        } catch (error) {
            throw new Error(`Failed to reload DNS: ${error}, ${lastErrorOutput}`);
        }
    } catch (error) {
        throw new Error(`Failed to create subdomain: ${error}`);
    }
    console.log('Created subdomain:', subdomain);
}

export async function deleteSubdomain(subdomain: string) {

    if (!subdomain) {
        throw new Error('Subdomain name is required');
    }

    if (subdomain.length < 3) {
        throw new Error('Subdomain name must be at least 3 characters long');
    }

    if (subdomain.length > 32) {
        throw new Error('Subdomain name must be at most 63 characters long');
    }

    if (!/^[a-z0-9-]+$/.test(subdomain)) {
        throw new Error('Subdomain name must only contain lowercase letters, numbers and hyphens');
    }

    // Read and modify the zone file
    const zoneFilePath = '/etc/bind/zones/nsromania.info';
    const entryToRemove = `${subdomain}\tIN\CNAME\tnsromania.info.\n`;

    try {
        // Read the zone file and remove the entry, save the file
        const zoneFile = await fs.readFile(zoneFilePath, 'utf8');
        const newZoneFile = zoneFile.replace(entryToRemove, '');
        await fs.writeFile(zoneFilePath, newZoneFile);


        // Reload BIND configuration using rndc
        let lastErrorOutput: string | null = null;
        try {
            const { stdout, stderr } = await exec('rndc reload');
            lastErrorOutput = stderr?.read();
        } catch (error) {
            throw new Error(`Failed to reload DNS: ${error}, ${lastErrorOutput}`);
        }

    } catch (error) {
        throw new Error(`Failed to delete subdomain: ${error}`);
    }
    console.log('Deleted subdomain:', subdomain);
}

export async function listSubdomains() {
    const zoneFilePath = '/etc/bind/zones/nsromania.info';

    try {
        const zoneFile = await fs.readFile(zoneFilePath, 'utf8');
        const subdomains = zoneFile
            .split('\n')
            .filter((line) => line.includes('CNAME'))
            .map((line) => line.split('\t')[0]);

        return subdomains;
    } catch (error) {
        throw new Error(`Failed to list subdomains: ${error}`);
    }
}
