/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from 'test-utils';
import { GoogleReCaptchaProvider } from 'react-google-recaptcha-v3';
import fetchMock from 'jest-fetch-mock';

import RegisterForm from '../RegisterForm';
import { act } from 'react';

//https://github.com/mui/material-ui/issues/45477 ownerState prop is not supported on ClickAwayListener

const mockExecuteRecaptcha = jest.fn((_?: string) => Promise.resolve('1234567890'));

jest.mock('react-google-recaptcha-v3', () => {
    return {
        GoogleReCaptchaProvider: ({
            reCaptchaKey,
            useEnterprise,
            useRecaptchaNet,
            scriptProps,
            language,
            children,
        }: any): JSX.Element => {
            return <>{children}</>;
        },
        useGoogleReCaptcha: () => ({
            executeRecaptcha: mockExecuteRecaptcha,
        }),
    };
});
describe('RegisterForm', () => {
    beforeEach(() => {
        //Mock the global fetch function
        fetchMock.enableMocks();

        render(
            // Recaptcha is only needed on public forms not on all components
            // This is why is not in the custom renderer in test-utils
            <GoogleReCaptchaProvider reCaptchaKey={process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY as string}>
                <RegisterForm />
            </GoogleReCaptchaProvider>
        );
        //Setup spy on fetch function - maybe this should be a global mock
        //TODO: Review if this is the best way to mock fetch
        jest.spyOn(window, 'fetch').mockImplementation(() => {
            return Promise.resolve({
                json: () => Promise.resolve({ success: true }),
                status: 200,
            } as Response);
        });
    });

    it('submits data correctly', async () => {
        const validateEmailButton = screen.getByRole('button', { name: 'Validează' });
        const nameTextarea = screen.getByRole('textbox', { name: 'Nume' });
        const emailTextarea = screen.getByRole('textbox', { name: 'E-mail' });

        console.log("Checking if email and name textareas are present");
        expect(emailTextarea).toBeInTheDocument();
        expect(nameTextarea).toBeInTheDocument();
        expect(validateEmailButton).toBeInTheDocument();

        console.log("Filling in email and name textareas");
        fireEvent.change(nameTextarea, { target: { value: 'John Doe' } });
        fireEvent.change(emailTextarea, { target: { value: 'johnDoe@co.com' } });
        await act(async () => {
            fireEvent.click(validateEmailButton);
        });

        console.log("Checking if validate email was called with the correct data");
        expect(global.fetch).toHaveBeenCalledWith(
            '/api/register/validate-email',
            expect.objectContaining({
                method: 'POST',
                body: expect.stringContaining('{"email":"johnDoe@co.com","token":"1234567890"}'),
            })
        );

        const validationCodeInput = screen.getByRole('textbox', { name: 'Cod validare e-mail' });
        const checkValidationCodeButton = screen.getByRole('button', { name: 'Verificați codul de validare' });

        console.log("Checking if validation code input and check validation code button are present");
        expect(checkValidationCodeButton).toBeInTheDocument();
        expect(validationCodeInput).toBeInTheDocument();
        fireEvent.change(validationCodeInput, { target: { value: '123456' } });

        await act(async () => {
            fireEvent.click(checkValidationCodeButton);
        });

        console.log("Checking if check validation code was called with the correct data");
        expect(global.fetch).toHaveBeenCalledWith(
            '/api/register/validate-verification-code',
            expect.objectContaining({
                method: 'POST',
                body: expect.stringContaining('{"email":"johnDoe@co.com","token":"1234567890","code":"123456"}'),
            })
        );

        const subdomainInput = screen.getByRole('textbox', { name: 'Subdomeniu' });
        const siteTitleInput = screen.getByRole('textbox', { name: 'Titlul Site-ului' });
        const secretApiInput = screen.getByRole('textbox', { name: 'Secret API' });
        const dataSourceInput = screen.getByRole('combobox', { name: 'Sursă de date' });
        const serverRegionInput = screen.getByRole('combobox', { name: 'Regiune server Dexcom' });
        const dexcomUsernameInput = screen.getByRole('textbox', { name: 'Nume utilizator Dexcom' });
        const dexcomPasswordInput = screen.getByRole('textbox', { name: 'Parolă Dexcom' });
        
        const submitRegistrationButton = screen.getByRole('button', { name: 'Înregistrare' });
        
        console.log("Checking the rest of the fom inputs are present");
        expect(subdomainInput).toBeInTheDocument();
        expect(siteTitleInput).toBeInTheDocument();
        expect(secretApiInput).toBeInTheDocument();
        expect(dataSourceInput).toBeInTheDocument();
        expect(serverRegionInput).toBeInTheDocument();
        expect(dexcomUsernameInput).toBeInTheDocument();
        expect(dexcomPasswordInput).toBeInTheDocument();
        expect(submitRegistrationButton).toBeInTheDocument();

        fireEvent.change(subdomainInput, { target: { value: 'subdomain' } });
        fireEvent.change(siteTitleInput, { target: { value: 'siteTitle' } });
        fireEvent.change(secretApiInput, { target: { value: 'minimum12charsecret' } });
        fireEvent.change(dexcomUsernameInput, { target: { value: 'dexcomUsername' } });
        fireEvent.change(dexcomPasswordInput, { target: { value: 'dexcomPassword' } });
        await act(async () => {
            fireEvent.click(submitRegistrationButton);
        });
        
        console.log("Checking if the registration was called with the correct data");
        expect(global.fetch).toHaveBeenCalledWith(
            '/api/register',
            expect.objectContaining({
                method: 'POST',
                body: expect.stringContaining(
                    JSON.stringify({
                        domain: 'subdomain',
                        ownerEmail: 'johnDoe@co.com',
                        ownerName: 'John Doe',
                        dataSource: 'Dexcom',
                        dexcomUsername: 'dexcomUsername',
                        dexcomPassword: 'dexcomPassword',
                        dexcomServer: 'EU',
                        emailVerificationToken: '123456',
                        reCAPTCHAToken: '1234567890',
                        apiSecret: 'minimum12charsecret',
                        title: 'siteTitle',
                    })
                ),
            })
        );
    });

    afterEach(() => {
        jest.restoreAllMocks(); // Restore original fetch after each test
    });
});
