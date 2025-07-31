// Unit tests for RegisterForm
import React from 'react';
import { render } from '@testing-library/react';
import RegisterForm from '../app/welcome/register/RegisterForm';
import path from 'path';
import { createMockTranslator, extractTranslationKeys, validateTranslationKeys } from '@/lib/test-utils';

// Mock next-intl
jest.mock('next-intl', () => ({
    useTranslations: () => createMockTranslator(),
    useLocale: () => 'en',
}));

describe('Translations', () => {
    it('all RegisterForm translation keys exist in all languages', () => {
        // Render the form to collect all translation keys used
        const renderResult = render(<RegisterForm />);

        // Extract keys using the utility
        const uniqueKeys = extractTranslationKeys(renderResult);
        console.log('Unique keys:', uniqueKeys);

        // Validate keys using the utility
        const messagesPath = path.join(__dirname, '../../messages');
        validateTranslationKeys(uniqueKeys, 'RegisterPage', messagesPath);
    });
});
