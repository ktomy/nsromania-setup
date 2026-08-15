import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier/flat';

const eslintConfig = defineConfig([
    ...nextVitals,
    ...nextTypescript,
    prettier,
    {
        rules: {
            'react/no-unescaped-entities': 'off',
            '@next/next/no-page-custom-font': 'off',
            'react-hooks/set-state-in-effect': 'off',
        },
    },
    // Add override for test files
    {
        files: ['**/*.test.tsx', '**/*.test.ts'],
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-require-imports': 'off',
        },
    },
    globalIgnores(['node_modules/**', '.next/**', 'public/**', 'src/lib/services/**']),
]);

export default eslintConfig;
