import { InactiveUserActions } from '@/lib/services/maintenance';

export interface MaintenanceCheckRequest {
    days: number;
}

export interface MaintenanceActionRequest extends MaintenanceCheckRequest {
    siteIds: number[];
    actions: InactiveUserActions;
}

export async function parseMaintenanceCheckRequest(req: Request): Promise<MaintenanceCheckRequest> {
    const body = await parseJsonBody(req);
    const days = parseDays(body.days);

    return { days };
}

export async function parseMaintenanceActionRequest(req: Request): Promise<MaintenanceActionRequest> {
    const body = await parseJsonBody(req);
    const days = parseDays(body.days);
    const siteIds = body.siteIds;
    const actions = body.actions;

    if (!Array.isArray(siteIds) || !siteIds.every((siteId) => Number.isInteger(siteId))) {
        throw new Error('siteIds must be an array of integers');
    }

    if (actions == null || typeof actions !== 'object' || Array.isArray(actions)) {
        throw new Error('actions must be an object');
    }

    const actionFlags = actions as Record<string, unknown>;
    const parsedActions: InactiveUserActions = {
        stop: actionFlags.stop === true,
        deactivate: actionFlags.deactivate === true,
        destroy: actionFlags.destroy === true,
    };

    if (!parsedActions.stop && !parsedActions.deactivate && !parsedActions.destroy) {
        throw new Error('At least one action is required');
    }

    if (parsedActions.destroy && !parsedActions.deactivate) {
        throw new Error('Destroy requires deactivate');
    }

    return { days, siteIds, actions: parsedActions };
}

function parseDays(days: unknown) {
    if (!Number.isInteger(days) || (days as number) < 1 || (days as number) > 3650) {
        throw new Error('days must be an integer between 1 and 3650');
    }

    return days as number;
}

async function parseJsonBody(req: Request) {
    try {
        const body = (await req.json()) as unknown;
        if (body == null || typeof body !== 'object' || Array.isArray(body)) {
            throw new Error('Request body must be an object');
        }

        return body as Record<string, unknown>;
    } catch (error) {
        if (error instanceof Error && error.message === 'Request body must be an object') {
            throw error;
        }

        throw new Error('Invalid JSON body');
    }
}
