import * as React from 'react';
import Typography from '@mui/material/Typography';
import { auth } from '../../auth';
import { Box } from '@mui/material';
import { DataGrid, GridColDef, GridRowsProp } from '@mui/x-data-grid';
import { prisma } from '../../lib/prisma'


export default async function HomePage() {
    const session = await auth();

    const domains = await prisma.ns_domain.findMany();

    const rows: GridRowsProp = domains.map((domain) => {
        return {
            id: domain.id,
            active: domain.active,
            title: domain.title,
            domain: domain.domain,
        }
    });

    // const rows: GridRowsProp = [
    //     { id: 1, col1: 'Hello', col2: 'World' },
    //     { id: 2, col1: 'DataGridPro', col2: 'is Awesome' },
    //     { id: 3, col1: 'MUI', col2: 'is Amazing' },
    // ];

    const columns: GridColDef[] = [
        { field: 'id', headerName: 'ID', width: 150 },
        { field: 'active', headerName: 'Active', width: 150 },
        { field: 'title', headerName: 'Title', width: 150 },
        { field: 'domain', headerName: 'Subdomain', width: 150 },
    ];

    return <Box>
        <Typography>Welcome to Nightscout Romania, {session?.user?.name || 'User'} ({session?.user?.id || "Unknown ID"})!</Typography>
        <DataGrid rows={rows} columns={columns} />
    </Box>

    //<Typography>Welcome to Nightscout Romania, {session?.user?.name || 'User'} ({session?.user?.id || "Unknown ID"})!</Typography>;
}
