// Environment variable names a Nightscout instance can read, and the only ones the host agent of an additional server
// accepts: letters, digits and underscores, not starting with a digit, at most 128 characters. Names typed with
// surrounding spaces or a trailing ':' (copied from documentation) were stored as they were and never reached
// Nightscout under the intended name.
export function sanitizeEnvVariableName(name: string | null | undefined): string {
    const cleaned = (name ?? '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 128);
    return /^[A-Za-z_]/.test(cleaned) ? cleaned : '';
}

// Variables a site's own environment rows must never set. Instances run in root PM2, so variables read by Node, the
// dynamic linker, OpenSSL or a shell would let a site owner run code as root on the hosting server (for example
// NODE_OPTIONS="--import data:..."). PORT is fixed per site; overriding it could take over another site's traffic.
// Keep in sync with RESERVED_ENV_* in ops/servers/host_agent.py.
const RESERVED_ENV_PREFIXES = ['NODE_', 'NPM_', 'LD_', 'DYLD_', 'UV_', 'PM2_', 'OPENSSL_', 'BASH_', 'MALLOC_'];
const RESERVED_ENV_NAMES = new Set([
    'PORT',
    'PATH',
    'HOME',
    'PWD',
    'USER',
    'LOGNAME',
    'SHELL',
    'ENV',
    'IFS',
    'TMPDIR',
    'GCONV_PATH',
    'LOCPATH',
    'HOSTALIASES',
    'RES_OPTIONS',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR',
    'PYTHONPATH',
    'PERL5LIB',
]);

export function isReservedEnvVariableName(name: string): boolean {
    const upper = name.toUpperCase();
    return RESERVED_ENV_NAMES.has(upper) || RESERVED_ENV_PREFIXES.some((prefix) => upper.startsWith(prefix));
}
