import * as React from 'react';
import Typography from '@mui/material/Typography';
import { Box, Button } from '@mui/material';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';

export default function RegisterPage() {
    const t = useTranslations('RegisterPage');
    const locale = useLocale();

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, mt: 4 }}>
            <Typography variant="h4">{t('registrationTitle')}</Typography>
            <Typography variant="body1">
                {t('registrationUnavailable')}
                <br />
                {t('registrationPrompt')}
                <a target='_blank' href="https://www.facebook.com/groups/noisidiabetul/posts/3015947701975505/">{t('registrationForm')}</a>
            </Typography>

            <Typography variant="body1">
                {t('contactMessage')} <a href="mailto:artiom@gmail.com">artiom@gmail.com</a>
            </Typography>
        </Box>
    );
}