import { getAvailableVersions } from '@/lib/services/nsversion';
import { auth } from '@/auth';

export async function GET() {
    const session = await auth();

    if (!session || !session.user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    try {
        const versions = await getAvailableVersions();
        
        return new Response(JSON.stringify(versions), {
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) {
        console.error('Error fetching versions:', error);
        return new Response(
            JSON.stringify({ error: 'Failed to fetch versions' }),
            {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
            }
        );
    }
}
