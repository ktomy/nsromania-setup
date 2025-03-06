'use client';

import Typography from '@mui/material/Typography';
import { Alert, Box, Snackbar } from '@mui/material';
import { DataGrid, GridActionsCellItem, GridColDef, GridRowId, GridRowsProp } from '@mui/x-data-grid';
import Grid from '@mui/material/Grid2';
import { Settings } from '@mui/icons-material';
import { useSession } from 'next-auth/react';
import { register_request } from '@prisma/client';
import { redirect } from 'next/navigation';
import { formatDate } from '@/lib/utils';
import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';

export default function RequestsPage() {
    const t = useTranslations('RequestsPage');
    const [rows, setRows] = useState<GridRowsProp>([]);
    const { data: session, status } = useSession();
    const [snackOpen, setSnackOpen] = useState(false);
    const [snackMessage, setSnackMessage] = useState('');
    const [snackKind, setSnackKind] = useState<'success' | 'error' | 'info' | 'warning'>('success');
    const [, setActionInProgress] = useState(false);

    const openSnack = (message: string, kind: 'success' | 'error' | 'info' | 'warning') => {
        setSnackMessage(t(message));
        setSnackKind(kind);
        setSnackOpen(true);
    };

    const handleSnackClose = () => {
        setSnackOpen(false);
    };
    const handleRequestsActions = async (id: number, action: "approve" | "reject") => {
        try {
            setActionInProgress(true);

            const res = await fetch(`/api/register/${id}`, {
                method: action === "approve" ? "POST" : "DELETE",
            });

            if (res.ok) {
                openSnack("actionSuccess", "success");
                fetchRequests();

            } else {
                console.error(`Failed to ${action} domain`, res);
                openSnack("actionFailed", "error");
                setActionInProgress(false);
            }
        } catch (error) {
            console.error(`Failed to ${action} domain`, error);
            openSnack("actionFailed", "error");
            setActionInProgress(false);
        }
    }

    const fetchRequests = () => {
        fetch(`/api/register`).then((response) => {
            response.json().then((domains) => {
                const rows: GridRowsProp = domains.map((request: register_request) => {
                    return {
                        id: request.id,
                        domain: request.subdomain,
                        dataSource: request.data_source,
                        ownerName: request.owner_name,
                        ownerEmail: request.owner_email,
                        apiSecret: request.api_secret,
                        status: request.status,
                        createdAt: formatDate(request.requested_at),
                        actionedAt: formatDate(request.chnged_at),
                        actions: request.status === "pending" ? [
                            {
                                icon: (<Settings />),
                                label: t('approve'),
                                onClick: handleRequestsActions.bind(null, request.id, "approve"),
                            },
                            {
                                icon: (<Settings />),
                                label: t('reject'),
                                onClick: handleRequestsActions.bind(null, request.id, "reject"),
                            },
                        ] : [],
                    }
                });
                setRows(rows);
                setActionInProgress(false);
            });

        });
    }

    useEffect(() => {
        if (!session) return;
        fetchRequests();

    }, [session]);


    if (status === 'loading') {
        return <p>{t('loading')}</p>;
    }

    if (!session) {
        return <p>{t('notSignedIn')}</p>;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const redirectToDetails = (id: GridRowId) => () => {
        console.log('Redirecting to domain details:', id);
        redirect(`/requests/${id}`);
    };

    const columns: GridColDef[] = [
        { field: 'domain', headerName: t('domain'), width: 200 },
        { field: 'dataSource', headerName: t('dataSource'), width: 150 },
        { field: 'ownerName', headerName: t('ownerName'), width: 200 },
        { field: 'ownerEmail', headerName: t('ownerEmail'), width: 200 },
        // { field: 'apiSecret', headerName: t('apiSecret'), width: 200 },
        { field: 'status', headerName: t('status'), width: 200 },
        // { field: 'createdAt', headerName: t('createdAt'), width: 200 },
        // { field: 'actionedAt', headerName: t('actionedAt'), width: 200 },
        {
            field: 'actions',
            headerName: t('actions'),
            width: 200,
            renderCell: (params) => {
                return (
                    <GridActionsCellItem
                        icon={<Settings />}
                        label="Actions"
                        action={params.value}
                    />
                );
            },
        },
    ];

    return (<Box>
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
        <Grid size={12} direction={"row"} container>
            <Grid size={8}>
                <Typography>{t('welcomeMessage')}</Typography>
            </Grid>
            <Grid size={4}>
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2 }}>

                    {/* <Button
                        variant="contained"
                        color="primary"
                        onClick={() => handleDomainsActions("startall")}
                        disabled={actionInProgress}
                    >
                        {t('startAllActive')}
                    </Button>
                    <Button variant="contained" color="primary" href={`/newdomain`}>
                        {t('newDomain')}
                    </Button> */}
                </Box>
            </Grid>
        </Grid>
        <br />
        <DataGrid
            rows={rows}
            columns={columns}
            disableRowSelectionOnClick

        />        
    </Box>);
}