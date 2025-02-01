import * as React from 'react';
import Typography from '@mui/material/Typography';
import { Box, Button } from '@mui/material';
import Link from 'next/link';

export default function WelcomePage() {
    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, mt: 4 }}>
            <Typography variant="h4">Registration</Typography>
            <Typography variant="body1">
                Registration is not available at this time.
                <br />
                If you still want to register, please fill in
                <a target='_blank' href="https://www.facebook.com/groups/noisidiabetul/posts/3015947701975505/">this</a> form


            </Typography>

            <Typography variant="body1">
                If you have any questions, please contact us at <a href="mailto:artiom@gmail.com">artiom@gmail.com</a>
            </Typography>
        </Box>
    );
}