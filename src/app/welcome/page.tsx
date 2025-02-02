import * as React from 'react';
import Typography from '@mui/material/Typography';
import { Box, Button } from '@mui/material';
import Link from 'next/link';

export default function WelcomePage() {
    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, mt: 4 }}>
            <Typography variant="h4">Welcome to NSRomania</Typography>
            <Typography variant="body1">
                This is a community-driven Nightscout hosting service.
                <br />
                This service is offered for caretakers of people with type 1 diabetes.
                <br />
                This is a community server managed by volunteers.
                <br />
                Please use it with care and respect.

            </Typography>
            <table cellPadding={10}>
                <tbody>
                    <tr>
                        <td>
                            <Button variant="contained" color="primary" component={Link} href="/auth/signin">
                                Sign In
                            </Button>
                        </td>
                        <td>
                            <Button variant="contained" color="primary" component={Link} href="/welcome/register">
                                Register
                            </Button>
                        </td>
                    </tr>
                </tbody>
            </table>
            <Typography variant="body1">
                If you have any questions, please contact us at <a href="mailto:artiom@gmail.com">artiom@gmail.com</a>
            </Typography>
        </Box>
    );
}