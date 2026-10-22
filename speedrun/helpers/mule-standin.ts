// mule-standin (role): a throwaway stand-in for the scored side against the trade giver (mule.ts in
// `request` mode), to prove the giver's run-day packages at full load on the demo. Never run it on
// the scored account.
//
// For each ledger row in `rows`, in order, the stand-in runs the scored side's own hand-off
// (runner/handoff.ts runHandOff on the row's plan from the manifest) against the mule:
//   1. The row's plan, with its equip lines emptied (the stand-in never equips, eats, drinks, casts
//      or banks) and each give line kept only when the stand-in holds it from mule surplus: a line it
//      does not hold, or holds as its own, is recorded as not exercised.
//   2. handOffPre (the step's precondition: partner in view, gives held, free slots) must pass.
//   3. The stand-in asks for the package by a cue scoped to the row's hand-off id (mule.ts
//      requestPackage, the run's channel), and waits for the mule's standing trade request: the
//      package is staged, as on run day when SCORED arrives.
//   4. runHandOff, its report kept (ticks on this account's clock from its first trade click).
//   5. Everything the trade brought is handed straight back to the mule in one trade (lib/trade.ts
//      give, by obj id and count); with no package pending the mule takes any offer and banks it. A
//      give-back that does not land stops the session: nothing more is taken from the mule.
// A row's seed package, asked for just before the row, brings the mule surplus its give lines need
// (H12's staff of fire, knife, coins ...): just before, because an earlier row's package may need the
// same stock (H7's antipoison(3)). It goes back to the mule in the row's swap; whatever is left at
// the end goes back in a last trade. The stand-in finishes holding exactly what it started with, by id, or says what
// differs.
//
// Prints `RESULT mule-standin {...}` and writes it to `resultFile` when set.
//
// Role options: partner (the mule's account), cueDir (the mule's), rows (ledger row ids, in order),
//   manifest (default STEP-MANIFEST.md), seeds { <row>: { step, items: [{ item | id, amount }] } }
//   (each seed package's scope step in the mule's config), stageWaitMs (default 180000: the mule banks and
//   withdraws between packages), resultFile, settleMs (default 45000: the wait before returning, so
//   the mule banks the last give-back before a launcher stops it).
import { readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import type { BotWorldState, InventoryItem } from '../../sdk/types';
import { TRADE_REQUEST_CHAT_TYPE } from '../../sdk/types';
import { INVENTORY_SIZE } from '../lib/items';
import { give, receiveFrom, sameName, type GiveResult, type WantSpec } from '../lib/trade';
import { nextTick, waitTicks } from '../lib/wait';
import { handOffFrom, handOffPre, matches, runHandOff, type HandOffPlan, type HandOffReport } from '../runner/handoff';
import { MANIFEST } from '../tools/slot-ledger';
import { ChatCursor, countById, requestPackage } from './mule';
import { runStandalone, type Role, type RoleContext } from './role';

const ROOT = resolve(import.meta.dir, '..', '..');

export type Counts = Map<number, number>;

/** What `after` holds beyond `before`, by obj id. */
export function gained(before: Counts, after: Counts): { id: number; n: number }[] {
    return [...after].filter(([id, n]) => n > (before.get(id) ?? 0)).map(([id, n]) => ({ id, n: n - (before.get(id) ?? 0) }));
}

/** How `now` differs from `want`, by obj id; empty when equal. */
export function countsDiffer(want: Counts, now: Counts): string[] {
    const ids = new Set([...want.keys(), ...now.keys()]);
    return [...ids].filter(id => (want.get(id) ?? 0) !== (now.get(id) ?? 0)).map(id => `obj ${id}: ${want.get(id) ?? 0} -> ${now.get(id) ?? 0}`);
}

/**
 * The plan the stand-in can run: no equip changes, and only the give lines it holds from mule
 * surplus (not its own items, not worn). Every line left out is named.
 */
export function standInPlan(plan: HandOffPlan, s: BotWorldState, own: Counts): { plan: HandOffPlan; notExercised: string[] } {
    const notExercised = [...plan.wield.map(w => `+${w.name} (equip; the stand-in never equips)`), ...plan.unwield.map(w => `-${w.name} (equip)`)];
    const give = plan.give.filter(g => {
        const held = s.inventory.filter(i => matches(g, i));
        if (s.equipment.some(e => matches(g, e))) notExercised.push(`gives ${g.name}: worn by the stand-in`);
        else if (!held.length) notExercised.push(`gives ${g.name}: not held (no surplus seeded)`);
        else if (held.some(i => own.has(i.id))) notExercised.push(`gives ${g.name}: the stand-in's own, not the mule's`);
        else return true;
        return false;
    });
    return { plan: { ...plan, give, wield: [], unwield: [] }, notExercised };
}

export interface RowResult {
    row: string;
    outcome: 'pass' | 'refused' | 'not staged' | 'failed' | 'give-back failed';
    reason?: string;
    trade?: HandOffReport['trade'];
    /** The stand-in's clock: its first trade click to the outcome (runHandOff). */
    ticks?: number;
    /** swap() only: its first trade click to the screens opening. */
    openTicks?: number;
    /** Ticks from the cue to the mule's standing request (the mule's bank and withdraw). */
    stageTicks?: number;
    /** The row's seed: mule surplus for its give lines, received just before. */
    seed?: { ok: boolean; ticks: number | null; received: string[]; reason: string | null };
    received?: string[];
    gave?: string[];
    notExercised: string[];
    freeBefore: number;
    freeAfter?: number;
    giveBack?: { ok: boolean; ticks: number; gave: string[]; reason?: string };
}

const label = (items: readonly { name: string; count: number }[]) => items.map(i => `${i.name} x${i.count}`);
const free = (inv: readonly InventoryItem[]) => INVENTORY_SIZE - inv.length;

async function waitForStaged(ctx: RoleContext, partner: string, cursor: ChatCursor, ms: number): Promise<number | null> {
    const start = ctx.sdk.getState()?.tick ?? 0;
    const deadline = Date.now() + ms;
    while (Date.now() < deadline && !ctx.signal.aborted) {
        const s = await nextTick(ctx.sdk);
        if (cursor.next().some(m => sameName(m.sender, partner))) return s.tick - start;
    }
    return null;
}

/** Hand `items` to the partner; a trade that never opened is retried, one that moved anything is final. */
async function giveBack(ctx: RoleContext, partner: string, items: readonly { id: number; n: number }[]): Promise<GiveResult> {
    let last: GiveResult | undefined;
    for (let tries = 0; tries < 4 && !ctx.signal.aborted; tries++) {
        last = await give(ctx.sdk, partner, items.map(i => ({ item: i.id, n: i.n })), { openMaxTicks: 200 });
        ctx.log('give back', { ok: last.ok, reason: last.reason ?? null, gave: label(last.gave), ticks: last.ticks, tries: tries + 1 });
        if (last.ok || last.gave.length) return last;
        await waitTicks(ctx.sdk, 5);
    }
    return last ?? { ok: false, ticks: 0, gave: [], sent: 0, reason: 'aborted' };
}

function wantOf(items: readonly { item?: string; id?: number; amount: number }[]): WantSpec[] {
    return items.map(i => ({ item: i.id ?? new RegExp(`^${i.item!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), amount: i.amount }));
}

async function session(ctx: RoleContext): Promise<void> {
    const { sdk } = ctx;
    const o = ctx.options;
    const partner = String(o.partner ?? '');
    const cueDir = String(o.cueDir ?? '');
    const rows = (o.rows ?? []) as string[];
    if (!partner || !cueDir || !rows.length) throw new Error('mule-standin: options.partner, options.cueDir and options.rows are required');
    const manifestPath = typeof o.manifest === 'string' ? (isAbsolute(o.manifest) ? o.manifest : join(ROOT, o.manifest)) : MANIFEST;
    const manifest = readFileSync(manifestPath, 'utf8');
    const stageWaitMs = Number(o.stageWaitMs ?? 180_000);
    const seeds = (o.seeds ?? {}) as Record<string, { step: string; items: { item?: string; id?: number; amount: number }[] }>;
    const plans = rows.map(id => handOffFrom(manifest, id));

    const cursor = new ChatCursor(sdk, [TRADE_REQUEST_CHAT_TYPE]);
    const inv = () => sdk.getInventory();
    const own = countById(inv());
    const out: { account: string; partner: string; start: { tick: number | null; inventory: string[]; equipment: string[] }; rows: RowResult[]; end?: unknown } = {
        account: ctx.account,
        partner,
        start: { tick: sdk.getState()?.tick ?? null, inventory: label(inv()), equipment: label(sdk.getState()?.equipment ?? []) },
        rows: [],
    };
    ctx.log('stand-in start', out.start);
    const ask = (handOff: string) => {
        cursor.next();
        requestPackage(cueDir, ctx.account, handOff, { tick: sdk.getState()?.tick ?? 0, ms: Date.now() });
    };

    let stopped = false;
    for (const [k, plan0] of plans.entries()) {
        if (stopped || ctx.signal.aborted) break;
        const id = rows[k]!;
        const seed = seeds[id];
        let seeded: RowResult['seed'];
        if (seed) {
            ask(seed.step);
            const staged = await waitForStaged(ctx, partner, cursor, stageWaitMs);
            const r = staged === null ? null : await receiveFrom(sdk, partner, { want: wantOf(seed.items), openMaxTicks: 30, maxTicks: 40 });
            seeded = { ok: r?.ok ?? false, ticks: r?.ticks ?? null, received: r ? label(r.received) : [], reason: r?.reason ?? (staged === null ? 'not staged' : null) };
            ctx.log('seed', { row: id, ...seeded });
        }
        const s0 = sdk.getState()!;
        const { plan, notExercised } = standInPlan(plan0, s0, own);
        const res: RowResult = { row: id, outcome: 'pass', notExercised, freeBefore: free(s0.inventory), ...(seeded ? { seed: seeded } : {}) };
        out.rows.push(res);
        const pre = handOffPre(s0, plan, partner);
        if (pre !== true) {
            Object.assign(res, { outcome: 'refused', reason: pre });
            ctx.log('row refused', { row: id, reason: pre });
            continue;
        }
        const before = countById(inv());
        ask(id);
        const staged = await waitForStaged(ctx, partner, cursor, stageWaitMs);
        if (staged === null) {
            Object.assign(res, { outcome: 'not staged', reason: `no standing request from ${partner} within ${stageWaitMs / 1000} s (package short?)` });
            ctx.log('row not staged', { row: id });
            continue;
        }
        res.stageTicks = staged;
        let report: HandOffReport | undefined;
        try {
            await runHandOff(sdk, plan, partner, { onReport: r => (report = r) });
        } catch (e) {
            Object.assign(res, { outcome: 'failed', reason: e instanceof Error ? e.message : String(e) });
        }
        if (report) Object.assign(res, { trade: report.trade, ticks: report.ticks, ...(report.openTicks !== undefined ? { openTicks: report.openTicks } : {}), received: report.received, gave: report.gave });
        res.freeAfter = free(inv());
        const back = gained(before, countById(inv()));
        if (back.length) {
            const gb = await giveBack(ctx, partner, back);
            res.giveBack = { ok: gb.ok, ticks: gb.ticks, gave: label(gb.gave), ...(gb.reason ? { reason: gb.reason } : {}) };
            const left = gained(before, countById(inv()));
            if (!gb.ok || left.length) {
                Object.assign(res, { outcome: 'give-back failed', reason: gb.reason ?? `still held: ${left.map(l => `obj ${l.id} x${l.n}`).join(', ')}` });
                stopped = true;
            }
        }
        ctx.log('row', res as unknown as Record<string, unknown>);
    }

    // Whatever of the mule's is still held (seed surplus no row took) goes back in one last trade.
    const rest = gained(own, countById(inv()));
    const last = rest.length ? await giveBack(ctx, partner, rest) : null;
    const diff = countsDiffer(own, countById(inv()));
    out.end = { tick: sdk.getState()?.tick ?? null, returned: last ? { ok: last.ok, gave: label(last.gave), reason: last.reason ?? null } : null, inventory: label(inv()), sameAsStart: diff.length === 0, diff, stopped };
    ctx.log('stand-in end', out.end as Record<string, unknown>);
    const text = JSON.stringify(out);
    console.log(`RESULT mule-standin ${text}`);
    if (typeof o.resultFile === 'string') writeFileSync(o.resultFile, `${JSON.stringify(out, null, 2)}\n`);
    // As a launcher's `final` role its return stops the mule too: leave it time to bank the last give-back.
    const settleMs = Number(o.settleMs ?? 45_000);
    const until = Date.now() + settleMs;
    while (Date.now() < until && !ctx.signal.aborted) await nextTick(sdk);
}

export const role: Role = {
    name: 'mule-standin',
    produces: [],
    // Never throws: a launcher restarts a role that throws, and a restarted stand-in would ask the
    // mule for every package again. It logs the error and returns, which ends the session.
    async run(ctx) {
        try {
            await session(ctx);
        } catch (e) {
            ctx.log('stand-in error: stopping', { error: e instanceof Error ? e.message : String(e), inventory: label(ctx.sdk.getInventory()) });
            console.log(`RESULT mule-standin ${JSON.stringify({ account: ctx.account, error: String(e), inventory: label(ctx.sdk.getInventory()) })}`);
        }
    },
};

if (import.meta.main) await runStandalone(role);
