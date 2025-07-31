'use client';
import * as React from 'react';
import Typography from '@mui/material/Typography';
import { Alert, Box, Button, Grid, MenuItem, Snackbar } from '@mui/material';
import { useTranslations, useLocale } from 'next-intl';
import { useState } from 'react';
import { useGoogleReCaptcha } from 'react-google-recaptcha-v3';
import { RegisterDomainRequest } from '@/types/domains';
import NSInput from '@/lib/components/general/NSInput/NSInput';
import { InfoRounded } from '@mui/icons-material';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { registrationFormSchema, RegistrationFormData } from '@/lib/validations/index';

export default function RegisterForm() {
    const t = useTranslations('RegisterPage');
    const locale = useLocale();
    const { executeRecaptcha } = useGoogleReCaptcha();
    const [validationEmailSent, setValidationEmailSent] = useState(false);
    const [emailValidated, setEmailValidated] = useState(false);
    const [subdomainIsValid, setSubdomainIsValid] = useState(true);
    const [snack, setSnack] = useState<{
        open: boolean;
        message: string;
        severity: 'success' | 'error' | 'info' | 'warning';
    }>({ open: false, message: '', severity: 'success' });
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Initialize React Hook Form with Zod schema
    const {
        control,
        handleSubmit,
        watch,
        getValues,
        formState: { errors },
        setError,
    } = useForm({
        resolver: zodResolver(registrationFormSchema(t)),
        mode: 'onChange',
        defaultValues: {
            ownerName: '',
            ownerEmail: '',
            emailValidationCode: '',
            subDomain: '',
            nsTitle: 'Nightscout',
            apiSecret: '',
            dataSource: 'Dexcom',
            dexcomServer: 'EU',
            dexcomUsername: undefined,
            dexcomPassword: undefined,
        },
    });

    const dataSource = watch('dataSource');

    // Send validation email
    const handleSendValidationEmail = async () => {
        const { ownerName, ownerEmail } = getValues();
        if (!executeRecaptcha) return;
        if (!ownerName || !ownerEmail) {
            openSnack(t('ownerNameAndEmailRequired'), 'error');
            return;
        }

        const token =
            process.env.NODE_ENV === 'development' ? '1234567890' : await executeRecaptcha('email_validation');

        const res = await fetch('/api/register/validate-email', {
            method: 'POST',
            body: JSON.stringify({ email: ownerEmail, token: token }),
            headers: { 'Content-Type': 'application/json', 'Accept-Language': locale },
        });

        const data = await res.json();
        if (data.error) {
            setError('ownerEmail', {
                type: 'manual',
                message: data.error,
            });

            openSnack(data.error, 'error');
            return;
        }

        openSnack(t('sendingValidationEmail'), 'info');
        setValidationEmailSent(true);
    };

    // Check email verification code
    const handleCheckValidationCode = async () => {
        const { ownerEmail, emailValidationCode } = getValues();

        if (!executeRecaptcha) return;

        const token =
            process.env.NODE_ENV === 'development' ? '1234567890' : await executeRecaptcha('email_code_validation');

        const res = await fetch('/api/register/validate-verification-code', {
            method: 'POST',
            body: JSON.stringify({ email: ownerEmail, token: token, code: emailValidationCode }),
            headers: { 'Content-Type': 'application/json', 'Accept-Language': locale },
        });

        const data = await res.json();
        if (data.error) {
            setError('emailValidationCode', {
                type: 'manual',
                message: data.error,
            });

            openSnack(data.error, 'error');
            return;
        }

        openSnack(t('emailVerificationCodeValidated'), 'success');
        setEmailValidated(true);
    };

    // Form submission
    const onSubmit = async (values: RegistrationFormData) => {
        setIsSubmitting(true);
        if (!executeRecaptcha) {
            return;
        }

        // Validate subdomain before proceeding
        try {
            const recaptcha =
                process.env.NODE_ENV === 'development' ? '1234567890' : await executeRecaptcha('subdomain_validation');
            const availRes = await fetch('/api/register/validate-subdomain', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept-Language': locale },
                body: JSON.stringify({ subdomain: values.subDomain, token: recaptcha }),
            });

            if (!availRes.ok) {
                const errorData = await availRes.json();
                setError('subDomain', {
                    type: 'manual',
                    message: errorData.error,
                });
                setSubdomainIsValid(false);
                setIsSubmitting(false);

                return;
            }
        } catch {
            setError('subDomain', {
                type: 'manual',
                message: t('errors.subdomain.availability'),
            });

            setSubdomainIsValid(false);
            setIsSubmitting(false);
            openSnack(t('subdomainValidationFailed'), 'error');

            return;
        }

        try {
            const recaptcha =
                process.env.NODE_ENV === 'development' ? '1234567890' : await executeRecaptcha('register');

            const registerRequest: RegisterDomainRequest = {
                domain: values.subDomain,
                ownerEmail: values.ownerEmail,
                ownerName: values.ownerName,
                dataSource: values.dataSource,
                dexcomUsername: values.dexcomUsername,
                dexcomPassword: values.dexcomPassword,
                dexcomServer: values.dexcomServer,
                emailVerificationToken: values.emailValidationCode,
                reCAPTCHAToken: recaptcha,
                apiSecret: values.apiSecret,
                title: values.nsTitle,
            };

            const res = await fetch('/api/register', {
                method: 'POST',
                body: JSON.stringify(registerRequest),
                headers: { 'Content-Type': 'application/json', 'Accept-Language': locale },
            });

            const data = await res.json();
            if (data.success) {
                openSnack(t('registrationSuccess'), 'success');
                // Wait a second and redirect to /welcome/registrationsuccess/ page
                setTimeout(() => {
                    window.location.href = '/welcome/registrationsuccess';
                }, 1000);
            } else {
                openSnack(t('registrationFailed'), 'error');
            }
        } catch {
            openSnack(t('registrationFailed'), 'error');
            //TODO: Add a redirect to the error page
        } finally {
            setIsSubmitting(false);
        }
    };

    const openSnack = (message: string, severity: 'success' | 'error' | 'info' | 'warning') => {
        setSnack({ open: true, message, severity });
    };
    const handleSnackClose = () => setSnack((s) => ({ ...s, open: false }));

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, mt: 4 }}>
            <Snackbar open={snack.open} autoHideDuration={3000} onClose={handleSnackClose}>
                <Alert onClose={handleSnackClose} severity={snack.severity} variant="filled" sx={{ width: '100%' }}>
                    {snack.message}
                </Alert>
            </Snackbar>
            <Typography sx={{ mb: 2 }} variant="h4">
                {t('registrationTitle')}
            </Typography>
            <Box maxWidth={'sm'} component="form" onSubmit={handleSubmit(onSubmit)}>
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
                        <Controller
                            name="ownerName"
                            control={control}
                            render={({ field }) => (
                                <NSInput
                                    fullWidth
                                    size="small"
                                    label={t('ownerName')}
                                    error={!!errors.ownerName}
                                    helperText={errors.ownerName?.message}
                                    moreInformation={t('details.ownerName')}
                                    {...field}
                                />
                            )}
                        />
                    </Grid>
                    <Grid size={{ xs: 12 }}>
                        <Controller
                            name="ownerEmail"
                            control={control}
                            render={({ field }) => (
                                <NSInput
                                    fullWidth
                                    size="small"
                                    label={t('ownerEmail')}
                                    error={!!errors.ownerEmail}
                                    helperText={errors.ownerEmail?.message}
                                    disabled={emailValidated}
                                    moreInformation={t('details.ownerEmail')}
                                    {...field}
                                />
                            )}
                        />
                    </Grid>
                    <Grid size={12}>
                        {!validationEmailSent && (
                            <Button
                                disabled={emailValidated || !!errors.ownerEmail}
                                onClick={handleSendValidationEmail}
                                type="button"
                                variant="contained"
                                color="primary"
                            >
                                {t('validateEmail')}
                            </Button>
                        )}
                    </Grid>
                    {validationEmailSent && !emailValidated && (
                        <>
                            <Grid size={{ xs: 12, sm: 6 }}>
                                <Controller
                                    name="emailValidationCode"
                                    control={control}
                                    render={({ field }) => (
                                        <NSInput
                                            fullWidth
                                            size="small"
                                            label={t('emailValidationCode')}
                                            error={!!errors.emailValidationCode}
                                            helperText={errors.emailValidationCode?.message}
                                            moreInformation={t('details.emailValidationCode')}
                                            {...field}
                                        />
                                    )}
                                />
                            </Grid>
                            <Grid size={{ xs: 12, sm: 6 }}>
                                <Button
                                    disabled={emailValidated || !!errors.emailValidationCode}
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
                                <Controller
                                    name="subDomain"
                                    control={control}
                                    render={({ field }) => (
                                        <NSInput
                                            fullWidth
                                            size="small"
                                            label={t('subDomain')}
                                            error={!!errors.subDomain || !subdomainIsValid}
                                            helperText={errors.subDomain?.message}
                                            moreInformation={t('details.subDomain')}
                                            {...field}
                                        />
                                    )}
                                />
                            </Grid>
                            <Grid size={12}>
                                <Controller
                                    name="nsTitle"
                                    control={control}
                                    render={({ field }) => (
                                        <NSInput
                                            fullWidth
                                            size="small"
                                            label={t('title')}
                                            error={!!errors.nsTitle}
                                            helperText={errors.nsTitle?.message}
                                            moreInformation={t('details.title')}
                                            {...field}
                                        />
                                    )}
                                />
                            </Grid>
                            <Grid size={{ xs: 12, sm: 6 }}>
                                <Controller
                                    name="apiSecret"
                                    control={control}
                                    render={({ field }) => (
                                        <NSInput
                                            fullWidth
                                            size="small"
                                            label={t('apiSecret')}
                                            error={!!errors.apiSecret}
                                            helperText={errors.apiSecret?.message}
                                            moreInformation={t('details.apiSecret')}
                                            {...field}
                                        />
                                    )}
                                />
                            </Grid>
                            <Grid size={{ xs: 12, sm: 6 }}>
                                <Controller
                                    name="dataSource"
                                    control={control}
                                    render={({ field }) => (
                                        <NSInput
                                            fullWidth
                                            size="small"
                                            select
                                            label={t('dataSource')}
                                            error={!!errors.dataSource}
                                            helperText={errors.dataSource?.message}
                                            moreInformation={t('details.dataSource')}
                                            {...field}
                                        >
                                            <MenuItem value="Dexcom">{t('dexcom')}</MenuItem>
                                            <MenuItem value="API">{t('anythingElse')}</MenuItem>
                                        </NSInput>
                                    )}
                                />
                            </Grid>
                            {dataSource === 'Dexcom' && (
                                <>
                                    <Grid size={{ xs: 12, sm: 6 }}>
                                        <Controller
                                            name="dexcomServer"
                                            control={control}
                                            render={({ field }) => (
                                                <NSInput
                                                    fullWidth
                                                    size="small"
                                                    select
                                                    label={t('dexcomServer')}
                                                    error={!!errors.dexcomServer}
                                                    helperText={errors.dexcomServer?.message}
                                                    moreInformation={t('details.dexcomServer')}
                                                    {...field}
                                                >
                                                    <MenuItem value="EU">{t('eu')}</MenuItem>
                                                    <MenuItem value="US">{t('us')}</MenuItem>
                                                </NSInput>
                                            )}
                                        />
                                    </Grid>
                                    <Grid size={12}>
                                        <Controller
                                            name="dexcomUsername"
                                            control={control}
                                            render={({ field }) => (
                                                <NSInput
                                                    fullWidth
                                                    size="small"
                                                    label={t('dexcomUsername')}
                                                    error={!!errors.dexcomUsername}
                                                    helperText={errors.dexcomUsername?.message}
                                                    moreInformation={t('details.dexcomUsername')}
                                                    {...field}
                                                />
                                            )}
                                        />
                                    </Grid>
                                    <Grid size={12}>
                                        <Controller
                                            name="dexcomPassword"
                                            control={control}
                                            render={({ field }) => (
                                                <NSInput
                                                    fullWidth
                                                    size="small"
                                                    label={t('dexcomPassword')}
                                                    error={!!errors.dexcomPassword}
                                                    helperText={errors.dexcomPassword?.message}
                                                    moreInformation={t('details.dexcomPassword')}
                                                    {...field}
                                                />
                                            )}
                                        />
                                    </Grid>
                                </>
                            )}
                            <Grid size={8}>{/* Google reCAPTCHA */}</Grid>
                            <Grid size={12}>
                                <Button type="submit" variant="contained" color="primary" loading={isSubmitting}>
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
