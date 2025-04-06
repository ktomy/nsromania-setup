'use client';

import Typography from '@mui/material/Typography';
import { Alert, Box, Chip, Snackbar } from '@mui/material';
import { DataGrid, GridActionsCellItem, GridColDef, GridRenderCellParams, GridRowsProp } from '@mui/x-data-grid';
import Grid from '@mui/material/Grid2';
import { Info, OpenInNew, Settings, ThumbDown, ThumbUp } from '@mui/icons-material';
import { register_request, User } from '@prisma/client';
import { formatDate } from '@/lib/utils';
import { Key, MouseEventHandler, ReactElement, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import getStatusChipProps from './utils';

type Action = {
    icon: ReactElement;
    label: string;
    onClick: MouseEventHandler<HTMLButtonElement>;
};

interface RegistrationRequestsListProps {
    user: User;
}

type GridRegisterRequest = Partial<register_request> & { 
    actions: Action[]; 
    statusProps: ReturnType<typeof getStatusChipProps>;
};

export default function RegistrationRequestsList({ user }: RegistrationRequestsListProps) {
    const t = useTranslations('RequestsPage');
    const [rows, setRows] = useState<GridRowsProp<GridRegisterRequest>>([]);
    const [snackOpen, setSnackOpen] = useState(false);
    const [snackMessage, setSnackMessage] = useState('');
    const [snackKind, setSnackKind] = useState<'success' | 'error' | 'info' | 'warning'>('success');
    const [, setActionInProgress] = useState(false);
    const router = useRouter();

    const openSnack = (message: string, kind: 'success' | 'error' | 'info' | 'warning') => {
        setSnackMessage(t(message));
        setSnackKind(kind);
        setSnackOpen(true);
    };

    const handleSnackClose = () => {
        setSnackOpen(false);
    };
    const handleRequestsActions = async (id: number, action: 'approve' | 'reject') => {
        try {
            setActionInProgress(true);

            const res = await fetch(`/api/register/${id}`, {
                method: action === 'approve' ? 'POST' : 'DELETE',
            });

            if (res.ok) {
                openSnack('actionSuccess', 'success');
                fetchRequests();
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

    const navigateToDetails = (id: number) => {
        router.push(`/requests/${id}`);
    };

    const navigateToSiteInformation = (subdomain: string) => {
        fetch(`/api/domains/by-subdomain/${subdomain}`).then((response) => {
            response.json().then((data) => {
                router.push(`/domains/${data.id}`);
            });
        });
    };

    const visitWebsite = (subdomain: string) => {
        window.open(`https://${subdomain}.nsromania.info/`, '_blank');
    };

    const fetchRequests = () =>  {
        fetch(`/api/register`).then((response) => {
            response.json().then((domains: register_request[]) => {
                const rows: GridRowsProp<GridRegisterRequest> = domains.map((request: register_request) => {
                    let actions: Action[] = [];
                    if (request.status === 'pending') {
                        actions = [
                            {
                                icon: <Info color="primary" />,
                                label: t('details'),
                                onClick: () => navigateToDetails(request.id),
                            },
                            {
                                icon: <ThumbUp color="success" />,
                                label: t('approve'),
                                onClick: () => handleRequestsActions(request.id, 'approve'),
                            },
                            {
                                icon: <ThumbDown color="error" />,
                                label: t('reject'),
                                onClick: () => handleRequestsActions(request.id, 'reject'),
                            },
                        ];
                    } else if (request.status === 'approved') {
                        actions = [
                            {
                                icon: <Info color="primary" />,
                                label: t('details'),
                                onClick: () => navigateToDetails(request.id),
                            },
                            {
                                icon: <Settings />,
                                label: t('siteInformation'),
                                onClick: () => navigateToSiteInformation(request.subdomain),
                            },
                            {
                                icon: <OpenInNew />,
                                label: t('visit'),
                                onClick: () => visitWebsite(request.subdomain),
                            },
                        ];
                    } else if (request.status === 'denied' || request.status === 'rejected') {
                        actions = [
                            {
                                icon: <Info color="primary" />,
                                label: t('details'),
                                onClick: () => navigateToDetails(request.id),
                            },
                        ];
                    }

                    return {
                        id: request.id,
                        domain: request.subdomain,
                        dataSource: request.data_source,
                        ownerName: request.owner_name,
                        ownerEmail: request.owner_email,
                        apiSecret: request.api_secret,
                        status: request.status,
                        statusProps: getStatusChipProps(request.status, t),
                        createdAt: formatDate(request.requested_at),
                        actionedAt: formatDate(request.chnged_at),
                        actions: actions,
                    };
                });
                setRows(rows);
                setActionInProgress(false);
            });
        });
    };

    useEffect(() => {
        fetchRequests();
    }, [user]);

    const columns: GridColDef[] = [
        { field: 'domain', headerName: t('domain'), width: 200 },
        { field: 'dataSource', headerName: t('dataSource'), width: 150 },
        { field: 'ownerName', headerName: t('ownerName'), width: 200 },
        { field: 'ownerEmail', headerName: t('ownerEmail'), width: 200 },
        {
            field: 'status',
            headerName: t('status'),
            width: 150,
            renderCell: (params: GridRenderCellParams<GridRegisterRequest>) => {
                const { label, color, icon, variant } = params.row.statusProps;
                return (
                    <Chip
                        label={label}
                        color={color}
                        icon={icon}
                        variant={variant}
                        size="small"
                        sx={{
                            fontWeight: 'medium',
                            minWidth: '90px',
                            justifyContent: 'flex-start',
                        }}
                    />
                );
            },
        },
        {
            field: 'actions',
            headerName: t('actions'),
            width: 200,
            renderCell: (params: GridRenderCellParams<GridRegisterRequest>) => {
                const actions = params.row.actions;
                return (
                    <Box sx={{ display: 'flex', gap: 1, height: '100%', alignItems: 'center' }}>
                        {actions.map((action: Action, index: Key) => (
                            <GridActionsCellItem
                                key={index}
                                icon={action.icon}
                                label={action.label}
                                onClick={action.onClick}
                            />
                        ))}
                    </Box>
                );
            },
        },
    ];

    return (
        <Box>
            <Snackbar open={snackOpen} autoHideDuration={3000} onClose={handleSnackClose} message={snackMessage}>
                <Alert onClose={handleSnackClose} severity={snackKind} variant="filled" sx={{ width: '100%' }}>
                    {snackMessage}
                </Alert>
            </Snackbar>
            <Grid size={12} direction={'row'} container>
                <Grid size={8}>
                    <Typography>{t('welcomeMessage')}</Typography>
                </Grid>
            </Grid>
            <br />
            <DataGrid rows={rows} columns={columns} disableRowSelectionOnClick />
        </Box>
    );
}