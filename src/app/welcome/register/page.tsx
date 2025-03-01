'use client';
import * as React from 'react';

import { GoogleReCaptchaProvider } from "react-google-recaptcha-v3";
import RegisterForm from './RegisterForm';

export default function RegisterPage() {

    return (
        <GoogleReCaptchaProvider reCaptchaKey={process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY as string}>
            <RegisterForm />
        </GoogleReCaptchaProvider>
    );
}