'use client';
import { notFound, useParams } from 'next/navigation';

import { Container, Box, Typography, Paper, Button, Snackbar, Alert } from "@mui/material";
import Grid from '@mui/material/Grid2';
import React, { useEffect, useState } from 'react';
import { formatDate } from '@/lib/utils';
import { GetDomainByIdResponse } from '@/types/domains';


async function fetchDomain(id: string): Promise<GetDomainByIdResponse | null> {

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

export default function DomainPage() {
    const { id } = useParams() as { id: string };

    const [domain, setDomain] = useState<GetDomainByIdResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [snackOpen, setSnackOpen] = useState(false);
    const [snackMessage, setSnackMessage] = useState('');
    const [snackKind, setSnackKind] = useState<'success' | 'error' | 'info' | 'warning'>('success');
    const [actionInProgress, setActionInProgress] = useState(false);

    const openSnack = (message: string, kind: 'success' | 'error' | 'info' | 'warning') => {
        setSnackMessage(message);
        setSnackKind(kind);
        setSnackOpen(true);
    };

    const handleSnackClose = () => {
        setSnackOpen(false);
    };

    const handleStartStopDomain = async (id: string, action: "start" | "stop") => {
        try {
            setActionInProgress(true);
            const res = await fetch(`/api/domains/${id}/${action}`, {
                method: "POST",
            });

            if (res.ok) {
                openSnack("Action successfull", "success");
                // reload the domain
                fetchDomain(id).then((domain) => {
                    if (!domain) {
                        notFound();
                    }
                    setDomain(domain);
                    setActionInProgress(false);
                });
            } else {
                console.error(`Failed to ${action} domain`, res);
                openSnack(`Failed to ${action} domain`, "error");
                setActionInProgress(false);
            }
        } catch (error) {
            console.error(`Failed to ${action} domain`, error);
            openSnack(`Failed to ${action} domain`, "error");
            setActionInProgress(false);
        }
    }


    useEffect(() => {
        fetchDomain(id).then((domain) => {
            if (!domain) {
                notFound();
            }
            setDomain(domain);
            setLoading(false);
        });
    }, [id]);

    const domainProperties: Record<string, RenderProperty> = domain == null ? {} : {
        "Subdomain name": domain.domain || "",
        "Owner": domain.authUser?.email || ["Unknown", "red"],
        Active: domain.active ? ["Yes", "green"] : ["No", "red"],
        "Initialized (should be)": domain.dbExists ? ["Yes", "green"] : ["No", "red"],
        "Initialized (actual)": domain.dbInitialized ? ["Yes", "green"] : ["No", "red"],
        Status: domain.status === "not running" ?
            ["Not running", "red"] : domain.status === "online" ?
                ["Online", "green"] : domain.status || ["error", "red"],
        Title: domain.title || "",
        'Data source': domain.enable.indexOf("bridge") !== -1 ?
            "Dexcom" : domain.enable.indexOf("mmconnect") !== -1 ? ["Medtronic", "red"] : "API",
        "API Secret": domain.apiSecret || "",
        Created: formatDate(domain?.created),
        "Last updated": formatDate(domain?.lastUpdated),
        Enable: domain.enable || "",
    };

    let variables = {};

    if (domain != null) {
        if (domain.enable.indexOf("bridge") !== -1) {
            domainProperties["Dexcom Server"] = domain.bridgeServer || "";
            domainProperties["Dexcom Username"] = domain.bridgeUsername || "";
            domainProperties["Dexcom Password"] = domain.bridgePassword || "";
        }

        if (domain.environments) {
            domain.environments.sort((a, b) =>
                a.variable.localeCompare(b.variable)).forEach((env) => {
                    variables = { ...variables, [env.variable]: env.value };
                });
        }
    }


    return (
        (loading || !domain) ? <Typography>Loading...</Typography> :
            <Box>
                <Snackbar
                    open={snackOpen}
                    autoHideDuration={3000}
                    onClose={handleSnackClose}
                    message={snackMessage}
                >
                    <Alert
                        onClose={handleSnackClose}
                        severity={snackKind}
                        variant="filled"
                        sx={{ width: '100%' }}
                    >
                        {snackMessage}
                    </Alert>
                </Snackbar>
                <Grid size={12} direction={"row"} container>
                    <Grid size={8}>
                        <Typography variant="h6">
                            <a href={`https://${domain?.domain}.nsromania.info`}>{domain?.domain}.nsromania.info</a>
                        </Typography>
                    </Grid>
                    <Grid size={4}>
                        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
                            <Button
                                variant="contained"
                                color="primary"
                                onClick={() => handleStartStopDomain(id, "start")}
                                disabled={
                                    domain.status === "online" ||
                                    domain.dbInitialized === false ||
                                    actionInProgress
                                }
                            >
                                Start
                            </Button>
                            <Button
                                variant="contained"
                                color="error"
                                onClick={() => handleStartStopDomain(id, "stop")}
                                disabled={
                                    domain.status === "not running" ||
                                    domain.dbInitialized === false ||
                                    actionInProgress}
                            >
                                Stop
                            </Button>
                            <Button variant="contained" color="primary" href={`/domains/${id}/edit`}>
                                Edit Domain
                            </Button>
                        </Box>
                    </Grid>
                </Grid>
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
