import { User } from '@/generated/client';

const mockRegistrationRequestFindUnique = jest.fn();
const mockRegistrationRequestUpdate = jest.fn();
const mockUserFindUnique = jest.fn();
const mockUserCreate = jest.fn();
const mockDomainCreate = jest.fn();
const mockGetLatestAvailableVersion = jest.fn();

jest.mock('../../prisma', () => ({
    prisma: {
        register_request: {
            findUnique: mockRegistrationRequestFindUnique,
            update: mockRegistrationRequestUpdate,
        },
        user: {
            findUnique: mockUserFindUnique,
            create: mockUserCreate,
        },
        nSDomain: {
            create: mockDomainCreate,
        },
    },
}));

jest.mock('../nsversion', () => ({
    getLatestAvailableVersion: mockGetLatestAvailableVersion,
}));

jest.mock('../sendemail', () => ({
    sendRegistrationNotificationEmail: jest.fn(),
    sendValidationEmail: jest.fn(),
}));

const { approveRegistrationRequest } = require('../registration') as typeof import('../registration');

function user(overrides: Partial<User> = {}): User {
    return {
        id: 'user-id',
        name: 'User',
        username: null,
        email: 'user@example.com',
        emailVerified: null,
        image: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        loginAllowed: 1,
        role: 'user',
        ...overrides,
    };
}

describe('approveRegistrationRequest', () => {
    const request = {
        id: 10,
        owner_email: 'owner@example.com',
        owner_name: 'Owner',
        subdomain: 'example',
        api_secret: 'a-secure-secret',
        title: 'Example Site',
        data_source: 'API',
        dexcom_server: null,
        dexcom_username: null,
        dexcom_password: null,
    };
    const approvingUser = user({ id: 'admin-id', role: 'admin' });
    const owner = user({ id: 'owner-id', email: request.owner_email, name: request.owner_name });

    beforeEach(() => {
        jest.clearAllMocks();
        mockRegistrationRequestFindUnique.mockResolvedValue(request);
        mockGetLatestAvailableVersion.mockResolvedValue({
            name: 'nightscout',
            version: '15.0.10',
            directoryName: 'version-15.0.10',
        });
        mockUserFindUnique.mockResolvedValue(owner);
        mockDomainCreate.mockResolvedValue({});
        mockRegistrationRequestUpdate.mockResolvedValue({});
    });

    it('assigns the highest installed Nightscout version to the approved domain', async () => {
        await approveRegistrationRequest(request.id, approvingUser);

        expect(mockDomainCreate).toHaveBeenCalledWith({
            data: expect.objectContaining({
                domain: request.subdomain,
                nsversion: 'version-15.0.10',
            }),
        });
        expect(mockRegistrationRequestUpdate).toHaveBeenCalledWith({
            where: { id: request.id },
            data: { status: 'approved', chnged_by: approvingUser.id },
        });
    });

    it('does not create user or domain records when no installed version is available', async () => {
        mockGetLatestAvailableVersion.mockRejectedValue(new Error('No installed Nightscout versions are available'));

        await expect(approveRegistrationRequest(request.id, approvingUser)).rejects.toThrow(
            'No installed Nightscout versions are available'
        );

        expect(mockUserFindUnique).not.toHaveBeenCalled();
        expect(mockUserCreate).not.toHaveBeenCalled();
        expect(mockDomainCreate).not.toHaveBeenCalled();
        expect(mockRegistrationRequestUpdate).not.toHaveBeenCalled();
    });
});
