export type Locale = (typeof locales)[number];

export const locales = ['en', 'ro'] as const;
export const defaultLocale: Locale = 'en';