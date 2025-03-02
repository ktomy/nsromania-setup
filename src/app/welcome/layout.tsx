import LocaleSwitcher from '@/lib/components/LocaleSwitcher';
import { Box, Container, useTheme } from '@mui/material';

export default function HomePagesLayout(props: { children: React.ReactNode }) {
    return (
        <>
            <Box component="header" sx={{ position: 'relative', padding: 2 }} height={64}>
                <Box sx={{ marginBottom: 2, position: 'absolute', top: '1rem', right: '1rem' }}>
                    <LocaleSwitcher />
                </Box>
            </Box>
            <Container maxWidth="lg">{props.children}</Container>
        </>
    );
}
