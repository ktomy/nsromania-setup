import { validateCaptcha } from "@/lib/services/recaptcha";
import { createRegistrationRequest, validateEmail } from "@/lib/services/registration";
import { RegisterDomainRequest } from "@/types/domains";
import { NextResponse } from "next/server";

export async function POST(req: Request) {

    const registrationRequest = await req.json() as RegisterDomainRequest;

    // email should look like an email, token should be long enough
    // domain should be an alphanumeric string of 2 to 16 characters, can only contain dashes, lowecase letters and numbers
    // data source can only be "Dexcom" or "API"
    // name can only contain letters and spaces
    // API secret should be a string of 12 characters

    if (
        !registrationRequest.ownerEmail ||
        !registrationRequest.reCAPTCHAToken ||
        !registrationRequest.domain ||
        !registrationRequest.dataSource ||
        !registrationRequest.ownerName ||
        !registrationRequest.apiSecret ||
        registrationRequest.apiSecret.length < 12 ||
        !registrationRequest.domain.match(/^[a-z0-9-]{2,16}$/) ||
        !registrationRequest.ownerName.match(/^[a-zA-Z ]{2,64}$/) ||
        !["Dexcom", "API"].includes(registrationRequest.dataSource) ||
        !registrationRequest.ownerEmail.match(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/) ||
        registrationRequest.reCAPTCHAToken.length < 10 ||
        !validateCaptcha(registrationRequest.reCAPTCHAToken)
    ) {
        return new Response(JSON.stringify({ error: "Invalid input parameters" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
        });
    }

    if (!await validateEmail(registrationRequest.ownerEmail, registrationRequest.emailVerificationToken)) {
        return new Response(JSON.stringify({ error: "Email not validated" }), {
            status: 403,
            headers: { "Content-Type": "application/json" },
        });
    }

    if (await createRegistrationRequest(registrationRequest)) {
        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    } else {
        return new Response(JSON.stringify({ error: "Failed to create registration request" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
}
