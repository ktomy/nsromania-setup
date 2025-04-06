'use client';

import { Check, Close, PendingActions } from '@mui/icons-material';
import { JSX } from 'react';

type StatusProp = {
    label: string;
    color: 'warning' | 'success' | 'error' | 'default';
    icon?: JSX.Element;
    variant: 'filled' | 'outlined';
};

export default function getStatusChipProps(statusValue: string, t: (key: string) => string): StatusProp {
    switch (statusValue.toLowerCase()) {
        case 'pending':
            return {
                label: t('pending'),
                color: 'warning' as const,
                icon: <PendingActions fontSize="small" />,
                variant: 'filled' as const,
            };
        case 'approved':
            return {
                label: t('approved'),
                color: 'success' as const,
                icon: <Check fontSize="small" />,
                variant: 'filled' as const,
            };
        case 'denied':
        case 'rejected':
            return {
                label: t('rejected'),
                color: 'error' as const,
                icon: <Close fontSize="small" />,
                variant: 'filled' as const,
            };
        default:
            return {
                label: statusValue,
                color: 'default' as const,
                icon: undefined,
                variant: 'outlined' as const,
            };
    }
}