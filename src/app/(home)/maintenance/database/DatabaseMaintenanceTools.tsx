'use client';

import { Alert, Box, Button, MenuItem, Select, Snackbar, Stack, Typography } from '@mui/material';
import { DataGrid, GridColDef, GridRowSelectionModel } from '@mui/x-data-grid';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';

type SiteRow = {
    id: number;
    domain: string;
    title: string;
    active: boolean;
    dataSize: number | null;
    storageSize: number | null;
};

type TrimResponse = {
    results?: Array<{ deletedDocuments: number }>;
};

const RETENTION_DAYS = [30, 90, 180] as const;

export default function DatabaseMaintenanceTools() {
    const t = useTranslations('MaintenancePage');
    const [rows, setRows] = useState<SiteRow[]>([]);
    const [selection, setSelection] = useState<GridRowSelectionModel>({ type: 'include', ids: new Set() });
    const [days, setDays] = useState<(typeof RETENTION_DAYS)[number]>(90);
    const [loading, setLoading] = useState(true);
    const [trimming, setTrimming] = useState(false);
    const [snack, setSnack] = useState<{ message: string; severity: 'success' | 'error' } | null>(null);

    const loadSites = useCallback(async () => {
        try {
            setLoading(true);
            const response = await fetch('/api/admin/maintenance/database');
            if (!response.ok) throw new Error('load');
            const data = (await response.json()) as { sites: SiteRow[] };
            setRows(data.sites);
        } catch (error) {
            console.error('Failed to load database sizes', error);
            setSnack({ message: t('databaseLoadFailed'), severity: 'error' });
        } finally {
            setLoading(false);
        }
    }, [t]);

    useEffect(() => {
        void loadSites();
    }, [loadSites]);

    const columns = useMemo<GridColDef[]>(
        () => [
            { field: 'id', headerName: t('id'), width: 70 },
            { field: 'domain', headerName: t('domain'), flex: 1 },
            { field: 'title', headerName: t('siteTitle'), flex: 1 },
            { field: 'active', headerName: t('active'), type: 'boolean', width: 90 },
            {
                field: 'dataSize',
                headerName: t('databaseDataSize'),
                flex: 1,
                valueFormatter: (value) => formatBytes(value),
            },
            {
                field: 'storageSize',
                headerName: t('databaseStorageSize'),
                flex: 1,
                valueFormatter: (value) => formatBytes(value),
            },
        ],
        [t]
    );

    const handleTrim = async () => {
        if (selection.ids.size === 0) return;
        if (!window.confirm(t('trimConfirmation', { days, count: selection.ids.size }))) return;
        try {
            setTrimming(true);
            const response = await fetch('/api/admin/maintenance/database', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ days, siteIds: Array.from(selection.ids, Number) }),
            });
            const data = (await response.json()) as TrimResponse;
            if (!response.ok) throw new Error('trim');
            const deletedDocuments = data.results?.reduce((total, result) => total + result.deletedDocuments, 0) ?? 0;
            setSnack({ message: t('databaseTrimSuccess', { count: deletedDocuments }), severity: 'success' });
            await loadSites();
            setSelection({ type: 'include', ids: new Set() });
        } catch (error) {
            console.error('Failed to trim databases', error);
            setSnack({ message: t('databaseTrimFailed'), severity: 'error' });
        } finally {
            setTrimming(false);
        }
    };

    return (
        <Box>
            <Snackbar open={snack !== null} autoHideDuration={5000} onClose={() => setSnack(null)}>
                <Alert severity={snack?.severity} variant="filled" onClose={() => setSnack(null)}>
                    {snack?.message}
                </Alert>
            </Snackbar>
            <Stack spacing={2}>
                <Typography variant="h5">{t('databaseTitle')}</Typography>
                <Typography>{t('databaseDescription')}</Typography>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
                    <Select
                        aria-label={t('retentionLabel')}
                        value={days}
                        onChange={(event) => setDays(Number(event.target.value) as (typeof RETENTION_DAYS)[number])}
                        size="small"
                    >
                        {RETENTION_DAYS.map((retention) => (
                            <MenuItem value={retention} key={retention}>
                                {t('retentionOption', { days: retention })}
                            </MenuItem>
                        ))}
                    </Select>
                    <Button
                        variant="contained"
                        color="warning"
                        onClick={handleTrim}
                        disabled={trimming || selection.ids.size === 0}
                    >
                        {t('trimButton')}
                    </Button>
                    <Typography>{t('selectedSites', { count: selection.ids.size })}</Typography>
                </Stack>
                <DataGrid
                    rows={rows}
                    columns={columns}
                    loading={loading}
                    checkboxSelection
                    disableRowSelectionExcludeModel
                    disableRowSelectionOnClick
                    rowSelectionModel={selection}
                    onRowSelectionModelChange={setSelection}
                    autoHeight
                />
            </Stack>
        </Box>
    );
}

function formatBytes(value: unknown) {
    if (typeof value !== 'number') return '—';
    if (value === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const unit = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    return `${(value / 1024 ** unit).toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}
