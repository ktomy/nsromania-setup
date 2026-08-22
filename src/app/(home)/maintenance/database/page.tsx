import { auth } from '@/auth';
import { getTranslations } from 'next-intl/server';
import DatabaseMaintenanceTools from './DatabaseMaintenanceTools';

export default async function DatabaseMaintenancePage() {
    const t = await getTranslations('MaintenancePage');
    const session = await auth();

    if (!session) {
        return <p>{t('notSignedIn')}</p>;
    }

    if (session.user.role !== 'admin') {
        return <p>{t('notAuthorized')}</p>;
    }

    return <DatabaseMaintenanceTools />;
}
