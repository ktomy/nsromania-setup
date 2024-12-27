"use client";

import * as React from 'react';
import { useState, useEffect } from 'react';
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
import { useParams } from 'next/navigation';
import { GetDomainByIdResponse } from '@/types/domains';

export default function EditDomainPage() {
    const { id } = useParams() as { id: string };
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
                    setLoading(false);
                })
                .catch(error => {
                    console.error('Error fetching domain:', error);
                    setAlert({ type: 'error', message: 'Failed to fetch domain' });
                });
        }
    }, [id]);

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        const updatedDomain: Omit<NSDomain, 'id' | 'created' | 'lastUpdated' | 'authUserId' | 'authUser' | 'environments'> = {
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
        };

        try {
            setAlert(null);
            const body = JSON.stringify({ domain: updatedDomain });
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

    return (
        (loading || !domain) ? <Typography>Loading...</Typography> :
            <Box component="form" onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Grid container spacing={1}>
                    <Grid size={4}>
                        <Typography variant="h6">Domain Name</Typography>
                    </Grid>
                    <Grid size={8}>
                        <TextField
                            value={domain}
                            onChange={(e) => setDomain(e.target.value)}
                            required
                            error={domain.length > 0 && !/^[a-z0-9-]{2,20}$/.test(domain)}
                            size="small"
                            disabled
                        />
                    </Grid>

                    <Grid size={4}>
                        <Typography variant="h6">Title</Typography>
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
                        <Typography variant="h6">API Secret</Typography>
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
                        <Typography variant="h6">Active</Typography>
                    </Grid>
                    <Grid size={8}>
                        <FormControlLabel
                            control={<Checkbox checked={active} onChange={(e) => setActive(e.target.checked)} />}
                            label=""
                        />
                    </Grid>

                    <Grid size={4}>
                        <Typography variant="h6">Data Source</Typography>
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
                                <Typography variant="h6">Dexcom Server</Typography>
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
                                <Typography variant="h6">Dexcom Username</Typography>
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
                                <Typography variant="h6">Dexcom Password</Typography>
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
                        <Typography variant="h6">Enable</Typography>
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
                        <Typography variant="h6">Show Plugins</Typography>
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
                {alert && (
                    <Alert severity={alert.type} onClose={() => setAlert(null)}>
                        {alert.message}
                    </Alert>
                )}
                <Grid size={12}>
                    <Button type="submit" variant="contained" color="primary">
                        Save
                    </Button>
                </Grid>
            </Box>
    );
}
