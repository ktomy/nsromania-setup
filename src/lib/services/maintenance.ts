import { NSDomain } from '@/generated/client';
import { prisma } from '../prisma';
import { destroyDomainInfrastructure } from './domainLifecycle';
import { getLastDbEntries, getLastDbEntry } from './nsdatbasea';
import { isDomainRunning, tryStopDomain } from './nsruntime';

export type InactiveUserActions = {
    stop?: boolean;
    deactivate?: boolean;
    destroy?: boolean;
};

export type MaintenanceSiteResult = {
    id: number;
    domain: string;
    title: string;
    created: string;
    lastGlucoseEntry: string | null;
    inactive: boolean;
    status: string;
    result?: 'actioned' | 'skipped' | 'failed';
    error?: string;
};

export type MaintenanceCounts = {
    checked: number;
    inactiveCandidates: number;
    stopped: number;
    deactivated: number;
    destroyed: number;
    skipped: number;
    failed: number;
};

export type InactiveUserPreview = {
    counts: MaintenanceCounts;
    sites: MaintenanceSiteResult[];
};

export type ActionInactiveUsersResult = {
    counts: MaintenanceCounts;
    results: MaintenanceSiteResult[];
};

type InactivityEvaluation = {
    lastGlucoseEntry: Date | null;
    inactive: boolean;
    status: string;
};

const emptyCounts = (): MaintenanceCounts => ({
    checked: 0,
    inactiveCandidates: 0,
    stopped: 0,
    deactivated: 0,
    destroyed: 0,
    skipped: 0,
    failed: 0,
});

function validateDays(days: number) {
    if (!Number.isInteger(days) || days <= 0) {
        throw new Error('Days must be a positive integer');
    }
}

function validateActions(actions: InactiveUserActions) {
    if (!actions.stop && !actions.deactivate && !actions.destroy) {
        throw new Error('At least one action is required');
    }
    if (actions.destroy && !actions.deactivate) {
        throw new Error('Destroy requires deactivate');
    }
}

function cutoffDate(days: number, now: Date) {
    return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function siteResult(domain: NSDomain, evaluation: InactivityEvaluation): MaintenanceSiteResult {
    return {
        id: domain.id,
        domain: domain.domain,
        title: domain.title,
        created: domain.created.toISOString(),
        lastGlucoseEntry: evaluation.lastGlucoseEntry?.toISOString() ?? null,
        inactive: evaluation.inactive,
        status: evaluation.status,
    };
}

async function evaluateInactivity(domain: NSDomain, cutoff: Date): Promise<InactivityEvaluation> {
    const lastGlucoseEntry = await getLastDbEntry(domain.domain);
    return evaluateLastGlucoseEntry(lastGlucoseEntry, cutoff);
}

function evaluateLastGlucoseEntry(lastGlucoseEntry: Date | null, cutoff: Date): InactivityEvaluation {
    if (!lastGlucoseEntry) {
        return {
            lastGlucoseEntry,
            inactive: true,
            status: 'inactive-no-glucose',
        };
    }

    if (lastGlucoseEntry <= cutoff) {
        return {
            lastGlucoseEntry,
            inactive: true,
            status: 'inactive-old-glucose',
        };
    }

    return {
        lastGlucoseEntry,
        inactive: false,
        status: 'active-recent-glucose',
    };
}

export async function getInactiveUserPreview({
    days,
    now = new Date(),
}: {
    days: number;
    now?: Date;
}): Promise<InactiveUserPreview> {
    validateDays(days);
    const cutoff = cutoffDate(days, now);
    const counts = emptyCounts();
    const sites: MaintenanceSiteResult[] = [];

    const domains = await prisma.nSDomain.findMany({
        where: {
            active: 1,
            created: {
                lte: cutoff,
            },
        },
        orderBy: {
            created: 'asc',
        },
    });

    const lastEntries = await getLastDbEntries(domains.map((domain) => domain.domain));

    for (const domain of domains) {
        counts.checked += 1;
        const evaluation = evaluateLastGlucoseEntry(lastEntries.get(domain.domain) ?? null, cutoff);
        if (evaluation.inactive) {
            counts.inactiveCandidates += 1;
        }
        sites.push(siteResult(domain, evaluation));
    }

    return { counts, sites };
}

export async function actionInactiveUsers({
    days,
    siteIds,
    actions,
    now = new Date(),
}: {
    days: number;
    siteIds: number[];
    actions: InactiveUserActions;
    now?: Date;
}): Promise<ActionInactiveUsersResult> {
    validateDays(days);
    validateActions(actions);

    const cutoff = cutoffDate(days, now);
    const counts = emptyCounts();
    const results: MaintenanceSiteResult[] = [];

    for (const siteId of siteIds) {
        counts.checked += 1;
        const domain = await prisma.nSDomain.findUnique({
            where: {
                id: siteId,
            },
        });

        if (!domain || domain.active !== 1 || domain.created > cutoff) {
            counts.skipped += 1;
            results.push({
                id: siteId,
                domain: domain?.domain ?? String(siteId),
                title: domain?.title ?? '',
                created: domain?.created.toISOString() ?? '',
                lastGlucoseEntry: null,
                inactive: false,
                status: 'skipped-not-eligible',
                result: 'skipped',
            });
            continue;
        }

        const evaluation = await evaluateInactivity(domain, cutoff);
        const row = siteResult(domain, evaluation);

        if (!evaluation.inactive) {
            counts.skipped += 1;
            results.push({ ...row, result: 'skipped' });
            continue;
        }

        counts.inactiveCandidates += 1;

        try {
            if (actions.stop && (await isDomainRunning(domain.domain))) {
                await tryStopDomain(domain);
                counts.stopped += 1;
            }

            if (actions.deactivate) {
                await prisma.nSDomain.update({
                    where: { id: domain.id },
                    data: { active: 0 },
                });
                counts.deactivated += 1;
            }

            if (actions.destroy) {
                const lifecycleResult = await destroyDomainInfrastructure(domain);
                if (lifecycleResult.stopped) {
                    counts.stopped += 1;
                }
                counts.destroyed += 1;
            }

            results.push({ ...row, result: 'actioned' });
        } catch (error) {
            counts.failed += 1;
            results.push({
                ...row,
                result: 'failed',
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    return { counts, results };
}
