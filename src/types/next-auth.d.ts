import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
    interface Session extends DefaultSession {
        user: {
            role?: string;
            id?: string;
        } & DefaultSession['user'];
    }
}
