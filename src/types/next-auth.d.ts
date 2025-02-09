import { DefaultSession } from "next-auth"

declare module "next-auth" {
    interface User {
        role?: string
    }
    interface Session {
        user?: User
    }
}
