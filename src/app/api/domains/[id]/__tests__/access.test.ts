/** @jest-environment node */

// Every per-site route must refuse sites of other users before doing anything. These tests use the real
// authorizeDomainAccess and isMyDOmain against a Prisma stand-in that answers like the real query.

import { NextRequest } from 'next/server';

jest.mock('../../../../../auth', () => ({ auth: jest.fn() }));

jest.mock('../../../../../lib/prisma', () => ({
    prisma: {
        nSDomain: { findFirst: jest.fn() },
        $disconnect: jest.fn(),
    },
}));

jest.mock('../../../../../lib/services/nsruntime', () => ({
    getDomainProcessStatus: jest.fn(),
    tryStartDomain: jest.fn(),
    tryRecreateDomain: jest.fn(),
    tryStopDomain: jest.fn(),
    isDomainRunning: jest.fn(),
    saveProcessListIfHealthy: jest.fn(),
    getProcessesList: jest.fn(),
}));

jest.mock('../../../../../lib/services/domainLifecycle', () => ({
    destroyDomainInfrastructure: jest.fn(),
    initializeDomainInfrastructure: jest.fn(),
    DomainInitializationError: class DomainInitializationError extends Error {
        constructor(
            message: string,
            readonly status: number
        ) {
            super(message);
        }
    },
}));

jest.mock('../../../../../lib/services/domains', () => ({
    ...jest.requireActual('../../../../../lib/services/domains'),
    deleteNSDomainAndRelated: jest.fn(),
    updateNSDomain: jest.fn(),
    getFullDOmainData: jest.fn(),
}));

import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { deleteNSDomainAndRelated, getFullDOmainData, updateNSDomain } from '@/lib/services/domains';
import { destroyDomainInfrastructure, initializeDomainInfrastructure } from '@/lib/services/domainLifecycle';
import {
    getDomainProcessStatus,
    isDomainRunning,
    saveProcessListIfHealthy,
    tryStartDomain,
    tryStopDomain,
} from '@/lib/services/nsruntime';
import { POST as startPost } from '../start/route';
import { POST as stopPost } from '../stop/route';
import { POST as destroyPost } from '../destroy/route';
import { POST as deletePost } from '../delete/route';
import { POST as initializePost } from '../initialize/route';
import { GET as domainGet, PUT as domainPut } from '../route';

const OWNER = { id: 'owner-1', role: 'user', email: 'owner@example.com' };
const OTHER = { id: 'other-2', role: 'user', email: 'other@example.com' };
const ADMIN = { id: 'admin-3', role: 'admin', email: 'admin@example.com' };

let site: Record<string, unknown>;

function signIn(user: object | null) {
    (auth as jest.Mock).mockResolvedValue(user ? { user } : null);
}

function request(path: string, method: string, body?: unknown) {
    return new NextRequest(`http://localhost/api/domains/${path}`, {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

type Route = (req: NextRequest, props: { params: Promise<{ id: string }> }) => Promise<Response>;

// [name, handler, method, active state the action requires, side effects that must not happen for other users]
const ROUTES: Array<[string, Route, string, number, () => jest.Mock[]]> = [
    ['start', startPost, 'POST', 1, () => [tryStartDomain as jest.Mock, getDomainProcessStatus as jest.Mock]],
    ['stop', stopPost, 'POST', 1, () => [tryStopDomain as jest.Mock, isDomainRunning as jest.Mock]],
    ['destroy', destroyPost, 'POST', 0, () => [destroyDomainInfrastructure as jest.Mock]],
    ['delete', deletePost, 'POST', 0, () => [deleteNSDomainAndRelated as jest.Mock]],
    ['initialize', initializePost, 'POST', 1, () => [initializeDomainInfrastructure as jest.Mock]],
    ['GET', domainGet as unknown as Route, 'GET', 1, () => [getFullDOmainData as jest.Mock]],
    ['PUT', domainPut as unknown as Route, 'PUT', 1, () => [updateNSDomain as jest.Mock]],
];

describe('per-site API authorization', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.spyOn(console, 'log').mockImplementation(() => {});
        site = { id: 7, domain: 'demo', active: 1, dbExists: 1, authUserId: OWNER.id, server: null, environments: [] };
        // Like Prisma: a condition whose value is undefined is left out of the query
        (prisma.nSDomain.findFirst as jest.Mock).mockImplementation(
            async ({ where }: { where: { id?: number; authUserId?: string } }) =>
                where.id === site.id && (where.authUserId === undefined || where.authUserId === site.authUserId)
                    ? site
                    : null
        );
    });

    describe.each(ROUTES)('%s', (name, handler, method, active, sideEffects) => {
        const body = method === 'PUT' ? { title: 'changed' } : undefined;
        const path = method === 'GET' || method === 'PUT' ? '7' : `7/${name}`;

        beforeEach(() => {
            site.active = active;
        });

        it('requires a signed-in user', async () => {
            signIn(null);
            const response = await handler(request(path, method, body), params('7'));
            expect(response.status).toBe(401);
            sideEffects().forEach((effect) => expect(effect).not.toHaveBeenCalled());
        });

        it("refuses another user's site without touching it", async () => {
            signIn(OTHER);
            const response = await handler(request(path, method, body), params('7'));
            expect(response.status).toBe(404);
            sideEffects().forEach((effect) => expect(effect).not.toHaveBeenCalled());
        });

        it('refuses a session without a user id', async () => {
            signIn({ ...OTHER, id: '' });
            const response = await handler(request(path, method, body), params('7'));
            expect(response.status).toBe(404);
            sideEffects().forEach((effect) => expect(effect).not.toHaveBeenCalled());
        });

        it.each(['abc', '7abc', '0', '-7', '99999999999'])('treats the id %s as not found', async (id) => {
            signIn(ADMIN);
            const response = await handler(request(path, method, body), params(id));
            expect(response.status).toBe(404);
            sideEffects().forEach((effect) => expect(effect).not.toHaveBeenCalled());
        });
    });

    it.each([
        ['owner', OWNER],
        ['admin', ADMIN],
    ])('lets the %s start and stop the site', async (_, user) => {
        signIn(user);
        (getDomainProcessStatus as jest.Mock).mockResolvedValue(null);
        (tryStartDomain as jest.Mock).mockResolvedValue('ok');
        (isDomainRunning as jest.Mock).mockResolvedValue(true);
        (tryStopDomain as jest.Mock).mockResolvedValue('ok');
        (saveProcessListIfHealthy as jest.Mock).mockResolvedValue(true);

        expect((await startPost(request('7/start', 'POST'), params('7'))).status).toBe(200);
        expect(tryStartDomain).toHaveBeenCalledWith(expect.objectContaining({ id: 7, domain: 'demo' }));
        expect((await stopPost(request('7/stop', 'POST'), params('7'))).status).toBe(200);
        expect(tryStopDomain).toHaveBeenCalledWith(expect.objectContaining({ id: 7, domain: 'demo' }));
    });

    describe('initialize', () => {
        beforeEach(() => {
            (initializeDomainInfrastructure as jest.Mock).mockResolvedValue({ server: 'd1' });
        });

        it('lets the owner initialize on the stored server but not choose one', async () => {
            signIn(OWNER);
            expect((await initializePost(request('7/initialize', 'POST', { server: 'd1' }), params('7'))).status).toBe(
                403
            );
            expect(initializeDomainInfrastructure).not.toHaveBeenCalled();

            expect((await initializePost(request('7/initialize', 'POST'), params('7'))).status).toBe(200);
            expect(initializeDomainInfrastructure).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), {
                server: undefined,
            });
        });

        it("passes the admin's server choice", async () => {
            signIn(ADMIN);
            const response = await initializePost(request('7/initialize', 'POST', { server: 'd1' }), params('7'));
            expect(response.status).toBe(200);
            await expect(response.json()).resolves.toEqual({ status: 'ok', server: 'd1' });
            expect(initializeDomainInfrastructure).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), {
                server: 'd1',
            });
        });

        it.each([['not json'], [JSON.stringify({ server: 5 })], [JSON.stringify(['d1'])]])(
            'rejects the body %s',
            async (raw) => {
                signIn(ADMIN);
                const response = await initializePost(
                    new NextRequest('http://localhost/api/domains/7/initialize', { method: 'POST', body: raw }),
                    params('7')
                );
                expect(response.status).toBe(400);
                expect(initializeDomainInfrastructure).not.toHaveBeenCalled();
            }
        );
    });
});
