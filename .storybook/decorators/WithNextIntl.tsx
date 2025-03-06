import { IntlProvider } from 'next-intl';
import { Decorator } from '@storybook/react';
import React from 'react';

export const withNextIntl: Decorator = (Story, context) => {
    const messages = require(`../../messages/${context.globals.locale}.json`);
    return (
        <IntlProvider locale="ro" messages={messages}>
            <Story />
        </IntlProvider>
    );
};
