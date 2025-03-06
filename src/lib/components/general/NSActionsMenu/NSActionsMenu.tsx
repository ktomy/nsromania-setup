import { Button, ButtonGroup, Menu, MenuItem, useMediaQuery } from '@mui/material';
import { useState } from 'react';
import { useTheme } from '@mui/material/styles';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import SpeedDial from '@mui/material/SpeedDial';
import SpeedDialAction from '@mui/material/SpeedDialAction';
import SpeedDialIcon from '@mui/material/SpeedDialIcon';

import NSButton from '../NSButton';
import { KeyboardArrowUp } from '@mui/icons-material';
export type GenericFunction = (...args: unknown[]) => unknown | Promise<unknown>;

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
    asSpeedDial?: boolean;
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
export default function ActionsMenu({ actionsButtonLabel, actions, ...props }: ActionsMenuProps) {
    const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
    const [loadingId, setLoadingId] = useState<null | string>(null);
    const [speedDialOpen, setSpeedDialOpen] = useState(false);
    const menuOpen = Boolean(anchorEl);
    const theme = useTheme();
    const matchMedia = useMediaQuery(theme.breakpoints.down('md'));

    const handleMenuButtonClick = (event: React.MouseEvent<HTMLElement>) => {
        setAnchorEl(event.currentTarget);
    };

    const handleClose = () => {
        setSpeedDialOpen(false);
        setAnchorEl(null);
    };
    if (matchMedia) {
        if (props.asSpeedDial) {
            return (
                <SpeedDial
                    ariaLabel={actionsButtonLabel}
                    icon={<SpeedDialIcon icon={<KeyboardArrowUp />} openIcon={<KeyboardArrowDownIcon />} />}
                    sx={{ position: 'absolute', bottom: 16, right: 16 }}
                    onClose={handleClose}
                    onOpen={() => {
                        setSpeedDialOpen(true);
                    }}
                    open={speedDialOpen}
                >
                    {actions.map((action, index) => {
                        return (
                            <SpeedDialAction
                                key={`${action.id}-${index}`}
                                icon={<SpeedDialIcon icon={action.icon} />}
                                title={action.label}
                                onClick={async () => {
                                    handleClose();
                                    handleActionFunction(action, setLoadingId);
                                }}
                            />
                        );
                    })}
                </SpeedDial>
            );
        }
        return (
            <div>
                <Button
                    id="actions-menu-button"
                    aria-controls={menuOpen ? 'actions-menu' : undefined}
                    aria-haspopup="true"
                    aria-expanded={menuOpen ? 'true' : undefined}
                    variant="contained"
                    disableElevation
                    onClick={handleMenuButtonClick}
                    endIcon={<KeyboardArrowDownIcon />}
                >
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
                                }}
                            >
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
