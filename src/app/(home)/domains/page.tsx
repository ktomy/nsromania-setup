'use client';
import * as React from 'react';
import Typography from '@mui/material/Typography';
import { Box } from '@mui/material';
import { DataGrid, GridActionsCellItem, GridColDef, GridRowId, GridRowsProp, GridToolbar } from '@mui/x-data-grid';
import SettingsIcon from '@mui/icons-material/Settings';
import { useSession } from 'next-auth/react';
import { NSDomain } from '.prisma/client';
import { redirect } from 'next/navigation';
import { formatDate } from '../../../lib/utils';

export default function DomainsPage() {
    const [rows, setRows] = React.useState<GridRowsProp>([]);
    const { data: session, status } = useSession();

    if (status === 'loading') {
        return <p>Loading...</p>;
    }

    if (!session) {
        return <p>You are not signed in. Please sign in to access this page.</p>;
    }

    React.useEffect(() => {

        fetch(`/api/domains`).then((response) => {
            response.json().then((domains) => {
                const rows: GridRowsProp = domains.map((domain: NSDomain) => {
                    return {
                        id: domain.id,
                        active: domain.active,
                        title: domain.title,
                        domain: domain.domain,
                        created: formatDate(domain.created),
                        last_updated: formatDate(domain.last_updated),
                        data_source: domain.enable.indexOf('bridge') > -1 ?
                            'Dexcom' : domain.enable.indexOf('mmconnect') > -1 ? 'Medtronic' : 'API',
                    }
                });
                setRows(rows);
            });

        });
    }, []);

    const redirectToDetails = (id: GridRowId) => () => {
        console.log('Redirecting to domain details:', id);
        redirect(`/domains/${id}`);
    };

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
        {
            field: 'actions',
            type: 'actions',
            width: 80,
            getActions: (params) => [
                <GridActionsCellItem
                    icon={<SettingsIcon />}
                    label="Details"
                    onClick={redirectToDetails(params.id)}
                />,
            ],
        },
    ];


    return <Box>
        <Typography>Welcome to Nightscout Romania, {session?.user?.name || 'User'} ({session?.user?.id || "Unknown ID"})!</Typography>
        <DataGrid
            rows={rows}
            columns={columns}

        />
    </Box>

}
