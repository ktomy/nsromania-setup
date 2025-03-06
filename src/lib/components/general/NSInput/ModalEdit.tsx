import React, { useState } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, TextFieldProps } from '@mui/material';
import { useTranslations } from 'next-intl';

export type ModalEditProps = {
    isOpen: boolean;
    onClose: () => void;
    onEdit: (value: string | null) => void;
    value: string | null;
    label?: React.ReactNode;
    modalSaveLabel?: string;
    modalCancelLabel?: string;
    modalTitle?: string | React.ReactNode;
} & TextFieldProps;

const checkMultiline = (value: string | null) => {
    if (value === null) return false;
    const multilineRegex = /[\r\n]|.{30,}/;
    return multilineRegex.test(value);
};

export default function ModalEdit({
    isOpen,
    onClose,
    onEdit,
    value,
    modalSaveLabel,
    modalCancelLabel,
    modalTitle,
    ...props
}: ModalEditProps) {
    const [editedValue, setEditedValue] = useState(value);
    const t = useTranslations('EditDomainPage');
    const [multiline, setMultiline] = useState(checkMultiline(value));
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setEditedValue(e.target.value);
    };

    const handleSave = () => {
        onEdit(editedValue);
        onClose();
    };

    const checkMultilineRealtime = (value: string | null) => {
        setMultiline(checkMultiline(value));
    };
    console.log(modalSaveLabel);
    return (
        <Dialog open={isOpen} onClose={onClose} fullWidth maxWidth="md">
            {modalTitle ?? <DialogTitle>{modalTitle}</DialogTitle>}
            <DialogContent>
                <TextField
                    {...props}
                    margin="dense"
                    type="text"
                    multiline={multiline}
                    rows={20}
                    autoFocus
                    fullWidth
                    value={editedValue}
                    onChange={handleChange}
                    slotProps={{
                        htmlInput: {
                            onInput: (e: React.FormEvent<HTMLInputElement>) => {
                                checkMultilineRealtime(e.currentTarget.value ?? null);
                            },
                        },
                    }}
                />
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} color="primary">
                    {modalCancelLabel ?? t('cancel')}
                </Button>
                <Button onClick={handleSave} color="primary" disabled={props.disabled}>
                    {modalSaveLabel ?? t('save')}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
