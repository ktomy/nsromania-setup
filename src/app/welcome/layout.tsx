import LocaleSwitcher from '@/lib/components/LocaleSwitcher';
import { Box, Container } from '@mui/material';
import { ThemeSwitcher } from '@toolpad/core/DashboardLayout';

export default function HomePagesLayout(props: { children: React.ReactNode }) {
    return (
        <>
            <Box component="header" sx={{ position: 'relative', padding: 2 }} height={64}>
                <Box
                    sx={{
                        marginBottom: 2,
                        position: 'absolute',
                        top: '1rem',
                        right: '1rem',
                        display: 'flex',
                        gap: 2,
                        alignItems: 'center',
                    }}
                >
                    <ThemeSwitcher />
                    <LocaleSwitcher />
                </Box>
            </Box>
            <Container maxWidth="lg">{props.children}</Container>
        </>
    );
}
