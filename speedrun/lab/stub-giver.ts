#!/usr/bin/env bun
// lab/stub-giver.ts: one generic lab giver for the hand-offs run.ts places (runner/chain.ts
// PLACEMENT), so SCORED's own trade code (runner/handoff.ts, lib/trade.ts) is what a dress rehearsal
// tests. A lab account speaking the real protocol: for each row of its plan, in order, it stages the
// row's `in` with ::give, teleports to the meeting tile, waits for SCORED to come into view, keeps a
// standing trade request, and trades: it gives the row's `in` and takes the row's `out` (lib/trade.ts
// swap(), either direction). The ledger row is the data, read through slot-ledger.ts's parser.
//
//   LOCAL_STAFF_LEVEL=4 bun speedrun/lab/stub-giver.ts --bot=<lab env name> --scored=<lab account> --plan=<plan.json>
//
// plan.json is lab/dress-rehearsal.ts's `stubPlanFile`: [{ row, tile: {x, z, level?} }] in run
// order, and `objs`, overrides from a ledger NAME to its ::give debug name where obj.pack has no
// spelling of the name. A top-up row (`x to N`) is offered in full: the giver cannot see what SCORED
// holds. Lab only (stand-ins.ts labRefusal).
//
// Prints `RESULT stub-giver {...}`: per row, ok, the trade's ticks, and what moved.

import { readFileSync } from 'fs';
import type { BotWorldState } from '../../sdk/types';
import { debugNameFor } from '../lib/ledger-objs';
import { objPack } from '../lib/obj-pack';
import { sameName, swap, type GiveSpec, type WantSpec } from '../lib/trade';
import { openSession } from '../lib/session';
import { waitUntil } from '../lib/wait';
import { h4mLoadRows, parseFallbacks } from '../helpers/mule-ledger';
import { H4M_ROW } from '../runner/chain';
import { handOffFrom, planHandOff, type HandOffPlan } from '../runner/handoff';
import { MANIFEST } from '../tools/slot-ledger';
import { clearInventory, give, leaveTutorial, mustTele } from './setup';
import { labRefusal } from './stand-ins';

export interface StubRow {
    row: string;
    tile: { x: number; z: number; level?: number };
}

export interface StubPlanFile {
    rows: StubRow[];
    /** Ledger NAME -> ::give debug name, where obj.pack has no spelling of it. */
    objs?: Record<string, string>;
}


export interface StagedRow {
    row: string;
    tile: StubRow['tile'];
    /** What the giver stages and offers (SCORED's `in`). */
    stage: { obj: string; n: number }[];
    offer: GiveSpec[];
    /** What it takes back (SCORED's `out`). */
    want: WantSpec[];
}

/** The plan's rows as the giver stages them; every ledger name it cannot ::give is listed, none skipped. */
/**
 * A row's hand-off plan. H4m's loads (H4m.1..H4m.N) have no row of their own: they share the one
 * `H4m.1-H4m.N` row of the fallback table, as the chain reads it (runner/chain.ts h4mPlan).
 */
export function stubPlanOf(manifest: string, row: string): HandOffPlan {
    if (h4mLoadRows(manifest).includes(row)) return planHandOff(parseFallbacks(manifest).find(r => r.row.startsWith(`${H4M_ROW}.`))!);
    return handOffFrom(manifest, row);
}

export function stageRows(manifest: string, plan: StubPlanFile): { rows: StagedRow[]; unresolved: string[] } {
    const unresolved: string[] = [];
    const rows = plan.rows.map(r => {
        const p: HandOffPlan = stubPlanOf(manifest, r.row);
        const stage = p.receive.flatMap(x => {
            let obj = debugNameFor(x.name, x.ids?.[0], plan.objs);
            // A noted [n] entry named without an id resolves to the unnoted obj: give its note (as boundary.ts stages the pack).
            if (obj && x.kind === 'n' && !obj.startsWith('cert_')) obj = objPack().ids.has(`cert_${obj}`) ? `cert_${obj}` : null;
            if (!obj) {
                unresolved.push(`${r.row}: ${x.name}`);
                return [];
            }
            return [{ obj, n: x.count }];
        });
        const offer: GiveSpec[] = p.receive.map(x => ({ item: x.ids ? x.ids[0]! : x.pattern, n: x.count }));
        const want: WantSpec[] = p.give.map(g => ({ item: g.ids ? g.ids[0]! : g.pattern, ...(typeof g.count === 'number' ? { amount: g.count } : {}) }));
        return { row: r.row, tile: r.tile, stage, offer, want };
    });
    return { rows, unresolved };
}

export interface StubResult {
    row: string;
    ok: boolean;
    ticks: number;
    gave: string[];
    received: string[];
    reason?: string;
}

type StubSdk = Parameters<typeof swap>[0] & Parameters<typeof clearInventory>[0];

const inView = (scored: string) => (s: BotWorldState) => s.nearbyPlayers.some(p => sameName(p.name, scored));

/** Serve each row in order. `arriveTicks`: how long to wait for SCORED on the tile (observed ticks). */
export async function serveRows(sdk: StubSdk, scored: string, rows: readonly StagedRow[], o: { arriveTicks?: number; log?: (r: StubResult) => void } = {}): Promise<StubResult[]> {
    const out: StubResult[] = [];
    for (const r of rows) {
        await clearInventory(sdk);
        for (const st of r.stage) await give(sdk, st.obj, st.n);
        await mustTele(sdk, r.tile.x, r.tile.z, r.tile.level ?? 0);
        const seen = await waitUntil(sdk, inView(scored), { maxTicks: o.arriveTicks ?? 20_000 });
        let res: StubResult;
        if (!seen.ok) res = { row: r.row, ok: false, ticks: 0, gave: [], received: [], reason: `${scored} never came into view` };
        else {
            const t = await swap(sdk, scored, r.offer, r.want, { openTicks: 300, maxTicks: 60, closeModals: true });
            res = { row: r.row, ok: t.ok, ticks: t.ticks, gave: t.gave.map(i => `${i.name} x${i.count}`), received: t.received.map(i => `${i.name} x${i.count}`), ...(t.reason ? { reason: t.reason } : {}) };
        }
        out.push(res);
        o.log?.(res);
        if (!res.ok) break;
    }
    return out;
}

async function main(argv: string[]): Promise<number> {
    const arg = (k: string) => argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
    const bot = arg('bot');
    const scored = arg('scored');
    const planPath = arg('plan');
    if (!bot || !scored || !planPath) {
        console.error('usage: LOCAL_STAFF_LEVEL=4 bun speedrun/lab/stub-giver.ts --bot=<lab env name> --scored=<lab account> --plan=<plan.json>');
        return 2;
    }
    const plan = JSON.parse(readFileSync(planPath, 'utf8')) as StubPlanFile;
    const { rows, unresolved } = stageRows(readFileSync(MANIFEST, 'utf8'), plan);
    if (unresolved.length) {
        console.error(`[stub-giver] no ::give name for ${unresolved.join('; ')}: add them to the plan's objs`);
        return 3;
    }
    const session = await openSession(bot, { client: 'lite', launch: true });
    const why = labRefusal({ staffLevel: process.env.LOCAL_STAFF_LEVEL, server: session.env.SERVER ?? 'localhost', gateway: (session.sdk as unknown as { config?: { gatewayUrl?: string } }).config?.gatewayUrl ?? '' });
    if (why) {
        console.error(`[stub-giver] REFUSED: ${why}`);
        return 3;
    }
    // A fresh lab account lands on Tutorial Island, where a staff teleport is refused.
    await leaveTutorial(session);
    const results = await serveRows(session.sdk as unknown as StubSdk, scored, rows, { log: r => console.log(`[stub-giver] ${JSON.stringify(r)}`) });
    console.log(`RESULT stub-giver ${JSON.stringify({ rows: results.length, ok: results.filter(r => r.ok).length, results })}`);
    return results.length === rows.length && results.every(r => r.ok) ? 0 : 1;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
