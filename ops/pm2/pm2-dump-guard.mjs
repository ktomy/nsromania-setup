#!/usr/local/nvm/versions/node/v22.12.0/bin/node
// Runs as ExecStartPre of pm2-root.service, before `pm2 resurrect`.
//
// PM2 rewrites dump.pm2 when its daemon receives a signal. If that happens while
// apps are down (e.g. systemd killing an unfinished resurrect), the saved list marks
// every site as stopped and the next resurrect brings nothing back. This guard:
//   - snapshots a healthy dump.pm2 into the backup directory, and
//   - replaces a degraded dump.pm2 with the newest healthy candidate
//     (dump.pm2.bak first, then snapshots), keeping the rejected file.
// It never blocks PM2 from starting: every outcome exits 0.

import { copyFileSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DUMP = process.env.PM2_DUMP_GUARD_DUMP || '/root/.pm2/dump.pm2';
const SNAPSHOT_DIR = process.env.PM2_DUMP_GUARD_SNAPSHOT_DIR || '/var/log/nightscout/backup/pm2-dumps';
const MIN_ONLINE_RATIO = 0.5;

const log = (message) => console.log(`pm2-dump-guard: ${message}`);

function inspect(file) {
    let raw;
    try {
        raw = readFileSync(file);
    } catch (error) {
        return { file, raw: null, healthy: false, summary: error.code || error.message };
    }
    try {
        const list = JSON.parse(raw.toString('utf8'));
        if (!Array.isArray(list) || list.length === 0) {
            return { file, raw, healthy: false, summary: 'empty or not a list' };
        }
        const online = list.filter((proc) => (proc.pm2_env || proc).status === 'online').length;
        return {
            file,
            raw,
            healthy: online / list.length >= MIN_ONLINE_RATIO,
            summary: `${online}/${list.length} online`,
        };
    } catch (error) {
        return { file, raw, healthy: false, summary: error.message };
    }
}

function timestamp() {
    return new Date()
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d+Z$/, 'Z');
}

function snapshots() {
    try {
        return readdirSync(SNAPSHOT_DIR)
            .filter((name) => /^dump-\d{8}T\d{6}Z\.pm2$/.test(name))
            .sort()
            .reverse()
            .map((name) => join(SNAPSHOT_DIR, name));
    } catch {
        return [];
    }
}

function main() {
    mkdirSync(SNAPSHOT_DIR, { recursive: true, mode: 0o700 });
    const current = inspect(DUMP);

    if (current.healthy) {
        const [latest] = snapshots();
        const latestRaw = latest ? inspect(latest).raw : null;
        if (!latestRaw || !latestRaw.equals(current.raw)) {
            const target = join(SNAPSHOT_DIR, `dump-${timestamp()}.pm2`);
            copyFileSync(DUMP, target);
            log(`${DUMP} healthy (${current.summary}); snapshot ${target}`);
        } else {
            log(`${DUMP} healthy (${current.summary}); matches latest snapshot`);
        }
        return;
    }

    log(`${DUMP} degraded (${current.summary}); looking for a healthy replacement`);
    const replacement = [`${DUMP}.bak`, ...snapshots()].map(inspect).find((candidate) => candidate.healthy);
    if (!replacement) {
        log('no healthy replacement found; leaving dump unchanged');
        return;
    }

    if (current.raw) {
        const rejected = join(SNAPSHOT_DIR, `rejected-${timestamp()}-${process.pid}.pm2`);
        copyFileSync(DUMP, rejected);
        log(`kept degraded dump as ${rejected}`);
    }
    const temporary = `${DUMP}.guard-tmp`;
    writeFileSync(temporary, replacement.raw, { mode: 0o600 });
    renameSync(temporary, DUMP);
    log(`restored ${DUMP} from ${replacement.file} (${replacement.summary})`);
}

try {
    main();
} catch (error) {
    log(`error: ${error.message}; leaving dump unchanged`);
}
