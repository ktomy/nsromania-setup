import { NextRequest, NextResponse } from "next/server";
import { validateEmail } from "@/lib/services/registration";
import { validateCaptcha } from "@/lib/services/recaptcha";


export async function POST(req: NextRequest) {

    const { email, token, code } = await req.json() as { email: string, token: string, code: string };

    // if email does not like like an email (reges validation) or token is small or empty, return an error
    if (!email || !token || !code || code.length !== 6 || !email.match(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/) || token.length < 10) {
        return new Response(JSON.stringify({ error: "Invalid email or token" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
        });
    }

    if (!await validateCaptcha(token)) {
        return new Response(JSON.stringify({ message: "Failed to verify" }), {
            status: 405,
        });
    }

    if (!await validateEmail(email, code)) {
        return new Response(JSON.stringify({ error: "Invalid verification code" }), {
            status: 403,
            headers: { "Content-Type": "application/json" },
        });
    }

    return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
    });
}