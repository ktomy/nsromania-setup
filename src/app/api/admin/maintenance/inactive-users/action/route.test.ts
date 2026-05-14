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
        actionInactiveUsers: jest.fn(),
    })
);

const { auth } = jest.requireMock('../../../../../../auth') as {
    auth: jest.Mock;
};
const { actionInactiveUsers } = jest.requireMock('../../../../../../lib/services/maintenance') as {
    actionInactiveUsers: jest.Mock;
};

const { POST } = require('./route') as typeof import('./route');

describe('inactive users action route', () => {
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
        actionInactiveUsers.mockResolvedValue({ counts: {}, results: [] });
    });

    it('requires authentication', async () => {
        auth.mockResolvedValue(null);

        const response = await POST(request({ days: 90, siteIds: [1], actions: { deactivate: true } }));

        expect(response.status).toBe(401);
        expect(actionInactiveUsers).not.toHaveBeenCalled();
    });

    it('requires an admin session', async () => {
        auth.mockResolvedValue({ user: { id: 'user-1', role: 'user' } });

        const response = await POST(request({ days: 90, siteIds: [1], actions: { deactivate: true } }));

        expect(response.status).toBe(401);
        expect(actionInactiveUsers).not.toHaveBeenCalled();
    });

    it('requires site ids before running maintenance actions', async () => {
        auth.mockResolvedValue({ user: { id: 'admin-1', role: 'admin' } });

        const response = await POST(request({ days: 90, actions: { deactivate: true } }));

        expect(response.status).toBe(400);
        expect(actionInactiveUsers).not.toHaveBeenCalled();
    });

    it('passes validated options to inactive-user processing', async () => {
        auth.mockResolvedValue({ user: { id: 'admin-1', role: 'admin' } });

        const response = await POST(request({ days: 120, siteIds: [7], actions: { stop: true, deactivate: true } }));

        expect(response.status).toBe(200);
        expect(actionInactiveUsers).toHaveBeenCalledWith({
            days: 120,
            siteIds: [7],
            actions: { stop: true, deactivate: true, destroy: false },
        });
    });
});

function request(body: unknown) {
    return {
        json: jest.fn().mockResolvedValue(body),
    } as any;
}
