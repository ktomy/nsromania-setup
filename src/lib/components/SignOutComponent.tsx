'use client';
import * as React from 'react';
import { signOut, useSession } from 'next-auth/react';
import { Box, Button, Typography } from '@mui/material';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { User } from 'next-auth';



export default function SignOutComponent({ user }: { user: User | undefined }) {
    const t = useTranslations('SignOutComponent');

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, mt: 4 }}>
            <Typography variant="h6">{t('alreadySignedIn')}</Typography>
            <Typography variant="body1">{user?.email}</Typography>
            <table cellPadding={10}>
                <tbody>
                    <tr>
                        <td>
                            <Button variant="outlined" color="primary" component={Link} href="/">
                                {t('home')}
                            </Button>

                        </td>
                        <td>
                            <Button variant="contained" color="primary" onClick={() => signOut()}>{t('signOut')}</Button>
                        </td>
                    </tr>
                </tbody>
            </table>
        </Box>
    );

}