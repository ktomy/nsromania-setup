import { MongoClient } from 'mongodb';

export type DatabaseSize = {
    dbName: string;
    dataSize: number;
    storageSize: number;
};

export type DatabaseTrimResult = {
    dbName: string;
    cutoff: string;
    deletedDocuments: number;
    collections: Array<{
        name: string;
        dateField: string | null;
        deletedDocuments: number;
    }>;
};

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

export async function getDbSizes(dbNames: string[]): Promise<Map<string, DatabaseSize | null>> {
    const sizes = new Map<string, DatabaseSize | null>();
    const uniqueDbNames = Array.from(new Set(dbNames));

    if (uniqueDbNames.length === 0) {
        return sizes;
    }

    const client = createMongoClient();

    try {
        await client.connect();
        const databaseNames = new Set(
            (await client.db('admin').admin().listDatabases()).databases.map((database) => database.name)
        );
        for (const dbName of uniqueDbNames) {
            if (!databaseNames.has(dbName)) {
                sizes.set(dbName, null);
                continue;
            }
            const database = client.db(dbName);
            const stats = await database.stats();
            sizes.set(dbName, {
                dbName,
                dataSize: stats.dataSize ?? 0,
                storageSize: stats.storageSize ?? 0,
            });
        }
        return sizes;
    } catch (error) {
        console.error('Error getting database sizes:', error);
        throw error;
    } finally {
        await client.close();
    }
}

export const DEFAULT_TRIMMABLE_COLLECTIONS: Record<string, string> = {
    entries: 'date',
    treatments: 'created_at',
    devicestatus: 'created_at',
    activity: 'created_at',
};

export async function trimDatabase(
    dbName: string,
    cutoff: Date,
    trimmableCollections: Record<string, string> = DEFAULT_TRIMMABLE_COLLECTIONS
): Promise<DatabaseTrimResult> {
    const client = createMongoClient();

    try {
        await client.connect();
        const database = client.db(dbName);
        const collectionInfos = await database.listCollections().toArray();
        const collections: DatabaseTrimResult['collections'] = [];

        for (const collectionInfo of collectionInfos) {
            const dateField = trimmableCollections[collectionInfo.name] ?? null;
            if (!dateField) {
                collections.push({ name: collectionInfo.name, dateField: null, deletedDocuments: 0 });
                continue;
            }

            const collection = database.collection(collectionInfo.name);
            const deleted = await collection.deleteMany({
                $or: [
                    { [dateField]: { $type: 'number', $lt: cutoff.getTime() } },
                    { [dateField]: { $type: 'string', $lt: cutoff.toISOString() } },
                    { [dateField]: { $type: 'date', $lt: cutoff } },
                ],
            });
            collections.push({ name: collectionInfo.name, dateField, deletedDocuments: deleted.deletedCount });
        }

        return {
            dbName,
            cutoff: cutoff.toISOString(),
            deletedDocuments: collections.reduce((total, collection) => total + collection.deletedDocuments, 0),
            collections,
        };
    } catch (error) {
        console.error(`Error trimming database ${dbName}:`, error);
        throw error;
    } finally {
        await client.close();
    }
}
