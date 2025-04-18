import fs from 'fs';
import path from 'path';
import { RenderResult } from '@testing-library/react';

// Create a reusable mock translator factory
export const createMockTranslator = () => {
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
};

// Extract translation keys from rendered component
export const extractTranslationKeys = (renderResult: RenderResult): string[] => {
  const allKeys: string[] = [];
  
  // Extract keys from text content
  document.querySelectorAll('*').forEach((node) => {
    const textContent = node.textContent;
    const regex = /#\$%([^$]+)\$%#/g;
    let match;
    while ((match = regex.exec(textContent || '')) !== null) {
      const key = match[1];
      allKeys.push(key);
    }
  });
  
  // Extract keys from attributes
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
  return Array.from(new Set(allKeys));
};

// Helper to check if a nested key exists in an object
export const hasKey = (obj: any, key: string): boolean => {
  if (!obj) return false;
  if (key in obj) return true;
  if (key.includes('.')) {
    const [first, ...rest] = key.split('.');
    return hasKey(obj[first], rest.join('.'));
  }
  return false;
};

// Load translation files and validate keys
export const validateTranslationKeys = (
  uniqueKeys: string[],
  translationSection: string,
  messagesDir: string
): void => {
  // Load translation files
  const langs = ['en', 'ro'];
  const translations: Record<string, any> = {};
  
  langs.forEach((lang) => {
    const file = path.join(messagesDir, `${lang}.json`);
    const allTranslations = JSON.parse(fs.readFileSync(file, 'utf8'));
    translations[lang] = allTranslations[translationSection] || {};
  });

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
};