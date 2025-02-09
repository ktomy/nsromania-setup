import * as React from 'react';
import { AuthResponse, SignInPage, type AuthProvider } from '@toolpad/core/SignInPage';
import { AuthError } from 'next-auth';
import { auth, providerMap, signIn } from '@/auth';
import { Button } from '@mui/material';
import SignOutComponent from '@/lib/components/SignOutComponent';

export default async function SignIn() {
    const session = await auth();
    if (session) {
        return (
            <SignOutComponent user={session.user} />
        );
    }

    return (
        <SignInPage
            providers={providerMap}
            slotProps={{ emailField: { autoFocus: false } }}
            signIn={async (provider: AuthProvider, formData: FormData, callbackUrl?: string): Promise<AuthResponse> => {
                'use server';
                try {
                    return await signIn(provider.id, {
                        ...(formData && { email: formData.get('email'), password: formData.get('password') }),
                        redirectTo: callbackUrl ?? '/',
                    });
                } catch (error) {
                    // The desired flow for successful sign in in all cases
                    // and unsuccessful sign in for OAuth providers will cause a `redirect`,
                    // and `redirect` is a throwing function, so we need to re-throw
                    // to allow the redirect to happen
                    // Source: https://github.com/vercel/next.js/issues/49298#issuecomment-1542055642
                    // Detect a `NEXT_REDIRECT` error and re-throw it
                    if (error instanceof Error && error.message === 'NEXT_REDIRECT') {
                        throw error;
                    }
                    // Handle Auth.js errors

                    if (error instanceof AuthError) {
                        return {
                            error:
                                error.type === 'CredentialsSignin'
                                    ? 'Invalid credentials.'
                                    : error.type === 'AccessDenied' ?
                                        "Unknown email address"
                                        : 'An error with Auth.js occurred.',
                            type: error.type,
                        };
                    }
                    // An error boundary must exist to handle unknown errors
                    return {
                        error: 'Something went wrong.',
                        type: 'UnknownError',
                    };
                }
            }}
        />
    );
}
