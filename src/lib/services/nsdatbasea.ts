import { MongoClient } from 'mongodb';

interface MongoUser {
    user: string;
    db: string;
    roles: { role: string; db: string }[];
}

function createMongoClient() {
    if (!process.env.MONGO_URL) {
        throw new Error('Missing environment variable "MONGO_URL"');
    }

    const timeoutMs = Number(process.env.MONGO_TIMEOUT_MS ?? 5000);

    return new MongoClient(process.env.MONGO_URL, {
        connectTimeoutMS: timeoutMs,
        serverSelectionTimeoutMS: timeoutMs,
    });
}

export async function checkMongoDatabaseAndUser(dbName: string, userName: string): Promise<boolean> {
    const client = createMongoClient();

    try {
        await client.connect();
        const adminDb = client.db(dbName).admin();

        // Check if database exists
        const databases = await adminDb.listDatabases();
        const dbExists = databases.databases.some((db) => db.name === dbName);
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
    const client = createMongoClient();

    try {
        await client.connect();

        const db = client.db(name);
        await db.command({
            createUser: name,
            pwd: password,
            roles: [{ role: 'readWrite', db: name }],
        });

        await db.collection('dummy').insertOne({ initialized: true });

        // const adminDb = client.db('admin').admin();

        // // Create database
        // await adminDb.command({ create: name });

        // // Create user
        // await adminDb.command({
        //     createUser: name,
        //     pwd: password,
        //     roles: [{ role: 'readWrite', db: name }],
        // });
    } catch (error) {
        console.error('Error creating database and user:', error);
        throw error;
    } finally {
        await client.close();
    }
    console.log(`Database and user created: ${name}`);
}

export async function deleteDatabaseAndUser(name: string) {
    const client = createMongoClient();

    try {
        await client.connect();
        const userDb = client.db(name);

        // Drop user
        await userDb.command({ dropUser: name });

        // Drop database
        await userDb.dropDatabase();
    } catch (error) {
        console.error('Error deleting database and user:', error);
        throw error;
    } finally {
        await client.close();
    }
    console.log(`Database and user deleted: ${name}`);
}

export async function getCollections(dbName: string) {
    const client = createMongoClient();

    try {
        await client.connect();
        const collections = await client.db(dbName).listCollections().toArray();
        return collections.map((collection) => collection.name);
    } catch (error) {
        console.error('Error getting collections:', error);
        throw error;
    } finally {
        await client.close();
    }
}

export async function getLastDbEntry(dbName: string) {
    if (!(await checkMongoDatabaseAndUser(dbName, dbName))) {
        return null;
    }

    const client = createMongoClient();

    try {
        await client.connect();
        // check if collection 'entries' exists
        const collections = await client.db(dbName).listCollections().toArray();
        if (!collections.some((collection) => collection.name === 'entries')) {
            return null;
        }
        // get one entry from 'entries' sorted by 'date' descending
        const lastEntry = await client.db(dbName).collection('entries').find().sort({ date: -1 }).limit(1).toArray();
        if (lastEntry.length === 0) {
            return null;
        }
        return new Date(lastEntry[0].date);
    } catch (error) {
        console.error('Error getting last database entry:', error);
        throw error;
    } finally {
        await client.close();
    }
}

export async function getLastDbEntries(dbNames: string[]) {
    const lastEntries = new Map<string, Date | null>();
    const uniqueDbNames = Array.from(new Set(dbNames));

    if (uniqueDbNames.length === 0) {
        return lastEntries;
    }

    const client = createMongoClient();

    try {
        await client.connect();

        for (const dbName of uniqueDbNames) {
            const collections = await client.db(dbName).listCollections({ name: 'entries' }).toArray();
            if (collections.length === 0) {
                lastEntries.set(dbName, null);
                continue;
            }

            const lastEntry = await client
                .db(dbName)
                .collection('entries')
                .findOne({}, { sort: { date: -1 }, projection: { date: 1 } });
            lastEntries.set(dbName, lastEntry?.date ? new Date(lastEntry.date) : null);
        }

        return lastEntries;
    } catch (error) {
        console.error('Error getting last database entries:', error);
        throw error;
    } finally {
        await client.close();
    }
}

export async function getDbSize(dbName: string) {
    if (!(await checkMongoDatabaseAndUser(dbName, dbName))) {
        return null;
    }

    const client = createMongoClient();

    try {
        await client.connect();
        const stats = await client.db(dbName).stats();
        return stats.dataSize;
    } catch (error) {
        console.error('Error getting database size:', error);
        throw error;
    } finally {
        await client.close();
    }
}
