'use client';
import { NSDomain, NSDomainEnvironment } from '.prisma/client';
import { notFound, useParams } from 'next/navigation';

import { Container, Box, Typography, Paper } from "@mui/material";
import Grid from '@mui/material/Grid2';
import React from 'react';
import Link from 'next/link';
import { formatDate } from '../../../../lib/utils';


type ApiResponse = NSDomain & {
    Environments?: NSDomainEnvironment[];
}

async function fetchDomain(id: string): Promise<ApiResponse | null> {

    const res = await fetch(`/api/domains/${id}`);
    if (!res.ok) return null;
    return res.json();

}

type RenderProperty = string | [string, string];

const RenderDomainProperties = ({ properties }: { properties: Record<string, RenderProperty> }) => {
    return (
        <Container maxWidth="lg">
            <Paper
                elevation={1}
                sx={{
                    p: 3,
                    borderRadius: 2,
                    backgroundColor: "whitesmoke",
                }}
            >
                <Grid container spacing={2} alignItems="center">
                    {Object.entries(properties).map(([key, value]) => {
                        const displayValue = typeof value === "string" ? value : value[0];
                        const color = typeof value === "string" ? "inherit" : value[1];

                        return (
                            <React.Fragment key={key}>
                                <Grid size={4}>
                                    <Typography variant="body1" fontWeight="bold">
                                        {key}:
                                    </Typography>
                                </Grid>
                                <Grid size={8}>
                                    <Typography variant="body1" sx={{ color }}>
                                        {displayValue}
                                    </Typography>
                                </Grid>
                            </React.Fragment>
                        );
                    })}
                </Grid>
            </Paper>
        </Container>
    );
};

export default function DomainPage({ params }: { params: { id: string } }) {
    const { id } = useParams() as { id: string };

    const [domain, setDomain] = React.useState<ApiResponse | null>(null);
    const [loading, setLoading] = React.useState(true);

    React.useEffect(() => {
        fetchDomain(id).then((domain) => {
            if (!domain) {
                notFound();
            }
            setDomain(domain);
            setLoading(false);
        });
    }, []);

    const domainProperties: Record<string, RenderProperty> = {
        Domain: domain?.domain || "",
        Active: domain?.active ? ["Yes", "green"] : ["No", "red"],
        Title: domain?.title || "",
        'Data source': domain?.enable.indexOf("bridge") !== -1 ?
            "Dexcom" : domain?.enable.indexOf("mmconnect") !== -1 ? ["Medtronic", "red"] : "API",
        "API Secret": domain?.api_secret || "",
        Created: formatDate(domain?.created),
        "Last updated": formatDate(domain?.last_updated),
    };

    let variables = {};
    if (domain?.Environments) {
        domain?.Environments.sort((a, b) => a.variable.localeCompare(b.variable)).forEach((env) => {
            variables = { ...variables, [env.variable]: env.value };
        });
    }


    return (
        (loading || !domain) ? <Typography>Loading...</Typography> :
            <Box>
                <Typography variant="h6">
                    <a href={`http://${domain?.domain}.nsromania.info`}>{domain?.domain}.nsromania.info</a>
                </Typography>
                <br />
                <Typography variant="h6">
                    Basic data
                </Typography>
                <RenderDomainProperties properties={domainProperties} />
                <Typography variant="h6">
                    Advanced settings (environment variables)
                </Typography>
                {Object.keys(variables).length === 0 ? (
                    <RenderDomainProperties properties={{ "None defined": "" }} />
                ) : (
                    <RenderDomainProperties properties={variables} />
                )}

            </Box>

    );


}