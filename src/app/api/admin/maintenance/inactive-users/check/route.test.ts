export {};

jest.mock(
    '../../../../../../auth',
    () => ({
        auth: jest.fn(),
    })
);

jest.mock(
    '../../../../../../lib/services/maintenance',
    () => ({
        getInactiveUserPreview: jest.fn(),
    })
);

const { auth } = jest.requireMock('../../../../../../auth') as {
    auth: jest.Mock;
};
const { getInactiveUserPreview } = jest.requireMock('../../../../../../lib/services/maintenance') as {
    getInactiveUserPreview: jest.Mock;
};

const { POST } = require('./route') as typeof import('./route');

describe('inactive users check route', () => {
    beforeAll(() => {
        global.Response = class {
            status: number;
            body: string;

            constructor(body: string, init?: { status?: number }) {
                this.body = body;
                this.status = init?.status ?? 200;
            }
        } as any;
    });

    beforeEach(() => {
        jest.clearAllMocks();
        getInactiveUserPreview.mockResolvedValue({ counts: {}, sites: [] });
    });

    it('requires authentication', async () => {
        auth.mockResolvedValue(null);

        const response = await POST(request({ days: 90 }));

        expect(response.status).toBe(401);
        expect(getInactiveUserPreview).not.toHaveBeenCalled();
    });

    it('requires an admin session', async () => {
        auth.mockResolvedValue({ user: { id: 'user-1', role: 'user' } });

        const response = await POST(request({ days: 90 }));

        expect(response.status).toBe(401);
        expect(getInactiveUserPreview).not.toHaveBeenCalled();
    });

    it('passes validated days to inactive-user preview', async () => {
        auth.mockResolvedValue({ user: { id: 'admin-1', role: 'admin' } });

        const response = await POST(request({ days: 120 }));

        expect(response.status).toBe(200);
        expect(getInactiveUserPreview).toHaveBeenCalledWith({ days: 120 });
    });
});

function request(body: unknown) {
    return {
        json: jest.fn().mockResolvedValue(body),
    } as any;
}
