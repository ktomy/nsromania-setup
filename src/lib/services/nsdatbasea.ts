import { MongoClient } from 'mongodb';

interface MongoUser {
    user: string;
    db: string;
    roles: { role: string; db: string }[];
}

export async function checkMongoDatabaseAndUser(dbName: string, userName: string): Promise<boolean> {

    if (!process.env.MONGO_URL) {
        throw new Error('Missing environment variable "MONGO_URL"');
    }

    const client = new MongoClient(process.env.MONGO_URL);

    try {
        await client.connect();
        const adminDb = client.db(dbName).admin();

        // Check if database exists
        const databases = await adminDb.listDatabases();
        const dbExists = databases.databases.some(db => db.name === dbName);
        if (!dbExists) {
            return false;
        }
        const users = await client.db(dbName).command({ usersInfo: 1 });
        const userExists = users.users.some((user: MongoUser) => user.user === userName);
        return userExists;


    } catch (error) {
        console.error('Error checking database and user:', error);
        return false;
    } finally {
        await client.close();
    }
}

export async function createDatabaseAndUser(name: string, password: string) {
    if (!process.env.MONGO_URL) {
        throw new Error('Missing environment variable "MONGO_URL"');
    }

    const client = new MongoClient(process.env.MONGO_URL);

    try {
        await client.connect();
        const adminDb = client.db('admin').admin();

        // Create database
        await adminDb.command({ create: name });

        // Create user
        await adminDb.command({
            createUser: name,
            pwd: password,
            roles: [{ role: 'readWrite', db: name }],
        });
    } catch (error) {
        console.error('Error creating database and user:', error);
        throw error;
    } finally {
        await client.close();
    }

}

export async function deleteDatabaseAndUser(name: string) {
    if (!process.env.MONGO_URL) {
        throw new Error('Missing environment variable "MONGO_URL"');
    }

    const client = new MongoClient(process.env.MONGO_URL);

    try {
        await client.connect();
        const adminDb = client.db('admin').admin();

        // Drop user
        await adminDb.command({ dropUser: name });

        // Drop database
        await adminDb.command({ dropDatabase: 1 });


    } catch (error) {
        console.error('Error deleting database and user:', error);
    } finally {
        await client.close();
    }

}

