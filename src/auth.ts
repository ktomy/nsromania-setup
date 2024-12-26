import NextAuth from 'next-auth';
import GitHub from 'next-auth/providers/github';
import type { Provider } from 'next-auth/providers';
import Google from 'next-auth/providers/google';
import { PrismaAdapter } from "@auth/prisma-adapter"
import { prisma } from "./lib/prisma"
import { User } from '@prisma/client';

const providers: Provider[] = [
    GitHub({
        clientId: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET,
        allowDangerousEmailAccountLinking: true,
    }),
    Google({
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        allowDangerousEmailAccountLinking: true,
    }),
];

if (!process.env.GITHUB_CLIENT_ID) {
    console.warn('Missing environment variable "GITHUB_CLIENT_ID"');
}
if (!process.env.GITHUB_CLIENT_SECRET) {
    console.warn('Missing environment variable "GITHUB_CLIENT_SECRET"');
}

export const providerMap = providers.map((provider) => {
    if (typeof provider === 'function') {
        const providerData = provider();
        return { id: providerData.id, name: providerData.name };
    }
    return { id: provider.id, name: provider.name };
});

export const { handlers, auth, signIn, signOut } = NextAuth({
    providers,
    secret: process.env.AUTH_SECRET,
    pages: {
        signIn: '/auth/signin',
    },
    adapter: PrismaAdapter(prisma),
    callbacks: {
        async authorized({ auth: session, request: { nextUrl } }) {
            const isLoggedIn = !!session?.user;
            const isPublicPage = nextUrl.pathname.startsWith('/public');

            if (isPublicPage || isLoggedIn) {
                return true;
            }

            return false; // Redirect unauthenticated users to login page
        },
        async signIn({ user, account, profile, email, credentials }) {

            if (!user) {
                return false;
            }

            const dbUser = user as User;
            if (dbUser.loginAllowed === 1) {
                return true;
            }

            return false;

        },
    },
});
