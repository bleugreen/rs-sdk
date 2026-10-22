// handover (role): move exact amounts of stock from this account's bank to other
// accounts by trade, then stop. For ledger moves the fleet's courier cannot make
// (it always carries whole stacks), e.g. a few talismans and a few hundred essence
// from an essence miner to the run machine's altar givers, or coins from an
// earner to a buyer.
//
// Travel: the donor may stand on either side of the Al Kharid toll gate (coin
// earners work in Al Kharid), or underground in the Dwarven Mine or the Mining
// Guild cellar (smelters). Every leg goes through travelTo, which climbs out
// first (lib/underground.ts) and pays the toll when the destination is across
// the fence. A leg that fails ends the
// attempt before the next step: the bank is opened only once the donor stands
// at `bank`, since openBank opens whatever booth is nearest. Coins for the toll
// crossings still ahead (out to `meet`, back to `bank`) are withdrawn with the
// handover.
//
// Duplicates: a handover is repeated (up to 3 attempts) only when nothing left
// the inventory. A trade that may have completed (items gone, or the giver could
// not settle it) is logged as uncertain and never repeated. Each handover's
// outcome is kept in ctx.state under handoverKey(), and "giving" is recorded
// there before the trade opens, so a run restarted for any reason (a re-login, a
// stall, a supervisor restart) skips what was delivered or uncertain, and treats
// a trade it was killed in the middle of as uncertain. To send the same list
// again on purpose, give it a new `id`.
//
// When the list is done the role returns: it has finished, and the fleet moves
// the account on to the assignment's `then` (docs/speedrun/HELPERS.md).
//
// Role options:
//   id         names this list in the account's role state (default: a digest of `handovers`)
//   bank       { x, z } bank to withdraw at (default: the nearest booth in reach of where it stands)
//   meet       { x, z } where to trade (default: stay at the bank)
//   handovers  [{ to: 'cairn_h70', items: [{ item: 'Air talisman', n: 1 }, { item: 'Rune essence', n: 300 }] }]
//              an item is named exactly (`item`) or by obj id (`id`, where names collide: every
//              unfinished potion is 'Unfinished potion', every grimy herb 'Herb'). An id may be the
//              item's or its note's (obj.pack); a note's id is withdrawn noted. Otherwise more than
//              one is withdrawn as notes, and `noted: true | false` says so explicitly. A name that
//              matches two different bank items, or a bank stack short of `n`, is not withdrawn.
//   crossKandarin  true lets a donor standing in Kandarin (a woodcutter at Seers') reach a `bank` or
//              `meet` on the Lumbridge side over White Wolf Mountain (speedrun/lib/kandarin.ts
//              crossFromKandarin). It crosses before the bank is opened, so nothing withdrawn
//              crosses; its own role (`then`) takes it back. Default false: such a leg fails.
import { createHash } from 'node:crypto';
import { withdrawMany, type WithdrawSpec } from '../lib/bank';
import { itemRef, matchesItem, namesNote, refLabel, refMatches, type ItemPattern, type ItemRef } from '../lib/items';
import { noteLink } from '../lib/obj-pack';
import { crossFromKandarin, kandarinTile } from '../lib/kandarin';
import { isEastOfTollGate, TOLL_GP, travelTo, type Tile, type TravelResult } from '../lib/toll-gate';
import { give, sameName, type GiveResult, type GiveSpec } from '../lib/trade';
import { climbToSurface, isUnderground, NO_WAY_UP } from '../lib/underground';
import { STALLED, tickMs, waitTicks } from '../lib/wait';
import { altarData, inRoom, leaveRoom, ROUTE_ALTARS, type AltarName } from './altar-room';
import { inMine } from './essence';
import { closeBank, depositAllExcept, ensureOutOfTutorial, openBank } from './mule';
import { runStandalone, type Role, type RoleContext, type RoleFinish } from './role';
import { waitForPlayer } from './wine';
import type { BankItem, InventoryItem } from '../../sdk/types';

/** One line of a handover: an item by name or obj id, how many, and optionally whether noted. */
export type HandoverItem = ItemRef & { n: number; noted?: boolean };

export interface Handover {
    to: string;
    items: HandoverItem[];
}

export interface HandoverOptions {
    id?: string;
    bank?: Tile;
    meet?: Tile;
    handovers: Handover[];
    crossKandarin?: boolean;
}

export function handoverOptions(raw: Record<string, unknown>): HandoverOptions {
    const list = raw.handovers;
    if (!Array.isArray(list) || list.length === 0) throw new Error('handover: options.handovers is required');
    const handovers = list.map((h: Record<string, unknown>, i: number) => {
        const to = String(h.to ?? '');
        if (!/^cairn_[a-z0-9_]{1,6}$/.test(to)) throw new Error(`handovers[${i}].to must be a cairn_ account`);
        const raw = Array.isArray(h.items) ? (h.items as Record<string, unknown>[]) : [];
        if (raw.length === 0) throw new Error(`handovers[${i}].items is empty`);
        const items = raw.map((it, j): HandoverItem => {
            const where = `handovers[${i}].items[${j}]`;
            const ref = itemRef(it, where);
            const n = Number(it.n);
            if (!Number.isInteger(n) || n < 1) throw new Error(`${where} needs a positive n`);
            if (it.noted !== undefined && typeof it.noted !== 'boolean') throw new Error(`${where}.noted must be true or false`);
            if (it.noted === false && namesNote(ref)) throw new Error(`${where}: obj ${ref.id} is a note, so it cannot be noted: false`);
            // Name-only lines keep exactly their old shape: the list's default id is a digest of it.
            return { ...ref, n, ...(typeof it.noted === 'boolean' ? { noted: it.noted } : {}) };
        });
        return { to, items };
    });
    if (raw.id !== undefined && (typeof raw.id !== 'string' || !/^[\w.-]{1,64}$/.test(raw.id))) throw new Error('handover: options.id must be 1-64 letters, digits, _ . or -');
    if (raw.crossKandarin !== undefined && typeof raw.crossKandarin !== 'boolean') throw new Error('handover: options.crossKandarin must be true or false');
    return {
        ...(typeof raw.id === 'string' ? { id: raw.id } : {}),
        ...(raw.bank ? { bank: raw.bank as Tile } : {}),
        ...(raw.meet ? { meet: raw.meet as Tile } : {}),
        ...(raw.crossKandarin === true ? { crossKandarin: true } : {}),
        handovers
    };
}

/** A leg from Kandarin to the Lumbridge side, which the plain walk cannot make (White Wolf Mountain). */
export function leavesKandarin(from: Tile, to: Tile): boolean {
    return kandarinTile(from) && !kandarinTile(to);
}

/** One handover's line in the account's role state. 'giving' is written before the trade opens. */
export interface HandoverRecord {
    outcome: 'giving' | 'delivered' | 'uncertain';
    to: string;
    items: Handover['items'];
    at: string;
}

/**
 * The role-state key of the i-th handover: the list's `id`, else a digest of the
 * list itself, so the same assignment run again finds what it already did.
 */
export function handoverKey(o: Pick<HandoverOptions, 'id' | 'handovers'>, i: number): string {
    const list = o.id ?? createHash('sha256').update(JSON.stringify(o.handovers)).digest('hex').slice(0, 16);
    return `handover/${list}/${i}`;
}

function priorRecord(ctx: RoleContext, key: string): HandoverRecord | null {
    const v = ctx.state.get(key);
    if (v === undefined) return null;
    const r = (v && typeof v === 'object' ? v : {}) as Partial<HandoverRecord>;
    // Anything unrecognised under the key is treated as the worst case: it may have been given.
    const outcome = r.outcome === 'delivered' || r.outcome === 'giving' ? r.outcome : 'uncertain';
    return { outcome, to: String(r.to ?? '?'), items: r.items ?? [], at: String(r.at ?? '?') };
}

const exact = (name: string) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
const COINS = 995;
const isCoins = (it: ItemRef) => (it.id !== undefined ? noteLink(it.id).item === COINS : /^coins$/i.test(it.item.trim()));

/** What a line is withdrawn as: a note's id or `noted: true` notes it, else more than one is noted. */
export function withdrawnNoted(it: HandoverItem): boolean {
    return it.noted ?? (namesNote(it) || it.n > 1);
}

/** The bank pattern of a line: its exact name, or the item's own id (the bank never holds a note). */
function bankPattern(it: ItemRef): ItemPattern {
    return it.id !== undefined ? noteLink(it.id).item : exact(it.item);
}

/** Per-line key for counting what is carried: one per name, one per item id. */
function lineKey(it: ItemRef): string {
    return it.id !== undefined ? `obj ${noteLink(it.id).item}` : it.item.toLowerCase();
}

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
    const specs: WithdrawSpec[] = items.map(it => ({ item: bankPattern(it), n: it.n, asNote: withdrawnNoted(it) }));
    if (tollCoins <= 0) return specs;
    const i = items.findIndex(isCoins);
    if (i >= 0) specs[i] = { ...specs[i]!, n: (specs[i]!.n as number) + tollCoins };
    else specs.push({ item: exact('Coins'), n: tollCoins, asNote: false });
    return specs;
}

/**
 * Why `specs` must not be withdrawn from `bank`, or null. A name matching two different
 * bank items would take whichever comes first (address it by id), and a stack smaller
 * than the count would be withdrawn whole and handed over short.
 */
export function bankRefusal(specs: readonly WithdrawSpec[], bank: readonly BankItem[]): { reason: string; missing: WithdrawSpec[] } | null {
    const reasons: string[] = [];
    const missing: WithdrawSpec[] = [];
    for (const spec of specs) {
        const matches = bank.filter(b => matchesItem(b, spec.item));
        const label = spec.item instanceof RegExp ? spec.item.source.replace(/^\^|\$$/g, '') : String(spec.item);
        if (new Set(matches.map(b => b.id)).size > 1) {
            reasons.push(`${label} names ${matches.map(b => `obj ${b.id}`).join(' and ')}: give the id`);
            missing.push(spec);
            continue;
        }
        const have = matches[0]?.count ?? 0;
        if (typeof spec.n === 'number' && have < spec.n) {
            reasons.push(`${label} ${have}/${spec.n}`);
            missing.push(spec);
        }
    }
    return reasons.length ? { reason: `bank: ${reasons.join(', ')}`, missing } : null;
}

/**
 * The trade offer for a handover: a name by its exact name, an id by whichever of its
 * item's or note's id is carried (the note after a noted withdrawal).
 */
export function offerSpecs(items: Handover['items'], inventory: readonly InventoryItem[]): GiveSpec[] {
    return items.map(it => {
        if (it.id === undefined) return { item: exact(it.item), n: it.n };
        const link = noteLink(it.id);
        const id = [link.note, link.item].find(x => x !== null && inventory.some(i => i.id === x)) ?? link.item;
        return { item: id, n: it.n };
    });
}

const NEVER_OPENED = new Set(['player_not_found', 'no_response', 'nothing to give']);

/**
 * Classify a give() result. `lost` is how many of each handover line (by
 * lower-case name, or item id) left the inventory, read a few ticks after give returned.
 * Delivered needs the trade to report every item gone; anything that may have
 * moved part of the handover is uncertain.
 */
export function giveOutcome(r: GiveResult, items: Handover['items'], lost: Map<string, number>): Outcome {
    if (r.ok) {
        const all = items.every(it => r.gave.filter(g => refMatches(it, g)).reduce((a, g) => a + g.count, 0) >= it.n);
        return all ? 'delivered' : 'uncertain';
    }
    if ([...lost.values()].some(n => n > 0)) return 'uncertain';
    if (r.reason !== undefined && NEVER_OPENED.has(r.reason)) return 'retry';
    if (r.reason === 'timeout' || r.reason === STALLED || r.reason?.startsWith('no settlement')) return 'uncertain';
    return 'retry';
}

/** The game-facing steps of a handover; tests replace them. */
export interface HandoverIo {
    travel(ctx: RoleContext, to: Tile): Promise<TravelResult>;
    /** Over White Wolf Mountain to `to` on the Lumbridge side. */
    leaveKandarin(ctx: RoleContext, to: Tile): Promise<TravelResult>;
    openBank(ctx: RoleContext): Promise<boolean>;
    closeBank(ctx: RoleContext): Promise<void>;
    depositAll(ctx: RoleContext): Promise<void>;
    withdraw(ctx: RoleContext, specs: WithdrawSpec[]): Promise<{ ok: boolean; reason?: string; missing?: WithdrawSpec[] }>;
    waitForPartner(ctx: RoleContext, name: string): Promise<boolean>;
    give(ctx: RoleContext, to: string, items: Handover['items']): Promise<GiveResult>;
}

export const gameIo: HandoverIo = {
    travel: (ctx, to) => travelTo(ctx.bot, ctx.sdk, to, { tolerance: 3, log: ctx.log, signal: ctx.signal }),
    leaveKandarin: async (ctx, to) => {
        const t = { bot: ctx.bot, sdk: ctx.sdk, log: ctx.log, checkSignal: () => { if (ctx.signal.aborted) throw new Error('aborted'); } };
        try {
            await crossFromKandarin(t, to, `(${to.x}, ${to.z})`);
            return { ok: true, paid: 0 };
        } catch (e) {
            return { ok: false, paid: 0, reason: `kandarin: ${e instanceof Error ? e.message : String(e)}` };
        }
    },
    openBank,
    closeBank,
    depositAll: async ctx => {
        await depositAllExcept(ctx.sdk);
    },
    withdraw: async (ctx, specs) => {
        const refused = bankRefusal(specs, ctx.sdk.getBankItems());
        return refused ? { ok: false, ...refused } : withdrawMany(ctx.sdk, specs);
    },
    waitForPartner: (ctx, name) => waitForPlayer(ctx.sdk, name, 4000 * tickMs()),
    give: (ctx, to, items) => give(ctx.sdk, to, offerSpecs(items, ctx.sdk.getInventory()), { openMaxTicks: 400 })
};

function here(ctx: RoleContext): Tile {
    const p = ctx.sdk.getState()!.player!;
    return { x: p.worldX, z: p.worldZ };
}

function carried(ctx: RoleContext, items: Handover['items']): Map<string, number> {
    const inv = ctx.sdk.getState()?.inventory ?? [];
    return new Map(items.map(it => [lineKey(it), inv.filter(i => refMatches(it, i)).reduce((a, i) => a + i.count, 0)]));
}

function reportBank(ctx: RoleContext): void {
    ctx.reportBank({ items: ctx.sdk.getBankItems().map(i => ({ id: i.id, name: i.name, count: i.count })) });
}

/** One leg: over the mountain first when `crossKandarin` allows it and the leg leaves Kandarin. */
async function go(ctx: RoleContext, o: Pick<HandoverOptions, 'crossKandarin'>, to: Tile, io: HandoverIo): Promise<TravelResult> {
    if (o.crossKandarin && leavesKandarin(here(ctx), to)) {
        const r = await io.leaveKandarin(ctx, to);
        if (!r.ok) return r;
    }
    return io.travel(ctx, to);
}

function legFailed(ctx: RoleContext, leg: 'bank' | 'meet', to: Tile, r: TravelResult): Outcome {
    ctx.log(`handover: could not reach the ${leg}; not opening a bank here`, { to, from: here(ctx), reason: r.reason, paid: r.paid });
    // Another attempt would fail the same way: no toll, or a dungeon with no known way up.
    return r.reason === 'toll gate: no toll' || r.reason?.startsWith(NO_WAY_UP) ? 'stop' : 'retry';
}

/** One attempt at handover `h`, recorded in ctx.state under `key` from just before the trade opens. */
export async function handoverOnce(ctx: RoleContext, h: Handover, o: HandoverOptions, key: string, io: HandoverIo = gameIo): Promise<Outcome> {
    if (o.bank) {
        const r = await go(ctx, o, o.bank, io);
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
        const r = await go(ctx, o, o.meet, io);
        if (!r.ok) return legFailed(ctx, 'meet', o.meet, r);
    }
    if (!(await io.waitForPartner(ctx, h.to))) {
        ctx.log('handover: partner never came into sight', { to: h.to });
        return 'retry';
    }
    const before = carried(ctx, h.items);
    const record = (outcome: HandoverRecord['outcome']): HandoverRecord => ({ outcome, to: h.to, items: h.items, at: new Date().toISOString() });
    // From here until the outcome is known, a restart must assume the items may have moved.
    await ctx.state.set(key, record('giving'));
    const r = await io.give(ctx, h.to, h.items);
    // A refused trade's refund can land a tick or two after the screen closes.
    if (!r.ok) await waitTicks(ctx.sdk, 3);
    const after = carried(ctx, h.items);
    const lost = new Map([...before].map(([name, n]) => [name, n - (after.get(name) ?? 0)]));
    const outcome = giveOutcome(r, h.items, lost);
    await ctx.state.set(key, outcome === 'delivered' || outcome === 'uncertain' ? record(outcome) : undefined);
    ctx.log('handover', { to: h.to, ok: r.ok, outcome, gave: r.gave.map(i => `${i.name} (obj ${i.id}) x${i.count}`), reason: r.reason });
    if (outcome === 'uncertain') ctx.log('handover: outcome uncertain; not repeating it. Check the receiver before giving again', { to: h.to, items: h.items, lost: Object.fromEntries(lost) });
    return outcome;
}

export interface HandoverReport {
    done: string[];
    uncertain: string[];
    failed: string[];
}

/**
 * Every handover in turn, then whatever is still carried back into the bank.
 * A handover the account's role state already holds as delivered or uncertain
 * (or as being given, by a run that was stopped mid-trade) is not attempted.
 */
export async function runHandovers(ctx: RoleContext, o: HandoverOptions, io: HandoverIo = gameIo): Promise<HandoverReport> {
    const report: HandoverReport = { done: [], uncertain: [], failed: [] };
    for (const [i, h] of o.handovers.entries()) {
        if (ctx.signal.aborted) break;
        const key = handoverKey(o, i);
        const prior = priorRecord(ctx, key);
        if (prior) {
            if (prior.outcome === 'giving') {
                ctx.log('handover: a previous run was stopped during this trade; outcome uncertain, not repeating it. Check the receiver before giving again', { to: h.to, items: h.items, since: prior.at, key });
                await ctx.state.set(key, { ...prior, outcome: 'uncertain' });
            } else {
                ctx.log(`handover: already ${prior.outcome} at ${prior.at}; not repeating it`, { to: h.to, key });
            }
            (prior.outcome === 'delivered' ? report.done : report.uncertain).push(h.to);
            continue;
        }
        let outcome: Outcome = 'retry';
        for (let attempt = 0; attempt < 3 && !ctx.signal.aborted; attempt++) {
            outcome = await handoverOnce(ctx, h, o, key, io);
            if (outcome !== 'retry') break;
        }
        if (outcome === 'delivered') report.done.push(h.to);
        else if (outcome === 'uncertain') report.uncertain.push(h.to);
        else report.failed.push(h.to);
    }
    const back = o.bank ? await go(ctx, o, o.bank, io) : { ok: true, paid: 0 };
    if (!back.ok) {
        ctx.log('handover: could not get back to the bank; keeping what is carried', { to: o.bank, from: here(ctx), reason: back.reason });
    } else if (await io.openBank(ctx)) {
        await io.depositAll(ctx);
        reportBank(ctx);
        await io.closeBank(ctx);
    }
    ctx.log('handover: finished', { ...report, of: o.handovers.map(h => h.to) });
    if (report.uncertain.length) ctx.log('handover: UNCERTAIN outcomes; never repeated. Check these receivers before giving again', { uncertain: report.uncertain });
    return report;
}

/** What the supervisor is told when the list is done: uncertain trades need a person. */
export function finishOf(report: HandoverReport): RoleFinish {
    return report.uncertain.length ? { attention: `handover uncertain to ${report.uncertain.join(', ')}: check the receiver before giving again` } : {};
}

/**
 * Get to where a bank is reachable on foot. The fleet parks essence miners
 * wherever their trip stopped, often inside the essence mine, and an altar
 * helper may be parked in an altar room; both are left by their portal. A
 * smelter may be in the Dwarven Mine or the guild cellar: it climbs out here so
 * that a list with no `bank` opens a booth on the surface. A failed climb is
 * logged and left to the legs, whose travelTo tries again or reports it.
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
    if (isUnderground(here(ctx))) {
        const r = await climbToSurface(ctx.bot, ctx.sdk, { log: ctx.log, signal: ctx.signal });
        if (!r.ok) ctx.log('handover: still underground', { at: here(ctx), reason: r.reason });
    }
}

export const role: Role = {
    name: 'handover',
    produces: [],
    async run(ctx) {
        const o = handoverOptions(ctx.options);
        await ensureOutOfTutorial(ctx);
        await ctx.bot.dismissBlockingUI();
        await leaveEnclosure(ctx);
        return finishOf(await runHandovers(ctx, o));
    }
};

if (import.meta.main) await runStandalone(role);
