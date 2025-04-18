export async function validateCaptcha(token: string): Promise<boolean> {
    if (process.env.NODE_ENV === 'development') {
        console.log('Skipping reCAPTCHA validation in development mode');
        return true;
    }

    try {
        const secretKey = process.env.RECAPTCHA_SECRET_KEY;
        const response = await fetch(
            `https://www.google.com/recaptcha/api/siteverify?secret=${secretKey}&response=${token}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
            }
        );

        const responseBody = await response.json();

        if (response.status !== 200 || !responseBody.success || responseBody.score < 0.5) {
            console.log('reCAPTCHA validation failed (status code or score invalid)', responseBody);
            return false;
        }
    } catch (error) {
        console.log('reCAPTCHA validation failed', error);
        return false;
    }

    return true;
}
