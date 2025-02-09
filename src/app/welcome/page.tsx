import * as React from 'react';
import Typography from '@mui/material/Typography';
import { Box, Button } from '@mui/material';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import LocaleSwitcher from '@/lib/components/LocaleSwitcher';

export default function WelcomePage() {
    const t = useTranslations('WelcomePage');

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, mt: 4 }}>
            <LocaleSwitcher />
            <Typography variant="h4">{t('welcomeTitle')}</Typography>
            <Typography variant="body1">
                {t('welcomeMessage1')}
                <br />
                {t('welcomeMessage2')}
                <br />
                {t('welcomeMessage3')}
                <br />
                {t('welcomeMessage4')}
            </Typography>
            <table cellPadding={10}>
                <tbody>
                    <tr>
                        <td>
                            <Button variant="contained" color="primary" component={Link} href="/auth/signin">
                                {t('signIn')}
                            </Button>
                        </td>
                        <td>
                            <Button variant="contained" color="primary" component={Link} href="/welcome/register">
                                {t('register')}
                            </Button>
                        </td>
                    </tr>
                </tbody>
            </table>
            <Typography variant="body1">
                {t('contactMessage')} <a href="mailto:artiom@gmail.com">artiom@gmail.com</a>
            </Typography>
        </Box>
    );
}