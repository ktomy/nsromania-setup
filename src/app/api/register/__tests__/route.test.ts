/** @jest-environment node */

jest.mock('../../../../auth', () => ({ auth: jest.fn() }));
jest.mock('../../../../lib/services/recaptcha', () => ({ validateCaptcha: jest.fn().mockResolvedValue(true) }));
jest.mock('../../../../lib/services/registration', () => ({
    createRegistrationRequest: jest.fn().mockResolvedValue(true),
    validateEmail: jest.fn().mockResolvedValue(true),
    validateSubdomain: jest.fn().mockResolvedValue(true),
}));
jest.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }));
jest.mock('next-intl', () => ({
    hasLocale: (locales: readonly string[], locale: string) => locales.includes(locale),
}));

import { createRegistrationRequest } from '@/lib/services/registration';
import { POST } from '../route';

describe('registration language', () => {
    beforeEach(() => jest.clearAllMocks());

    it.each(['en', 'ro'])('passes the validated form language %s to persistence', async (locale) => {
        const body = {
            ownerName: 'Owner',
            ownerEmail: 'owner@example.com',
            domain: 'example',
            title: 'Example',
            apiSecret: 'test-api-secret',
            dataSource: 'API',
            emailVerificationToken: '123456',
            reCAPTCHAToken: 'test-captcha-token',
        };
        const response = await POST(
            new Request('http://localhost/api/register', {
                method: 'POST',
                headers: { 'Accept-Language': locale },
                body: JSON.stringify(body),
            })
        );

        expect(response.status).toBe(200);
        expect(createRegistrationRequest).toHaveBeenCalledWith(body, locale);
    });

    it('rejects unsupported languages before saving the request', async () => {
        const response = await POST(
            new Request('http://localhost/api/register', {
                method: 'POST',
                headers: { 'Accept-Language': 'fr' },
                body: '{}',
            })
        );

        expect(response.status).toBe(400);
        expect(createRegistrationRequest).not.toHaveBeenCalled();
    });
});
