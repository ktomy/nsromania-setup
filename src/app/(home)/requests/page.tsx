// Server-side component
import RegistrationRequestsList from './RegistrationRequestsList';
import { getTranslations } from 'next-intl/server';
import { auth } from '@/auth';
import { User } from '@/generated/client';

export default async function RequestsPage() {
    const t = await getTranslations('RequestsPage');
    const session = await auth();

    if (!session) {
        return <p>{t('notSignedIn')}</p>;
    }
    if (session.user.role !== 'admin') {
        return <p>{t('notAuthorized')}</p>;
    }

    const user = session.user as User;
    return <RegistrationRequestsList user={user} />;
}
