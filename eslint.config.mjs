import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({
    // import.meta.dirname is available after Node.js v20.11.0
    baseDirectory: import.meta.dirname,
    packageManager: 'pnpm',
});
const eslintConfig = [
    ...compat.config({
        extends: ['next/core-web-vitals', 'next/typescript', 'prettier'],
        ignorePatterns: ['node_modules', '.next', 'public', "src/lib/services"],
        rules: {
            'react/no-unescaped-entities': 'off',
            '@next/next/no-page-custom-font': 'off',
        },
    }),
];

export default eslintConfig;
