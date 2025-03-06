import React, { ReactElement } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import roMessages from '../../messages/ro.json';
import { createTheme, ThemeProvider } from '@mui/material';

const AllTheProviders = ({ children }: { children: React.ReactNode }) => {
    const lightTheme = createTheme({
        palette: {
            mode: 'light',
        },
    });
    const locale = 'ro';
    return (
        <NextIntlClientProvider messages={roMessages} locale={locale}>
            <ThemeProvider theme={lightTheme}>{children}</ThemeProvider>
        </NextIntlClientProvider>
    );
};

const customRender = (ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) =>
    render(ui, { wrapper: AllTheProviders, ...options });

export * from '@testing-library/react';
export { customRender as render };
