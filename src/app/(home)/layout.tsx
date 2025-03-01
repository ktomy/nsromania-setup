import * as React from 'react';
import { DashboardLayout } from '@toolpad/core/DashboardLayout';
import { PageContainer } from '@toolpad/core/PageContainer';
import { auth } from '@/auth';
import { redirect } from 'next/navigation';

export default async function HomePagesLayout(props: { children: React.ReactNode }) {
    const session = await auth();
    if (session === null) {
        redirect("/welcome");
    }

    return (
        <DashboardLayout>
            <PageContainer>{props.children}</PageContainer>
        </DashboardLayout>
    );
}
