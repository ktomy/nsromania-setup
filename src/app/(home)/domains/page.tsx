import { auth } from '@/auth';
import { User } from '@prisma/client';
import DomainsList from './DomainsList';
import { getTranslations } from 'next-intl/server';

export default async function DomainsPage() {
    const t = await getTranslations('DomainsPage');
    const session = await auth();

    if (!session) {
        return <p>{t('notSignedIn')}</p>;
    }

    const user = session.user as User;

    return <DomainsList user={user} />;
}
