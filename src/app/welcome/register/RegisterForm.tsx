'use client';
import * as React from 'react';
import Typography from '@mui/material/Typography';
import { Alert, Box, Button, debounce, Grid, MenuItem, Snackbar } from '@mui/material';
import { useTranslations } from 'next-intl';
import { ChangeEventHandler, useState } from 'react';
import { useGoogleReCaptcha } from 'react-google-recaptcha-v3';
import { RegisterDomainRequest } from '@/types/domains';
import NSInput from '@/lib/components/general/NSInput/NSInput';
import { InfoRounded } from '@mui/icons-material';

export default function RegisterForm() {
    const t = useTranslations('RegisterPage');
    const [ownerEmail, setOwnerEmail] = useState('');
    const [ownerName, setOwnerName] = useState('');
    const [emailValidationCode, setEmailValidationCode] = useState('');
    const [subDomain, setSubDomain] = useState('');
    const [nsTitle, setNsTitle] = useState('Nightscout');
    const [apiSecret, setApiSecret] = useState('');
    const [dataSource, setDataSource] = useState('Dexcom');
    const [dexcomServer, setDexcomServer] = useState('EU');
    const [dexcomUsername, setDexcomUsername] = useState('');
    const [dexcomPassword, setDexcomPassword] = useState('');
    const { executeRecaptcha } = useGoogleReCaptcha();
    const [validationEmailSent, setValidationEmailSent] = useState(false);
    const [emailValidated, setEmailValidated] = useState(false);
    const [snackOpen, setSnackOpen] = useState(false);
    const [snackMessage, setSnackMessage] = useState('');
    const [snackKind, setSnackKind] = useState<'success' | 'error' | 'info' | 'warning'>('success');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [success, setSuccess] = useState(false);
    const [subdomainIsValid, setSubbdomainIsValid] = useState(false);

    const handleSendValidationEmail = async () => {
        if (!executeRecaptcha) {
            console.error('Recaptcha not initialized');
            return;
        }

        // check name and email fields
        if (ownerName.length === 0 || ownerEmail.length === 0) {
            openSnack(t('ownerNameAndEmailRequired'), 'error');
            return;
        }

        const token =
            process.env.NODE_ENV === 'development' ? '1234567890' : await executeRecaptcha('email_validation');

        const res = await fetch('/api/register/validate-email', {
            method: 'POST',
            body: JSON.stringify({ email: ownerEmail, token: token }),
            headers: { 'Content-Type': 'application/json' },
        });

        const data = await res.json();
        if (data.error) {
            console.log('Email validation failed', data);
            openSnack(t('validationEmailFailed'), 'error');
            return;
        }

        openSnack(t('sendingValidationEmail'), 'info');
        setValidationEmailSent(true);
    };

    const validateSubdomain = async () => {
        console.log('Validating subdomain', subDomain);
        if (!executeRecaptcha) {
            console.error('Recaptcha not initialized');
            setSubbdomainIsValid(false);
            return;
        }
        const token =
            process.env.NODE_ENV === 'development' ? '1234567890' : await executeRecaptcha('subdomain_validation');
        const res = await fetch('/api/register/validate-subdomain', {
            method: 'POST',
            body: JSON.stringify({ token: token, subdomain: subDomain }),
            headers: { 'Content-Type': 'application/json' },
        });
        if (res.status === 200) {
            setSubbdomainIsValid(true);
        } else {
            setSubbdomainIsValid(false);
        }
    };

    // Create a debounced version of validateSubdomain
    const debouncedValidateSubdomain = React.useCallback(
        debounce(() => {
            if (subDomain.length > 0) {
                validateSubdomain();
            }
        }, 500), // 500ms delay
        [subDomain, executeRecaptcha]
    );

    React.useEffect(() => {
        if (subDomain.length > 0 && /^[a-z0-9]{1,32}$/.test(subDomain)) {
            debouncedValidateSubdomain();
        } else {
            setSubbdomainIsValid(false);
        }

        // Cleanup the debounced function on unmount or when dependencies change
        return () => {
            debouncedValidateSubdomain.clear();
        };
    }, [subDomain, debouncedValidateSubdomain]);

    const handleCheckValidationCode = async () => {
        if (!executeRecaptcha) {
            console.error('Recaptcha not initialized');
            return;
        }

        const token =
            process.env.NODE_ENV === 'development' ? '1234567890' : await executeRecaptcha('email_code_validation');

        const res = await fetch('/api/register/validate-verification-code', {
            method: 'POST',
            body: JSON.stringify({ email: ownerEmail, token: token, code: emailValidationCode }),
            headers: { 'Content-Type': 'application/json' },
        });

        const data = await res.json();
        if (data.error) {
            console.log('Email verification code validation failed', data);
            openSnack(t('emailValidationCodeInvalid'), 'error');
            return;
        }

        openSnack(t('emailVerificationCodeValidated'), 'success');
        setEmailValidated(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        setIsSubmitting(true);
        e.preventDefault();
        if (!executeRecaptcha) {
            console.error('Recaptcha not initialized');
            return;
        }
        try {
            const token = process.env.NODE_ENV === 'development' ? '1234567890' : await executeRecaptcha('register');

            const registerRequest: RegisterDomainRequest = {
                domain: subDomain,
                ownerEmail: ownerEmail,
                ownerName: ownerName,
                dataSource: dataSource,
                dexcomUsername: dexcomUsername,
                dexcomPassword: dexcomPassword,
                dexcomServer: dexcomServer,
                emailVerificationToken: emailValidationCode,
                reCAPTCHAToken: token,
                apiSecret: apiSecret,
                title: nsTitle,
            };

            const res = await fetch('/api/register', {
                method: 'POST',
                body: JSON.stringify(registerRequest),
                headers: { 'Content-Type': 'application/json' },
            });

            const data = await res.json();
            if (data.success) {
                openSnack(t('registrationSuccess'), 'success');
                setSuccess(true);
                // Wait a second and redirect to /welcome/registrationsuccess/ page
                setTimeout(() => {
                    window.location.href = '/welcome/registrationsuccess';
                }, 1000);
            } else {
                console.log('registration failed', data);
                openSnack(t('registrationFailed'), 'error');
            }
        } catch (e) {
            console.error('Registration failed', e);
            setSuccess(false);
            openSnack(t('registrationFailed'), 'error');
            //TODO: Add a redirect to the error page
        } finally {
            setIsSubmitting(false);
        }
    };

    const openSnack = (message: string, kind: 'success' | 'error' | 'info' | 'warning') => {
        setSnackMessage(message);
        setSnackKind(kind);
        setSnackOpen(true);
    };

    const handleSnackClose = () => {
        setSnackOpen(false);
    };

    const handleDataSourceChange: ChangeEventHandler<HTMLInputElement | HTMLTextAreaElement> = (event) => {
        setDataSource(event.target.value);
    };

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, mt: 4 }}>
            <Snackbar open={snackOpen} autoHideDuration={3000} onClose={handleSnackClose} message={snackMessage}>
                <Alert onClose={handleSnackClose} severity={snackKind} variant="filled" sx={{ width: '100%' }}>
                    {snackMessage}
                </Alert>
            </Snackbar>
            <Typography sx={{ mb: 2 }} variant="h4">
                {t('registrationTitle')}
            </Typography>
            <Box maxWidth={'sm'} component="form" onSubmit={handleSubmit}>
                <Typography sx={{ mb: 2 }} variant="body2">
                    {t('registrationDescription')}
                </Typography>
                <Typography variant="body2" sx={{ mb: 2, lineHeight: 1.5 }}>
                    {t.rich('registrationHint', {
                        icon: () => <InfoRounded fontSize="small" sx={{ verticalAlign: 'bottom' }} />,
                    })}
                </Typography>
                <Grid container spacing={2} sx={{ marginX: 'auto' }}>
                    <Grid size={{ xs: 12 }}>
                        {/* Owner name is a string of max 64 characters having alphanumeric characters and spaces */}
                        <NSInput
                            value={ownerName}
                            onChange={(e) => setOwnerName(e.target.value)}
                            required
                            fullWidth
                            label={t('ownerName')}
                            error={ownerName.length > 0 && !/^[a-zA-Z0-9\s]{1,64}$/.test(ownerName)}
                            size="small"
                            moreInformation={t('details.ownerName')}
                        />
                    </Grid>
                    <Grid size={{ xs: 12 }}>
                        <NSInput
                            value={ownerEmail}
                            onChange={(e) => setOwnerEmail(e.target.value)}
                            fullWidth
                            required
                            label={t('ownerEmail')}
                            disabled={emailValidated}
                            error={
                                ownerEmail.length > 0 &&
                                !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(ownerEmail)
                            }
                            size="small"
                            moreInformation={t('details.ownerEmail')}
                        />
                    </Grid>
                    <Grid size={12}>
                        {!validationEmailSent && (
                            <Button
                                disabled={emailValidated}
                                onClick={handleSendValidationEmail}
                                type="button"
                                variant="contained"
                                color="primary"
                            >
                                {t('validateEmail')}
                            </Button>
                        )}
                    </Grid>
                    {validationEmailSent && (
                        <>
                            <Grid size={{ xs: 12, sm: 6 }}>
                                {/* Validation code is a string of 6 digits, it can contain spaces or tabs at any moment, including start and end of the string */}
                                <NSInput
                                    value={emailValidationCode}
                                    onChange={(e) => setEmailValidationCode(e.target.value)}
                                    required
                                    disabled={emailValidated}
                                    error={emailValidationCode.length > 0 && !/^\s*\d{6}\s*$/.test(emailValidationCode)}
                                    fullWidth
                                    size="small"
                                    label={t('emailValidationCode')}
                                    moreInformation={t('details.emailValidationCode')}
                                />
                            </Grid>
                            <Grid size={{ xs: 12, sm: 6 }}>
                                <Button
                                    disabled={emailValidated}
                                    fullWidth
                                    type="button"
                                    variant="contained"
                                    onClick={handleCheckValidationCode}
                                    color="primary"
                                >
                                    {t('checkValidationCode')}
                                </Button>
                            </Grid>
                        </>
                    )}

                    {emailValidated && (
                        <>
                            <Grid size={12}>
                                {/* Subdomain is a string of max 32 characters containing only lowercase alphanumeric characters*/}
                                <NSInput
                                    value={subDomain}
                                    onChange={(e) => setSubDomain(e.target.value)}
                                    required
                                    fullWidth
                                    label={t('subDomain')}
                                    error={subDomain.length > 0 && !subdomainIsValid}
                                    size="small"
                                    moreInformation={t('details.subDomain')}
                                />
                            </Grid>
                            <Grid size={12}>
                                <NSInput
                                    value={nsTitle}
                                    onChange={(e) => setNsTitle(e.target.value)}
                                    fullWidth
                                    label={t('title')}
                                    size="small"
                                    moreInformation={t('details.title')}
                                />
                            </Grid>
                            <Grid size={{ xs: 12, sm: 6 }}>
                                <NSInput
                                    value={apiSecret}
                                    onChange={(e) => setApiSecret(e.target.value)}
                                    required
                                    fullWidth
                                    label={t('apiSecret')}
                                    error={apiSecret.length > 0 && !/^[a-zA-Z0-9-\_\.]{12,32}$/.test(apiSecret)}
                                    helperText={
                                        apiSecret.length > 0 && apiSecret.length < 12
                                            ? t('formValidation.apiSecretHelperText')
                                            : ''
                                    }
                                    size="small"
                                    moreInformation={t('details.apiSecret')}
                                />
                            </Grid>
                            <Grid size={{ xs: 12, sm: 6 }}>
                                <NSInput
                                    value={dataSource}
                                    onChange={handleDataSourceChange}
                                    select
                                    fullWidth
                                    size="small"
                                    label={t('dataSource')}
                                    moreInformation={t('details.dataSource')}
                                >
                                    <MenuItem value="Dexcom">{t('dexcom')}</MenuItem>
                                    <MenuItem value="API">{t('anythingElse')}</MenuItem>
                                </NSInput>
                            </Grid>
                            {dataSource === 'Dexcom' && (
                                <>
                                    <Grid size={{ xs: 12, sm: 6 }}>
                                        <NSInput
                                            select
                                            value={dexcomServer}
                                            onChange={(e) => setDexcomServer(e.target.value)}
                                            label={t('dexcomServer')}
                                            size="small"
                                            fullWidth
                                            moreInformation={t('details.dexcomServer')}
                                        >
                                            <MenuItem value="EU">{t('eu')}</MenuItem>
                                            <MenuItem value="US">{t('us')}</MenuItem>
                                        </NSInput>
                                    </Grid>
                                    <Grid size={12}>
                                        <NSInput
                                            value={dexcomUsername}
                                            onChange={(e) => setDexcomUsername(e.target.value)}
                                            required={dataSource === 'Dexcom'}
                                            fullWidth
                                            size="small"
                                            error={dexcomUsername.length > 0 && !/^[a-zA-Z0-9!@#$%^&*().+\-]{5,32}$/.test(dexcomUsername)}
                                            label={t('dexcomUsername')}
                                            moreInformation={t('details.dexcomUsername')}
                                        />
                                    </Grid>
                                    <Grid size={12}>
                                        <NSInput
                                            value={dexcomPassword}
                                            onChange={(e) => setDexcomPassword(e.target.value)}
                                            required={dataSource === 'Dexcom'}
                                            fullWidth
                                            size="small"
                                            label={t('dexcomPassword')}
                                            moreInformation={t('details.dexcomPassword')}
                                        />
                                    </Grid>
                                </>
                            )}
                            <Grid size={8}>{/* Google reCAPTCHA */}</Grid>
                            <Grid size={12}>
                                <Button
                                    type="submit"
                                    variant="contained"
                                    color="primary"
                                    loading={isSubmitting}
                                    disabled={success && !subdomainIsValid}
                                >
                                    {t('register')}
                                </Button>
                            </Grid>
                        </>
                    )}
                </Grid>
            </Box>
            <br />
            <br />
        </Box>
    );
}
