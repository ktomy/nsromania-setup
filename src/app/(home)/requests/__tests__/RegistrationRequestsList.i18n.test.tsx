// Unit tests for RegistrationRequestsList
import React from 'react';
import { render } from '@testing-library/react';
import RegistrationRequestsList from '../RegistrationRequestsList';
import path from 'path';
import { createMockTranslator, extractTranslationKeys, validateTranslationKeys } from '../../../../lib/test-utils';

// Mock fetch
global.fetch = jest.fn(() =>
    Promise.resolve({
        json: () => Promise.resolve([]),
        ok: true,
    })
) as jest.Mock;

// Mock window.open
window.open = jest.fn();

// Mock next-intl
jest.mock('next-intl', () => ({
    useTranslations: () => createMockTranslator(),
}));

// Mock next/navigation
jest.mock('next/navigation', () => ({
    useRouter: () => ({
        push: jest.fn(),
    }),
}));

// Create a mock User for testing
const mockUser = {
    id: 1,
    name: 'Test User',
    role: 'admin',
    email: 'test@example.com',
};

describe('Translations', () => {
    it('all RegistrationRequestsList translation keys exist in all languages', async () => {
        // Render the component to collect all translation keys used
        const renderResult = render(<RegistrationRequestsList user={mockUser as any} />);

        // Allow component to render fully with its async operations
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Extract keys using the utility
        const uniqueKeys = extractTranslationKeys(renderResult);
        console.log('Unique keys:', uniqueKeys);

        // Validate keys using the utility
        const messagesPath = path.join(__dirname, '../../../../../messages');
        validateTranslationKeys(uniqueKeys, 'RequestsPage', messagesPath);
    });
});
