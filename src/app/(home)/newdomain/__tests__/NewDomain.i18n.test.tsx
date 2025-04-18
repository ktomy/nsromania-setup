// Unit tests for NewDomain
import React from 'react';
import { render } from '@testing-library/react';
import NewDomain from '../NewDomain';
import fs from 'fs';
import path from 'path';

// Mock fetch
global.fetch = jest.fn(() => 
  Promise.resolve({
    json: () => Promise.resolve({ id: 1 }),
    ok: true
  })
) as jest.Mock;

// Mock window.location.href
Object.defineProperty(window, 'location', {
  value: { href: jest.fn() }
});

// Mock next-intl
jest.mock('next-intl', () => ({
    useTranslations: () => {
        const t = (key: string, params?: any) => {
            if (params) {
                return Object.entries(params).reduce(
                    (acc, [k, v]) => acc.replace(`{${k}}`, String(v)),
                    "#$%" + key + "$%#"
                );
            }
            return "#$%" + key + "$%#";
        };
        t.rich = (key: string, { icon }: any) => (icon ? [icon(), key] : key);
        return t;
    },
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
        render(<NewDomain user={mockUser as any} />);
        
        // Allow component to render fully with its async operations
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Collect all text nodes that are translation keys (mock returns the key)
        const allKeys: string[] = [];
        document.querySelectorAll('*').forEach((node) => {
            const textContent = node.textContent;
            // get text by regex
            const regex = /#\$%([^$]+)\$%#/g;
            let match;
            while ((match = regex.exec(textContent || '')) !== null) {
                const key = match[1];
                allKeys.push(key);
            }
        });
        
        // Collect all attributes that are translation keys (mock returns the key)
        document.querySelectorAll('*').forEach((node) => {
            const attributes = node.attributes;
            for (let i = 0; i < attributes.length; i++) {
                const attr = attributes[i];
                const regex = /#\$%([^$]+?)\$%#/g;
                let match;
                while ((match = regex.exec(attr.value || '')) !== null) {
                    const key = match[1];
                    allKeys.push(key);
                }
            }
        });

        // Remove duplicates
        const uniqueKeys = Array.from(new Set(allKeys));

        console.log('Unique keys:', uniqueKeys);

        // Load translation files
        const langs = ['en', 'ro'];
        const translations: Record<string, any> = {};
        langs.forEach((lang) => {
            const file = path.join(__dirname, '../../../../../messages', `${lang}.json`);
            const allTranslations = JSON.parse(fs.readFileSync(file, 'utf8'));
            translations[lang] = allTranslations.NewDomainPage || {};
        });

        // Helper to check nested keys (e.g. details.ownerName)
        function hasKey(obj: any, key: string): boolean {
            if (!obj) return false;
            if (key in obj) return true;
            if (key.includes('.')) {
                const [first, ...rest] = key.split('.');
                return hasKey(obj[first], rest.join('.'));
            }
            return false;
        }

        // Check all keys exist in all languages
        uniqueKeys.forEach((key) => {
            langs.forEach((lang) => {
                expect(
                    hasKey(translations[lang], key)
                ).toBe(
                    true
                );
            });
        });
    });
});