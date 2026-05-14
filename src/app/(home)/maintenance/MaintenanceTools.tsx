'use client';

import { Alert, Box, Button, Checkbox, FormControlLabel, Snackbar, Stack, TextField, Typography } from '@mui/material';
import { DataGrid, GridColDef } from '@mui/x-data-grid';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';

type MaintenanceRow = {
    id: number;
    domain: string;
    title: string;
    created: string;
    lastGlucoseEntry: string | null;
    inactive: boolean;
    status: string;
    result?: string;
    error?: string;
};

type MaintenanceResponse = {
    counts?: {
        checked?: number;
        inactiveCandidates?: number;
        stopped?: number;
        deactivated?: number;
        destroyed?: number;
        skipped?: number;
        failed?: number;
    };
    sites?: MaintenanceRow[];
    results?: MaintenanceRow[];
};

type SnackKind = 'success' | 'error' | 'info' | 'warning';

const DEFAULT_DAYS = 90;

export default function MaintenanceTools() {
    const t = useTranslations('MaintenancePage');
    const [days, setDays] = useState(DEFAULT_DAYS);
    const [stop, setStop] = useState(false);
    const [deactivate, setDeactivate] = useState(false);
    const [destroy, setDestroy] = useState(false);
    const [rows, setRows] = useState<MaintenanceRow[]>([]);
    const [counts, setCounts] = useState({
        checked: 0,
        inactiveCandidates: 0,
        stopped: 0,
        deactivated: 0,
        destroyed: 0,
        skipped: 0,
        failed: 0,
    });
    const [checked, setChecked] = useState(false);
    const [actionInProgress, setActionInProgress] = useState(false);
    const [snackOpen, setSnackOpen] = useState(false);
    const [snackMessage, setSnackMessage] = useState('');
    const [snackKind, setSnackKind] = useState<SnackKind>('success');
    const [gridMounted, setGridMounted] = useState(false);

    useEffect(() => {
        setGridMounted(true);
    }, []);

    const inactiveSiteIds = useMemo(() => rows.filter((row) => row.inactive).map((row) => row.id), [rows]);
    const hasSelectedAction = stop || deactivate || destroy;

    const columns = useMemo<GridColDef[]>(
        () => [
            { field: 'id', headerName: t('id'), width: 80 },
            { field: 'domain', headerName: t('domain'), flex: 1 },
            { field: 'title', headerName: t('siteTitle'), flex: 1 },
            { field: 'created', headerName: t('created'), flex: 1 },
            { field: 'lastGlucoseEntry', headerName: t('lastGlucoseEntry'), flex: 1 },
            { field: 'status', headerName: t('status'), flex: 1 },
            { field: 'result', headerName: t('result'), width: 130 },
            { field: 'error', headerName: t('error'), flex: 1 },
        ],
        [t]
    );

    const openSnack = (message: string, kind: SnackKind) => {
        setSnackMessage(t(message));
        setSnackKind(kind);
        setSnackOpen(true);
    };

    const handleSnackClose = () => {
        setSnackOpen(false);
    };

    const normalizeResponse = (data: MaintenanceResponse) => {
        setCounts({
            checked: data.counts?.checked ?? 0,
            inactiveCandidates: data.counts?.inactiveCandidates ?? 0,
            stopped: data.counts?.stopped ?? 0,
            deactivated: data.counts?.deactivated ?? 0,
            destroyed: data.counts?.destroyed ?? 0,
            skipped: data.counts?.skipped ?? 0,
            failed: data.counts?.failed ?? 0,
        });

        setRows(
            (data.results ?? data.sites ?? []).map((row) => ({
                id: row.id,
                domain: row.domain,
                title: row.title,
                created: formatDateTime(row.created),
                lastGlucoseEntry: row.lastGlucoseEntry ? formatDateTime(row.lastGlucoseEntry) : '',
                inactive: row.inactive,
                status: row.status,
                result: row.result ?? '',
                error: row.error ?? '',
            }))
        );
    };

    const handleCheck = async () => {
        try {
            setActionInProgress(true);
            const response = await fetch('/api/admin/maintenance/inactive-users/check', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ days }),
            });
            const data = (await response.json()) as MaintenanceResponse;

            if (!response.ok) {
                openSnack('checkFailed', 'error');
                return;
            }

            normalizeResponse(data);
            setChecked(true);
            openSnack('checkSuccess', 'success');
        } catch (error) {
            console.error('Failed to check maintenance candidates', error);
            openSnack('checkFailed', 'error');
        } finally {
            setActionInProgress(false);
        }
    };

    const handleRun = async () => {
        try {
            setActionInProgress(true);
            const response = await fetch('/api/admin/maintenance/inactive-users/action', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    days,
                    siteIds: inactiveSiteIds,
                    actions: {
                        stop,
                        deactivate,
                        destroy,
                    },
                }),
            });
            const data = (await response.json()) as MaintenanceResponse;

            if (!response.ok) {
                openSnack('actionFailed', 'error');
                return;
            }

            normalizeResponse(data);
            openSnack('actionSuccess', 'success');
        } catch (error) {
            console.error('Failed to run maintenance actions', error);
            openSnack('actionFailed', 'error');
        } finally {
            setActionInProgress(false);
        }
    };

    const handleDeactivateChange = (nextDeactivate: boolean) => {
        setDeactivate(nextDeactivate);
        if (!nextDeactivate) {
            setDestroy(false);
        }
    };

    return (
        <Box>
            <Snackbar open={snackOpen} autoHideDuration={3000} onClose={handleSnackClose} message={snackMessage}>
                <Alert onClose={handleSnackClose} severity={snackKind} variant="filled" sx={{ width: '100%' }}>
                    {snackMessage}
                </Alert>
            </Snackbar>

            <Stack spacing={2}>
                <Typography variant="h5">{t('title')}</Typography>

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
                    <TextField
                        label={t('daysLabel')}
                        type="number"
                        value={days}
                        onChange={(event) => setDays(Math.max(1, Number(event.target.value)))}
                        slotProps={{ htmlInput: { min: 1 } }}
                    />
                    <Button variant="contained" onClick={handleCheck} disabled={actionInProgress}>
                        {t('checkButton')}
                    </Button>
                    <Button
                        variant="contained"
                        color="warning"
                        onClick={handleRun}
                        disabled={actionInProgress || !checked || !hasSelectedAction || inactiveSiteIds.length === 0}
                    >
                        {t('runButton')}
                    </Button>
                </Stack>

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                    <FormControlLabel
                        control={<Checkbox checked={stop} onChange={(event) => setStop(event.target.checked)} />}
                        label={t('stop')}
                    />
                    <FormControlLabel
                        control={
                            <Checkbox
                                checked={deactivate}
                                onChange={(event) => handleDeactivateChange(event.target.checked)}
                            />
                        }
                        label={t('deactivate')}
                    />
                    <FormControlLabel
                        control={
                            <Checkbox
                                checked={destroy}
                                disabled={!deactivate}
                                onChange={(event) => setDestroy(event.target.checked)}
                            />
                        }
                        label={t('destroy')}
                    />
                </Stack>

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                    <Typography>{t('checkedCount', { count: counts.checked })}</Typography>
                    <Typography>{t('inactiveCandidatesCount', { count: counts.inactiveCandidates })}</Typography>
                    <Typography>{t('stoppedCount', { count: counts.stopped })}</Typography>
                    <Typography>{t('deactivatedCount', { count: counts.deactivated })}</Typography>
                    <Typography>{t('destroyedCount', { count: counts.destroyed })}</Typography>
                    <Typography>{t('skippedCount', { count: counts.skipped })}</Typography>
                    <Typography>{t('failedCount', { count: counts.failed })}</Typography>
                </Stack>

                {gridMounted ? (
                    <DataGrid rows={rows} columns={columns} disableRowSelectionOnClick />
                ) : (
                    <Box sx={{ minHeight: 120 }} />
                )}
            </Stack>
        </Box>
    );
}

function formatDateTime(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toLocaleString();
}
