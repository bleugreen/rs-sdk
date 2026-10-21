// Shared plumbing for the lab measurement scripts.

import type { Session } from '../lib/session';
import { measure, newRunId, TickLog } from '../lib/ticks';
import { nextTick } from '../lib/wait';

export function arg(name: string, fallback: string): string {
    const hit = process.argv.find(a => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
}

export function botArg(): string {
    const bot = process.argv.slice(2).find(a => !a.startsWith('-'));
    if (!bot) throw new Error('usage: bun <script> <bot> [--n=3]');
    return bot;
}

export function labLog(name: string): TickLog {
    return TickLog.open(`lab-${name}-${newRunId()}`);
}

export function result(name: string, data: unknown): void {
    console.log(`RESULT ${name} ${JSON.stringify(data)}`);
}

/** Measure `fn` starting on a fresh tick, and print its row. */
export async function sample<T>(log: TickLog, session: Session, step: string, fn: () => Promise<T>, meta?: Record<string, unknown>): Promise<T> {
    await nextTick(session.sdk);
    const out = await measure(log, session, step, fn, meta);
    const row = log.rows[log.rows.length - 1]!;
    result(step, { ticks: row.ticks, ok: row.ok, ...(row.error ? { error: row.error } : {}), ...(meta ?? {}) });
    return out;
}

export function normName(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}
