// Server-side component
import { auth } from '@/auth';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import RequestDetails from './RequestDetails';
import { getRegistrationRequestById } from '@/lib/services/registration';

async function getRequestData(id: number) {
    return await getRegistrationRequestById(id);
}

export default async function RequestDetailsPage({ params }: { params: Promise<{ id: string }> }) {
    const t = await getTranslations('RequestsPage');
    const session = await auth();

    // Check authentication
    if (!session) {
        return <p>{t('notSignedIn')}</p>;
    }
    
    // Check authorization
    if (session.user.role !== 'admin') {
        return <p>{t('notAuthorized')}</p>;
    }

    // Fetch data server-side
    const awaitedParams = await params;
    const idNumber = parseInt(awaitedParams.id);
    if (isNaN(idNumber)) {
        notFound();
    }
    const request = await getRequestData(idNumber);
    
    if (!request) {
        notFound();
    }

    // Render the client component with the server-fetched data
    return <RequestDetails request={request} />;
}
