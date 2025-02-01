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
            </Typography>
            <Button variant="contained" color="primary" component={Link} href="/auth/signin">
                Sign In
            </Button>
        </Box>
    );
}