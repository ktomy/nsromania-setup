import { useMediaQuery, useTheme } from "@mui/material";
import Button, { ButtonProps } from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";

export interface NSButtonProps extends ButtonProps {
	endIcon?: React.ReactNode;
	startIcon?: React.ReactNode;
}

/**
 * This buytton component will render a button or an icon button depending on the screen size.
 * The endIcon or the startIcon props is required, else will throw an error
 * The breakpoint is set to lg, everything under lg will be shown a icon button
 * This button is usefull for responsive design on tables where the space is limited
 * 
 * @param props ButtonProps
 * @returns React.ReactNode
 */
export default function NSButton(props: NSButtonProps) {
	const theme = useTheme();
	const matchSm = useMediaQuery(theme.breakpoints.down("lg"));
	if (matchSm) {
		if (!props.endIcon && !props.startIcon) {
			throw new Error("You must provide an icon for the button");
		}
	}
	if (!matchSm) {
		return (
			<Button {...props} color={props.color == undefined ? "primary" : props.color}>
				{props.children}
			</Button>
		);
	} else {
		// Eliminate not recognized warning on props for startIcon and endIcon
		const { endIcon, startIcon, ...restOfProps} = props;
		return (
			<IconButton {...restOfProps} color={props.color == undefined ? "primary" : props.color}>
				{endIcon || startIcon}
			</IconButton>
		);
	}
}
