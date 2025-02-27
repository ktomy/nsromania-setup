import React, { useState } from "react";
import { TextField, IconButton, TextFieldProps } from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import ModalEdit from "./ModalEdit";

type EditableInputProps = {
	value: string | null;
	onEdit: (value: string | null) => void;
} & TextFieldProps

export default function EditableInput({ value, onEdit, ...props }: EditableInputProps) {
	const [isModalOpen, setIsModalOpen] = useState(false);
	const [inputValue, setInputValue] = useState<string | null>(value);

	const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		setInputValue(e.target.value);
		onEdit(e.target.value);
	};

	const handleEditClick = () => {
		setIsModalOpen(true);
	};

	const handleModalClose = () => {
		setIsModalOpen(false);
	};

	const handleModalEdit = (newValue: string | null) => {
		setInputValue(newValue);
		onEdit(newValue);
	};

	return (
		<div>
			<TextField
				label={props.label}
				value={inputValue}
				onChange={handleInputChange}
        fullWidth
        size='small'
				slotProps={{
					input: {
						endAdornment: (
							<IconButton onClick={handleEditClick}>
								<EditIcon />
							</IconButton>
						),
					},
				}}
				{...props}
			/>
			<ModalEdit isOpen={isModalOpen} onClose={handleModalClose} onEdit={handleModalEdit} value={inputValue} label={props.label}/>
		</div>
	);
}
