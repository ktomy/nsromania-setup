// Environment variable names a Nightscout instance can read, and the only ones the host agent of an additional server
// accepts: letters, digits and underscores, not starting with a digit, at most 128 characters. Names typed with
// surrounding spaces or a trailing ':' (copied from documentation) were stored as they were and never reached
// Nightscout under the intended name.
export function sanitizeEnvVariableName(name: string | null | undefined): string {
    const cleaned = (name ?? '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 128);
    return /^[A-Za-z_]/.test(cleaned) ? cleaned : '';
}
