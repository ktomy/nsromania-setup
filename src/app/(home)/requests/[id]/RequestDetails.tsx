'use client';

import {
    Box,
    Typography,
    Snackbar,
    Alert,
    Accordion,
    AccordionSummary,
    AccordionDetails,
    Button,
    Chip,
    Grid,
    Link,
} from '@mui/material';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { formatDate } from '@/lib/utils';
import { register_request, User } from '@prisma/client';
import ThumbUpIcon from '@mui/icons-material/ThumbUp';
import ThumbDownIcon from '@mui/icons-material/ThumbDown';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import getStatusChipProps from '../utils';

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


interface RegisterRequestExtended extends register_request {
    auth_user?: User;
}

interface RequestDetailsProps {
    request: RegisterRequestExtended;
}

export default function RequestDetails({ request }: RequestDetailsProps) {
    const router = useRouter();
    const t = useTranslations('RequestsPage');
    
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

            const res = await fetch(`/api/register/${request.id}`, {
                method: action === 'approve' ? 'POST' : 'DELETE',
            });

            if (res.ok) {
                openSnack(t('actionSuccess'), 'success');
                // Refresh the page to show updated status
                router.refresh();
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

    const requestProperties: Record<string, RenderProperty> = {
        Subdomain: request.subdomain || '',
        'Owner Name': request.owner_name || '',
        'Owner Email': request.owner_email || '',
        'Data Source': request.data_source || '',
        Title: request.title || '',
        'API Secret': request.api_secret || '',
        'Created At': formatDate(request.requested_at),
        'Last Updated': formatDate(request.chnged_at),
        'Updated By': request.auth_user?.name || '',
    };

    let dexcomProperties = {};

    if (request.data_source === 'Dexcom') {
        dexcomProperties = {
            'Dexcom Server': request.dexcom_server || '',
            'Dexcom Username': request.dexcom_username || '',
            'Dexcom Password': request.dexcom_password || '',
        };
    }

    return (
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
                        {request.status === 'approved' ? (
                        <Link onClick={() => 
                        {
                            fetch(`/api/domains/by-subdomain/${request.subdomain}`).then((response) => {
                                response.json().then((data) => {
                                    router.push(`/domains/${data.id}`);
                                });
                            });
                        }
                    } sx={{ cursor: 'pointer' }}>
                            {request.subdomain}
                        </Link>): request.subdomain} :&nbsp;
                        {t('requestDetails')}
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