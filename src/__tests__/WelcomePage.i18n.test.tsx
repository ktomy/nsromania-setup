// Unit tests for WelcomePage
import React from 'react';
import { render } from '@testing-library/react';
import path from 'path';
import { createMockTranslator, extractTranslationKeys, validateTranslationKeys } 
    from '@/lib/test-utils';
import WelcomePage from '@/app/welcome/WelcomePage';

// Mock next-intl
jest.mock('next-intl', () => ({
    useTranslations: () => createMockTranslator(),
}));

describe('Translations', () => {
    it('all WelcomePage translation keys exist in all languages', () => {
        // Render the component to collect all translation keys used
        const renderResult = render(<WelcomePage />);

        // Extract keys using the utility
        const uniqueKeys = extractTranslationKeys(renderResult);
        console.log('Unique keys:', uniqueKeys);

        // Validate keys using the utility
        const messagesPath = path.join(__dirname, '../../messages');
        validateTranslationKeys(uniqueKeys, 'WelcomePage', messagesPath);
    });
});
