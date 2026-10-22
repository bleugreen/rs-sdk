// handoff-demo (role): STEP-MANIFEST.md entry 33's demo acceptance (H1 at S01) on a throwaway, under the
// run-machine launcher (standalone.ts), so its client drives through the launcher's loopback SDK gateway.
// A test double for the scored side; never run it on the scored account.
//
// The account must be fresh (its first login): S00's tutorialSkip lands it on S01's tile (Lumbridge,
// 3222,3222), where the giver (kits.ts on cairn_mule2, staged first by speedrun/lab/h1-demo.ts) already
// stands with the row's `in`, and the hand-off step (runner/handoff.ts) runs at once: the two steps
// chained as run.ts chains them. After the verdict it hands everything the row brought back to the giver
// in a second, untimed trade (lib/trade.ts give(); the kits role takes returns), prints one RESULT line
// and returns (the launcher entry is `final`, so the launcher then logs it out).
//
// Ticks are observed ticks on this account's clock: the step's TickLog row (its start to its
// postcondition) and the trade's own count (receiveFrom: the first trade click to the items held).
//
// Role options: ledger (a file holding the inventory-ledger row, absolute or relative to the checkout),
//   row (default H1), partner (the giver's account), giveBack (default true), giveBackMs (default 300000:
//   the giver banks between the trades, so it may be away from the tile for a minute or two).

import { readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import type { BotWorldState } from '../../sdk/types';
import { TickLog } from '../lib/ticks';
import { give, sameName, type GiveResult } from '../lib/trade';
import { nextTick, waitTicks } from '../lib/wait';
import { onTutorialIsland } from '../lib/world';
import { handOffFrom, handOffStep, type HandOffPlan, type HandOffReport } from '../runner/handoff';
import { runSteps } from '../runner/step';
import { tutorialSkip } from '../skills/start';
import { runStandalone, type Role, type RoleContext } from './role';

const ROOT = resolve(import.meta.dir, '..', '..');

/** rs/49's demo hand-off cost (mule.md, burst giver with pre-request, fast receiver): ticks for 1, 10 and 20 stacks. */
export const RS49_DEMO: ReadonlyArray<readonly [stacks: number, ticks: number]> = [
    [1, 6.7],
    [10, 8],
    [20, 10],
];

/**
 * Entry 33's demo bar for a package of `stacks` stacks: rs/49's figure, linear between its measured
 * points (flat outside them), and the pass limit one tick above it.
 */
export function demoBar(stacks: number): { expected: number; limit: number } {
    const pts = RS49_DEMO;
    let expected = pts[0]![1];
    if (stacks >= pts.at(-1)![0]) expected = pts.at(-1)![1];
    else {
        for (let i = 1; i < pts.length; i++) {
            const [x0, y0] = pts[i - 1]!;
            const [x1, y1] = pts[i]!;
            if (stacks <= x1) {
                expected = stacks <= x0 ? y0 : y0 + ((stacks - x0) * (y1 - y0)) / (x1 - x0);
                break;
            }
        }
    }
    expected = Math.round(expected * 100) / 100;
    return { expected, limit: Math.round((expected + 1) * 100) / 100 };
}

/** What the give-back offers: every received entry at the row's count. */
export function giveBackSpecs(plan: HandOffPlan): Array<{ item: RegExp; n: number }> {
    return plan.receive.map(r => ({ item: r.pattern, n: r.count }));
}

interface TraceRow {
    t: number;
    x: number;
    z: number;
    partnerInView: boolean;
    slots: number;
    trade: string | null;
}

function traceRow(s: BotWorldState, partner: string): TraceRow {
    return {
        t: s.tick,
        x: s.player?.worldX ?? -1,
        z: s.player?.worldZ ?? -1,
        partnerInView: s.nearbyPlayers.some(p => sameName(p.name, partner)),
        slots: s.inventory.length,
        trade: s.trade?.isOpen ? (s.trade.screen ?? 'open') : null,
    };
}

/** Hand the row's items back: wait for the giver in view, then give(); retry a trade that never opened. */
async function giveBack(ctx: RoleContext, plan: HandOffPlan, partner: string, budgetMs: number): Promise<{ ok: boolean; tries: number; last?: GiveResult; reason?: string }> {
    const { sdk } = ctx;
    const deadline = Date.now() + budgetMs;
    let tries = 0;
    let last: GiveResult | undefined;
    while (Date.now() < deadline && !ctx.signal.aborted) {
        const s = await nextTick(sdk);
        if (!s.nearbyPlayers.some(p => sameName(p.name, partner))) continue;
        tries++;
        last = await give(sdk, partner, giveBackSpecs(plan), { openTimeoutMs: Math.min(60_000, Math.max(1, deadline - Date.now())) });
        ctx.log('give back', { ok: last.ok, reason: last.reason ?? null, gave: last.gave.map(i => `${i.name} x${i.count}`), ticks: last.ticks, tries });
        // Anything that changed hands settles it, whole or part: a second offer could double-give.
        if (last.ok || last.gave.length) return { ok: last.ok, tries, last };
        await waitTicks(sdk, 5);
    }
    return { ok: false, tries, ...(last ? { last } : {}), reason: ctx.signal.aborted ? 'aborted' : `not given back within ${budgetMs / 1000}s` };
}

async function demo(ctx: RoleContext): Promise<void> {
    const { sdk, bot } = ctx;
    const ledger = String(ctx.options.ledger ?? '');
    const partner = String(ctx.options.partner ?? '');
    if (!ledger || !partner) throw new Error('handoff-demo: options.ledger and options.partner are required');
    const id = String(ctx.options.row ?? 'H1');
    const plan = handOffFrom(readFileSync(isAbsolute(ledger) ? ledger : join(ROOT, ledger), 'utf8'), id);
    const s0 = sdk.getState();
    const fresh = onTutorialIsland(s0?.player);
    ctx.log('demo start', { row: id, partner, fresh, tick: s0?.tick ?? null, at: s0?.player ? [s0.player.worldX, s0.player.worldZ] : null, receive: plan.receive.map(r => `${r.name} x${r.count}`) });

    const trace: TraceRow[] = [];
    const unsubscribe = sdk.onStateUpdate(s => trace.push(traceRow(s, partner)));
    const log = TickLog.memory(`handoff-demo-${ctx.account}`);
    const session = { sdk, bot, name: ctx.account, sessionId: 1 };
    const reports: HandOffReport[] = [];
    const step = handOffStep<Record<string, never>>(plan, { partner, onReport: r => reports.push(r) });
    // S01's real precondition: S00 lands the account on the tile and H1 runs at once. A relaunched
    // account (no longer fresh) gets the hand-off alone, and the RESULT says so.
    const list = fresh ? [tutorialSkip, step] : [step];
    let error: string | undefined;
    try {
        await runSteps(session as never, list, { log, c: {}, shouldStop: () => ctx.signal.aborted, logout: async () => undefined, tickMonitor: false });
    } catch (e) {
        error = e instanceof Error ? e.message : String(e);
    }
    unsubscribe();

    const rowOf = (name: string) => log.rows.filter(r => r.step === name).at(-1);
    const s00 = rowOf(tutorialSkip.name);
    const h = rowOf(step.name);
    const trade = reports[0];
    const landed = s00?.endTick;
    const arrival = landed === undefined ? undefined : trace.find(r => r.t >= landed);
    const bar = demoBar(plan.receive.length);
    const pass = !error && !!h?.ok && !!trade?.ok && fresh && h.ticks <= bar.limit;
    const out = {
        account: ctx.account, row: id, partner, fresh, pass,
        rule: `fresh account, S00 then ${id} at once, the step row ok, its observed ticks <= ${bar.limit} (rs/49's ${bar.expected} for ${plan.receive.length} stacks, +1)`,
        stepTicks: h?.ticks ?? null,
        tradeTicks: trade?.ticks ?? null,
        s00Ticks: s00?.ticks ?? null,
        // Ticks between S00's landing and the hand-off step's start (run.ts chains them the same way).
        gap: landed !== undefined && h ? h.startTick - landed : null,
        partnerInViewOnLanding: arrival?.partnerInView ?? null,
        received: trade?.received ?? [],
        bar,
        ...(error ? { error } : {}),
        // Per observed state from S00's landing to the end of the step: tick, tile, partner in view, slots used, trade screen.
        trace: trace.filter(r => landed === undefined || (r.t >= landed - 1 && (!h || r.t <= h.endTick + 1))),
    };
    ctx.log('result', out);
    console.log(`RESULT handoff-demo ${JSON.stringify(out)}`);

    if (ctx.options.giveBack !== false && trade?.ok) {
        const back = await giveBack(ctx, plan, partner, Number(ctx.options.giveBackMs ?? 300_000));
        console.log(`RESULT handoff-demo-giveback ${JSON.stringify({ ok: back.ok, tries: back.tries, reason: back.reason ?? null, gave: back.last?.gave.map(i => `${i.name} x${i.count}`) ?? [], inventory: sdk.getInventory().map(i => `${i.name} x${i.count}`) })}`);
    }
}

export const role: Role = {
    name: 'handoff-demo',
    produces: [],
    async run(ctx) {
        await demo(ctx);
    },
};

if (import.meta.main) await runStandalone(role);
