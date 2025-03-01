import * as React from "react";
import Typography from "@mui/material/Typography";
import { Box, Button } from "@mui/material";
import Grid from "@mui/material/Grid2";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";

export default function WelcomePage() {
	const t = useTranslations("WelcomePage");
	const locale = useLocale();

	return (
		<Box sx={{ height: "100vh", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 2 }}>
			<Typography variant="h4">{t("welcomeTitle")}</Typography>
			<Typography variant="body1">
				{t("welcomeMessage1")}
				<br />
				{t("welcomeMessage2")}
				<br />
				{t("welcomeMessage3")}
				<br />
				{t("welcomeMessage4")}
			</Typography>
			<Grid container spacing={2}>
				<Grid size={{ xs: 12, sm: 6 }}>
					<Button variant="outlined" color="primary" component={Link} href="/auth/signin" fullWidth>
						{t("signIn")}
					</Button>
				</Grid>
				<Grid size={{ xs: 12, sm: 6 }}>
					<Button variant="contained" color="primary" component={Link} href="/welcome/register" fullWidth>
						{t("register")}
					</Button>
				</Grid>
			</Grid>
			<Typography variant="body1">
				{t("contactMessage")} <a href="mailto:artiom@gmail.com">artiom@gmail.com</a>
			</Typography>
		</Box>
	);
}
