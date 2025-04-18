import * as React from 'react';
import Typography from '@mui/material/Typography';
import { Box, Button } from '@mui/material';
import { useTranslations } from 'next-intl';

export default function RegistrationSuccess() {
    const t = useTranslations('RegistrationSuccessPage');

    return (
        <Box
            sx={{
                height: '100vh',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'start',
                alignItems: 'center',
                gap: 2,
            }}
        >
            <Typography variant="h4">{t('registrationSuccess')}</Typography>
            <Typography variant="body1">{t('registrationSuccessMessage')}</Typography>
            <Button variant="contained" color="primary" href="/">
                {t('home')}
            </Button>
        </Box>
    );
}