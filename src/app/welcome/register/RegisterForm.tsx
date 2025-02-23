'use client';
import * as React from 'react';
import Typography from '@mui/material/Typography';
import { Alert, Box, Button, FormControl, MenuItem, Select, SelectChangeEvent, Snackbar, TextField } from '@mui/material';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import Grid from '@mui/material/Grid2';
import { useEffect, useState } from 'react';
import LocaleSwitcher from '@/lib/components/LocaleSwitcher';
import { useGoogleReCaptcha } from "react-google-recaptcha-v3";
import { RegisterDomainRequest } from '@/types/domains';

export default function RegisterForm() {
    const t = useTranslations('RegisterPage');
    const locale = useLocale();
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

    const handleSendValidationEmail = async () => {
        if (!executeRecaptcha) {
            console.error("Recaptcha not initialized");
            return;
        }

        const token = process.env.NODE_ENV === 'development' ? "1234567890"
            : await executeRecaptcha("email_validation");

        const res = await fetch("/api/register/validate-email", {
            method: "POST",
            body: JSON.stringify({ email: ownerEmail, token: token }),
            headers: { "Content-Type": "application/json" },
        });

        const data = await res.json();
        if (data.error) {
            console.log("Email validation failed", data);
            openSnack(t('validationEmailFailed'), 'error');
            return;
        }

        openSnack(t('sendingValidationEmail'), 'info');
        setValidationEmailSent(true);
    };

    const handleCheckValidationCode = async () => {
        if (!executeRecaptcha) {
            console.error("Recaptcha not initialized");
            return;
        }

        const token = process.env.NODE_ENV === 'development' ? "1234567890"
            : await executeRecaptcha("email_code_validation");

        const res = await fetch("/api/register/validate-verification-code", {
            method: "POST",
            body: JSON.stringify({ email: ownerEmail, token: token, code: emailValidationCode }),
            headers: { "Content-Type": "application/json" },
        });

        const data = await res.json();
        if (data.error) {
            console.log("Email verification code validation failed", data);
            openSnack(t('emailValidationCodeInvalid'), 'error');
            return;
        }

        openSnack(t('emailVerificationCodeValidated'), 'success');
        setEmailValidated(true);
    };


    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!executeRecaptcha) {
            console.error("Recaptcha not initialized");
            return;
        }

        const token = process.env.NODE_ENV === 'development' ? "1234567890"
            : await executeRecaptcha("register");

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

        const res = await fetch("/api/register", {
            method: "POST",
            body: JSON.stringify(registerRequest),
            headers: { "Content-Type": "application/json" },
        });

        const data = await res.json();
        if (data.success) {
            openSnack(t('registrationSuccess'), 'success');
        } else {
            console.log("registration failed", data);
            openSnack(t('registrationFailed'), 'error');
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

    const handleDataSourceChange = (event: SelectChangeEvent<string>, child: React.ReactNode) => {
        const value = event.target.value as string;
        setDataSource(value);
    };

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, mt: 4 }}>
            <Snackbar
                open={snackOpen}
                autoHideDuration={3000}
                onClose={handleSnackClose}
                message={snackMessage}
            >
                <Alert
                    onClose={handleSnackClose}
                    severity={snackKind}
                    variant="filled"
                    sx={{ width: '100%' }}
                >
                    {snackMessage}
                </Alert>
            </Snackbar>
            <LocaleSwitcher />
            <Typography variant="h4">{t('registrationTitle')}</Typography>
            <Box width={1024} component="form" onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Typography variant="body2">{t('registrationDescription')}</Typography>
                <Grid container spacing={1}>
                    <Grid size={4}>
                        <Typography variant="h6">{t('ownerName')}</Typography>
                    </Grid>
                    <Grid size={8}>
                        {/* Owner name is a string of max 64 characters having alphanumeric characters and spaces */}
                        <TextField
                            value={ownerName}
                            onChange={(e) => setOwnerName(e.target.value)}
                            required
                            fullWidth
                            error={ownerName.length > 0 && !/^[a-zA-Z0-9\s]{1,64}$/.test(ownerName)}
                            size="small"
                        />
                    </Grid>
                    <Grid size={4}>
                        <Typography variant="h6">{t('ownerEmail')}</Typography>
                    </Grid>
                    <Grid size={6}>
                        <TextField
                            value={ownerEmail}
                            onChange={(e) => setOwnerEmail(e.target.value)}
                            fullWidth
                            required
                            disabled={emailValidated}
                            error={ownerEmail.length > 0 && !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(ownerEmail)}
                            size="small"
                        />
                    </Grid>
                    <Grid size={2}>
                        <Button
                            disabled={emailValidated}
                            fullWidth
                            onClick={handleSendValidationEmail}
                            type="button"
                            variant="contained"
                            color="primary">
                            {t('validateEmail')}
                        </Button>
                    </Grid>
                    {validationEmailSent && (
                        <>
                            <Grid size={4}>
                                <Typography variant="h6">{t('emailValidateionCode')}</Typography>
                            </Grid>
                            <Grid size={4}>
                                {/* Validation code is a string of 6 digits, it can contain spaces or tabs at any moment, including start and end of the string */}
                                <TextField
                                    value={emailValidationCode}
                                    onChange={(e) => setEmailValidationCode(e.target.value)}
                                    required
                                    disabled={emailValidated}
                                    error={emailValidationCode.length > 0 && !/^\s*\d{6}\s*$/.test(emailValidationCode)}
                                    fullWidth
                                    size="small"
                                />
                            </Grid>
                            <Grid size={4}>
                                <Button
                                    disabled={emailValidated}
                                    fullWidth type="button"
                                    variant="contained"
                                    onClick={handleCheckValidationCode}
                                    color="primary">
                                    {t('checkValidationCode')}
                                </Button>
                            </Grid>
                        </>
                    )}

                    {emailValidated && (
                        <>
                            <Grid size={4}>
                                <Typography variant="h6">{t('subDomain')}</Typography>
                            </Grid>
                            <Grid size={8}>
                                {/* Subdomain is a string of max 32 characters containing only lowercase alphanumeric characters*/}
                                <TextField
                                    value={subDomain}
                                    onChange={(e) => setSubDomain(e.target.value)}
                                    required
                                    fullWidth
                                    error={subDomain.length > 0 && !/^[a-z0-9]{1,32}$/.test(subDomain)}
                                    size="small"
                                />
                            </Grid>
                            <Grid size={4}>
                                <Typography variant="h6">{t('title')}</Typography>
                            </Grid>
                            <Grid size={8}>
                                <TextField
                                    value={nsTitle}
                                    onChange={(e) => setNsTitle(e.target.value)}
                                    fullWidth
                                    size="small"
                                />
                            </Grid>
                            <Grid size={4}>
                                <Typography variant="h6">{t('apiSecret')}</Typography>
                            </Grid>
                            <Grid size={8}>
                                <TextField
                                    value={apiSecret}
                                    onChange={(e) => setApiSecret(e.target.value)}
                                    required
                                    error={apiSecret.length > 0 && apiSecret.length < 12}
                                    size='small'
                                />
                            </Grid>
                            <Grid size={4}>
                                <Typography variant="h6">{t('dataSource')}</Typography>
                            </Grid>
                            <Grid size={8}>
                                <FormControl fullWidth size='small'>
                                    <Select value={dataSource} onChange={handleDataSourceChange}>
                                        <MenuItem value="Dexcom">{t('dexcom')}</MenuItem>
                                        <MenuItem value="API">{t('anythingElse')}</MenuItem>
                                    </Select>
                                </FormControl>
                            </Grid>
                            {(dataSource === 'Dexcom') && (
                                <>
                                    <Grid size={4}>
                                        <Typography variant="h6">{t('dexcomServer')}</Typography>
                                    </Grid>
                                    <Grid size={8}>
                                        <FormControl fullWidth size='small'>
                                            <Select value={dexcomServer} onChange={(e) => setDexcomServer(e.target.value)}>
                                                <MenuItem value="EU">{t('eu')}</MenuItem>
                                                <MenuItem value="US">{t('us')}</MenuItem>
                                            </Select>
                                        </FormControl>
                                    </Grid>

                                    <Grid size={4}>
                                        <Typography variant="h6">{t('dexcomUsername')}</Typography>
                                    </Grid>
                                    <Grid size={8}>
                                        <TextField
                                            value={dexcomUsername}
                                            onChange={(e) => setDexcomUsername(e.target.value)}
                                            required={dataSource === 'Dexcom'}
                                            fullWidth
                                            size='small'
                                        />
                                    </Grid>

                                    <Grid size={4}>
                                        <Typography variant="h6">{t('dexcomPassword')}</Typography>
                                    </Grid>
                                    <Grid size={8}>
                                        <TextField
                                            value={dexcomPassword}
                                            onChange={(e) => setDexcomPassword(e.target.value)}
                                            required={dataSource === 'Dexcom'}
                                            fullWidth
                                            size='small'
                                        />
                                    </Grid>
                                </>
                            )}
                            <Grid size={4} />
                            <Grid size={8}>
                                {/* Google reCAPTCHA */}

                            </Grid>
                            <Grid size={4} />
                            <Grid size={8}>
                                <Button
                                    type="submit"
                                    variant="contained"
                                    color="primary">
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