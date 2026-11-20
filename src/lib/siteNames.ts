// A site's subdomain is also its MongoDB database and user name, its nginx vhost file name and part of its PM2 process
// name, so it must never name something that is not a site. Used by the browser too: no server-only imports here.

// MongoDB system databases, reserved nginx vhosts and DNS labels of the panel itself. The zone header is checked as
// well when DNS is written (dnsmanagement.ts).
const RESERVED_SITE_NAMES = new Set(['admin', 'local', 'config', 'setup', 'default', '00-default', 'www', 'mail']);

export const SITE_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/;

export function isReservedSiteName(name: string): boolean {
    return RESERVED_SITE_NAMES.has(name.toLowerCase());
}

// 3 to 63 lowercase letters, digits and inner hyphens (the DNS and nginx code refuse shorter names), and not reserved
export function isValidSiteName(name: unknown): name is string {
    return typeof name === 'string' && SITE_NAME_PATTERN.test(name) && !isReservedSiteName(name);
}
