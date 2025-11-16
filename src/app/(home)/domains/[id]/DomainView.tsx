'use client';

import { notFound, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { Box, Typography, Snackbar, Alert, Accordion, AccordionSummary, AccordionDetails, Grid } from '@mui/material';
import React, { useState } from 'react';
import { formatBytes, formatDate } from '@/lib/utils';
import { GetDomainByIdResponse } from '@/types/domains';
import NSActionsMenu, { ActionsMenuItem } from '@/lib/components/general/NSActionsMenu/NSActionsMenu';
import StopRoundedIcon from '@mui/icons-material/StopRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import DeleteForeverRoundedIcon from '@mui/icons-material/DeleteForeverRounded';
import FolderDeleteRoundedIcon from '@mui/icons-material/FolderDeleteRounded';
import WavingHandRoundedIcon from '@mui/icons-material/WavingHandRounded';
import SettingsInputComponentRoundedIcon from '@mui/icons-material/SettingsInputComponentRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';

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

interface DomainViewProps {
    domainData: GetDomainByIdResponse;
    idNumber: number;
}

export default function DomainView({ domainData, idNumber }: DomainViewProps) {
    const router = useRouter();
    const t = useTranslations('DomainPage');
    const [domain, setDomain] = useState<GetDomainByIdResponse>(domainData);
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

    const handleDomainActions = async (action: 'start' | 'stop' | 'initialize' | 'destroy' | 'welcome' | 'delete') => {
        try {
            if (action === 'destroy' || action === 'delete') {
                //TODO: Add a modal to confirm the action (Good first issue)
                if (!confirm("Are you sure you want to " + action + " this domain?")) {
                    return;
                }
            }
            setActionInProgress(true);
            const res = await fetch(`/api/domains/${idNumber}/${action}`, {
                method: 'POST',
            });

            if (res.ok) {
                if (action === 'delete') {
                    router.push('/domains');
                    return;
                }
                openSnack('Action successfull', 'success');
                // reload the domain
                const updatedDomain = await fetch(`/api/domains/${idNumber}`).then((res) => res.json());
                if (!updatedDomain) {
                    notFound();
                }
                setDomain(updatedDomain);
                setActionInProgress(false);
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

    const domainProperties: Record<string, RenderProperty> = {
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

    const adminActions: ActionsMenuItem[] = [
        {
            label: t('initialize'),
            id: 'initialize',
            action: async () => await handleDomainActions('initialize'),
            icon: <SettingsInputComponentRoundedIcon />,
            disabled: domain?.status === 'online' || domain?.dbInitialized === true || actionInProgress,
        },
        {
            label: t('start'),
            id: 'start',
            action: async () => await handleDomainActions('start'),
            icon: <PlayArrowRoundedIcon />,
            disabled: domain?.status === 'online' || domain?.dbInitialized === false || actionInProgress,
        },
        {
            label: t('stop'),
            id: 'stop',
            action: async () => await handleDomainActions('stop'),
            icon: <StopRoundedIcon />,
            disabled: domain?.status === 'not running' || domain?.dbInitialized === false || actionInProgress,
        },
        {
            label: t('welcome'),
            id: 'welcome',
            action: async () => await handleDomainActions('welcome'),
            icon: <WavingHandRoundedIcon />,
            disabled: domain?.status !== 'online' || actionInProgress,
        },
        {
            label: t('edit'),
            id: 'edit',
            action: async () => await router.push(`/domains/${idNumber}/edit`),
            icon: <EditRoundedIcon />,
            disabled: domain?.status === 'online' || actionInProgress,
        },
        {
            label: t('destroy'),
            id: 'destroy',
            action: async () => await handleDomainActions('destroy'),
            icon: <DeleteForeverRoundedIcon />,
            disabled: domain?.status === 'online' || domain?.dbInitialized === false || actionInProgress,
        },
                {
            label: t('delete'),
            id: 'delete',
            action: async () => await handleDomainActions('delete'),
            icon: <FolderDeleteRoundedIcon />,
            disabled: domain?.status === 'online' || domain?.dbInitialized === true || actionInProgress,
        },
    ];

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