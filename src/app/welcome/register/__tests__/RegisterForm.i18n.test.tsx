// Unit tests for RegisterForm
import React from 'react';
import { render } from '@testing-library/react';
import RegisterForm from '../RegisterForm';
import fs from 'fs';
import path from 'path';

// Mock next-intl
jest.mock('next-intl', () => ({
    useTranslations: () => {
        const t = (key: string) => "#$%" + key + "$%#";
        t.rich = (key: string, { icon }: any) => (icon ? [icon(), key] : key);
        return t;
    },
}));

describe('Translations', () => {
    it('all RegisterForm translation keys exist in all languages', () => {
        // Render the form to collect all translation keys used
        render(<RegisterForm />);
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
                if (attr.value && attr.value.includes('#$%')) {
                    // Extract the key from the attribute value
                    const key = attr.value.replace('#$%', '').replace('$%#', '');
                    allKeys.push(key);
                }
            }
        });

        // Remove duplicates
        const uniqueKeys = Array.from(new Set(allKeys));

        // Load translation files
        const langs = ['en', 'ro'];
        const translations: Record<string, any> = {};
        langs.forEach((lang) => {
            const file = path.join(__dirname, '../../../../../messages', `${lang}.json`);
            translations[lang] = JSON.parse(fs.readFileSync(file, 'utf8')).RegisterPage;
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
