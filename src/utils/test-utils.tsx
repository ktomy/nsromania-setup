import React, { ReactElement } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';

import { getLocale, getTranslations } from 'next-intl/server';
import { createTheme, ThemeProvider } from '@mui/material';

const AllTheProviders = ({ children }: { children: React.ReactNode }) => {
    
    const lightTheme = createTheme({
        palette: {
            mode: 'light',
        },
    });
    const locale = "ro"
    const messages = require(`../../messages/${locale}.json`);
    return (
        <NextIntlClientProvider messages={messages} locale={locale}>
            <ThemeProvider theme={lightTheme}>{children}</ThemeProvider>
        </NextIntlClientProvider>
    );
};

const customRender = (ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) =>
    render(ui, { wrapper: AllTheProviders, ...options });

export * from '@testing-library/react';
export { customRender as render };
