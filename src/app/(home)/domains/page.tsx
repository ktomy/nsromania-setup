'use client';
import Typography from '@mui/material/Typography';
import { Alert, Box, Button, Chip, Snackbar } from '@mui/material';
import { DataGrid, GridActionsCellItem, GridColDef, GridRowId, GridRowsProp } from '@mui/x-data-grid';
import Grid from '@mui/material/Grid2';
import SettingsIcon from '@mui/icons-material/Settings';
import { useSession } from 'next-auth/react';
import { NSDomain, User } from '@prisma/client';
import { redirect } from 'next/navigation';
import { formatDate } from '@/lib/utils';
import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';

type NSDomainExtended = NSDomain & {
    status: string;
};

export default function DomainsPage() {
    const t = useTranslations('DomainsPage');
    const [rows, setRows] = useState<GridRowsProp>([]);
    const { data: session, status } = useSession();
    const [snackOpen, setSnackOpen] = useState(false);
    const [snackMessage, setSnackMessage] = useState('');
    const [snackKind, setSnackKind] = useState<'success' | 'error' | 'info' | 'warning'>('success');
    const [actionInProgress, setActionInProgress] = useState(false);

    const openSnack = (message: string, kind: 'success' | 'error' | 'info' | 'warning') => {
        setSnackMessage(t(message));
        setSnackKind(kind);
        setSnackOpen(true);
    };

    const handleSnackClose = () => {
        setSnackOpen(false);
    };

    const handleDomainsActions = async (action: 'startall') => {
        try {
            setActionInProgress(true);
            const res = await fetch(`/api/domains/${action}`, {
                method: 'POST',
            });

            if (res.ok) {
                openSnack('actionSuccess', 'success');
                fetchDomains();
            } else {
                console.error(`Failed to ${action} domain`, res);
                openSnack('actionFailed', 'error');
                setActionInProgress(false);
            }
        } catch (error) {
            console.error(`Failed to ${action} domain`, error);
            openSnack('actionFailed', 'error');
            setActionInProgress(false);
        }
    };

    const fetchDomains = () => {
        fetch(`/api/domains`).then((response) => {
            response.json().then((domains) => {
                const rows: GridRowsProp = domains.map((domain: NSDomainExtended) => {
                    return {
                        id: domain.id,
                        active: domain.active,
                        title: domain.title,
                        domain: domain.domain,
                        created: formatDate(domain.created),
                        last_updated: formatDate(domain.lastUpdated),
                        data_source:
                            domain.enable.indexOf('bridge') > -1
                                ? 'Dexcom'
                                : domain.enable.indexOf('mmconnect') > -1
                                  ? 'Medtronic'
                                  : 'API',
                        status: domain.status,
                    };
                });
                setRows(rows);
                setActionInProgress(false);
            });
        });
    };

    useEffect(() => {
        if (!session) return;
        fetchDomains();
    }, [session]);

    if (status === 'loading') {
        return <p>{t('loading')}</p>;
    }

    if (!session) {
        return <p>{t('notSignedIn')}</p>;
    }

    const redirectToDetails = (id: GridRowId) => () => {
        console.log('Redirecting to domain details:', id);
        redirect(`/domains/${id}`);
    };

    const columns: GridColDef[] = [
        {
            field: 'id',
            headerName: t('id'),
            type: 'number',
            width: 50,
        },
        {
            field: 'active',
            headerName: t('active'),
            type: 'boolean',
            width: 70,
        },
        {
            field: 'domain',
            headerName: t('subdomain'),
            type: 'string',
            flex: 1,
        },
        {
            field: 'data_source',
            headerName: t('dataSource'),
            type: 'string',
            width: 100,
        },
        {
            field: 'title',
            headerName: t('title'),
            type: 'string',
            flex: 1,
        },
        {
            field: 'created',
            headerName: t('created'),
            type: 'string',
            flex: 1,
        },
        {
            field: 'last_updated',
            headerName: t('updated'),
            type: 'string',
            flex: 1,
        },
        {
            field: 'status',
            headerName: t('status'),
            type: 'string',
            width: 120,
            renderCell: (params) => {
                const status = params.value;
                return (
                    <Chip
                        label={status}
                        size="small"
                        style={{
                            backgroundColor: status === 'online' ? 'green' : 'red',
                            color: 'white',
                        }}
                    />
                );
            },
        },
        {
            field: 'actions',
            type: 'actions',
            width: 80,
            getActions: (params) => [
                <GridActionsCellItem
                    key={1}
                    icon={<SettingsIcon />}
                    label={t('details')}
                    onClick={redirectToDetails(params.id)}
                />,
            ],
        },
    ];

    const user = session.user as User;

    return (
        <Box>
            <Snackbar open={snackOpen} autoHideDuration={3000} onClose={handleSnackClose} message={snackMessage}>
                <Alert onClose={handleSnackClose} severity={snackKind} variant="filled" sx={{ width: '100%' }}>
                    {snackMessage}
                </Alert>
            </Snackbar>
            <Grid size={12} direction={'row'} container>
                <Grid size={8}>
                    <Typography>
                        {t('welcomeMessage', {
                            name: user.name,
                            id: user.id || 'Unknown ID',
                            role: user.role || 'Unknown',
                        })}
                    </Typography>
                </Grid>
                <Grid size={4}>
                    <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
                        <Button
                            variant="contained"
                            color="primary"
                            onClick={() => handleDomainsActions('startall')}
                            disabled={actionInProgress}
                        >
                            {t('startAllActive')}
                        </Button>
                        <Button variant="contained" color="primary" href={`/newdomain`}>
                            {t('newDomain')}
                        </Button>
                    </Box>
                </Grid>
            </Grid>
            <br />
            <DataGrid rows={rows} columns={columns} disableRowSelectionOnClick />
        </Box>
    );
}
