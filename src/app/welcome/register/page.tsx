'use client';
import * as React from 'react';
import Typography from '@mui/material/Typography';
import { Box, Button, FormControl, MenuItem, Select, SelectChangeEvent, TextField } from '@mui/material';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import Grid from '@mui/material/Grid2';
import { useEffect, useState } from 'react';
import LocaleSwitcher from '@/lib/components/LocaleSwitcher';
import { GoogleReCaptchaProvider, useGoogleReCaptcha } from "react-google-recaptcha-v3";


export default function RegisterPage() {
    const t = useTranslations('RegisterPage');
    const locale = useLocale();
    const [ownerEmail, setOwnerEmail] = useState('');
    const [ownerName, setOwnerName] = useState('');
    const [emailValidationCode, setEmailValidationCode] = useState('');
    const [subDomain, setSubDomain] = useState('');
    const [apiSecret, setApiSecret] = useState('');
    const [dataSource, setDataSource] = useState('Dexcom');
    const [dexcomServer, setDexcomServer] = useState('EU');
    const [dexcomUsername, setDexcomUsername] = useState('');
    const [dexcomPassword, setDexcomPassword] = useState('');
    const { executeRecaptcha } = useGoogleReCaptcha();
    const [captchaToken, setCaptchaToken] = useState<string | null>(null);


    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!captchaToken) {
            alert("reCAPTCHA validation failed");
            return;
        }

        const res = await fetch("/api/register", {
            method: "POST",
            body: JSON.stringify({ token: captchaToken }),
            headers: { "Content-Type": "application/json" },
        });

        const data = await res.json();
        if (data.success) {
            alert("Captcha Verified! Form Submitted.");
        } else {
            alert("Captcha verification failed.");
        }
    };

    const handleDataSourceChange = (event: SelectChangeEvent<string>, child: React.ReactNode) => {
        const value = event.target.value as string;
        setDataSource(value);
        // if (value === 'Dexcom') {
        //     setEnable('careportal iob cob cage sage rawbg cors dbsize bridge');
        // } else {
        //     setEnable('careportal iob cob cage sage rawbg cors dbsize');
        // }
    };

    useEffect(() => {
        if (executeRecaptcha) {
            executeRecaptcha("submit").then(setCaptchaToken);
        }
    }, [executeRecaptcha]);

    return (
        <GoogleReCaptchaProvider reCaptchaKey={process.env.RECAPTCHA_SITE_KEY as string}>

            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, mt: 4 }}>
                <LocaleSwitcher />
                <Typography variant="h4">{t('registrationTitle')}</Typography>
                <Box width={1024} component="form" onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <Typography variant="body2">{t('registrationDescription')}</Typography>
                    <Grid container spacing={1}>
                        <Grid size={4}>
                            <Typography variant="h6">{t('ownerEmail')}</Typography>
                        </Grid>
                        <Grid size={8}>
                            <TextField
                                value={ownerEmail}
                                onChange={(e) => setOwnerEmail(e.target.value)}
                                fullWidth
                                required
                                error={ownerEmail.length > 0 && !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(ownerEmail)}
                                size="small"
                            />
                        </Grid>
                        <Grid size={4}>
                            <Typography variant="h6">{t('ownerName')}</Typography>
                        </Grid>
                        <Grid size={6}>
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
                        <Grid size={2}>
                            <Button fullWidth type="button" variant="contained" color="primary">{t('validateEmail')}</Button>
                        </Grid>
                        <Grid size={4}>
                            <Typography variant="h6">{t('emailValidateionCode')}</Typography>
                        </Grid>
                        <Grid size={8}>
                            {/* Owner name is a string of max 64 characters having alphanumeric characters and spaces */}
                            <TextField
                                value={emailValidationCode}
                                onChange={(e) => setEmailValidationCode(e.target.value)}
                                required
                                fullWidth
                                error={emailValidationCode.length > 0 && !/^[a-zA-Z0-9\s]{1,64}$/.test(emailValidationCode)}
                                size="small"
                            />
                        </Grid>
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
                            <Button type="submit" variant="contained" color="primary">{t('register')}</Button>
                        </Grid>
                    </Grid>
                </Box>
                <br />
                <br />
            </Box>
        </GoogleReCaptchaProvider>
    );
}