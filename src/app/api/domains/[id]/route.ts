import { NextApiRequest } from 'next';
import { getNSDomainById } from '../../../../lib/services/domains';

export async function GET(req: NextApiRequest, { params }: { params: { id: string } }) {

    const { id } = await params;
    try {
        const nsDomains = await getNSDomainById(parseInt(id));
        return new Response(JSON.stringify(nsDomains), {
            headers: { "Content-Type": "application/json" },
        });
    } catch (error) {
        console.error("Error fetching NS domains:", error);
        return new Response(
            JSON.stringify({ error: "Failed to fetch NS domains" }),
            {
                status: 500,
                headers: { "Content-Type": "application/json" },
            }
        );
    }

}