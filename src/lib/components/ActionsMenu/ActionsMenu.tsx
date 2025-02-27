import { Button, ButtonGroup, Menu, MenuItem, useMediaQuery } from "@mui/material";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useTheme } from "@mui/material/styles";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import SvgIcon, { SvgIconProps } from "@mui/material/SvgIcon";
import NSButton from "../general/NSButton";
export type GenericFunction = (...args: any[]) => any | Promise<any>;

export interface ActionsMenuItem {
	id: string;
	action?: GenericFunction;
	label: string;
	disabled?: boolean;
	icon: React.ReactNode;
}

export interface ActionsMenuProps extends React.HTMLAttributes<HTMLDivElement> {
	actions: ActionsMenuItem[];
	actionsButtonLabel: string;
	children?: React.ReactNode;
}

const handleActionFunction = async (action: ActionsMenuItem, setLoadingId: (newVal: string | null) => void) => {
	try {
		setLoadingId(action.id);
		await action.action?.();
	} finally {
		setLoadingId(null);
	}
};

/**
 * Documentation:
 * - https://mui.com/components/buttons/
 * - https://mui.com/components/menu/
 * - https://mui.com/components/button-group/
 *
 * This component is used to display a list of actions in a menu or button group.
 * It will display a menu button if the screen width is less than 960px, otherwise it will display a button group.
 * Idf the screen width is less than the 'md' value set in the theme a dropdown menu will show the actions.
 * If the screen width is greater than the 'md' value set in the theme a button group will show the actions.
 * @param actionsButtonLabel
 * @param actions
 * @returns a menu or button group with the actions
 */
export default function ActionsMenu({ actionsButtonLabel, actions, children, ...props }: ActionsMenuProps) {
	const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
	const [loadingId, setLoadingId] = useState<null | string>(null);
	const menuOpen = Boolean(anchorEl);
	const theme = useTheme();
	const matchMedia = useMediaQuery(theme.breakpoints.down("md"));
	const matchMd = useMediaQuery(theme.breakpoints.up(1350));
	const handleMenuButtonClick = (event: React.MouseEvent<HTMLElement>) => {
		setAnchorEl(event.currentTarget);
	};
	const handleClose = () => {
		setAnchorEl(null);
	};
	if (matchMedia) {
		return (
			<div>
				<Button
					id="actions-menu-button"
					aria-controls={menuOpen ? "actions-menu" : undefined}
					aria-haspopup="true"
					aria-expanded={menuOpen ? "true" : undefined}
					variant="contained"
					disableElevation
					onClick={handleMenuButtonClick}
					endIcon={<KeyboardArrowDownIcon />}>
					{actionsButtonLabel}
				</Button>
				<Menu open={menuOpen} onClose={handleClose} anchorEl={anchorEl}>
					{actions.map((action, index) => {
						return (
							<MenuItem
								key={`${action.id}-${index}`}
								onClick={async () => {
									handleClose();
									handleActionFunction(action, setLoadingId);
								}}
								disabled={action.disabled}
								sx={{
									gap: 1,
								}}>
								{action.icon ? action.icon : null}
								{action.label}
							</MenuItem>
						);
					})}
				</Menu>
			</div>
		);
	} else {
		return (
			<div>
				<ButtonGroup>
					{actions.map((action, index) => {
						return (
							<NSButton
								key={`${action.id}-${index}`}
								onClick={async () => {
									handleActionFunction(action, setLoadingId);
								}}
								endIcon={action.icon}
								disabled={action.disabled}
								loading={loadingId === action.id}
								color="primary"
								>
								{action.label}
							</NSButton>
						);
					})}
				</ButtonGroup>
			</div>
		);
	}
}
