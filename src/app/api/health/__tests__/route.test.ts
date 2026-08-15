/** @jest-environment node */

describe('GET /api/health', () => {
    const originalCommitHash = process.env.NEXT_PUBLIC_COMMIT_HASH;

    afterEach(() => {
        if (originalCommitHash === undefined) {
            delete process.env.NEXT_PUBLIC_COMMIT_HASH;
        } else {
            process.env.NEXT_PUBLIC_COMMIT_HASH = originalCommitHash;
        }
        jest.resetModules();
    });

    it('returns a DB-independent status and commit hash without caching', async () => {
        process.env.NEXT_PUBLIC_COMMIT_HASH = '0123456789abcdef0123456789abcdef01234567';

        const { GET } = await import('../route');
        const response = GET();

        expect(response.status).toBe(200);
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        await expect(response.json()).resolves.toEqual({
            status: 'ok',
            commit: '0123456789abcdef0123456789abcdef01234567',
        });
    });
});
