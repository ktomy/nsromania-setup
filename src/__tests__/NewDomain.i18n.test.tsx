// Unit tests for NewDomain
import React from 'react';
import { render } from '@testing-library/react';
import path from 'path';
import { createMockTranslator, extractTranslationKeys, validateTranslationKeys } from '@/lib/test-utils';
import NewDomain from '@/app/(home)/newdomain/NewDomain';

// Mock fetch
global.fetch = jest.fn(() =>
    Promise.resolve({
        json: () => Promise.resolve({ id: 1 }),
        ok: true,
    })
) as jest.Mock;

// Mock window.location.href
Object.defineProperty(window, 'location', {
    value: { href: jest.fn() },
});

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
    it('all NewDomain translation keys exist in all languages', async () => {
        // Render the component to collect all translation keys used
        const renderResult = render(<NewDomain user={mockUser as any} />);

        // Allow component to render fully with its async operations
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Extract keys using the utility
        const uniqueKeys = extractTranslationKeys(renderResult);
        console.log('Unique keys:', uniqueKeys);

        // Validate keys using the utility
        const messagesPath = path.join(__dirname, '../../messages');
        validateTranslationKeys(uniqueKeys, 'NewDomainPage', messagesPath);
    });
});
