import React, { useState } from 'react';
import { TextField, IconButton, TextFieldProps, Tooltip, Box, ClickAwayListener } from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import ModalEdit from './ModalEdit';
import InfoRoundedIcon from '@mui/icons-material/InfoRounded';

type EditableInputProps = {
    value: string | null | undefined;
    onEdit?: (value: string | null | undefined) => void;
    modalTitle?: string;
    modalDescription?: string;
    modalSaveLabel?: string;
    modalCancelLabel?: string;
    modal?: boolean;
    moreInformation?: string;
} & TextFieldProps;

/**
 *
 * This component is a TextField that can be edited in a modal.
 * Usefull for values that are very long and need to be edited in a larger space.
 * The component inherits all the props from the TextField component.
 * Default size is small and fullWidth is true when the modal is set on the component.
 * <br>
 * Example usage:
 * ```
 * <NSInput
 * 	value={value}
 * 	onEdit={handleEdit}
 * 	label="Input label"
 * 	color="primary"
 * 	variant="outlined"
 * 	disabled={false}
 * 	modal={true}
 * />
 * ```
 * @returns A TextField component that can be edited in a modal.
 */
export default function NSInput({
    value,
    onEdit,
    modal,
    modalSaveLabel,
    modalCancelLabel,
    modalTitle,
    moreInformation,
    ...props
}: EditableInputProps) {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [inputValue, setInputValue] = useState<string | null | undefined>(value);
    const [tooltipVisible, setTooltipVisible] = useState(false);

    if (modal && !onEdit) {
        console.warn('You are using modal mode without providing an onEdit function. The input will be read-only.');
    }
    if (modal && moreInformation) {
        console.warn(
            'You are using modal mode with moreInformation. The moreInformation should be displayed in the modal as modalDescrition.'
        );
    }
    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        setInputValue(e.target.value);
        if (onEdit) {
            onEdit(e.target.value);
        }
    };

    const handleEditClick = () => {
        setIsModalOpen(true);
    };

    const handleModalClose = () => {
        setIsModalOpen(false);
    };

    const handleModalEdit = (newValue: string | null | undefined) => {
        setInputValue(newValue);
        if (onEdit) {
            onEdit(newValue);
        }
    };

    const handleToggleTooltip = () => {
        setTooltipVisible((prev) => !prev);
    };

    if (modal) {
        return (
            <>
                <TextField
                    value={inputValue}
                    onChange={handleInputChange}
                    fullWidth
                    size="small"
                    {...props}
                    slotProps={{
                        input: {
                            endAdornment: (
                                <IconButton onClick={handleEditClick}>
                                    <EditIcon />
                                </IconButton>
                            ),
                        },
                    }}
                />
                <ModalEdit
                    isOpen={isModalOpen}
                    onClose={handleModalClose}
                    onEdit={handleModalEdit}
                    value={inputValue}
                    label={props.label}
                    modalTitle={modalTitle}
                    modalCancelLabel={modalCancelLabel}
                    modalSaveLabel={modalSaveLabel}
                    disabled={props.disabled}
                />
            </>
        );
    }
    return (
        <Box display="flex" alignItems="center">
            <TextField {...props} value={value} />
            {moreInformation && (
                // TODO: IMprove accessibility of the tooltip with arai-labels
                <ClickAwayListener onClickAway={() => setTooltipVisible(false)}>
                    <Tooltip title={moreInformation} open={tooltipVisible}>
                        <IconButton onClick={handleToggleTooltip}>
                            <InfoRoundedIcon />
                        </IconButton>
                    </Tooltip>
                </ClickAwayListener>
            )}
        </Box>
    );
}
