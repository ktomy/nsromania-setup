import * as React from 'react';
import { AppProvider } from '@toolpad/core/nextjs';
import { AppRouterCacheProvider } from '@mui/material-nextjs/v15-appRouter';
import DashboardIcon from '@mui/icons-material/Dashboard';
import type { Navigation } from '@toolpad/core/AppProvider';
import { SessionProvider, signIn, signOut } from 'next-auth/react';
import { auth } from '../auth';
import { Domain, DomainAdd } from '@mui/icons-material';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { headers } from 'next/headers';

const NAVIGATION: Navigation = [
    {
        kind: 'header',
        title: 'Meniu',
    },
    {
        title: 'Home',
        icon: <DashboardIcon />,
    },
    {
        segment: 'domains',
        title: 'Domains',
        pattern: 'domains{/:id}*',
        icon: <Domain />,
    },
    {
        title: "New domain",
        segment: "newdomain",
        icon: <DomainAdd />,
    }
];

const BRANDING = {
    title: 'NSRomania',

};

const AUTHENTICATION = {
    signIn,
    signOut,
};

export default async function RootLayout(props: { children: React.ReactNode }) {

    const session = await auth();

    const locale = await getLocale();

    const messages = await getMessages();

    return (
        <html lang={locale} data-toolpad-color-scheme="light">
            <body>
                <SessionProvider session={session}>
                    <AppRouterCacheProvider options={{ enableCssLayer: true }}>
                        <NextIntlClientProvider messages={messages}>
                            <AppProvider
                                navigation={NAVIGATION}
                                branding={BRANDING}
                                session={session}
                                authentication={AUTHENTICATION}
                            // theme={THEME}
                            >
                                {props.children}
                            </AppProvider>
                        </NextIntlClientProvider>
                    </AppRouterCacheProvider>
                </SessionProvider>
            </body>
        </html>
    );
}
