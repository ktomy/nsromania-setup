import path from 'path';
import { validateTranslationKeys } from '@/lib/test-utils';

// Keys used by generateMetadata in src/app/layout.tsx (page title and link-preview text).
describe('Translations', () => {
    it('all Metadata translation keys exist in all languages', () => {
        const messagesPath = path.join(__dirname, '../../messages');
        validateTranslationKeys(['title', 'description'], 'Metadata', messagesPath);
    });
});
