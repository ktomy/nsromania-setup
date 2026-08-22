const mockConnect = jest.fn();
const mockClose = jest.fn();
const mockDeleteMany = jest.fn();
const mockListCollections = jest.fn();
const mockCollection = jest.fn();
const mockDb = jest.fn();

jest.mock('mongodb', () => ({
    MongoClient: jest.fn().mockImplementation(() => ({
        connect: mockConnect,
        close: mockClose,
        db: mockDb,
    })),
}));

const { trimDatabase } = require('../nsdatbasea') as typeof import('../nsdatbasea');
const originalMongoUrl = process.env.MONGO_URL;

describe('Nightscout database trimming', () => {
    beforeAll(() => {
        process.env.MONGO_URL = 'mongodb://127.0.0.1:27017/test';
    });

    afterAll(() => {
        if (originalMongoUrl === undefined) {
            delete process.env.MONGO_URL;
        } else {
            process.env.MONGO_URL = originalMongoUrl;
        }
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockConnect.mockResolvedValue(undefined);
        mockClose.mockResolvedValue(undefined);
        mockDeleteMany.mockResolvedValue({ deletedCount: 2 });
        mockListCollections.mockReturnValue({
            toArray: jest
                .fn()
                .mockResolvedValue([
                    { name: 'entries' },
                    { name: 'treatments' },
                    { name: 'profile' },
                    { name: 'food' },
                    { name: 'dummy' },
                ]),
        });
        mockCollection.mockReturnValue({ deleteMany: mockDeleteMany });
        mockDb.mockReturnValue({ listCollections: mockListCollections, collection: mockCollection });
    });

    it('deletes all supported date representations only from time-series collections', async () => {
        const cutoff = new Date('2026-04-01T00:00:00.000Z');

        const result = await trimDatabase('site', cutoff);

        expect(mockCollection).toHaveBeenCalledTimes(2);
        expect(mockCollection).toHaveBeenNthCalledWith(1, 'entries');
        expect(mockCollection).toHaveBeenNthCalledWith(2, 'treatments');
        expect(mockDeleteMany).toHaveBeenNthCalledWith(1, {
            $or: [
                { date: { $type: 'number', $lt: cutoff.getTime() } },
                { date: { $type: 'string', $lt: cutoff.toISOString() } },
                { date: { $type: 'date', $lt: cutoff } },
            ],
        });
        expect(result.deletedDocuments).toBe(4);
        expect(result.collections).toEqual(
            expect.arrayContaining([
                { name: 'profile', dateField: null, deletedDocuments: 0 },
                { name: 'food', dateField: null, deletedDocuments: 0 },
            ])
        );
        expect(mockClose).toHaveBeenCalledTimes(1);
    });
});
