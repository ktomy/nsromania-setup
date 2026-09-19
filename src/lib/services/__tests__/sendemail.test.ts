/** @jest-environment node */

const mockSendTransacEmail = jest.fn();

jest.mock('@getbrevo/brevo', () => ({
    TransactionalEmailsApi: jest.fn().mockImplementation(() => ({
        authentications: { apiKey: {} },
        sendTransacEmail: mockSendTransacEmail,
    })),
}));

const { sendWelcomeEmail } = require('../sendemail') as typeof import('../sendemail');

describe('welcome email language', () => {
    beforeEach(() => {
        mockSendTransacEmail.mockReset().mockResolvedValue({});
    });

    it.each([
        ['en', 'Welcome to NSRomania!', 'Welcome!', 'NSRomania Team', 'en'],
        ['ro', 'Bine ati venit la NSRomania!', 'Bine ati venit!', 'Echipa NSRomania', 'ro'],
        [undefined, 'Bine ati venit la NSRomania!', 'Bine ati venit!', 'Echipa NSRomania', 'ro'],
        ['unknown', 'Bine ati venit la NSRomania!', 'Bine ati venit!', 'Echipa NSRomania', 'ro'],
    ])('renders the expected content for locale %s', async (locale, subject, greeting, sender, htmlLocale) => {
        expect(await sendWelcomeEmail('owner@example.com', 'test-site', 'test-api-secret', locale)).toBe(true);

        const message = mockSendTransacEmail.mock.calls[0][0];
        expect(message.subject).toBe(subject);
        expect(message.sender.name).toBe(sender);
        expect(message.replyTo.name).toBe(sender);
        expect(message.to).toEqual([{ email: 'owner@example.com', name: undefined }]);
        expect(message.htmlContent).toContain(greeting);
        expect(message.htmlContent).toContain(`<html lang="${htmlLocale}">`);
        expect(message.htmlContent).toContain('https://test-site.nsromania.info/');
        expect(message.htmlContent).toContain('https://test-api-secret@test-site.nsromania.info/api/v1/');
        expect(message.htmlContent).not.toMatch(/\{\{(?:subdomain|api_secret)\}\}/);
    });
});
