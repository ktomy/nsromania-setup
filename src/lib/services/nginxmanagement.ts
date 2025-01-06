import { exec } from "child_process";
import { promises as fs } from "fs";

export async function createVirtualHost(domain: string, port: number) {

    if (!domain) {
        throw new Error('Domain name is required');
    }

    if (domain.length < 3) {
        throw new Error('Domain name must be at least 3 characters long');
    }

    if (domain.length > 253) {
        throw new Error('Domain name must be at most 253 characters long');
    }

    if (!/^[a-z0-9-\.]+$/.test(domain)) {
        throw new Error('Domain name must only contain lowercase letters, numbers, dots and hyphens');
    }

    if (!port) {
        throw new Error('Port is required');
    }

    if (port < 11000 || port > 12000) {
        throw new Error('Port must be between 11000 and 12000');
    }

    console.log('Creating virtual host:', domain, 'on port:', port);

    // Create the virtual host configuration file
    const virtualHostFilePath = `/etc/nginx/sites-available/${domain}`;
    const virtualHostTemplateFIlePath = '/etc/nginx/sites-available/_template';
    // Read the template file
    const template = await fs.readFile(virtualHostTemplateFIlePath, 'utf8');

    // Replace placeholders
    const configContent = template
        .replace(/\[% subdomain %\]/g, domain)
        .replace(/\[% port %\]/g, port.toString());

    // Save the new virtual host config
    await fs.writeFile(virtualHostFilePath, configContent, 'utf8');

    //create symlink from sites-available to sites-enabled
    const sitesEnabledFilePath = `/etc/nginx/sites-enabled/${domain}`;
    await fs.symlink(virtualHostFilePath, sitesEnabledFilePath);

    //test nginx configuration and reload it

    try {
        // Test the new configuration
        await exec('nginx -t');

        // Reload nginx
        await exec('systemctl reload nginx');
    } catch (error) {
        throw new Error(`Failed to create virtual host: ${error}`);
    }
}

export async function deleteVirtualHost(domain: string) {

    if (!domain) {
        throw new Error('Domain name is required');
    }

    if (domain.length < 3) {
        throw new Error('Domain name must be at least 3 characters long');
    }

    if (domain.length > 253) {
        throw new Error('Domain name must be at most 253 characters long');
    }

    if (!/^[a-z0-9-\.]+$/.test(domain)) {
        throw new Error('Domain name must only contain lowercase letters, numbers, dots and hyphens');
    }

    console.log('Deleting virtual host:', domain);

    // Remove the virtual host configuration file
    const virtualHostFilePath = `/etc/nginx/sites-available/${domain}`;
    const sitesEnabledFilePath = `/etc/nginx/sites-enabled/${domain}`;

    try {
        // Remove the symlink
        await fs.unlink(sitesEnabledFilePath);

        // Remove the configuration file
        await fs.unlink(virtualHostFilePath);

        // Test nginx configuration and reload it
        await exec('nginx -t');
        await exec('systemctl reload nginx');
    } catch (error) {
        throw new Error(`Failed to delete virtual host: ${error}`);
    }
}

export async function getVirtualHosts() {
    const sitesAvailableDir = '/etc/nginx/sites-available';
    const files = await fs.readdir(sitesAvailableDir);

    const virtualHosts = files
        .filter(file => (file !== '_template' && file !== '00-default' && file !== 'setup'))
        .map(file => file);

    return virtualHosts;
}

