import * as React from 'react';
import { NextAppProvider } from '@toolpad/core/nextjs';
import { AppRouterCacheProvider } from '@mui/material-nextjs/v15-appRouter';
import DashboardIcon from '@mui/icons-material/Dashboard';
import type { Navigation, NavigationItem } from '@toolpad/core/AppProvider';
import { SessionProvider, signIn, signOut } from 'next-auth/react';
import { auth } from '../auth';
import { Build, Domain, DomainAdd, HowToReg } from '@mui/icons-material';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages, getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';

const BRANDING = {
    title: 'NSRomania',
};

const SITE_NAME = 'NSRomânia';
const SITE_URL = 'https://setup.nsromania.info';

// Title, description and Open Graph tags for browser tabs, search results and social link previews.
// The preview image and favicons come from opengraph-image.tsx, icon.svg and apple-icon.tsx in this folder.
export async function generateMetadata(): Promise<Metadata> {
    const locale = await getLocale();
    const t = await getTranslations('Metadata');
    const title = t('title');
    const description = t('description');

    return {
        metadataBase: new URL(SITE_URL),
        title,
        description,
        applicationName: SITE_NAME,
        openGraph: {
            type: 'website',
            siteName: SITE_NAME,
            title,
            description,
            locale: locale === 'ro' ? 'ro_RO' : 'en_US',
        },
        twitter: {
            card: 'summary_large_image',
            title,
            description,
        },
    };
}

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

        navigationItemsDict[5] = {
            segment: 'maintenance',
            title: t('maintenance'),
            pattern: 'maintenance{/:segment}*',
            icon: <Build />,
            children: [
                { segment: '', title: t('maintenanceTools') },
                { segment: 'database', title: t('maintenanceDatabase') },
            ],
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
