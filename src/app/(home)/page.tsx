import * as React from 'react';
import Typography from '@mui/material/Typography';
import { auth } from '../../auth';
import { useLocale, useTranslations } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { Box } from '@mui/material';

export default async function HomePage() {
    const session = await auth();
    const t = await getTranslations('HomePage');
    const lastCommitHash = process.env.NEXT_PUBLIC_COMMIT_HASH || 'Unknown';

    return <Box>
        <Typography>{t('welcomeMessage', { name: session?.user?.name || 'User', id: session?.user?.id || "Unknown ID" })}</Typography>
        <Typography variant="body2">Last commit: {lastCommitHash}</Typography>
    </Box>;
}
