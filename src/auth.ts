import NextAuth from 'next-auth';
import GitHub from 'next-auth/providers/github';
import type { Provider } from 'next-auth/providers';
import Google from 'next-auth/providers/google';
import Sendgrid from "next-auth/providers/sendgrid"
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
    Sendgrid({
        apiKey: process.env.SENDGRID_API_KEY,
        from: "NSRomania <login@nsromania.info>",
        id: "nodemailer",
        name: "Email",
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
        if (providerData.id === 'sendgrid') {
            return { id: "nodemailer", name: "Email" };
        }
        return { id: providerData.id, name: providerData.name };
    }

    if (provider.id === 'sendgrid') {
        return { id: "nodemailer", name: "Email" };
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
            const isPublicPage = nextUrl.pathname.startsWith('/public')
                || nextUrl.pathname.startsWith('/welcome')
                || nextUrl.pathname.startsWith('/auth/signin')
                ;

            if (isPublicPage || isLoggedIn) {
                return true;
            }

            return false; // Redirect unauthenticated users to login page
        },
        async signIn({ user, account, profile, email, credentials }) {
            // console.log("SignIn arguments:\nuser: ", user,
            //     "\naccount: ", account,
            //     "\nprofile: ", profile,
            //     "\nemail: ", email,
            //     "\ncredentials: ", credentials);

            if (!user) {
                return false;
            }

            const dbUser = user as User;
            if (dbUser.loginAllowed === 1) {
                console.log(`User ${dbUser.email} is logging in`);
                return true;
            }

            // check for the first login
            const newDbUser = await prisma.user.findFirst({
                where: {
                    email: user.email,
                },
            });

            if (newDbUser && newDbUser.loginAllowed === 1) {
                if (profile !== undefined && (
                    newDbUser.image !== profile.image ||
                    newDbUser.name !== profile.name
                )) {
                    await prisma.user.update({
                        where: {
                            email: user.email as string,
                        },
                        data: {
                            image: profile.picture,
                            name: profile.name,
                        },
                    });
                }
                console.log(`First login for ${user.email}, allowing`);
                return true;
            }

            return false;

        },
    },
    // session: {
    //     strategy: 'jwt',
    // },
});
