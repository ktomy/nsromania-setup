export const dynamic = 'force-dynamic';

export function GET() {
    return Response.json(
        {
            status: 'ok',
            commit: process.env.NEXT_PUBLIC_COMMIT_HASH || 'unknown',
        },
        {
            headers: {
                'Cache-Control': 'no-store',
            },
        }
    );
}
