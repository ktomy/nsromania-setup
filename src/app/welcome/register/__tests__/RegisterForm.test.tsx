// Unit tests for RegisterForm
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RegisterForm from '../RegisterForm';

// Mock next-intl
jest.mock('next-intl', () => ({
    useTranslations: () => {
        const t = (key: string) => key;
        t.rich = (key: string, { icon }: any) => (icon ? [icon(), key] : key);
        return t;
    },
    useLocale: () => 'en',
}));

// Mock react-google-recaptcha-v3
jest.mock('react-google-recaptcha-v3', () => ({
    useGoogleReCaptcha: () => ({ executeRecaptcha: jest.fn(() => Promise.resolve('mock-token')) }),
}));

describe('RegisterForm', () => {
    it('renders the registration form', () => {
        render(<RegisterForm />);
        expect(screen.getByText('registrationTitle')).toBeInTheDocument();
        // Use getByRole to find textboxes by accessible name
        expect(screen.getByRole('textbox', { name: 'ownerName' })).toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: 'ownerEmail' })).toBeInTheDocument();
    });

    it('shows error if owner name or email is missing when sending validation email', async () => {
        render(<RegisterForm />);
        fireEvent.click(screen.getByText('validateEmail'));
        await waitFor(() => {
            expect(screen.getByText('ownerNameAndEmailRequired')).toBeInTheDocument();
        });
    });

    it('validates email format', async () => {
        render(<RegisterForm />);
        const emailInput = screen.getByRole('textbox', { name: 'ownerEmail' });
        fireEvent.change(emailInput, { target: { value: 'invalid-email' } });
        // Wait for validation error to be applied
        await waitFor(() => {
            expect(emailInput).toHaveAttribute('aria-invalid', 'true');
        });
    });

    it('validates owner name format', async () => {
        render(<RegisterForm />);
        const nameInput = screen.getByRole('textbox', { name: 'ownerName' });
        fireEvent.change(nameInput, { target: { value: '!!!' } });
        await waitFor(() => {
            expect(nameInput).toHaveAttribute('aria-invalid', 'true');
        });
    });

    it('submits correct data on submit button press', async () => {
        // Mock fetch
        global.fetch = jest
            .fn()
            // validate-email
            .mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({}) })
            // validate-verification-code
            .mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({}) })
            // validate-subdomain
            .mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({}) })
            // register
            .mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({ success: true }) });

        render(<RegisterForm />);

        // Fill owner name and email
        fireEvent.change(screen.getByRole('textbox', { name: 'ownerName' }), { target: { value: 'Test User' } });
        fireEvent.change(screen.getByRole('textbox', { name: 'ownerEmail' }), {
            target: { value: 'test@example.com' },
        });
        // Send validation email
        fireEvent.click(screen.getByText('validateEmail'));
        await waitFor(() =>
            expect(global.fetch).toHaveBeenCalledWith('/api/register/validate-email', expect.anything())
        );

        // Fill validation code
        const codeInput = await screen.findByRole('textbox', { name: 'emailValidationCode' });
        fireEvent.change(codeInput, { target: { value: '123456' } });
        fireEvent.click(screen.getByText('checkValidationCode'));
        await waitFor(() =>
            expect(global.fetch).toHaveBeenCalledWith('/api/register/validate-verification-code', expect.anything())
        );

        // Wait for subDomain textbox to appear (UI update after email validation)
        await waitFor(() => expect(screen.getByRole('textbox', { name: 'subDomain' })).toBeInTheDocument());
        fireEvent.change(screen.getByRole('textbox', { name: 'subDomain' }), { target: { value: 'testsubdomain' } });
        fireEvent.change(screen.getByRole('textbox', { name: 'title' }), { target: { value: 'Nightscout' } });
        fireEvent.change(screen.getByRole('textbox', { name: 'apiSecret' }), { target: { value: 'supersecret1234' } });
        // Wait for dexcomServer combobox to appear
        await waitFor(() => expect(screen.getByRole('combobox', { name: 'dexcomServer' })).toBeInTheDocument());
        const serverSelect = screen.getByRole('combobox', { name: 'dexcomServer' });
        fireEvent.mouseDown(serverSelect);
        const euOption = await screen.findByRole('option', { name: 'eu' });
        fireEvent.click(euOption);
        fireEvent.change(screen.getByRole('textbox', { name: 'dexcomUsername' }), { target: { value: 'dexuser' } });
        fireEvent.change(screen.getByRole('textbox', { name: 'dexcomPassword' }), { target: { value: 'dexpass' } });

        // Submit the form
        fireEvent.click(screen.getByText('register'));

        await waitFor(() => {
            expect(global.fetch).toHaveBeenNthCalledWith(
                4,
                '/api/register',
                expect.objectContaining({
                    method: 'POST',
                    headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
                    body: expect.stringContaining('testsubdomain'),
                })
            );
        });

        // Optionally, check the payload
        const lastCall = (global.fetch as jest.Mock).mock.calls.find(([url]) => url === '/api/register');
        expect(lastCall).toBeDefined();
        const body = JSON.parse(lastCall[1].body);
        expect(body).toEqual({
            domain: 'testsubdomain',
            ownerEmail: 'test@example.com',
            ownerName: 'Test User',
            apiSecret: 'supersecret1234',
            dexcomUsername: 'dexuser',
            dexcomPassword: 'dexpass',
            dataSource: 'Dexcom',
            dexcomServer: 'EU',
            emailVerificationToken: '123456',
            reCAPTCHAToken: 'mock-token',
            title: 'Nightscout',
        });
    });
});
