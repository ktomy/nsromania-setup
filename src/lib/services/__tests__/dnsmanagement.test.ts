import { reservedLabels, setSubdomainRecord } from '../dnsmanagement';

const ZONE = [
    '$include "/etc/bind/zones/nsromania.info.header"',
    'maya\tIN\tCNAME\tnsromania.info.',
    'ktomy\tIN\tCNAME\tnsromania.info.',
    'carmen\tIN\tCNAME\tnsromania.info.',
    'ktomy\tIN\tCNAME\tnsromania.info.',
    'Madalin5431\tIN\tCNAME\tnsromania.info.',
    '',
].join('\n');

const HEADER = `;
; BIND data file for nsromania.info
;
$TTL\t300
@\tIN\tSOA\tns1.nsromania.info. admin.nsromania.info. (
\t\t     2026111701\t \t; Serial
\t\t\t 604800 )\t; Negative Cache TTL

@\tIN\tNS\tns1.nsromania.info.
ns2\tIN\tA\t45.134.39.79
ns1\tIN\tA\t45.134.39.79
d1\tIN\tA\t31.220.43.162\t; second hosting server
nsromania.info.\tIN\tA\t45.134.39.79
brevo1._domainkey\tIN\tCNAME\tb1.nsromania-info.dkim.brevo.com.
_dmarc\t\t\tIN\tTXT\t"v=DMARC1; p=none"
www\tIN\tCNAME\tnsromania.info.
setup\tIN\tCNAME\tnsromania.info.
join.nsromania.info.\tIN\tCNAME\tnsromania.info.
`;

describe('setSubdomainRecord', () => {
    it('replaces every record of the subdomain with exactly one pointing at the new target', () => {
        const result = setSubdomainRecord(ZONE, 'ktomy', 'd1.nsromania.info.');

        expect(result.match(/^ktomy\t/gm)).toHaveLength(1);
        expect(result).toContain('ktomy\tIN\tCNAME\td1.nsromania.info.\n');
        expect(result).toContain('maya\tIN\tCNAME\tnsromania.info.\n');
        expect(result).toContain('carmen\tIN\tCNAME\tnsromania.info.\n');
        expect(result.startsWith('$include "/etc/bind/zones/nsromania.info.header"\n')).toBe(true);
        expect(result.endsWith('\n')).toBe(true);
    });

    it('matches labels case-insensitively, as DNS does', () => {
        const result = setSubdomainRecord(ZONE, 'madalin5431', null);
        expect(result).not.toMatch(/madalin5431/i);
    });

    it('removes a subdomain and leaves the rest untouched', () => {
        const result = setSubdomainRecord(ZONE, 'ktomy', null);
        expect(result).not.toContain('ktomy');
        expect(result.split('\n')).toHaveLength(ZONE.split('\n').length - 2);
    });

    it('appends a new subdomain and is idempotent', () => {
        const once = setSubdomainRecord(ZONE, 'newsite', 'nsromania.info.');
        expect(once).toBe(`${ZONE}newsite\tIN\tCNAME\tnsromania.info.\n`);
        expect(setSubdomainRecord(once, 'newsite', 'nsromania.info.')).toBe(once);
    });

    it('does not depend on a trailing newline', () => {
        expect(setSubdomainRecord('a\tIN\tCNAME\tx.', 'b', 'y.')).toBe('a\tIN\tCNAME\tx.\nb\tIN\tCNAME\ty.\n');
    });
});

describe('reservedLabels', () => {
    it('collects the static owner names of the zone header', () => {
        const labels = reservedLabels(HEADER);
        for (const label of ['ns1', 'ns2', 'd1', 'www', 'setup', 'join', '_dmarc', 'brevo1._domainkey']) {
            expect(labels.has(label)).toBe(true);
        }
        expect(labels.has('nsromania.info')).toBe(false);
        expect(labels.has('ktomy')).toBe(false);
    });
});
