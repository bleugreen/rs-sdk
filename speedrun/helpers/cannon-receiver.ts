// cannon-receiver (role): a thin lab and demo stand-in for the scored account's side of the cannon
// hand-off (H11/H23, docs/speedrun/SUPPLIES.md), to rehearse the cannon holder's serve mode
// (cannon.ts). The receive is the run's own: runner/handoff.ts runHandOffOnCue on the ledger row
// (the cue through runner/cue-keeper.ts, the holder in sight and its standing request, then the
// row's trade), so the set, the balls and every extra of the row are wanted and checked, exactly as
// SCORED's H11/H23 step does. There is no second receiver: this role only stands on the tile first
// and adds the lab-only surface. Then, optionally: Set-up on the base (lab only) to show whether this
// account's quest state lets it use the cannon, and the set and balls given back to the holder in
// one trade (the H11r direction).
//
// Prints `RESULT cannon-receiver {...}`: the trade's ticks on this account's clock, whether the
// holder's request was standing at the click, what arrived, the Set-up message, and the give-back.
//
// Role options: giver (account, required), tile {x,z} (required), scope {step, family:'cannon'}
//   (required; S14 receives row H11, S27 row H23, or `row` names it), giveBack (default false),
//   waitTicks for the holder (default 6000),
//   expectBack [{ item, count }] (needs giveBack): what the holder gives in the give-back
//     trade (its serve.returnExtras; H11r: Magic shortbow 1, Rune arrow 200). With it the
//     give-back is one two-way trade (lib/trade.ts swap), judged in both directions,
//   lab only: questVarp (::setvar mcannon N first; 11 is complete), setUp (default false)
//
// serveFromLedger builds the holder's serve (balls, extras, top-ups, returnExtras) from the same
// ledger rows, so h92's run-day options can be checked against what SCORED will want.
import { readFileSync } from 'fs';
import type { BotWorldState, TradeItem } from '../../sdk/types';
import { CANNON_PARTS } from '../lib/cannon';
import { debugNameFor } from '../lib/ledger-objs';
import { give, offerSatisfies, swap, type SwapSdk } from '../lib/trade';
import { CueKeeper, exitStopIsFinal } from '../runner/cue-keeper';
import { handOffFrom, handOffMissing, runHandOffOnCue, type HandOffPlan } from '../runner/handoff';
import { MANIFEST } from '../tools/slot-ledger';
import { cueDir, scopeOption, type CueScope } from './altar-cue';
import { chebyshev, cheat, isLocalServer, labTele, pos, standOn, until, type Tile } from './altar-room';
import { extraWants, loadSpecs, loadWant, serveExtras, type ServeExtra } from './cannon';
import { ensureOutOfTutorial, walkNear } from './mule';
import { runStandalone, type Role, type RoleContext } from './role';

/** The ledger row a cannon scope's hand-off is: S14's H11, S27's H23. */
export const CANNON_ROW_FOR: Readonly<Record<string, string>> = { S14: 'H11', S27: 'H23' };

export function cannonRow(scope: CueScope, row?: string): string {
    const r = row ?? CANNON_ROW_FOR[scope.step];
    if (!r) throw new Error(`cannon-receiver: no ledger row for scope ${scope.step}; name it with options.row`);
    return r;
}

/** The holder's serve for one ledger row: what cannon.ts's serve options must carry. */
export interface LedgerServe {
    row: string;
    balls: number;
    /** serve.extras: the row's other fixed `in` entries. */
    extras: Required<ServeExtra>[];
    /** The row's top-ups (`NAME to N`): SCORED asks for N less what it holds, which the holder cannot see. */
    topUps: { item: string; to: number; obj: string }[];
}

function extraOf(row: string, name: string, count: number, id?: number): Required<ServeExtra> {
    const obj = debugNameFor(name, id);
    if (!obj) throw new Error(`${row}: no obj.pack name for ${name}`);
    return { item: name, count, obj };
}

/** cannon.ts serve options for row `row` (H11, H23), from the ledger SCORED's step reads. */
export function serveFromLedger(row: string, manifest: string = readFileSync(MANIFEST, 'utf8')): LedgerServe {
    const plan = handOffFrom(manifest, row);
    const parts = new Set(CANNON_PARTS.map(p => p.toLowerCase()));
    const missing = [...parts].filter(p => !plan.receive.some(r => r.name === p));
    if (missing.length) throw new Error(`${row} is not a cannon row: no ${missing.join(', ')}`);
    const balls = plan.receive.find(r => r.name === 'cannonball');
    if (!balls) throw new Error(`${row}: no cannonball count`);
    const rest = plan.receive.filter(r => !parts.has(r.name) && r.name !== 'cannonball');
    return {
        row,
        balls: balls.count,
        extras: rest.filter(r => !r.topUp).map(r => extraOf(row, r.name, r.count, r.ids?.[0])),
        topUps: rest.filter(r => r.topUp).map(r => ({ item: r.name, to: r.count, obj: extraOf(row, r.name, r.count, r.ids?.[0]).obj })),
    };
}

/**
 * How a holder's serve (cannon.ts serve options: balls, extras) differs from the ledger row SCORED
 * will want; empty when they agree. A top-up is served at most at its `to` count and at least at
 * what SCORED will lack, which the holder cannot see, so a fixed serve count for it is reported for
 * the staging to size against the ledger walk. Any drift makes SCORED's trade decline.
 */
export function serveDrift(serve: { balls: number; extras?: readonly { item: string; count: number }[] }, ledger: LedgerServe): string[] {
    const out: string[] = [];
    const norm = (s: string) => s.toLowerCase();
    if (serve.balls !== ledger.balls) out.push(`${ledger.row}: serve.balls ${serve.balls}, the ledger ${ledger.balls}`);
    const given = new Map((serve.extras ?? []).map(e => [norm(e.item), e.count]));
    for (const e of ledger.extras) {
        const n = given.get(norm(e.item));
        if (n !== e.count) out.push(`${ledger.row}: ${e.item} served ${n ?? 'not at all'}, the ledger ${e.count}`);
        given.delete(norm(e.item));
    }
    for (const t of ledger.topUps) {
        const n = given.get(norm(t.item));
        given.delete(norm(t.item));
        if (n === undefined) out.push(`${ledger.row}: ${t.item} (to ${t.to}, counting what SCORED holds) not served`);
        else if (n > t.to) out.push(`${ledger.row}: ${t.item} served ${n}, above the row's to ${t.to}`);
        else out.push(`${ledger.row}: ${t.item} served a fixed ${n} against a top-up to ${t.to}: SCORED declines unless it holds at least ${t.to - n} (size it from the ledger walk)`);
    }
    for (const [item, n] of given) out.push(`${ledger.row}: ${item} x${n} served but not in the row`);
    return out;
}

/** cannon.ts serve.returnExtras for the take-back: what the H11r row gives SCORED (none while it is give-only). */
export function returnExtrasFromLedger(manifest: string = readFileSync(MANIFEST, 'utf8')): Required<ServeExtra>[] {
    return handOffFrom(manifest, 'H11r').receive.map(r => extraOf('H11r', r.name, r.count, r.ids?.[0]));
}

const BALL = /^cannonball$/i;

export interface ReceiverResult {
    ok: boolean;
    /** Receiver clock: its trade click to the items in its pack. */
    ticks: number;
    standingAtClick: boolean;
    received: string[];
    reason?: string;
    setUp?: { message: string | null; placed: boolean; pickedUp: boolean };
    gaveBack?: { ok: boolean; giverTicks: number; received?: string[]; reason?: string };
}

export interface GiveBackResult {
    ok: boolean;
    ticks: number;
    gave: TradeItem[];
    received: TradeItem[];
    reason?: string;
}

/**
 * The H11r direction: the set and `balls` leftover balls (none: the parts alone) back to the
 * holder in one trade. With `expectBack` the holder offers its return extras in the same
 * trade, so it is lib/trade.ts swap (give the load, want the extras); without, the plain give,
 * which declines anything the holder offers.
 */
export async function giveBackTrade(sdk: SwapSdk, giver: string, balls: number, expectBack: readonly ServeExtra[]): Promise<GiveBackResult> {
    const specs = balls > 0 ? loadSpecs(balls) : loadSpecs(1).slice(0, 4);
    if (expectBack.length === 0) return { ...(await give(sdk, giver, specs, { openTimeoutMs: 60_000 })), received: [] };
    // Our request stands until the holder, which polls its chat every tick, clicks back.
    return swap(sdk, giver, specs, extraWants(expectBack), { openTicks: 200, maxTicks: 100 });
}

/** Delivered both ways: the set left (and `balls` balls with it), and every expected item arrived. */
export function giveBackDelivered(r: Pick<GiveBackResult, 'ok' | 'gave' | 'received'>, balls: number, expectBack: readonly ServeExtra[]): boolean {
    return r.ok && offerSatisfies(loadWant(balls), r.gave) && offerSatisfies(extraWants(expectBack), r.received);
}

const lines = (s: BotWorldState, since: number) => s.gameMessages.filter(m => m.tick > since && m.type === 0).map(m => m.text);

/** Lab: Set-up on the base and record the answer; pick the base up again if it went down. */
async function trySetUp(ctx: RoleContext): Promise<NonNullable<ReceiverResult['setUp']>> {
    const { sdk } = ctx;
    const s = () => sdk.getState() as BotWorldState;
    const base = s().inventory.find(i => /^cannon base$/i.test(i.name));
    const op = base?.optionsWithIndex.find(o => /set-?up/i.test(o.text));
    if (!base || !op) return { message: 'no Set-up option on a carried base', placed: false, pickedUp: false };
    const since = s().tick;
    await sdk.sendUseItem(base.slot, op.opIndex);
    const answer = /place the cannon base|can't set up|need to complete|enough space|won't be happy|can't set up a cannon here/i;
    await until(ctx, st => lines(st, since).some(t => answer.test(t)), 20);
    const message = lines(s(), since).find(t => answer.test(t)) ?? null;
    const placed = !!message && /place the cannon base/i.test(message);
    let pickedUp = false;
    if (placed) {
        const loc = sdk.getNearbyLocs().find(l => /^cannon base$/i.test(l.name));
        const pick = loc?.optionsWithIndex.find(o => /pick-?up/i.test(o.text));
        if (loc && pick) {
            await sdk.sendInteractLoc(loc.x, loc.z, loc.id, pick.opIndex);
            pickedUp = await until(ctx, st => st.inventory.some(i => /^cannon base$/i.test(i.name)), 20);
        }
    }
    return { message, placed, pickedUp };
}

export const role: Role = {
    name: 'cannon-receiver',
    produces: [],
    async run(ctx: RoleContext) {
        const o = ctx.options;
        const giver = String(o.giver ?? '');
        if (!giver) throw new Error('cannon-receiver: options.giver is required');
        const t = (o.tile ?? {}) as Tile;
        if (!Number.isInteger(t.x) || !Number.isInteger(t.z)) throw new Error('cannon-receiver: options.tile {x,z} is required');
        const tile: Tile = { x: t.x, z: t.z };
        const scope = scopeOption(o.scope, ['cannon']);
        const plan: HandOffPlan = handOffFrom(readFileSync(MANIFEST, 'utf8'), cannonRow(scope, o.row === undefined ? undefined : String(o.row)));
        const lab = isLocalServer();
        if ((o.questVarp !== undefined || o.setUp) && !lab) throw new Error('questVarp and setUp are for the local lab only');
        const expectBack = serveExtras(o.expectBack, false, 'cannon-receiver: expectBack');
        if (expectBack.length && !o.giveBack) throw new Error('cannon-receiver: expectBack needs giveBack');
        const { sdk } = ctx;
        const s = () => sdk.getState() as BotWorldState;

        await ensureOutOfTutorial(ctx);
        await ctx.bot.dismissBlockingUI();
        if (lab) {
            await cheat(ctx, '~clearinv inv');
            await until(ctx, st => st.inventory.length === 0, 10);
            if (o.questVarp !== undefined) await cheat(ctx, `setvar mcannon ${Number(o.questVarp)}`);
        }
        if (process.env.HELPER_LAB_TELE === '1' && chebyshev(pos(s()), tile) > 30) await labTele(ctx, tile);
        if (!(await walkNear(ctx, tile.x, tile.z, 2))) throw new Error(`could not reach ${tile.x},${tile.z}`);
        await standOn(ctx, tile);

        const keeper = new CueKeeper(cueDir(), ctx.account);
        const unsub = keeper.attach(sdk);
        let result: ReceiverResult = { ok: false, ticks: 0, standingAtClick: false, received: [], reason: 'not started' };
        try {
            // The run's own sequence on the row (runner/handoff.ts): cue, holder in sight, its request, the trade.
            try {
                const r = await runHandOffOnCue({ sdk: sdk as never }, plan, giver, {
                    scope, open: c => keeper.open(scope, c, { fresh: true }), waitTicks: Number(o.waitTicks ?? 6000),
                });
                const missing = handOffMissing(s(), plan);
                result = { ok: r.ok && missing.length === 0, ticks: r.ticks, standingAtClick: r.standingAtClick, received: r.received, ...(missing.length ? { reason: `${plan.id} after the trade: ${missing.join('; ')}` } : {}) };
            } catch (e) {
                result = { ...result, reason: e instanceof Error ? e.message : String(e) };
            }
            ctx.log('received', { ...result, row: plan.id });
            if (!result.ok) return;

            if (o.setUp) {
                result.setUp = await trySetUp(ctx);
                ctx.log('set-up', { ...result.setUp });
            }
            if (o.giveBack) {
                const held = s().inventory.filter(i => BALL.test(i.name)).reduce((a, i) => a + i.count, 0);
                const g = await giveBackTrade(sdk, giver, held, expectBack);
                result.gaveBack = {
                    ok: giveBackDelivered(g, held, expectBack),
                    giverTicks: g.ticks,
                    ...(expectBack.length ? { received: g.received.map(i => `${i.name} x${i.count}`) } : {}),
                    ...(g.reason ? { reason: g.reason } : {})
                };
                ctx.log('gave back', { ...result.gaveBack, tradeOk: g.ok, gave: g.gave.map(i => `${i.name} x${i.count}`) });
                // A final role's exit stops the launcher: let the holder log its side of the trade first.
                await sdk.waitForTicks(5);
            }
        } finally {
            // A failed receive stands the holder down, so a re-run's receiver is served.
            keeper.close({ final: exitStopIsFinal({ completed: result.ok, signal: null }) });
            unsub();
            console.log(`RESULT cannon-receiver ${JSON.stringify(result)}`);
        }
    }
};

if (import.meta.main) await runStandalone(role);
