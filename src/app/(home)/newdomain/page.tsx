"use client";

import * as React from 'react';
import { useState } from 'react';
import {
    TextField,
    Checkbox,
    FormControlLabel,
    Button, MenuItem,
    Select, InputLabel,
    FormControl,
    Box,
    Typography,
    SelectChangeEvent,
    Alert,
} from '@mui/material';
import Grid from '@mui/material/Grid2';
import { NSDomain } from '@prisma/client';
import { useTranslations } from 'next-intl';
import { useSession } from 'next-auth/react';
import { CreateDomainRequest } from '@/types/domains';

export default function NewDomainPage() {
    const session = useSession();

    const [domain, setDomain] = useState('');
    const [title, setTitle] = useState('');
    const [apiSecret, setApiSecret] = useState('');
    const [active, setActive] = useState(true);
    const [dataSource, setDataSource] = useState('Dexcom');
    const [dexcomServer, setDexcomServer] = useState('EU');
    const [dexcomUsername, setDexcomUsername] = useState('');
    const [dexcomPassword, setDexcomPassword] = useState('');
    const [enable, setEnable] = useState('careportal iob cob rawbg cors dbsize bridge');
    const [showPlugins, setShowPlugins] = useState('cob iob sage cage careportal');
    const [alert, setAlert] = useState<{ type: 'success' | 'error', message: string } | null>(null);
    const t = useTranslations("NewDomainPage");
    // Owner is an email address
    const [ownerEmail, setOwnerEmail] = useState('');
    const [ownerName, setOwnerName] = useState('');

    if (!session.data?.user) {
        return null;
    }

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        const newDomain: Omit<CreateDomainRequest, 'id' | 'created' | 'lastUpdated' | 'authUserId' | 'authUser' | 'environments'> = {
            domain,
            title,
            apiSecret,
            active: active ? 1 : 0,
            dbExists: 0,
            enable,
            showPlugins,
            mmconnectUsername: null,
            mmconnectPassword: null,
            mmconnectServer: null,
            bridgeUsername: dexcomUsername,
            bridgePassword: dexcomPassword,
            bridgeServer: dexcomServer,
            port: 0,
            dbPassword: null,
            nsversion: null,
            ownerEmail,
            ownerName,
        };

        try {
            setAlert(null);
            const body = JSON.stringify({ domain: newDomain });
            console.log('Body:', body);
            const response = await fetch('/api/domains', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: body,
            });

            if (response.ok) {
                // get the new domain id from the response (response is the new domain object)
                // Redirect to /domains/[id]

                const newDomain = await response.json();
                window.location.href = `/domains/${newDomain.id}`;
            } else {
                const errorData = await response.json();
                setAlert({ type: 'error', message: errorData.error });
            }
        } catch (error) {
            console.error('Error creating domain:', error);
            setAlert({ type: 'error', message: 'Failed to create domain' });
        }
    };

    const handleDataSourceChange = (event: SelectChangeEvent<string>, child: React.ReactNode) => {
        const value = event.target.value as string;
        setDataSource(value);
        if (value === 'Dexcom') {
            setEnable('careportal iob cob cage sage rawbg cors dbsize bridge');
        } else {
            setEnable('careportal iob cob cage sage rawbg cors dbsize');
        }
    };

    return (
        <Box component="form" onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Grid container spacing={1}>
                <Grid size={4}>
                    <Typography variant="h6">{t('domainOwner')}</Typography>
                </Grid>
                <Grid size={8}>
                    <TextField
                        value={ownerEmail}
                        onChange={(e) => setOwnerEmail(e.target.value)}
                        required
                        error={ownerEmail.length > 0 && !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(ownerEmail)}
                        size="small"
                    />
                </Grid>
                <Grid size={4}>
                    <Typography variant="h6">{t('domainOwnerName')}</Typography>
                </Grid>
                <Grid size={8}>
                    {/* Owner name is a string of max 64 characters having alphanumeric characters and spaces */}
                    <TextField
                        value={ownerName}
                        onChange={(e) => setOwnerName(e.target.value)}
                        required
                        error={ownerName.length > 0 && !/^[a-zA-Z0-9\s]{1,64}$/.test(ownerName)}
                        size="small"
                    />
                </Grid>

                <Grid size={4}>
                    <Typography variant="h6">{t('domainName')}</Typography>
                </Grid>
                <Grid size={8}>
                    <TextField
                        value={domain}
                        onChange={(e) => setDomain(e.target.value)}
                        required
                        error={domain.length > 0 && !/^[a-z0-9-]{2,20}$/.test(domain)}
                        size="small"
                    />
                </Grid>

                <Grid size={4}>
                    <Typography variant="h6">{t('title')}</Typography>
                </Grid>
                <Grid size={8}>
                    <TextField
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        error={title.length > 0 && title.length > 32}
                        size='small'
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
                    <Typography variant="h6">{t('active')}</Typography>
                </Grid>
                <Grid size={8}>
                    <FormControlLabel
                        control={<Checkbox checked={active} onChange={(e) => setActive(e.target.checked)} />}
                        label=""
                    />
                </Grid>

                <Grid size={4}>
                    <Typography variant="h6">{t('dataSource')}</Typography>
                </Grid>
                <Grid size={8}>
                    <FormControl fullWidth size='small'>
                        <Select value={dataSource} onChange={handleDataSourceChange}>
                            <MenuItem value="Dexcom">{t('dexcom')}</MenuItem>
                            <MenuItem value="API">{t('api')}</MenuItem>
                            <MenuItem value="Custom">{t('custom')}</MenuItem>
                        </Select>
                    </FormControl>
                </Grid>

                {(dataSource === 'Dexcom' || dataSource === 'Custom') && (
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
                                size='small'
                            />
                        </Grid>
                    </>
                )}

                <Grid size={4}>
                    <Typography variant="h6">{t('enable')}</Typography>
                </Grid>
                <Grid size={8}>
                    <TextField
                        value={enable}
                        onChange={(e) => setEnable(e.target.value)}
                        disabled={dataSource !== 'Custom'}
                        fullWidth
                    />
                </Grid>

                <Grid size={4}>
                    <Typography variant="h6">{t('showPlugins')}</Typography>
                </Grid>
                <Grid size={8}>
                    <TextField
                        value={showPlugins}
                        onChange={(e) => setShowPlugins(e.target.value)}
                        disabled={dataSource !== 'Custom'}
                        fullWidth
                    />
                </Grid>

            </Grid>
            {
                alert && (
                    <Alert severity={alert.type} onClose={() => setAlert(null)}>
                        {alert.message}
                    </Alert>
                )
            }
            <Grid size={12}>
                <Button type="submit" variant="contained" color="primary">
                    {t('create')}
                </Button>
            </Grid>
        </Box >
    );
}
