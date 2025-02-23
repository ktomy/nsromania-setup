import * as React from 'react';
import { NextAppProvider } from '@toolpad/core/nextjs';
import { AppRouterCacheProvider } from '@mui/material-nextjs/v15-appRouter';
import DashboardIcon from '@mui/icons-material/Dashboard';
import type { Navigation } from '@toolpad/core/AppProvider';
import { SessionProvider, signIn, signOut } from 'next-auth/react';
import { auth } from '../auth';
import { Domain, DomainAdd, HowToReg } from '@mui/icons-material';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages, getTranslations } from 'next-intl/server';

const BRANDING = {
    title: 'NSRomania',

};

const AUTHENTICATION = {
    signIn,
    signOut,
};

export default async function RootLayout(props: { children: React.ReactNode }) {

    const session = await auth();
    // console.log("(Home) Session: ", session);

    const locale = await getLocale();

    const messages = await getMessages();
    const t = await getTranslations('App');

    let navigation: Navigation = [];

    navigation.push({
        kind: 'header',
        title: t('menu'),
    });

    navigation.push({
        title: t('home'),
        icon: <DashboardIcon />,
    });

    if (session?.user?.role === 'admin') {
        navigation.push({
            segment: 'domains',
            title: t('domains'),
            pattern: 'domains{/:id}*',
            icon: <Domain />,
        });
        navigation.push({
            title: t('newDomain'),
            segment: "newdomain",
            icon: <DomainAdd />,
        });
        navigation.push({
            segment: 'requests',
            title: t('requests'),
            pattern: 'requests{/:id}*',
            icon: <HowToReg />,

        });
    }

    if (session?.user?.role === 'user') {
        navigation.push({
            segment: 'domains',
            title: t('myDomains'),
            pattern: 'domains{/:id}*',
            icon: <Domain />,
        });
    }

    return (
        <html lang={locale} data-toolpad-color-scheme="light">
            <body>
                <SessionProvider session={session}>
                    <AppRouterCacheProvider options={{ enableCssLayer: true }}>
                        <NextIntlClientProvider messages={messages}>
                            <NextAppProvider
                                navigation={navigation}
                                branding={BRANDING}
                                session={session}
                                authentication={AUTHENTICATION}
                            // theme={THEME}
                            >
                                {props.children}
                            </NextAppProvider>
                        </NextIntlClientProvider>
                    </AppRouterCacheProvider>
                </SessionProvider>
            </body>
        </html>
    );
}
