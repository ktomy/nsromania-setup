import * as React from 'react';
import Typography from '@mui/material/Typography';
import { auth } from '../../auth';
import { useLocale, useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';

export default async function HomePage() {
    const session = await auth();
    const t = await getTranslations('HomePage');

    return <Typography>{t('welcomeMessage', { name: session?.user?.name || 'User', id: session?.user?.id || "Unknown ID" })}</Typography>;
}
