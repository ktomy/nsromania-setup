import { NextResponse } from "next/server";

export async function POST(req: Request) {
    const { token } = await req.json();

    const secretKey = process.env.RECAPTCHA_SECRET_KEY;
    const response = await fetch(
        `https://www.google.com/recaptcha/api/siteverify?secret=${secretKey}&response=${token}`,
        { method: "POST" }
    );

    const data = await response.json();
    return NextResponse.json({ success: data.success });
}
