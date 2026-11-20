import NextAuth from 'next-auth';
import GitHub from 'next-auth/providers/github';
import type { Provider } from 'next-auth/providers';
import Google from 'next-auth/providers/google';
// Removed Sendgrid; email magic-link now sent via Brevo using local templates.
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma } from './lib/prisma';
import { User } from '@/generated/client';
import Credentials from 'next-auth/providers/credentials';
import { sendSignInEmail } from './lib/services/sendemail';

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
    // Custom Email magic-link provider using Brevo (via sendSignInEmail)
    {
        id: 'nodemailer',
        name: 'Email',
        type: 'email',
        sendVerificationRequest: async ({ identifier: email, url }) => {
            await sendSignInEmail(email, url);
        },
    } as Provider,
    process.env.NODE_ENV === 'development'
        ? Credentials({
              name: 'Test User',
              credentials: {
                  email: { label: 'Email', type: 'text', placeholder: 'email@test.com' },
                  password: { label: 'Password', type: 'password' },
              },
              async authorize(credentials) {
                  if (!credentials?.email || !credentials?.password) return null;

                  const testUser = await prisma.user.findUnique({
                      where: { email: credentials.email as string },
                  });

                  if (!testUser) return null;

                  // Simple password check
                  const isValidPassword = credentials.password === 'test';

                  return isValidPassword ? { id: testUser.id, name: testUser.name, email: testUser.email } : null;
              },
          })
        : null,
] as Provider[];

if (!process.env.GITHUB_CLIENT_ID) {
    console.warn('Missing environment variable "GITHUB_CLIENT_ID"');
}
if (!process.env.GITHUB_CLIENT_SECRET) {
    console.warn('Missing environment variable "GITHUB_CLIENT_SECRET"');
}

// The GitHub provider may take the primary address from /user/emails without checking that it is verified
async function isVerifiedGitHubEmail(accessToken: string | undefined, email: string | null | undefined) {
    if (!accessToken || !email) {
        return false;
    }
    try {
        const response = await fetch('https://api.github.com/user/emails', {
            headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'authjs' },
        });
        if (!response.ok) {
            return false;
        }
        const emails = (await response.json()) as { email: string; verified: boolean }[];
        return emails.some((entry) => entry.verified && entry.email.toLowerCase() === email.toLowerCase());
    } catch (error) {
        console.error('Unable to check GitHub email verification:', error);
        return false;
    }
}

export const providerMap = providers
    .filter((provider) => provider !== null)
    .map((provider) => {
        if (typeof provider === 'function') {
            const providerData = provider();
            return { id: providerData.id, name: providerData.name };
        }

        return { id: provider.id, name: provider.name };
    });

export const { handlers, auth, signIn, signOut } = NextAuth({
    providers: providers.filter((provider) => provider !== null),
    secret: process.env.AUTH_SECRET,
    pages: {
        signIn: '/auth/signin',
    },
    adapter: PrismaAdapter(prisma),
    callbacks: {
        async authorized({ auth: session, request: { nextUrl } }) {
            const isLoggedIn = !!session?.user;
            const isPublicPage =
                nextUrl.pathname.startsWith('/public') ||
                nextUrl.pathname.startsWith('/welcome') ||
                nextUrl.pathname.startsWith('/auth/signin');
            if (isPublicPage || isLoggedIn) {
                return true;
            }

            return false; // Redirect unauthenticated users to login page
        },
        async signIn({ user, account, profile }) {
            // console.log("SignIn arguments:\nuser: ", user,
            //     "\naccount: ", account,
            //     "\nprofile: ", profile,
            //     "\nemail: ", email,
            //     "\ncredentials: ", credentials);

            if (!user) {
                return false;
            }

            // Accounts are linked by email (allowDangerousEmailAccountLinking), so an OAuth sign-in is accepted only
            // when the provider has verified that address; otherwise anyone could add an admin's email to a new
            // GitHub account and sign in as that admin.
            if (account?.provider === 'google' && profile?.email_verified !== true) {
                console.warn(`Refusing Google sign-in with unverified email ${user.email}`);
                return false;
            }
            if (account?.provider === 'github' && !(await isVerifiedGitHubEmail(account.access_token, user.email))) {
                console.warn(`Refusing GitHub sign-in with unverified email ${user.email}`);
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
                if (profile !== undefined && (newDbUser.image !== profile.image || newDbUser.name !== profile.name)) {
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
                console.log(`No profile for ${user.email}, allowing`);
                return true;
            }

            return false;
        },
        async session({ session, token }) {
            // console.log("Session arguments:\nsession: ", session, "\ntoken: ", token);
            session.user.role = token?.role as string | undefined;
            session.user.id = typeof token?.id === 'string' ? token.id : '';
            return session;
        },
        async jwt({ token, user }) {
            let prismaUser = user as User | null;
            if (!prismaUser) {
                prismaUser = await prisma.user.findFirst({
                    where: {
                        email: token.email,
                    },
                });
            }
            if (prismaUser) {
                token.role = prismaUser.role;
                token.id = prismaUser.id;
            }
            // console.log("JWT arguments:\ntoken: ", token, "\nuser: ", user);
            return token;
        },
    },
    session: {
        strategy: 'jwt',
    },
});
