// handover (role): move exact amounts of stock from this account's bank to other
// accounts by trade, then stop. For ledger moves the fleet's courier cannot make
// (it always carries whole stacks), e.g. a few talismans and a few hundred essence
// from an essence miner to the run machine's altar givers, or coins from an
// earner to a buyer.
//
// Travel: the donor may stand on either side of the Al Kharid toll gate (coin
// earners work in Al Kharid). Every leg goes through travelTo, which pays the
// toll when the destination is across the fence. A leg that fails ends the
// attempt before the next step: the bank is opened only once the donor stands
// at `bank`, since openBank opens whatever booth is nearest. Coins for the toll
// crossings still ahead (out to `meet`, back to `bank`) are withdrawn with the
// handover.
//
// Duplicates: a handover is repeated (up to 3 attempts) only when nothing left
// the inventory. A trade that may have completed (items gone, or the giver could
// not settle it) is logged as uncertain and never repeated.
//
// Role options:
//   bank       { x, z } bank to withdraw at (default: the nearest booth in reach of where it stands)
//   meet       { x, z } where to trade (default: stay at the bank)
//   handovers  [{ to: 'cairn_h70', items: [{ item: 'Air talisman', n: 1 }, { item: 'Rune essence', n: 300 }] }]
//              non-stackable items above one are withdrawn as notes
import { withdrawMany, type WithdrawSpec } from '../lib/bank';
import { isEastOfTollGate, TOLL_GP, travelTo, type Tile, type TravelResult } from '../lib/toll-gate';
import { give, sameName, type GiveResult } from '../lib/trade';
import { waitTicks } from '../lib/wait';
import { altarData, inRoom, leaveRoom, ROUTE_ALTARS, type AltarName } from './altar-room';
import { inMine } from './essence';
import { closeBank, depositAllExcept, ensureOutOfTutorial, openBank } from './mule';
import { runStandalone, type Role, type RoleContext } from './role';
import { waitForPlayer } from './wine';

export interface Handover {
    to: string;
    items: { item: string; n: number }[];
}

export interface HandoverOptions {
    bank?: Tile;
    meet?: Tile;
    handovers: Handover[];
}

export function handoverOptions(raw: Record<string, unknown>): HandoverOptions {
    const list = raw.handovers;
    if (!Array.isArray(list) || list.length === 0) throw new Error('handover: options.handovers is required');
    const handovers = list.map((h: Record<string, unknown>, i: number) => {
        const to = String(h.to ?? '');
        if (!/^cairn_[a-z0-9_]{1,6}$/.test(to)) throw new Error(`handovers[${i}].to must be a cairn_ account`);
        const items = (Array.isArray(h.items) ? h.items : []).map((it: Record<string, unknown>) => ({ item: String(it.item), n: Number(it.n) }));
        if (items.length === 0 || items.some(it => !it.item || !Number.isInteger(it.n) || it.n < 1)) throw new Error(`handovers[${i}].items need item and a positive n`);
        return { to, items };
    });
    return { ...(raw.bank ? { bank: raw.bank as Tile } : {}), ...(raw.meet ? { meet: raw.meet as Tile } : {}), handovers };
}

const exact = (name: string) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
const isCoins = (name: string) => /^coins$/i.test(name.trim());

/**
 * What one attempt came to. 'retry': nothing left this account and another
 * attempt may succeed. 'stop': another attempt would fail the same way (no
 * toll). 'uncertain': the items may have changed hands, so it is never repeated.
 */
export type Outcome = 'delivered' | 'retry' | 'stop' | 'uncertain';

/** Toll crossings left once the bank at `at` has been used: out to `meet`, then back to `bank` at the end. */
export function tollsAfterBank(at: Tile, o: Pick<HandoverOptions, 'bank' | 'meet'>): number {
    if (!o.meet) return 0;
    const crosses = (a: Tile, b: Tile) => (isEastOfTollGate(a) !== isEastOfTollGate(b) ? 1 : 0);
    return crosses(at, o.meet) + (o.bank ? crosses(o.meet, o.bank) : 0);
}

/** The withdrawal for one handover, plus `tollCoins` more coins to pay the gate with. */
export function withdrawSpecs(items: Handover['items'], tollCoins: number): WithdrawSpec[] {
    const specs: WithdrawSpec[] = items.map(it => ({ item: exact(it.item), n: it.n, asNote: it.n > 1 }));
    if (tollCoins <= 0) return specs;
    const i = items.findIndex(it => isCoins(it.item));
    if (i >= 0) specs[i] = { ...specs[i]!, n: (specs[i]!.n as number) + tollCoins };
    else specs.push({ item: exact('Coins'), n: tollCoins, asNote: false });
    return specs;
}

const NEVER_OPENED = new Set(['player_not_found', 'no_response', 'nothing to give']);

/**
 * Classify a give() result. `lost` is how many of each handover item (by
 * lower-case name) left the inventory, read a few ticks after give returned.
 * Delivered needs the trade to report every item gone; anything that may have
 * moved part of the handover is uncertain.
 */
export function giveOutcome(r: GiveResult, items: Handover['items'], lost: Map<string, number>): Outcome {
    if (r.ok) {
        const all = items.every(it => r.gave.filter(g => sameName(g.name, it.item)).reduce((a, g) => a + g.count, 0) >= it.n);
        return all ? 'delivered' : 'uncertain';
    }
    if ([...lost.values()].some(n => n > 0)) return 'uncertain';
    if (r.reason !== undefined && NEVER_OPENED.has(r.reason)) return 'retry';
    if (r.reason === 'timeout' || r.reason?.startsWith('no settlement')) return 'uncertain';
    return 'retry';
}

/** The game-facing steps of a handover; tests replace them. */
export interface HandoverIo {
    travel(ctx: RoleContext, to: Tile): Promise<TravelResult>;
    openBank(ctx: RoleContext): Promise<boolean>;
    closeBank(ctx: RoleContext): Promise<void>;
    depositAll(ctx: RoleContext): Promise<void>;
    withdraw(ctx: RoleContext, specs: WithdrawSpec[]): Promise<{ ok: boolean; reason?: string; missing?: WithdrawSpec[] }>;
    waitForPartner(ctx: RoleContext, name: string): Promise<boolean>;
    give(ctx: RoleContext, to: string, items: Handover['items']): Promise<GiveResult>;
}

export const gameIo: HandoverIo = {
    travel: (ctx, to) => travelTo(ctx.bot, ctx.sdk, to, { tolerance: 3, log: ctx.log, signal: ctx.signal }),
    openBank,
    closeBank,
    depositAll: async ctx => {
        await depositAllExcept(ctx.sdk);
    },
    withdraw: (ctx, specs) => withdrawMany(ctx.sdk, specs),
    waitForPartner: (ctx, name) => waitForPlayer(ctx.sdk, name, 20 * 60_000),
    give: (ctx, to, items) => give(ctx.sdk, to, items.map(it => ({ item: exact(it.item), n: it.n })), { openTimeoutMs: 120_000 })
};

function here(ctx: RoleContext): Tile {
    const p = ctx.sdk.getState()!.player!;
    return { x: p.worldX, z: p.worldZ };
}

function carried(ctx: RoleContext, items: Handover['items']): Map<string, number> {
    const inv = ctx.sdk.getState()?.inventory ?? [];
    return new Map(items.map(it => [it.item.toLowerCase(), inv.filter(i => sameName(i.name, it.item)).reduce((a, i) => a + i.count, 0)]));
}

function reportBank(ctx: RoleContext): void {
    ctx.reportBank({ items: ctx.sdk.getBankItems().map(i => ({ id: i.id, name: i.name, count: i.count })) });
}

function legFailed(ctx: RoleContext, leg: 'bank' | 'meet', to: Tile, r: TravelResult): Outcome {
    ctx.log(`handover: could not reach the ${leg}; not opening a bank here`, { to, from: here(ctx), reason: r.reason, paid: r.paid });
    return r.reason === 'toll gate: no toll' ? 'stop' : 'retry';
}

export async function handoverOnce(ctx: RoleContext, h: Handover, o: HandoverOptions, io: HandoverIo = gameIo): Promise<Outcome> {
    if (o.bank) {
        const r = await io.travel(ctx, o.bank);
        if (!r.ok) return legFailed(ctx, 'bank', o.bank, r);
    }
    if (!(await io.openBank(ctx))) {
        ctx.log('handover: could not open the bank', { at: here(ctx) });
        return 'retry';
    }
    const tolls = tollsAfterBank(here(ctx), o);
    await io.depositAll(ctx);
    const w = await io.withdraw(ctx, withdrawSpecs(h.items, tolls * TOLL_GP));
    reportBank(ctx);
    await io.closeBank(ctx);
    if (!w.ok) {
        ctx.log('handover: withdraw incomplete', { to: h.to, reason: w.reason, missing: w.missing });
        return 'retry';
    }
    if (o.meet) {
        const r = await io.travel(ctx, o.meet);
        if (!r.ok) return legFailed(ctx, 'meet', o.meet, r);
    }
    if (!(await io.waitForPartner(ctx, h.to))) {
        ctx.log('handover: partner never came into sight', { to: h.to });
        return 'retry';
    }
    const before = carried(ctx, h.items);
    const r = await io.give(ctx, h.to, h.items);
    // A refused trade's refund can land a tick or two after the screen closes.
    if (!r.ok) await waitTicks(ctx.sdk, 3);
    const after = carried(ctx, h.items);
    const lost = new Map([...before].map(([name, n]) => [name, n - (after.get(name) ?? 0)]));
    const outcome = giveOutcome(r, h.items, lost);
    ctx.log('handover', { to: h.to, ok: r.ok, outcome, gave: r.gave.map(i => `${i.name} x${i.count}`), reason: r.reason });
    if (outcome === 'uncertain') ctx.log('handover: outcome uncertain; not repeating it. Check the receiver before giving again', { to: h.to, items: h.items, lost: Object.fromEntries(lost) });
    return outcome;
}

export interface HandoverReport {
    done: string[];
    uncertain: string[];
    failed: string[];
}

/** Every handover in turn, then whatever is still carried back into the bank. */
export async function runHandovers(ctx: RoleContext, o: HandoverOptions, io: HandoverIo = gameIo): Promise<HandoverReport> {
    const report: HandoverReport = { done: [], uncertain: [], failed: [] };
    for (const h of o.handovers) {
        if (ctx.signal.aborted) break;
        let outcome: Outcome = 'retry';
        for (let attempt = 0; attempt < 3 && !ctx.signal.aborted; attempt++) {
            outcome = await handoverOnce(ctx, h, o, io);
            if (outcome !== 'retry') break;
        }
        if (outcome === 'delivered') report.done.push(h.to);
        else if (outcome === 'uncertain') report.uncertain.push(h.to);
        else report.failed.push(h.to);
    }
    const back = o.bank ? await io.travel(ctx, o.bank) : { ok: true, paid: 0 };
    if (!back.ok) {
        ctx.log('handover: could not get back to the bank; keeping what is carried', { to: o.bank, from: here(ctx), reason: back.reason });
    } else if (await io.openBank(ctx)) {
        await io.depositAll(ctx);
        reportBank(ctx);
        await io.closeBank(ctx);
    }
    ctx.log('handover: finished', { ...report, of: o.handovers.map(h => h.to) });
    return report;
}

/**
 * Get to where a bank is reachable on foot. The fleet parks essence miners
 * wherever their trip stopped, often inside the essence mine, and an altar
 * helper may be parked in an altar room; both are left by their portal.
 */
async function leaveEnclosure(ctx: RoleContext): Promise<void> {
    for (const name of Object.keys(ROUTE_ALTARS) as AltarName[]) {
        const altar = altarData(name);
        if (inRoom(ctx.sdk.getState(), altar)) await leaveRoom(ctx, altar);
    }
    for (let attempt = 0; attempt < 4 && inMine(ctx.sdk.getState()); attempt++) {
        const portal = (await ctx.sdk.scanNearbyLocs(30))
            .filter(l => /^portal$/i.test(l.name) && l.optionsWithIndex.some(o => /use/i.test(o.text)))
            .sort((a, b) => a.distance - b.distance)[0];
        if (!portal) throw new Error('in the essence mine with no exit portal in sight');
        await ctx.bot.interactLoc(portal, /use/i);
        for (let t = 0; t < 25 && inMine(ctx.sdk.getState()); t++) await ctx.sdk.waitForTicks(1).catch(() => {});
    }
    if (inMine(ctx.sdk.getState())) throw new Error('the essence mine portal did not take us out');
}

export const role: Role = {
    name: 'handover',
    produces: [],
    async run(ctx) {
        const o = handoverOptions(ctx.options);
        await ensureOutOfTutorial(ctx);
        await ctx.bot.dismissBlockingUI();
        await leaveEnclosure(ctx);
        await runHandovers(ctx, o);
    }
};

if (import.meta.main) await runStandalone(role);
