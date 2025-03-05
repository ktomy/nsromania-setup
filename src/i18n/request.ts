import { getUserLocale } from '@/lib/services/locale';
import { getRequestConfig } from 'next-intl/server';
import { watchMessages } from '@/lib/watchMessages';

// Watch for changes in development
if (process.env.NODE_ENV === 'development') {
    watchMessages();
}

export default getRequestConfig(async () => {
    // Provide a static locale, fetch a user setting,
    // read from `cookies()`, `headers()`, etc.
    //const locale = 'en';
    const locale = await getUserLocale();

    return {
        locale,
        messages: (await import(`../../messages/${locale}.json`)).default
    };
});