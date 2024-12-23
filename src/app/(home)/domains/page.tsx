import * as React from 'react';
import Typography from '@mui/material/Typography';
import { auth } from '../../../auth';
import { Box } from '@mui/material';
import { DataGrid, GridActionsCellItem, GridColDef, GridRowId, GridRowsProp, GridToolbar } from '@mui/x-data-grid';
import DeleteIcon from '@mui/icons-material/Delete';
import { prisma } from '../../../lib/prisma'

export default async function DomainsPage() {
    const session = await auth();

    const domains = await prisma.nSDomain.findMany();

    const rows: GridRowsProp = domains.map((domain) => {
        return {
            id: domain.id,
            active: domain.active,
            title: domain.title,
            domain: domain.domain,
            created: domain.created.toLocaleString(),
            last_updated: domain.last_updated?.toLocaleString(),
            data_source: domain.enable.indexOf('bridge') > -1 ? 'Dexcom' : 'API',
        }
    });

    // const deleteUser = React.useCallback(
    //     (id: GridRowId) => () => {
    //         console.log(`Delete user ${id}`);
    //     },
    //     [],
    // );

    // const rows: GridRowsProp = [
    //     { id: 1, col1: 'Hello', col2: 'World' },
    //     { id: 2, col1: 'DataGridPro', col2: 'is Awesome' },
    //     { id: 3, col1: 'MUI', col2: 'is Amazing' },
    // ];

    const columns: GridColDef[] = [
        {
            field: 'id',
            headerName: 'ID',
            type: 'number',
            width: 50,
        },
        {
            field: 'active',
            headerName: 'Active',
            type: 'boolean',
            width: 70,
        },
        {
            field: 'domain',
            headerName: 'Subdomain',
            type: 'string',
            flex: 1,
        },
        {
            field: 'data_source',
            headerName: 'Data Source',
            type: 'string',
            width: 100,
        },
        {
            field: 'title',
            headerName: 'Title',
            type: 'string',
            flex: 1,
        },
        {
            field: 'created',
            headerName: 'Created',
            type: 'string',
            flex: 1,
        },
        {
            field: 'last_updated',
            headerName: 'Updated',
            type: 'string',
            flex: 1,
        },
        // {
        //     field: 'actions',
        //     type: 'actions',
        //     width: 80,
        //     getActions: (params) => [
        //         // <GridActionsCellItem
        //         //     icon={<DeleteIcon />}
        //         //     label="Delete"
        //         //     onClick={deleteUser(params.id)}
        //         // />,
        //         //   <GridActionsCellItem
        //         //     icon={<SecurityIcon />}
        //         //     label="Toggle Admin"
        //         //     onClick={toggleAdmin(params.id)}
        //         //     showInMenu
        //         //   />,
        //         //   <GridActionsCellItem
        //         //     icon={<FileCopyIcon />}
        //         //     label="Duplicate User"
        //         //     onClick={duplicateUser(params.id)}
        //         //     showInMenu
        //         //   />,
        //     ],
        // },
    ];


    return <Box>
        <Typography>Welcome to Nightscout Romania, {session?.user?.name || 'User'} ({session?.user?.id || "Unknown ID"})!</Typography>
        <DataGrid
            rows={rows}
            columns={columns}

        />
    </Box>

    //<Typography>Welcome to Nightscout Romania, {session?.user?.name || 'User'} ({session?.user?.id || "Unknown ID"})!</Typography>;
}
