// Unit tests for RegisterForm
import React from 'react';
import { render } from '@testing-library/react';
import RegisterForm from '../RegisterForm';
import path from 'path';
import { extractTranslationKeys, validateTranslationKeys } from '../../../../lib/test-utils';

// Mock next-intl
jest.mock('next-intl', () => ({
    useTranslations: () => {
        const t = (key: string, params?: any) => {
            if (params) {
                return Object.entries(params).reduce(
                    (acc, [k, v]) => acc.replace(`{${k}}`, String(v)),
                    '#$%' + key + '$%#'
                );
            }
            return '#$%' + key + '$%#';
        };
        t.rich = (key: string, { icon }: any) => (icon ? [icon(), key] : key);
        return t;
    },
}));

describe('Translations', () => {
    it('all RegisterForm translation keys exist in all languages', () => {
        // Render the form to collect all translation keys used
        const renderResult = render(<RegisterForm />);

        // Extract keys using the utility
        const uniqueKeys = extractTranslationKeys(renderResult);
        console.log('Unique keys:', uniqueKeys);

        // Validate keys using the utility
        const messagesPath = path.join(__dirname, '../../../../../messages');
        validateTranslationKeys(uniqueKeys, 'RegisterPage', messagesPath);
    });
});
