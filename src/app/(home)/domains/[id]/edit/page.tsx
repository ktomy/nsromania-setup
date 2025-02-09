"use client";

import * as React from 'react';
import { useState, useEffect } from 'react';
import {
    TextField,
    Checkbox,
    FormControlLabel,
    Button, MenuItem,
    Select,
    FormControl,
    Box,
    Typography,
    SelectChangeEvent,
    Alert,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Paper,
    Snackbar,
} from '@mui/material';
import Grid from '@mui/material/Grid2';
import { NSDomain, NSDomainEnvironment } from '@prisma/client';
import { useParams } from 'next/navigation';
import { GetDomainByIdResponse, PartialNSDomainWithEnvironments } from '@/types/domains';
import { useTranslations, useLocale } from 'next-intl';

export default function EditDomainPage() {
    const { id } = useParams() as { id: string };
    const t = useTranslations('EditDomainPage');
    const locale = useLocale();
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
    const [loading, setLoading] = useState(true);
    const [environments, setEnvironments] = useState<NSDomainEnvironment[]>([]);
    const [newEnvKey, setNewEnvKey] = useState('');
    const [newEnvValue, setNewEnvValue] = useState('');
    const [snackOpen, setSnackOpen] = useState(false);
    const [snackMessage, setSnackMessage] = useState('');
    const [snackKind, setSnackKind] = useState<'success' | 'error' | 'info' | 'warning'>('success');
    const [owner, setOwner] = useState('');

    useEffect(() => {
        if (id) {
            fetch(`/api/domains/${id}`)
                .then(response => response.json())
                .then(jsonData => {
                    const data = jsonData as GetDomainByIdResponse;
                    setDomain(data.domain ?? '');
                    setTitle(data.title ?? '');
                    setApiSecret(data.apiSecret ?? '');
                    setActive(data.active === 1);
                    setDataSource(data.enable.includes('bridge') ? 'Dexcom' : 'Custom');
                    setDexcomServer(data.bridgeServer ?? '');
                    setDexcomUsername(data.bridgeUsername ?? '');
                    setDexcomPassword(data.bridgePassword ?? '');
                    setEnable(data.enable ?? '');
                    setShowPlugins(data.showPlugins ?? '');
                    setEnvironments(data.environments ?? []);
                    setLoading(false);
                    setOwner(data.authUser?.email ?? '?');
                })
                .catch(error => {
                    console.error('Error fetching domain:', error);
                    setAlert({ type: 'error', message: 'Failed to fetch domain' });
                });
        }
    }, [id]);

    const handleAddEnvironment = () => {
        if (!newEnvKey || !newEnvValue) {
            openSnack('Variable and value are required', "error");
            return;
        }

        setEnvironments([...environments, {
            id: 0,
            variable: newEnvKey,
            value: newEnvValue,
            nsDomainId: parseInt(id),
        }]);
        setNewEnvKey('');
        setNewEnvValue('');
    };

    const handleRemoveEnvironment = (index: number) => {
        openSnack('Environment variable removed', 'info');
        setEnvironments(environments.filter((_, i) => i !== index));
    };

    const openSnack = (message: string, kind: 'success' | 'error' | 'info' | 'warning') => {
        setSnackMessage(message);
        setSnackKind(kind);
        setSnackOpen(true);
    };

    const handleSnackClose = () => {
        setSnackOpen(false);
    };

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        const updatedDomain: PartialNSDomainWithEnvironments = {
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
            environments: environments,
        };

        try {
            setAlert(null);
            const body = JSON.stringify(updatedDomain);
            const response = await fetch(`/api/domains/${id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: body,
            });

            if (response.ok) {
                setAlert({ type: 'success', message: 'Domain updated successfully' });
                // redirect to /domains/[id]
                window.location.href = `/domains/${id}`;
            } else {
                const errorData = await response.json();
                setAlert({ type: 'error', message: errorData.error });
            }
        } catch (error) {
            console.error('Error updating domain:', error);
            setAlert({ type: 'error', message: 'Failed to update domain' });
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

    const handleNewEnvKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setNewEnvKey(e.target.value);
    };

    return (
        (loading || !domain) ? <Typography>{t('loading')}</Typography> :
            <Box component="form" onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Grid container spacing={1}>
                    <Grid size={4}>
                        <Typography variant="h6">{t('domainName')}</Typography>
                    </Grid>
                    <Grid size={8}>
                        <Box sx={{ display: 'flex' }} alignItems="center">
                            <TextField
                                value={domain}
                                onChange={(e) => setDomain(e.target.value)}
                                required
                                error={domain.length > 0 && !/^[a-z0-9-]{2,20}$/.test(domain)}
                                size="small"
                                disabled
                            />
                            <Typography sx={{ marginLeft: 1 }}>.nsromania.info</Typography>
                        </Box>
                    </Grid>
                    <Grid size={4}>
                        <Typography variant="h6">{t('owner')}</Typography>
                    </Grid>
                    <Grid size={8}>
                        <TextField
                            disabled
                            value={owner}
                            size='small'
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
                                <MenuItem value="Dexcom">Dexcom</MenuItem>
                                <MenuItem value="API">API (xDrip/Libre/640GConnect)</MenuItem>
                                <MenuItem value="Custom">Custom</MenuItem>
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
                                        <MenuItem value="EU">EU</MenuItem>
                                        <MenuItem value="US">US</MenuItem>
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

                    <Grid size={12}>
                        <Typography variant="h6">{t('environments')}</Typography>
                    </Grid>
                    <Grid size={12}>
                        <TableContainer component={Paper}>
                            <Table>
                                <TableHead>
                                    <TableRow>
                                        <TableCell>{t('variable')}</TableCell>
                                        <TableCell>{t('value')}</TableCell>
                                        <TableCell>{t('actions')}</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {environments.map((env, index) => (
                                        <TableRow key={index}>
                                            <TableCell>{env.variable}</TableCell>
                                            <TableCell>{env.value}</TableCell>
                                            <TableCell>
                                                <Button onClick={() => handleRemoveEnvironment(index)}>{t('remove')}</Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                    <TableRow>
                                        <TableCell>
                                            <TextField
                                                value={newEnvKey}
                                                onChange={handleNewEnvKeyChange}
                                                placeholder={t('variable')}
                                                size="small"
                                                fullWidth
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <TextField
                                                value={newEnvValue}
                                                onChange={(e) => setNewEnvValue(e.target.value)}
                                                placeholder={t('value')}
                                                size="small"
                                                fullWidth
                                                multiline={newEnvKey === "LOOP_APNS_KEY"}
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <Button onClick={handleAddEnvironment}>{t('add')}</Button>
                                        </TableCell>
                                    </TableRow>
                                </TableBody>
                            </Table>
                        </TableContainer>
                    </Grid>

                </Grid>
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
                {alert && (
                    <Alert severity={alert.type} onClose={() => setAlert(null)}>
                        {alert.message}
                    </Alert>
                )}
                <Grid size={12}>
                    <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
                        <Button type="submit" variant="contained" color="primary">
                            {t('save')}
                        </Button>
                        <Button variant="outlined" color="primary" onClick={() => window.history.back()}>
                            {t('cancel')}
                        </Button>
                    </Box>
                </Grid>
            </Box>
    );
}
