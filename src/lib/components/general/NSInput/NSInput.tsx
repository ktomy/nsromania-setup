import React, { useState } from "react";
import { TextField, IconButton, TextFieldProps } from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import ModalEdit from "./ModalEdit";

type EditableInputProps = {
	value: string | null;
	onEdit?: (value: string | null) => void;
	modalTitle?: string;
	modalDescription?: string;
	modalSaveLabel?: string;
	modalCancelLabel?: string;
	modal?: boolean;
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
export default function NSInput({ value, onEdit, modal, modalSaveLabel, modalCancelLabel, modalTitle, modalDescription, ...props }: EditableInputProps) {
	const [isModalOpen, setIsModalOpen] = useState(false);
	const [inputValue, setInputValue] = useState<string | null>(value);

	if(modal && !onEdit) {
		console.warn("You are using modal mode without providing an onEdit function. The input will be read-only.");
	}
	const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
		setInputValue(e.target.value);
		onEdit && onEdit(e.target.value);
	};

	const handleEditClick = () => {
		setIsModalOpen(true);
	};

	const handleModalClose = () => {
		setIsModalOpen(false);
	};

	const handleModalEdit = (newValue: string | null) => {
		setInputValue(newValue);
		onEdit && onEdit(newValue);
	};

	if (modal) {
		return (
			<>
				<TextField
					value={inputValue}
					onChange={handleInputChange}
					fullWidth
					size="small"
					slotProps={{
						input: {
							endAdornment: (
								<IconButton onClick={handleEditClick} >
									<EditIcon />
								</IconButton>
							),
						},
					}}
					{...props}
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
		<TextField
			{...props}
			value={value}
		/>
	);
}
