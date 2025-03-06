'use client';
import { notFound, useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

import {
    Box,
    Typography,
    Paper,
    Button,
    Snackbar,
    Alert,
    ButtonGroup,
    Accordion,
    AccordionSummary,
    AccordionDetails,
} from '@mui/material';
import Grid from '@mui/material/Grid2';
import React, { useEffect, useState } from 'react';
import { formatBytes, formatDate } from '@/lib/utils';
import { GetDomainByIdResponse } from '@/types/domains';
import NSActionsMenu, { ActionsMenuItem } from '@/lib/components/general/NSActionsMenu/NSActionsMenu';
import StopRoundedIcon from '@mui/icons-material/StopRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import DeleteForeverRoundedIcon from '@mui/icons-material/DeleteForeverRounded';
import WavingHandRoundedIcon from '@mui/icons-material/WavingHandRounded';
import SettingsInputComponentRoundedIcon from '@mui/icons-material/SettingsInputComponentRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
async function fetchDomain(id: string): Promise<GetDomainByIdResponse | null> {
    const res = await fetch(`/api/domains/${id}`);
    if (!res.ok) return null;
    return res.json();
}

type RenderProperty = string | [string, string];
interface RenderDomainPropertiesProps {
    properties: Record<string, RenderProperty>;
    title?: string;
}

const RenderDomainProperties = ({ properties, title }: RenderDomainPropertiesProps) => {
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

export default function DomainPage() {
    const router = useRouter();
    const t = useTranslations('DomainPage');
    const { id } = useParams() as { id: string };

    const [domain, setDomain] = useState<GetDomainByIdResponse | null>(null);
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

    const handleDomainActions = async (id: string, action: 'start' | 'stop' | 'initialize' | 'destroy' | 'welcome') => {
        try {
            if (action === 'destroy') {
                //TODO: Add a modal to confirm the action (Good first issue)
                if (!confirm('Are you sure you want to destroy this domain?')) {
                    return;
                }
            }
            setActionInProgress(true);
            const res = await fetch(`/api/domains/${id}/${action}`, {
                method: 'POST',
            });

            if (res.ok) {
                openSnack('Action successfull', 'success');
                // reload the domain
                fetchDomain(id).then((domain) => {
                    if (!domain) {
                        notFound();
                    }
                    setDomain(domain);
                    setActionInProgress(false);
                });
            } else {
                console.error(`Failed to ${action} domain`, res);
                openSnack(`Failed to ${action} domain`, 'error');
                setActionInProgress(false);
            }
        } catch (error) {
            console.error(`Failed to ${action} domain`, error);
            openSnack(`Failed to ${action} domain`, 'error');
            setActionInProgress(false);
        }
    };

    useEffect(() => {
        fetchDomain(id).then((domain) => {
            if (!domain) {
                notFound();
            }
            setDomain(domain);
            setLoading(false);
        });
    }, [id]);

    const domainProperties: Record<string, RenderProperty> =
        domain == null
            ? {}
            : {
                    'Subdomain name': domain.domain || '',
                        Owner: domain.authUser?.email || ['Unknown', 'red'],
                        Active: domain.active ? ['Yes', 'green'] : ['No', 'red'],
                    'Initialized (should be)': domain.dbExists ? ['Yes', 'green'] : ['No', 'red'],
                    'Initialized (actual)': domain.dbInitialized ? ['Yes', 'green'] : ['No', 'red'],
                    Status:
                        domain.status === 'not running'
                            ? ['Not running', 'red']
                            : domain.status === 'online'
                            ? ['Online', 'green']
                            : domain.status || ['error', 'red'],
                    Title: domain.title || '',
                    'Data source':
                        domain.enable.indexOf('bridge') !== -1
                            ? 'Dexcom'
                            : domain.enable.indexOf('mmconnect') !== -1
                            ? ['Medtronic', 'red']
                            : 'API',
                    'API Secret': domain.apiSecret || '',
                    'Nightscout version': domain.nsversion || '<default>',
                    Created: formatDate(domain.created),
                    'Last updated': formatDate(domain.lastUpdated),
                    Enable: domain.enable || '',
                    'Database size': formatBytes(domain.dbSize) || '',
                    'Last glucose entry': formatDate(domain.lastDbEntry) || '',
                };

    let variables = {};

    if (domain != null) {
        if (domain.enable.indexOf('bridge') !== -1) {
            domainProperties['Dexcom Server'] = domain.bridgeServer || '';
            domainProperties['Dexcom Username'] = domain.bridgeUsername || '';
            domainProperties['Dexcom Password'] = domain.bridgePassword || '';
        }

        if (domain.environments) {
            domain.environments
                .sort((a, b) => a.variable.localeCompare(b.variable))
                .forEach((env) => {
                    variables = { ...variables, [env.variable]: env.value };
                });
        }
    }

    const adminActions: ActionsMenuItem[] = [
        {
            label: t('initialize'),
            id: 'initialize',
            action: async () => await handleDomainActions(id, 'initialize'),
            icon: <SettingsInputComponentRoundedIcon />,
            disabled: domain?.status === 'online' || domain?.dbInitialized === true || actionInProgress,
        },
        {
            label: t('start'),
            id: 'start',
            action: async () => await handleDomainActions(id, 'start'),
            icon: <PlayArrowRoundedIcon />,
            disabled: domain?.status === 'online' || domain?.dbInitialized === false || actionInProgress,
        },
        {
            label: t('stop'),
            id: 'stop',
            action: async () => await handleDomainActions(id, 'stop'),
            icon: <StopRoundedIcon />,
            disabled: domain?.status === 'not running' || domain?.dbInitialized === false || actionInProgress,
        },
        {
            label: t('welcome'),
            id: 'welcome',
            action: async () => await handleDomainActions(id, 'welcome'),
            icon: <WavingHandRoundedIcon />,
            disabled: domain?.status !== 'online' || actionInProgress,
        },
        {
            label: t('edit'),
            id: 'edit',
            action: async () => await router.push(`/domains/${id}/edit`),
            icon: <EditRoundedIcon />,
            disabled: domain?.status === 'online' || actionInProgress,
        },
        {
            label: t('destroy'),
            id: 'destroy',
            action: async () => await handleDomainActions(id, 'destroy'),
            icon: <DeleteForeverRoundedIcon />,
            disabled: domain?.status === 'online' || domain?.dbInitialized === false || actionInProgress,
        },
    ];

    return loading || !domain ? (
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
                        <a href={`https://${domain?.domain}.nsromania.info`}>{domain?.domain}.nsromania.info</a>
                    </Typography>
                </Grid>
                <Grid size="auto">
                    <NSActionsMenu
                        asSpeedDial
                        actionsButtonLabel={t('actionsButtonLabel')}
                        actions={adminActions}
                    ></NSActionsMenu>
                </Grid>
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
                            <RenderDomainProperties properties={domainProperties} />
                        </AccordionDetails>
                    </Accordion>
                    <Accordion defaultExpanded={true}>
                        <AccordionSummary
                            expandIcon={<ExpandMoreIcon />}
                            aria-controls="panel1-content"
                            id="panel1-header"
                        >
                            <Typography variant="h6">{t('advancedSettings')}</Typography>
                        </AccordionSummary>
                        <AccordionDetails>
                            {Object.keys(variables).length === 0 ? (
                                <RenderDomainProperties properties={{ 'None defined': '' }} />
                            ) : (
                                <RenderDomainProperties properties={variables} />
                            )}
                        </AccordionDetails>
                    </Accordion>
                </Grid>
            </Grid>
        </Box>
    );
}
