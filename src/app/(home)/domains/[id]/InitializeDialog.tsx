'use client';

import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    FormControl,
    FormControlLabel,
    FormLabel,
    Radio,
    RadioGroup,
} from '@mui/material';
import type { HostingServerInfo } from '@/lib/services/servers';

export interface InitializeDialogProps {
    open: boolean;
    servers: HostingServerInfo[];
    defaultServer: string;
    onCancel: () => void;
    onConfirm: (server: string) => void;
}

// Lets an admin choose the hosting server of a site that is initialized for the first time
export default function InitializeDialog({ open, servers, defaultServer, onCancel, onConfirm }: InitializeDialogProps) {
    const t = useTranslations('DomainPage');
    const initial = servers.some((server) => server.id === defaultServer) ? defaultServer : servers[0]?.id;
    const [selected, setSelected] = useState(initial);

    return (
        <Dialog open={open} onClose={onCancel} aria-labelledby="initialize-dialog-title">
            <DialogTitle id="initialize-dialog-title">{t('initializeDialogTitle')}</DialogTitle>
            <DialogContent>
                <DialogContentText>{t('initializeDialogText')}</DialogContentText>
                <FormControl sx={{ mt: 2 }}>
                    <FormLabel id="initialize-server-label">{t('initializeServerLabel')}</FormLabel>
                    <RadioGroup
                        aria-labelledby="initialize-server-label"
                        name="server"
                        value={selected}
                        onChange={(event) => setSelected(event.target.value)}
                    >
                        {servers.map((server) => (
                            <FormControlLabel
                                key={server.id}
                                value={server.id}
                                control={<Radio />}
                                label={`${server.id} (${server.hostname})${
                                    server.id === defaultServer ? ` – ${t('initializeServerDefault')}` : ''
                                }`}
                            />
                        ))}
                    </RadioGroup>
                </FormControl>
            </DialogContent>
            <DialogActions>
                <Button onClick={onCancel}>{t('cancel')}</Button>
                <Button variant="contained" onClick={() => selected && onConfirm(selected)} disabled={!selected}>
                    {t('initialize')}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
