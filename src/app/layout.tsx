import * as React from 'react';
import { AppProvider } from '@toolpad/core/nextjs';
import { AppRouterCacheProvider } from '@mui/material-nextjs/v15-appRouter';
import DashboardIcon from '@mui/icons-material/Dashboard';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart';
import type { Navigation } from '@toolpad/core/AppProvider';
import { SessionProvider, signIn, signOut } from 'next-auth/react';
import { auth } from '../auth';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { bgBG } from '@mui/x-data-grid/locales';

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
        icon: <ShoppingCartIcon />,
    },
];

const BRANDING = {
    title: 'NSRomania',

};

const AUTHENTICATION = {
    signIn,
    signOut,
};

// const THEME = createTheme(
//     {
//         palette: {
//             primary: { main: '#1976d2' },
//         },
//     },
//     bgBG,
// );

export default async function RootLayout(props: { children: React.ReactNode }) {
    const session = await auth();

    return (
        <html lang="en" data-toolpad-color-scheme="light">
            <body>
                <SessionProvider session={session}>
                    <AppRouterCacheProvider options={{ enableCssLayer: true }}>
                        <AppProvider
                            navigation={NAVIGATION}
                            branding={BRANDING}
                            session={session}
                            authentication={AUTHENTICATION}
                        // theme={THEME}
                        >
                            {props.children}
                        </AppProvider>
                    </AppRouterCacheProvider>
                </SessionProvider>
            </body>
        </html>
    );
}
