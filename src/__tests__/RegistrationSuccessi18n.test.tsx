// Unit tests for RegistrationSuccessPage
import React from 'react';
import { render } from '@testing-library/react';
import fs from 'fs';
import path from 'path';
import { createMockTranslator, extractTranslationKeys, validateTranslationKeys } from '@/lib/test-utils';
import RegistrationSuccess from '@/app/welcome/registrationsuccess/RegistrationSuccess';

// Mock next-intl
jest.mock('next-intl', () => ({
    useTranslations: () => createMockTranslator(),
}));

describe('Translations', () => {
    it('all RegistrationSuccessPage translation keys exist in all languages', () => {
        // Render the component to collect all translation keys used
        const renderResult = render(<RegistrationSuccess />);

        // Extract keys using the utility
        const uniqueKeys = extractTranslationKeys(renderResult);
        console.log('Unique keys:', uniqueKeys);

        // Validate keys using the utility
        const messagesPath = path.join(__dirname, '../../messages');
        validateTranslationKeys(uniqueKeys, 'RegistrationSuccessPage', messagesPath);
    });
});
