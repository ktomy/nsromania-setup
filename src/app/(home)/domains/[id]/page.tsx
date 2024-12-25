import { NSDomain } from '.prisma/client';
import { notFound, useParams } from 'next/navigation';
import { prisma } from '../../../../lib/prisma';
import * as MUI from '@mui/material';
import { Container, Box, Typography, Paper } from "@mui/material";
import Grid from '@mui/material/Grid2';
import React from 'react';
import { render } from 'preact';
import { PageContainer } from '@toolpad/core/PageContainer';
import { pathname } from 'next-extra/pathname';


async function fetchDomain(id: string): Promise<NSDomain | null> {

    const res = await fetch(`http://localhost:3000/api/domains/${id}`);
    if (!res.ok) return null;
    return res.json();

    // const domain = prisma.nSDomain.findFirst({
    //     where: {
    //         id: parseInt(id),
    //     },
    //     include: {
    //         Environments: true,
    //     }
    // });

    // return domain;


}
const DomainProperties = ({ properties }: { properties: Record<string, string> }) => {
    return (
        <Container maxWidth="lg">
            <Box sx={{ mt: 4 }}>
                <Typography variant="h4" gutterBottom>
                    Domain Properties
                </Typography>
                <Paper
                    elevation={3}
                    sx={{
                        p: 3,
                        borderRadius: 2,
                        backgroundColor: "whitesmoke",
                    }}
                >
                    <Grid container spacing={2} alignItems="center">
                        {Object.entries(properties).map(([key, value]) => (
                            <React.Fragment key={key}>
                                <Grid size={4}>
                                    <Typography variant="body1" fontWeight="bold">
                                        {key}:
                                    </Typography>
                                </Grid>
                                <Grid size={8}>
                                    <Typography variant="body1">{value}</Typography>
                                </Grid>
                            </React.Fragment>
                        ))}
                    </Grid>
                </Paper>
            </Box>
        </Container>
    );
};

export default async function DomainPage({ params }: { params: { id: string } }) {
    const { id } = await params;
    const domain = await fetchDomain(id);

    if (!domain) {
        notFound();
    }

    const properties = {
        Domain: domain.domain,
        Title: domain.title,
        // Add more fields as needed
    };

    const currentPath = await pathname();
    let activePage = currentPath;
    // remove everything after the last slash
    activePage = activePage.replace(/\/[^/]*$/, "");

    console.log("activePage", activePage);

    const title = domain.domain + ".nsromania.info";

    const breadcrumbs = [{ title: "Domains", path: activePage }, { title, currentPath }];

    return (
        // <PageContainer title={title} breadcrumbs={breadcrumbs}>
        <Box>
            <DomainProperties properties={properties} />
        </Box>
        // </PageContainer>
    );


}