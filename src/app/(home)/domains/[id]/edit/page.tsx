import { auth } from '@/auth';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import EditDomainForm from './EditDomainForm';
import { Typography } from '@mui/material';
import { User } from '@prisma/client';
import { getFullDOmainData } from '@/lib/services/domains';


export default async function EditDomainPage({ params }: { params: Promise<{ id: string }> }) {

    const awaitedParams = await params;
    const idNumber = parseInt(awaitedParams.id);
    if (isNaN(idNumber)) {
        notFound();
    }
    const t = await getTranslations('EditDomainPage');
    const session = await auth();
    
    // Check authentication
    if (!session) {
        return <Typography>{t('notSignedIn')}</Typography>;
    }
    
    // Fetch domain data server-side
    const domainData = await getFullDOmainData(idNumber);
    
    if (!domainData) {
        notFound();
    }
    
    // Check authorization - only allow domain owner or admin
    const user = session.user as User;
    if (user.role !== 'admin' && domainData.authUser?.id !== user.id) {
        return <Typography>{t('notAuthorized')}</Typography>;
    }
    
    // Render the client component with the server-fetched data
    return <EditDomainForm domainData={domainData} idNumber={idNumber} />;
}
