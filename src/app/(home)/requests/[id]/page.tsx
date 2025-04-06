'use client';

import { notFound, useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

import { 
    Box, 
    Typography, 
    Snackbar, 
    Alert, 
    Accordion, 
    AccordionSummary, 
    AccordionDetails,
    Button,
    Chip
} from '@mui/material';
import Grid from '@mui/material/Grid2';
import React, { useEffect, useState } from 'react';
import { formatDate } from '@/lib/utils';
import { register_request } from '@prisma/client';
import ThumbUpIcon from '@mui/icons-material/ThumbUp';
import ThumbDownIcon from '@mui/icons-material/ThumbDown';
import getStatusChipProps from '../utils';
import { useSession } from 'next-auth/react';

async function fetchRequest(id: string): Promise<register_request | null> {
    const res = await fetch(`/api/register/${id}`);
    if (!res.ok) return null;
    return res.json();
}

type RenderProperty = string | [string, string];
interface RenderRequestPropertiesProps {
    properties: Record<string, RenderProperty>;
    title?: string;
}

const RenderRequestProperties = ({ properties, title }: RenderRequestPropertiesProps) => {
    return (
        <>
            {title && <Typography variant="h6">{title}</Typography>}

            <Grid container spacing={2} alignItems="center">
                {Object.entries(properties).map(([key, value]) => {
                    const displayValue = typeof value === 'string' ? value : value[0];
                    const color = typeof value === 'string' ? 'inherit' : value[1];

                    return (
                        <React.Fragment key={key}>
                            <Grid size={{ xs: 12, sm: 4 }}>
                                <Typography variant="body1" fontWeight="bold">
                                    {key}:
                                </Typography>
                            </Grid>
                            <Grid size={{ xs: 12, sm: 8 }}>
                                <Typography variant="body1" noWrap maxHeight={100} sx={{ color }}>
                                    {displayValue}
                                </Typography>
                            </Grid>
                        </React.Fragment>
                    );
                })}
            </Grid>
        </>
    );
};

export default function RequestDetailsPage() {
    const router = useRouter();
    const t = useTranslations('RequestsPage');
    const { id } = useParams() as { id: string };
    const { data: session, status } = useSession();

    const [request, setRequest] = useState<register_request | null>(null);
    const [loading, setLoading] = useState(true);
    const [snackOpen, setSnackOpen] = useState(false);
    const [snackMessage, setSnackMessage] = useState('');
    const [snackKind, setSnackKind] = useState<'success' | 'error' | 'info' | 'warning'>('success');
    const [actionInProgress, setActionInProgress] = useState(false);

    const openSnack = (message: string, kind: 'success' | 'error' | 'info' | 'warning') => {
        setSnackMessage(message);
        setSnackKind(kind);
        setSnackOpen(true);
    };

    const handleSnackClose = () => {
        setSnackOpen(false);
    };

    const handleRequestActions = async (action: 'approve' | 'reject') => {
        try {
            setActionInProgress(true);

            const res = await fetch(`/api/register/${id}`, {
                method: action === 'approve' ? 'POST' : 'DELETE',
            });

            if (res.ok) {
                openSnack(t('actionSuccess'), 'success');
                // reload the request
                fetchRequest(id).then((request) => {
                    if (!request) {
                        notFound();
                    }
                    setRequest(request);
                    setActionInProgress(false);
                });
            } else {
                console.error(`Failed to ${action} request`, res);
                openSnack(t('actionFailed'), 'error');
                setActionInProgress(false);
            }
        } catch (error) {
            console.error(`Failed to ${action} request`, error);
            openSnack(t('actionFailed'), 'error');
            setActionInProgress(false);
        }
    };

    useEffect(() => {
        if (status === 'loading') return;
        
        if (!session) {
            // User not logged in
            router.push('/auth/signin');
            return;
        }
        
        if (session.user.role !== 'admin') {
            // User doesn't have admin role
            router.push('/');
            return;
        }
    }, [session, status, router]);

    useEffect(() => {
        fetchRequest(id).then((request) => {
            if (!request) {
                notFound();
            }
            setRequest(request);
            setLoading(false);
        });
    }, [id]);

    const requestProperties: Record<string, RenderProperty> =
        request == null
            ? {}
            : {
                  'Subdomain': request.subdomain || '',
                  'Owner Name': request.owner_name || '',
                  'Owner Email': request.owner_email || '',
                  'Data Source': request.data_source || '',
                  'Title': request.title || '',
                  'API Secret': request.api_secret || '',
                  'Created At': formatDate(request.requested_at),
                  'Last Updated': formatDate(request.chnged_at),
              };

    let dexcomProperties = {};

    if (request != null && request.data_source === 'Dexcom') {
        dexcomProperties = {
            'Dexcom Server': request.dexcom_server || '',
            'Dexcom Username': request.dexcom_username || '',
            'Dexcom Password': request.dexcom_password || '',
        };
    }

    return (status === 'loading' || !session || session.user.role !== 'admin') ? (
        <Typography>{t('loading')}</Typography>
    ) : loading || !request ? (
        <Typography>{t('loading')}</Typography>
    ) : (
        <Box>
            <Snackbar open={snackOpen} autoHideDuration={3000} onClose={handleSnackClose} message={snackMessage}>
                <Alert onClose={handleSnackClose} severity={snackKind} variant="filled" sx={{ width: '100%' }}>
                    {snackMessage}
                </Alert>
            </Snackbar>
            <Grid
                size={12}
                direction={'row'}
                container
                sx={{
                    justifyContent: 'space-between',
                    alignItems: 'center',
                }}
            >
                <Grid size="auto">
                    <Typography variant="h6">
                        {request.subdomain}: {t('requestDetails')}
                    </Typography>
                </Grid>
                <Grid size="auto">
                    {request.status && (
                        <Chip
                            {...getStatusChipProps(request.status, t)}
                            size="medium"
                            sx={{
                                fontWeight: 'medium',
                                minWidth: '90px',
                                justifyContent: 'flex-start',
                            }}
                        />
                    )}
                </Grid>
                {request.status === 'pending' && (
                    <Grid size={12} sx={{ display: 'flex', gap: 2, mt: 2, justifyContent: 'flex-end' }}>
                        <Button
                            variant="contained"
                            color="success"
                            startIcon={<ThumbUpIcon />}
                            onClick={() => handleRequestActions('approve')}
                            disabled={actionInProgress}
                        >
                            {t('approve')}
                        </Button>
                        <Button
                            variant="contained"
                            color="error"
                            startIcon={<ThumbDownIcon />}
                            onClick={() => handleRequestActions('reject')}
                            disabled={actionInProgress}
                        >
                            {t('reject')}
                        </Button>
                    </Grid>
                )}
                <Grid size={12} sx={{ mt: 2 }}>
                    <Accordion defaultExpanded={true}>
                        <AccordionSummary
                            expandIcon={<ExpandMoreIcon />}
                            aria-controls="panel1-content"
                            id="panel1-header"
                        >
                            <Typography variant="h6">{t('basicData')}</Typography>
                        </AccordionSummary>
                        <AccordionDetails>
                            <RenderRequestProperties properties={requestProperties} />
                        </AccordionDetails>
                    </Accordion>
                    {request.data_source === 'Dexcom' && (
                        <Accordion defaultExpanded={true}>
                            <AccordionSummary
                                expandIcon={<ExpandMoreIcon />}
                                aria-controls="panel2-content"
                                id="panel2-header"
                            >
                                <Typography variant="h6">{t('dexcomSettings')}</Typography>
                            </AccordionSummary>
                            <AccordionDetails>
                                <RenderRequestProperties properties={dexcomProperties} />
                            </AccordionDetails>
                        </Accordion>
                    )}
                </Grid>
            </Grid>
        </Box>
    );
}
