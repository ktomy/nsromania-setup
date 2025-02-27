import React, { useEffect, useState } from "react";
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField } from "@mui/material";

interface ModalEditProps {
	isOpen: boolean;
	onClose: () => void;
	onEdit: (value: string | null) => void;
	value: string | null;
	label?: React.ReactNode;
}

const checkMultiline = (value: string | null) => {
	if (value === null) return false;
	const multilineRegex = /[\r\n]|.{30,}/;
	return multilineRegex.test(value);
};

export default function ModalEdit({ isOpen, onClose, onEdit, value, ...props }: ModalEditProps) {
	const [editedValue, setEditedValue] = useState(value);
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

	return (
		<Dialog open={isOpen} onClose={onClose} fullWidth maxWidth="md">
			<DialogTitle>Edit Value</DialogTitle>
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
							onInput: (e: any) => {
								checkMultilineRealtime(e.currentTarget.value ?? null);
							},
						},
					}}
				/>
			</DialogContent>
			<DialogActions>
				<Button onClick={onClose} color="primary">
					Cancel
				</Button>
				<Button onClick={handleSave} color="primary">
					Save
				</Button>
			</DialogActions>
		</Dialog>
	);
}
