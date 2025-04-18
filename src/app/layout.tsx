import * as React from 'react';
import { NextAppProvider } from '@toolpad/core/nextjs';
import { AppRouterCacheProvider } from '@mui/material-nextjs/v15-appRouter';
import DashboardIcon from '@mui/icons-material/Dashboard';
import type { Navigation, NavigationItem } from '@toolpad/core/AppProvider';
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

    const navigationItemsDict: Record<number, NavigationItem> = {};

    navigationItemsDict[0] = {
        kind: 'header',
        title: t('menu'),
    };

    navigationItemsDict[1] = {
        title: t('home'),
        icon: <DashboardIcon />,
    };

    if (session?.user?.role === 'admin') {
        navigationItemsDict[2] = {
            segment: 'domains',
            title: t('domains'),
            pattern: 'domains{/:id}*',
            icon: <Domain />,
        };

        navigationItemsDict[4] = {
            segment: 'requests',
            title: t('requests'),
            pattern: 'requests{/:id}*',
            icon: <HowToReg />,
        };
    }
    navigationItemsDict[3] = {
        title: t('newDomain'),
        segment: 'newdomain',
        icon: <DomainAdd />,
    };

    if (session?.user?.role === 'user') {
        navigationItemsDict[2] = {
            segment: 'domains',
            title: t('myDomains'),
            pattern: 'domains{/:id}*',
            icon: <Domain />,
        };
    }

    const navigation: Navigation = Object.entries(navigationItemsDict)
        .sort(([orderA], [orderB]) => Number(orderA) - Number(orderB))
        .map(([, item]) => item);

    return (
        <html lang={locale} data-toolpad-color-scheme="light" suppressHydrationWarning={true}>
            <body>
                <SessionProvider session={session}>
                    <AppRouterCacheProvider options={{ enableCssLayer: true }}>
                        <NextIntlClientProvider messages={messages}>
                            <NextAppProvider
                                navigation={navigation}
                                branding={BRANDING}
                                session={session}
                                authentication={AUTHENTICATION}
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
