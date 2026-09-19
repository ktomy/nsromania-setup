/** @jest-environment node */

import { NextRequest } from 'next/server';

jest.mock('../../../../../../auth', () => ({ auth: jest.fn() }));
jest.mock('../../../../../../lib/services/domains', () => ({ getNSDomainById: jest.fn() }));
jest.mock('../../../../../../lib/services/sendemail', () => ({ sendWelcomeEmail: jest.fn() }));

import { auth } from '@/auth';
import { getNSDomainById } from '@/lib/services/domains';
import { sendWelcomeEmail } from '@/lib/services/sendemail';
import { POST } from '../route';

describe('domain welcome email', () => {
    it.each(['en', 'ro'])('uses saved language %s even when the admin uses another language', async (locale) => {
        (auth as jest.Mock).mockResolvedValue({ user: { role: 'admin' } });
        (getNSDomainById as jest.Mock).mockResolvedValue({
            domain: 'example',
            apiSecret: 'test-secret',
            registrationLocale: locale,
            authUser: { email: 'owner@example.com' },
        });
        (sendWelcomeEmail as jest.Mock).mockResolvedValue(true);

        const response = await POST(
            new NextRequest('http://localhost/api/domains/1/welcome', {
                method: 'POST',
                headers: { 'Accept-Language': locale === 'en' ? 'ro' : 'en' },
            }),
            { params: Promise.resolve({ id: '1' }) }
        );

        expect(response.status).toBe(200);
        expect(sendWelcomeEmail).toHaveBeenLastCalledWith('owner@example.com', 'example', 'test-secret', locale);
    });
});
