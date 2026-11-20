'use server';

import { cookies } from 'next/headers';
import { hasLocale } from 'next-intl';
import { Locale, defaultLocale, locales } from '@/i18n/config';

// In this example the locale is read from a cookie. You could alternatively
// also read it from a database, backend service, or any other source.
const COOKIE_NAME = 'NEXT_LOCALE';

export async function getUserLocale() {
    // The cookie is client-controlled and picks the messages file to load
    const locale = (await cookies()).get(COOKIE_NAME)?.value;
    return hasLocale(locales, locale) ? locale : defaultLocale;
}

export async function setUserLocale(locale: Locale) {
    if (!hasLocale(locales, locale)) {
        return;
    }
    (await cookies()).set(COOKIE_NAME, locale);
}
