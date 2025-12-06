import NewDomain from './NewDomain';
import { auth } from '@/auth';
import { User } from '@/generated/client';

export default async function NewDomainPage() {
    const session = await auth();
    const user = session?.user as User;

    return (
        <div>
            <NewDomain user={user} />
        </div>
    );
}
