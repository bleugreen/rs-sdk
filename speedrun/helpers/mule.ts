// Mule, courier and hand-off giver.
//
// mule (role `mule`): one or two accounts standing at Varrock west bank. It
//   accepts trades only from courier accounts (`^cairn_h\d+$` by default) and the
//   configured scored account, deposits whatever it receives, and reports its
//   bank after every change. With `packages` configured it is also the GIVER for
//   the scored account: it holds the next package in its inventory, offers it
//   the moment a trade opens, and verifies partner and offer on both screens. With
//   `ge` configured it lists items on the Grand Exchange and collects proceeds.
//
// courier (role `courier`): any helper account can be switched to it. Banks are
//   shared across booths, so the courier walks to Varrock west bank, withdraws its
//   produce there as notes, trades it to the mule, and walks back to where it was.
//
// The scored account's side of a hand-off is `requestPackage` (a cue scoped to the hand-off) +
// `receivePackage`.
// How the run uses them, and their measured cost in ticks: docs/speedrun/helpers/mule.md.
//
// Top-ups. A package line may be `{ item | id, topUp: { max } }` instead of a fixed `amount`:
// the ledger's `ITEM to N` (H12's `shark to 15`), where the scored account wants N less what it
// holds and the mule cannot see its pack. The package then carries `scope: { step, family: 'mule' }`
// (altar-cue.ts CueScope). The mule stages the line up to `max` (as far as its bank and the 28
// slots allow) and, once the trade is open, waits up to `askWaitTicks` observed ticks for the
// scored account's top-up ask with that scope (altar-cue.ts awaitAsk, the courier's ask reader).
// It offers the fixed lines as before, and of each top-up line the asked count clamped to
// [0, max] and to what it holds. With no usable ask it offers none of that line and logs it.
// Mule options for it: `askWaitTicks` (default 3), `cueDir` (default RC_CUE_DIR, as the givers).
//
// Carried packages (`carried: true`, H12o on Ape Atoll, where there is no bank). The mule logs in
// already holding every package, finds each package's lines in its inventory (carriedNeeds) and
// offers every line by exact count, since the inventory holds more than the package served. Each
// package may name the tile it is served from (`at`); the mule stands on the pending package's tile,
// else on the first one not yet served or withdrawn (carriedStand), and walks there as soon as that
// changes. What it served is kept in RoleState by cue session, so a restarted role never serves a
// package twice. A package whose cue stops before its trade (SCORED asked for none of it: every
// top-up met, so no trade) is passed and recorded the same way (passCarried). Two guards keep it alive between trades: it kills any NPC that hit it, or any named
// aggressive species within `clearTiles` (wildlifeThreat; any NPC hit on either trader closes the
// trade for both), and every `keepAliveMinutes` while idle it steps one tile out and back
// (keepAliveStep). Both are on by default only in carried mode.
//
// Run standalone (lite client already running for the account):
//   ROLE_OPTIONS='{...}' bun speedrun/helpers/mule.ts <account>            # mule
//   ROLE_OPTIONS='{...}' bun speedrun/helpers/mule.ts <account> courier    # courier
import { existsSync } from 'node:fs';
import type { BotActions } from '../../sdk/actions';
import type { BotSDK } from '../../sdk/index';
import { findDoorsAlongPath, initPathfinding } from '../../sdk/pathfinding';
import { reached } from '../../server/vendor/rsmod-pathfinder';
import type { BankItem, BotWorldState, GameMessage, InventoryItem, NearbyNpc, TradeItem, TradeItemSpec } from '../../sdk/types';
import { TRADE_REQUEST_CHAT_TYPE } from '../../sdk/types';
import { fight } from '../lib/combat';
import { itemRef, namesNote, noteOf, refLabel, refMatches, untradeable, type ItemRef, type NamedRef } from '../lib/items';
import type { ObjPack } from '../lib/obj-pack';
import { westOfTaverley } from '../lib/kandarin';
import { crossingsBetween } from '../lib/passages';
import { crossForDelivery } from './delivery-cross';
import { travelTo } from '../lib/toll-gate';
import { inArea, runTo } from '../lib/travel';
import { deliverySession, muleCanReady, muleHealthy, mulePreparationPath, PRE_REQUEST_TILES, readMulePreparation, sameWorldTile, worldTile, writeMuleReady, type MuleHold, type WorldTile } from './mule-readiness';
import { ANY_OFFER, clickBack, decideTradeClick, DROPPED_TICKS, give, newClickCtx, offerSatisfies, openTrade, sameName, sendTradeClick, type ClickCtx } from '../lib/trade';
import { tickMs, waitUntil, type StateSource } from '../lib/wait';
import { awaitAsk, cueAddresses, cueDir, CueWriter, nameHash, readCue, scopeOption, type AwaitAskOptions, type Cue, type CueScope, type TopUpAsk } from './altar-cue';
import { runStandalone, type Role, type RoleContext } from './role';

// ============ Places ============

/** Where the mule stands: inside Varrock west bank, in reach of the booths, off the GE table. */
export const MULE_STAND = { x: 3185, z: 3436 };
export const DEFAULT_COURIERS = '^cairn_h\\d+$';

function onTutorialIsland(x: number, z: number): boolean {
    return x >= 3050 && x <= 3156 && z >= 3056 && z <= 3136;
}

// ============ Pure helpers (unit tested in mule.test.ts) ============

/**
 * Accounts are configured by login name (`cairn_h05`) but the game shows display
 * names (`Cairn H05`: underscores become spaces, words are title-cased). Compare
 * both in this canonical form.
 */
export function canonName(name: string): string {
    return name.trim().toLowerCase().replace(/[\s_]+/g, '_');
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A RegExp that matches exactly this account's display name, for findNearbyPlayer / tradeWith. */
export function playerPattern(account: string): RegExp {
    const parts = canonName(account).split('_').filter(Boolean).map(escapeRegExp);
    return new RegExp(`^${parts.join('[ _]')}$`, 'i');
}

/** Whether a display name (or login name) matches an account-name RegExp written against login names. */
export function accountMatches(displayName: string | null | undefined, pattern: RegExp): boolean {
    if (!displayName) return false;
    return pattern.test(canonName(displayName));
}

/** Option values arrive as JSON: strings are case-insensitive RegExp sources. */
export function toRegExps(value: unknown): RegExp[] {
    const list = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
    return list.map(v => (v instanceof RegExp ? v : new RegExp(String(v), 'i')));
}

export interface PackageCount {
    /** How many; -1 = everything the bank has. */
    amount: number;
    /** Withdraw as banknotes (one slot per item type). Default false, or true for a note's id. */
    noted?: boolean;
}

/** A top-up line: the count comes from the scored account's ask, at most `max` (the ledger's `to N`). */
export interface TopUpCount {
    topUp: { max: number };
    /** As PackageCount's. */
    noted?: boolean;
}

/**
 * A package line: `item`, the exact name, case-insensitive ("Unfermented wine"), or `id`,
 * the obj id where names collide (every unfinished potion is "Unfinished potion"). An id
 * may be the item's or its note's (lib/obj-pack.ts); a note's id is withdrawn noted.
 * A fixed `amount`, or a `topUp`.
 */
export type PackageItem = ItemRef & (PackageCount | TopUpCount);
export type NamedPackageItem = NamedRef & PackageCount;

export function isTopUp(spec: PackageItem): spec is ItemRef & TopUpCount {
    return 'topUp' in spec;
}

export interface Package {
    name: string;
    items: PackageItem[];
    /** Whose top-up ask the package reads (family 'mule'); set exactly when it has a top-up line. */
    scope?: CueScope;
    /** Served only when asked for by name (a fallback such as H4e): never a step of order mode. */
    onRequest?: true;
    /** Meeting tile. Location-aware banked delivery requires an explicit plane. */
    at?: Tile;
    /** Reachable staging bank for this delivery, on an explicit plane. */
    bank?: WorldTile;
    /** Stage the next ordered delivery with this one; keep it aboard through this trade. */
    carryNext?: true;
    /** Maximum occupied slots returned by the receiver during this delivery (default zero in a carry group). */
    takeBackSlots?: number;
}

export interface Tile {
    x: number;
    z: number;
    level?: number;
}

/**
 * Order mode after a successful serve: the ordered packages advance only when the one served is
 * the ordered package due, so a package asked for by name in between (a fallback) leaves the
 * order where it was and the due package comes up again.
 */
export function afterServe(ordered: readonly Package[], nextIndex: number, served: Package): { nextIndex: number; pending: Package | null } {
    const next = ordered[nextIndex] === served ? nextIndex + 1 : nextIndex;
    return { nextIndex: next, pending: ordered[next] ?? null };
}

export interface Withdrawal {
    bankItem: BankItem;
    amount: number;
    noted: boolean;
    /** A top-up line's, staged up to its max. */
    topUp?: boolean;
}

export interface PackagePlan {
    withdrawals: Withdrawal[];
    missing: { item: string; wanted: number; have: number }[];
    /** Names that match more than one bank item (by id); the package names them by `id` instead. */
    ambiguous: { item: string; ids: number[] }[];
    /** Inventory slots the package occupies once withdrawn. */
    slots: number;
    /** Top-up lines staged below their max: the bank, or the slots the fixed lines leave, hold fewer. */
    topUpShort: { item: string; max: number; staged: number }[];
}

/**
 * Map a package onto the bank. Unnoted unstackable items take one slot each; a
 * package that does not fit in 28 slots is reported as `slots > 28` for the caller
 * to refuse. A name that matches two different bank items is reported in
 * `ambiguous`, never resolved to whichever comes first.
 *
 * Top-up lines are staged after the fixed ones, each up to its max as far as the bank and the
 * slots left allow (`topUpShort` names any staged below it); a top-up is never `missing`, since
 * the scored account may ask for none.
 */
export function planPackage(pkg: Package, bank: BankItem[], stackable: (name: string) => boolean = isStackableName, pack?: ObjPack): PackagePlan {
    const withdrawals: Withdrawal[] = [];
    const missing: PackagePlan['missing'] = [];
    const ambiguous: PackagePlan['ambiguous'] = [];
    const topUpShort: PackagePlan['topUpShort'] = [];
    const topUps: Array<{ spec: ItemRef & TopUpCount; bankItem: BankItem | undefined }> = [];
    let slots = 0;
    for (const spec of pkg.items) {
        const matches = bank.filter(b => refMatches(spec, b, pack));
        const ids = [...new Set(matches.map(b => b.id))];
        if (ids.length > 1) {
            ambiguous.push({ item: refLabel(spec), ids });
            continue;
        }
        const bankItem = matches[0];
        if (isTopUp(spec)) {
            topUps.push({ spec, bankItem });
            continue;
        }
        const have = bankItem?.count ?? 0;
        const amount = spec.amount === -1 ? have : spec.amount;
        if (!bankItem || amount <= 0 || have < amount) {
            missing.push({ item: refLabel(spec), wanted: spec.amount, have });
            continue;
        }
        const noted = spec.noted ?? namesNote(spec, pack);
        withdrawals.push({ bankItem, amount, noted });
        slots += noted || stackable(bankItem.name) ? 1 : amount;
    }
    for (const { spec, bankItem } of topUps) {
        const noted = spec.noted ?? namesNote(spec, pack);
        const oneSlot = noted || (!!bankItem && stackable(bankItem.name));
        const room = oneSlot ? (slots < 28 ? Infinity : 0) : Math.max(0, 28 - slots);
        const staged = Math.min(spec.topUp.max, bankItem?.count ?? 0, room);
        if (staged < spec.topUp.max) topUpShort.push({ item: refLabel(spec), max: spec.topUp.max, staged });
        if (!bankItem || staged <= 0) continue;
        withdrawals.push({ bankItem, amount: staged, noted, topUp: true });
        slots += oneSlot ? 1 : staged;
    }
    return { withdrawals, missing, ambiguous, slots, topUpShort };
}

/**
 * Items that stack unnoted (coins, runes, ammunition). Bank data does not say, so
 * this only sizes a package against 28 slots; a wrong guess shows up as a failed
 * withdrawal, never as a wrong trade.
 */
export function isStackableName(name: string): boolean {
    // Throwing knives (`Rune knife`) stack; the plain `Knife` tool does not. Thread and nails stack
    // Needles and swamp paste also stack (crafting.obj and cooking.obj). The ledger rejects mismatches.
    return /^coins$| rune$|arrows?$|arrowtips$|arrowheads$|bolts$|darts?$|dart tips?$|^feathers?$|\S knife$|cannonballs?$|^thread$|^nails$|^needle$|^swamp paste$/i.test(name);
}

/** Aggregate an inventory or offer into id -> count. */
export function countById(items: Array<{ id: number; count: number }>): Map<number, number> {
    const map = new Map<number, number>();
    for (const item of items) map.set(item.id, (map.get(item.id) ?? 0) + item.count);
    return map;
}

/** Exact multiset equality by item id: same ids, same counts, nothing extra. */
export function sameItems(a: Map<number, number>, b: Map<number, number>): boolean {
    if (a.size !== b.size) return false;
    for (const [id, count] of a) if (b.get(id) !== count) return false;
    return true;
}

/** True when `inventory` holds at least everything in `held`. */
export function holds(inventory: Map<number, number>, held: Map<number, number>): boolean {
    for (const [id, count] of held) if ((inventory.get(id) ?? 0) < count) return false;
    return true;
}

/** One slot per distinct item id: offering "All" on it moves every item of that id. */
export function firstSlotPerId(items: InventoryItem[]): InventoryItem[] {
    const seen = new Set<number>();
    const out: InventoryItem[] = [];
    for (const item of [...items].sort((x, y) => x.slot - y.slot)) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        out.push(item);
    }
    return out;
}

/**
 * The package a cue asks for: the one whose scope the cue addresses (altar-cue.ts cueAddresses, family
 * 'mule', the scope's step the hand-off id), and only when the cue's receiver is the account this mule
 * serves. A mule cue that names no package of ours, or another receiver, asks for nothing.
 */
export function packageForCue(cue: Pick<Cue, 'scope' | 'receiver'> | null, packages: readonly Package[], serve: string | undefined): Package | null {
    if (!cue || !serve || cue.receiver?.sha256 !== nameHash(serve)) return null;
    return packages.find(p => !!p.scope && cueAddresses(cue, p.scope.step, 'mule')) ?? null;
}

/**
 * Ask the mule for the package of hand-off `handOff` (H12): a cue in `dir` scoped
 * `{ step: handOff, family: 'mule' }` for `receiver`, the account the mule serves. The scored side
 * (run.ts) writes it before the hand-off; the mule stages that package and pre-requests.
 */
export function requestPackage(dir: string, receiver: string, handOff: string, beacon: { tick: number; ms: number }): Cue {
    return new CueWriter(dir, receiver, { step: handOff, family: 'mule' }).write({ beacons: [beacon], turns: [] });
}

/**
 * Is the inventory exactly the staged package, nothing more and nothing less? The giver serves
 * only then: what the scored account hands back in the same trade (ANY_OFFER, e.g. 20 enchanted
 * rings at S05's H4 hand-off) has to fit in the slots the package frees. `extra` names what does
 * not belong, `short` what is missing.
 */
export function stagedExactly(inventory: InventoryItem[], held: Map<number, number> | null): { exact: boolean; extra: string[]; short: number[] } {
    if (!held) return { exact: false, extra: [], short: [] };
    const inv = countById(inventory);
    const extra = inventory.filter(i => (inv.get(i.id) ?? 0) > (held.get(i.id) ?? 0)).map(i => `${i.name} x${i.count}`);
    const short = [...held].filter(([id, n]) => (inv.get(id) ?? 0) < n).map(([id]) => id);
    return { exact: extra.length === 0 && short.length === 0, extra, short };
}

/** What a top-up line offers in one trade, and why. */
export interface TopUpServe {
    item: string;
    /** The inventory id staged for it; null when none is. */
    id: number | null;
    max: number;
    /** How many the mule holds of it. */
    held: number;
    /** The ask's count for it; null when no usable ask names it. */
    asked: number | 'all' | null;
    /** Offered: the ask clamped to [0, max] and to `held`; 0 without an ask. */
    n: number;
}

/**
 * Each top-up line's count for this trade. A line takes the first ask item whose pattern (a
 * case-insensitive RegExp source, as the courier's asks) matches the name of what the mule holds
 * for it: `'all'` means up to max. No ask, or an ask that names none of it, offers none.
 */
export function topUpCounts(pkg: Pick<Package, 'items'>, inventory: readonly InventoryItem[], ask: Pick<TopUpAsk, 'items'> | null, pack?: ObjPack): TopUpServe[] {
    const out: TopUpServe[] = [];
    for (const spec of pkg.items) {
        if (!isTopUp(spec)) continue;
        const mine = inventory.filter(i => refMatches(spec, i, pack));
        const first = mine[0];
        const held = first ? mine.filter(i => i.id === first.id).reduce((n, i) => n + i.count, 0) : 0;
        const name = first?.name ?? spec.item ?? '';
        const a = name ? ask?.items.find(x => new RegExp(x.item, 'i').test(name)) : undefined;
        const asked = a ? a.count : null;
        const max = spec.topUp.max;
        const want = asked === null ? 0 : asked === 'all' ? max : Math.min(Math.max(0, asked), max);
        out.push({ item: refLabel(spec), id: first?.id ?? null, max, held, asked, n: Math.min(want, held) });
    }
    return out;
}

/**
 * The mule's pre-request: while a package is ready (`ready`) and `serve` is within
 * PRE_REQUEST_TILES, request it by lib/trade.ts's click rule (decideTradeClick: never while a
 * trade is open or our last click's result is pending; a click with no reply re-sent after
 * DROPPED_TICKS, a standing request after RESEND_TICKS, in observed ticks). `send` is the player index to click, when a click may go out.
 */
/** Entity interaction must already reach the partner; an overlapping click can auto-step either trader. */
export function deliveryTradeReach(s: BotWorldState | null, serve: string): boolean {
    const p = s?.player;
    const target = s?.nearbyPlayers.find(p => sameName(p.name, serve));
    if (!p || !target || target.reachable === false
        || ![p.worldX, p.worldZ, p.level, target.x, target.z].every(Number.isInteger)
        || Math.abs(p.worldX - target.x) + Math.abs(p.worldZ - target.z) !== 1) return false;
    initPathfinding();
    // The walking snapshot masks doors. Do not infer an immediately operable side beside one.
    if (findDoorsAlongPath([{ x: p.worldX, z: p.worldZ, level: p.level }, { x: target.x, z: target.z, level: p.level }]).length) return false;
    return reached(p.level, p.worldX, p.worldZ, target.x, target.z, 1, 1, 1, 0, -2, 0);
}

export function decidePreRequest(s: BotWorldState, click: ClickCtx, serve: string, ready: boolean, delivery = false): { next: ClickCtx; send?: number } {
    if (!ready || s.trade?.isOpen || (delivery && !deliveryTradeReach(s, serve))) return { next: click };
    const target = s.nearbyPlayers.find(p => sameName(p.name, serve) && p.distance <= PRE_REQUEST_TILES);
    if (!target) return { next: click };
    const d = decideTradeClick(s, click, { noReplyTicks: DROPPED_TICKS });
    return d.action === 'send' ? { next: d.next, send: target.index } : { next: d.next };
}

/** The explicit consecutive delivery group starting at the selected row. */
export function deliveryGroup(ordered: readonly Package[], first: Package): Package[] {
    const group = [first];
    let index = ordered.indexOf(first);
    while (group.at(-1)!.carryNext) {
        const next = ordered[++index];
        if (!next) throw new Error('carryNext requires a next ordered delivery');
        group.push(next);
    }
    return group;
}

/** Freeze full top-up maxima as well as fixed counts before any member becomes ready. */
function fullDeliveryPackage(pkg: Package): Package {
    return { ...pkg, items: pkg.items.map(i => {
        if (!isTopUp(i)) return i;
        const { topUp, ...ref } = i;
        return { ...ref, amount: topUp.max };
    }) };
}

/** Bank-derived reservations and worst-case occupied slots through every trade in a group. */
export function planCarryGroup(group: readonly Package[], bank: BankItem[]): { withdrawals: Withdrawal[]; held: Map<Package, Map<number, number>>; inventory: Map<number, number>; peakSlots: number } {
    const stock = bank.map(b => ({ ...b }));
    const withdrawals: Withdrawal[] = [];
    const held = new Map<Package, Map<number, number>>();
    const inventory = new Map<number, number>();
    const oneSlot = new Set<number>();
    const plans: Array<{ pkg: Package; fixed: Map<number, number> }> = [];
    for (const pkg of group) {
        if (pkg.items.some(i => !isTopUp(i) && i.amount === -1)) throw new Error('carry groups require bounded counts');
        // Resolve each line separately so repeated ids cannot spend the same bank stock twice.
        const counts = new Map<number, number>();
        const fixed = new Map<number, number>();
        for (const item of pkg.items) {
            const full = isTopUp(item) ? { ...item, amount: item.topUp.max } : item;
            const { topUp: _, ...spec } = full as PackageItem & { topUp?: unknown };
            const plan = planPackage({ name: pkg.name, items: [spec as PackageItem] }, stock);
            if (plan.missing.length || plan.ambiguous.length || !plan.withdrawals.length) throw new Error(`carry group short or ambiguous: ${pkg.name} ${refLabel(item)}`);
            const w = plan.withdrawals[0]!;
            const id = w.noted ? noteOf(w.bankItem.id) : w.bankItem.id;
            if (id === undefined) throw new Error(`No banknote for ${w.bankItem.name}`);
            if (counts.has(id)) throw new Error(`Package ${pkg.name}: duplicate carry item ${id}`);
            counts.set(id, w.amount);
            if (!isTopUp(item)) fixed.set(id, w.amount);
            inventory.set(id, (inventory.get(id) ?? 0) + w.amount);
            if (w.noted || isStackableName(w.bankItem.name)) oneSlot.add(id);
            stock.find(b => b.id === w.bankItem.id)!.count -= w.amount;
            withdrawals.push(w);
        }
        held.set(pkg, counts);
        plans.push({ pkg, fixed });
    }
    const remaining = new Map(inventory);
    const slots = () => [...remaining].reduce((n, [id, count]) => n + (count > 0 ? oneSlot.has(id) ? 1 : count : 0), 0);
    let peakSlots = slots();
    let returned = 0;
    for (const { pkg, fixed } of plans) {
        // A top-up can ask for zero, so none of its slots are assumed to be freed.
        for (const [id, count] of fixed) remaining.set(id, remaining.get(id)! - count);
        returned += pkg.takeBackSlots ?? 0;
        peakSlots = Math.max(peakSlots, slots() + returned);
    }
    if (peakSlots > 28) throw new Error(`carry group needs ${peakSlots} slots (maximum 28)`);
    return { withdrawals, held, inventory, peakSlots };
}

// ============ Carried packages (unit tested in mule.test.ts) ============

/** A carried package against the inventory: what serving it takes, by id, and what the inventory lacks. */
export interface CarriedNeeds {
    /** id -> count: a fixed line's amount (everything held for -1), a top-up line's whole holding (the trade clamps it to the ask and max). */
    held: Map<number, number>;
    missing: { item: string; wanted: number; have: number }[];
    /** Lines whose name matches more than one inventory id; the package names them by `id` instead. */
    ambiguous: { item: string; ids: number[] }[];
}

/**
 * Map a carried package onto the inventory, as planPackage maps a banked one onto the bank. A top-up
 * line is never missing (the scored account may ask for none); it is in `held` when any of it is.
 */
export function carriedNeeds(pkg: Pick<Package, 'items'>, inventory: readonly InventoryItem[], pack?: ObjPack): CarriedNeeds {
    const held = new Map<number, number>();
    const missing: CarriedNeeds['missing'] = [];
    const ambiguous: CarriedNeeds['ambiguous'] = [];
    const inv = countById([...inventory]);
    for (const spec of pkg.items) {
        const ids = [...new Set(inventory.filter(i => refMatches(spec, i, pack)).map(i => i.id))];
        if (ids.length > 1) {
            ambiguous.push({ item: refLabel(spec), ids });
            continue;
        }
        const id = ids[0];
        const have = id === undefined ? 0 : (inv.get(id) ?? 0);
        if (isTopUp(spec)) {
            if (id !== undefined) held.set(id, have);
            continue;
        }
        const amount = spec.amount === -1 ? have : spec.amount;
        if (id === undefined || amount <= 0 || have < amount) {
            missing.push({ item: refLabel(spec), wanted: spec.amount, have });
            continue;
        }
        held.set(id, amount);
    }
    return { held, missing, ambiguous };
}

/** CarriedNeeds as a log line's fields. */
export function carriedNeedsLog(n: CarriedNeeds): Record<string, unknown> {
    return { held: Object.fromEntries(n.held), ...(n.missing.length ? { missing: n.missing } : {}), ...(n.ambiguous.length ? { ambiguous: n.ambiguous } : {}) };
}

/** A carried package can be served: every fixed line held, no ambiguous line, and something to offer. */
export function carriedReady(n: CarriedNeeds): boolean {
    return n.missing.length === 0 && n.ambiguous.length === 0 && n.held.size > 0;
}

/**
 * The start-of-login check: what the inventory lacks for every carried package together (fixed
 * amounts plus top-up maxes, summed by line name or id). Empty when the mule is loaded for all of them.
 */
export function carriedShort(pkgs: readonly Package[], inventory: readonly InventoryItem[], pack?: ObjPack): { item: string; wanted: number; have: number }[] {
    const lines = new Map<string, { spec: PackageItem; wanted: number }>();
    for (const spec of pkgs.flatMap(p => p.items)) {
        const n = isTopUp(spec) ? spec.topUp.max : spec.amount;
        if (n < 0) continue;
        const key = spec.id !== undefined ? `#${spec.id}` : spec.item.toLowerCase();
        const line = lines.get(key);
        lines.set(key, { spec, wanted: (line?.wanted ?? 0) + n });
    }
    const out: { item: string; wanted: number; have: number }[] = [];
    for (const { spec, wanted } of lines.values()) {
        const have = inventory.filter(i => refMatches(spec, i, pack)).reduce((n, i) => n + i.count, 0);
        if (have < wanted) out.push({ item: refLabel(spec), wanted, have });
    }
    return out;
}

/**
 * Where a carried mule stands: the pending package's tile; else the first package (in config order)
 * not yet served or withdrawn (`done`) that has one, the next trade's; else the last done one's, so
 * after its last trade it stays put; else `stand`.
 */
export function carriedStand(packages: readonly Package[], pending: Package | null, done: ReadonlySet<string>, stand: Tile): Tile {
    if (pending?.at) return pending.at;
    const next = packages.find(p => p.at && !done.has(p.name));
    if (next?.at) return next.at;
    return [...packages].reverse().find(p => p.at && done.has(p.name))?.at ?? stand;
}

/** RoleState key: the carried packages served, by cue session, so a restarted role never serves one twice. */
export const CARRIED_SERVED_KEY = 'carriedServed';
export interface CarriedServed {
    pkg: string;
    /** The cue session that asked for it ('order' in order mode). */
    session: string;
    ms: number;
}

/** The RoleState record, read defensively: anything that is not a list of entries is none. */
export function carriedServedEntries(value: unknown): CarriedServed[] {
    if (!Array.isArray(value)) return [];
    return value.filter((e): e is CarriedServed => !!e && typeof e.pkg === 'string' && typeof e.session === 'string' && typeof e.ms === 'number');
}

/** Packages served during this login: entries written since its cues started to count (cueEpoch, less STALE_CUE_MS). */
export function carriedDoneSince(entries: readonly CarriedServed[], startMs: number): Set<string> {
    return new Set(entries.filter(e => e.ms >= startMs - STALE_CUE_MS).map(e => e.pkg));
}

/** The atoll's aggressive wildlife (quest_mm.npc, hunt mode aa_aggressive_melee, hunt range 1, any combat level). */
export const DEFAULT_WILDLIFE = ['^jungle spider$', '^scorpion$', '^snake$'];
/** Observed ticks a hit marks its NPC as attacking the mule (an NPC swings every 4). */
export const HIT_MEMORY_TICKS = 8;

/**
 * The NPC to kill before a trade, or null: one that hit the mule in the last HIT_MEMORY_TICKS (a miss
 * counts), else a named aggressive species within `clearTiles` of it (Chebyshev, on the NPC's route
 * tile). Only NPCs with an Attack option, not already dead; a hitter first, then the nearest.
 */
export function wildlifeThreat(s: BotWorldState, patterns: readonly RegExp[], clearTiles: number): NearbyNpc | null {
    const me = s.player;
    if (!me) return null;
    const hitters = new Set((s.combatEvents ?? []).filter(e => e.type === 'damage_taken' && e.sourceType === 'npc' && e.tick > s.tick - HIT_MEMORY_TICKS).map(e => e.sourceIndex));
    const dist = (n: NearbyNpc) => Math.max(Math.abs((n.tileX ?? n.x) - me.worldX), Math.abs((n.tileZ ?? n.z) - me.worldZ));
    const threats = s.nearbyNpcs.filter(
        n => n.hp !== 0 && n.options.some(o => /^attack$/i.test(o)) && (hitters.has(n.index) || (dist(n) <= clearTiles && patterns.some(p => p.test(n.name))))
    );
    threats.sort((a, b) => Number(hitters.has(b.index)) - Number(hitters.has(a.index)) || dist(a) - dist(b));
    return threats[0] ?? null;
}

/** A keep-alive is due when the mule has sent nothing for `everyMs` (0: never). */
export function keepAliveDue(nowMs: number, lastInputMs: number, everyMs: number): boolean {
    return everyMs > 0 && nowMs - lastInputMs >= everyMs;
}

/** The tiles a keep-alive may step to: the four neighbours of `at`, starting at `turn` so successive ones alternate. */
export function keepAliveTiles(at: Tile, turn: number): Tile[] {
    const steps: [number, number][] = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    return steps.map((_, i) => steps[(turn + i) % steps.length]!).map(([dx, dz]) => ({ x: at.x + dx, z: at.z + dz }));
}

export interface KeepAliveResult {
    moved: boolean;
    /** The neighbour it stepped to; null when no step took. */
    to: Tile | null;
    ticks: number;
}

/**
 * One keep-alive: a walk click to a neighbouring tile and one back to `at`. A click on the tile the
 * player stands on sends no packet at all (the client's route finds no step; lite movement.ts), so the
 * one input that changes nothing in the game has to be a step. A neighbour it cannot step onto within
 * `maxTicks` is skipped for the next.
 */
export async function keepAliveStep(sdk: StateSource & Pick<BotSDK, 'sendWalk'>, at: Tile, turn: number, maxTicks = 4): Promise<KeepAliveResult> {
    const t0 = sdk.getState()?.tick ?? 0;
    const off = (s: BotWorldState) => !!s.player && (s.player.worldX !== at.x || s.player.worldZ !== at.z);
    for (const to of keepAliveTiles(at, turn)) {
        void sdk.sendWalk(to.x, to.z, false);
        if (!(await waitUntil(sdk, off, { maxTicks })).ok) continue;
        void sdk.sendWalk(at.x, at.z, false);
        await waitUntil(sdk, s => !!s.player && !off(s), { maxTicks });
        return { moved: true, to, ticks: (sdk.getState()?.tick ?? t0) - t0 };
    }
    return { moved: false, to: null, ticks: (sdk.getState()?.tick ?? t0) - t0 };
}

/** Bank items a courier should carry: every item matching a pattern, noted, up to `freeSlots` types. */
export function courierPicks(bank: BankItem[], patterns: RegExp[], freeSlots: number): BankItem[] {
    return bank
        .filter(b => b.count > 0 && patterns.some(p => p.test(b.name)))
        .slice(0, Math.max(0, freeSlots));
}

// ============ Chat cursors ============

/** Unseen messages of some chat types. Requests that land between polls are never lost. */
export class ChatCursor {
    private seen: number;
    constructor(
        private readonly sdk: BotSDK,
        private readonly types: number[]
    ) {
        this.seen = this.maxKey(this.read());
    }
    private read(): GameMessage[] {
        return this.sdk.getChat({ types: this.types, limit: 100, includeSelf: false });
    }
    private key(m: GameMessage): number {
        return m.observationId ?? m.tick;
    }
    private maxKey(ms: GameMessage[]): number {
        return ms.reduce((max, m) => Math.max(max, this.key(m)), -1);
    }
    next(): GameMessage[] {
        const ms = this.read();
        const fresh = ms.filter(m => this.key(m) > this.seen);
        this.seen = Math.max(this.seen, this.maxKey(ms));
        return fresh;
    }
}

// ============ Small SDK helpers ============

function tick(sdk: BotSDK): number {
    return sdk.getState()?.tick ?? 0;
}

async function nextTick(sdk: BotSDK, maxMs = 5 * tickMs()): Promise<void> {
    const t = tick(sdk);
    await sdk.waitForCondition(s => s.tick > t, maxMs).catch(() => {});
}

function freeSlots(sdk: BotSDK): number {
    return 28 - sdk.getInventory().length;
}

function bankSnapshot(sdk: BotSDK) {
    return { items: sdk.getBankItems().map(b => ({ id: b.id, name: b.name, count: b.count })) };
}

/**
 * The SDK derives its HTTP origin for GE availability and market reads from the
 * gateway URL (sdk/index.ts buildClientUrl), so behind a loopback gateway, as the
 * fleet runs, it asks localhost:8888 and every GE action fails with "Unable to
 * connect". Point it at the game server named by SERVER instead.
 */
export function pointMarketAtServer(sdk: BotSDK, server = process.env.SERVER): void {
    const config = (sdk as unknown as { config?: { browserLaunchUrl?: string } }).config;
    if (!config || !server || config.browserLaunchUrl) return;
    const host = server.replace(/^wss?:\/\//, '').replace(/\/.*$/, '');
    config.browserLaunchUrl = /^(localhost|127\.)/.test(host) ? `http://${host}/bot` : `https://${host}/bot`;
}

export async function ensureOutOfTutorial(ctx: RoleContext): Promise<void> {
    const { sdk, bot } = ctx;
    await sdk.waitForReady(30_000).catch(() => {});
    for (let i = 0; i < 30; i++) {
        const p = sdk.getState()?.player;
        if (p && !onTutorialIsland(p.worldX, p.worldZ)) return;
        if (i === 0) ctx.log('skipping tutorial', { x: p?.worldX, z: p?.worldZ });
        await bot.skipTutorial();
        await sdk.waitForTicks(2).catch(() => {});
    }
    throw new Error('Could not leave the tutorial');
}

function distanceTo(sdk: BotSDK, x: number, z: number): number {
    const p = sdk.getState()?.player;
    if (!p) return Infinity;
    return Math.max(Math.abs(p.worldX - x), Math.abs(p.worldZ - z));
}

/** Walk near (x, z), paying the Al Kharid toll gate when it stands between (speedrun/lib/toll-gate.ts). */
export async function walkNear(ctx: RoleContext, x: number, z: number, tolerance: number): Promise<boolean> {
    return (await travelTo(ctx.bot, ctx.sdk, { x, z }, { tolerance, log: ctx.log, signal: ctx.signal })).ok;
}

export async function openBank(ctx: RoleContext): Promise<boolean> {
    if (ctx.sdk.isBankOpen()) return true;
    for (let attempt = 0; attempt < 3; attempt++) {
        const r = await ctx.bot.openBank();
        if (r.success) return true;
        ctx.log('openBank failed', { result: r.message });
        await ctx.sdk.waitForTicks(2).catch(() => {});
    }
    return false;
}

export async function closeBank(ctx: RoleContext): Promise<void> {
    if (ctx.sdk.isBankOpen()) await ctx.bot.closeBank();
}

/**
 * Deposit every inventory item whose id is not in `keep`, one "All" per item id,
 * sent without waiting between them (the server drains 5 per tick in order), then
 * confirmed once from state. Kept separate so it can switch to speedrun/lib/bank.ts.
 */
export async function depositAllExcept(sdk: BotSDK, keep: Map<number, number> = new Map()): Promise<boolean> {
    const targets = firstSlotPerId(sdk.getInventory()).filter(i => !keep.has(i.id));
    if (targets.length === 0) return true;
    await Promise.all(targets.map(i => sdk.sendBankDeposit(i.slot, -1)));
    const ids = new Set(targets.map(i => i.id));
    // The server drains 5 a tick: ceil(n / 5) ticks, with slack for the bank's own delay.
    return (await waitUntil(sdk, s => !s.inventory.some(i => ids.has(i.id)), { maxTicks: 17 + 2 * targets.length })).ok;
}

// ============ Giver ============

export type GiverMode = 'burst' | 'stock';

export interface GiveResult {
    success: boolean;
    message: string;
    /** Server ticks from the trade being open to the items leaving this inventory. */
    ticks: number;
    gave: TradeItem[];
    received: TradeItem[];
    /** Confirmation may have committed without an observed outcome; never restock/replay automatically. */
    uncertain?: true;
}

function diffItems(before: InventoryItem[], after: InventoryItem[]): { gained: TradeItem[]; lost: TradeItem[] } {
    const b = countById(before);
    const a = countById(after);
    const names = new Map<number, string>();
    for (const i of [...before, ...after]) names.set(i.id, i.name);
    const gained: TradeItem[] = [];
    const lost: TradeItem[] = [];
    for (const id of new Set([...a.keys(), ...b.keys()])) {
        const d = (a.get(id) ?? 0) - (b.get(id) ?? 0);
        const name = names.get(id) ?? 'Unknown';
        if (d > 0) gained.push({ slot: -1, id, name, count: d });
        if (d < 0) lost.push({ slot: -1, id, name, count: -d });
    }
    return { gained, lost };
}

/**
 * Give `items` (inventory entries; all of each id) to `partner` in the trade that
 * is already open with them. The one function both modes sit behind, so the
 * implementation can switch to speedrun/lib/trade.ts when it lands.
 *
 * burst: speedrun/lib/trade.ts give(), the one giver implementation: every offer
 *   (one exact-count press per id) plus the accept, sent back to back, so the
 *   server's 5-per-tick drain lands the accept after the last offer. Whatever the
 *   partner puts up is accepted (ANY_OFFER: the scored account may hand items back
 *   in the same trade, the two-way swap), re-accepted after any offer resets both
 *   accepts, and the confirm screen is accepted once our own offer is exactly
 *   `items` and the partner is exactly `partner`; any mismatch declines. A decline
 *   after our confirm accept is settled on the server's word (lib/trade.ts).
 * stock: the SDK's bot.trade (offers one item at a time, waiting for each).
 *
 * `amounts` offers an exact count of an id instead of all of it (a top-up line), and none at 0.
 */
export async function giveOpenTrade(
    sdk: BotSDK,
    bot: BotActions,
    partner: string,
    items: InventoryItem[],
    mode: GiverMode = 'burst',
    timeoutMs = 60_000,
    amounts?: ReadonlyMap<number, number>,
    stopIf?: (s: BotWorldState) => string | null
): Promise<GiveResult> {
    const startTick = tick(sdk);
    const invBefore = sdk.getInventory();
    const expected = countById(items);
    const done = (success: boolean, message: string): GiveResult => {
        const { gained, lost } = diffItems(invBefore, sdk.getInventory());
        return { success, message, ticks: tick(sdk) - startTick, gave: lost, received: gained };
    };

    const open = sdk.getTradeState();
    if (!open.isOpen || !accountMatches(open.partner, new RegExp(`^${escapeRegExp(canonName(partner))}$`))) {
        return done(false, `No trade open with ${partner} (open: ${open.isOpen}, partner: ${open.partner})`);
    }

    const count = (id: number): number | 'all' => amounts?.get(id) ?? 'all';
    // Each id from its lowest slot, offered in the order the ids first appear in `items` (X counts still go last, planOffers).
    const first = new Map(firstSlotPerId(items).map(i => [i.id, i]));
    const offered = [...new Set(items.map(i => i.id))].map(id => first.get(id)!).filter(i => count(i.id) !== 0);
    if (mode === 'stock') {
        const names = offered.map(i => {
            const n = count(i.id);
            return { item: new RegExp(`^${escapeRegExp(i.name)}$`, 'i'), amount: n === 'all' ? -1 : n };
        });
        const r = await bot.trade(playerPattern(partner), { give: names, timeout: timeoutMs });
        return { success: r.success, message: r.message, ticks: tick(sdk) - startTick, gave: r.gave, received: r.received };
    }

    const specs = offered.map(i => ({ item: i.id, n: count(i.id) }));
    // Settlement is the giver's to observe. The receiver closes its cue on its own completion frame,
    // so once the confirm screen was seen, the completion frames (the trade closed, or the confirm
    // screen's offers emptied while the server exchanges) are settlement, not a cancellation:
    // lib/trade.ts's give() declines on any stop, so the stop is withheld there and give() reads the
    // outcome. A stop on any other frame declines as before. A trade that fails after the confirm
    // screen was seen is uncertain: reconciled, never replayed.
    let confirmSeen = false;
    const settlingStop = stopIf && ((s: BotWorldState) => {
        const t = s.trade;
        if (t?.isOpen && t.screen === 'confirm' && t.myOffer.length > 0) confirmSeen = true;
        const completing = confirmSeen && (!t?.isOpen || (t.screen === 'confirm' && t.myOffer.length === 0));
        return completing ? null : stopIf(s);
    });
    const r = await give(sdk, partner, specs, { expectTheirs: ANY_OFFER, maxTicks: Math.ceil(timeoutMs / tickMs()), openMaxTicks: 17, ...(settlingStop ? { stopIf: settlingStop } : {}) });
    const { gained } = diffItems(invBefore, sdk.getInventory());
    const message = r.ok ? `Gave package to ${partner}${r.reason ? ` (${r.reason})` : ''}` : `Not given: ${r.reason ?? 'unknown'}`;
    return { success: r.ok, message, ticks: r.ticks, gave: r.gave, received: gained, ...(!r.ok && confirmSeen ? { uncertain: true as const } : {}) };
}

export interface ServeOptions {
    partner: string;
    pkg: Package;
    /** The staged package's ids and counts (Mule.held). */
    held: ReadonlyMap<number, number>;
    mode?: GiverMode;
    timeoutMs?: number;
    /** Where and how long to wait for the scored account's ask; required for a package with a top-up (the scope is the package's). */
    ask?: Omit<AwaitAskOptions, 'scope'>;
    log?: (message: string, data?: Record<string, unknown>) => void;
    /**
     * Offer each id's count in `held`, not all of it (carried mode: the inventory holds the other
     * packages too). A top-up line's count still comes from the ask.
     */
    exact?: boolean;
    stopIf?: (s: BotWorldState) => string | null;
}

export interface ServeResult extends GiveResult {
    /** Each top-up line's count (topUpCounts); empty for a fixed package. */
    topUps: TopUpServe[];
    /** The ask it served, or null. */
    ask: TopUpAsk | null;
}

/**
 * `items` in the package's line order (then by slot), so the offers follow the lines whatever slot each
 * sits in: H12oP's Superantipoison(4), a one-press All, goes before its sharks for every ask.
 */
export function byPackageLine(pkg: Pick<Package, 'items'>, items: readonly InventoryItem[], pack?: ObjPack): InventoryItem[] {
    const line = (i: InventoryItem) => {
        const n = pkg.items.findIndex(spec => refMatches(spec, i, pack));
        return n < 0 ? pkg.items.length : n;
    };
    return [...items].sort((a, b) => line(a) - line(b) || a.slot - b.slot);
}

/**
 * Give the staged package in the trade open with `partner`. A fixed package is all of each
 * staged id, as ever. A package with a top-up first waits for the scored account's ask (altar-cue.ts
 * awaitAsk, scoped to the package) and offers each top-up line's topUpCounts count.
 */
export async function serveStaged(sdk: BotSDK, bot: BotActions, o: ServeOptions): Promise<ServeResult> {
    const items = byPackageLine(o.pkg, sdk.getInventory().filter(i => o.held.has(i.id)));
    const mode = o.mode ?? 'burst';
    const timeoutMs = o.timeoutMs ?? 60_000;
    const fixed = o.exact ? new Map(o.held) : undefined;
    if (!o.pkg.items.some(isTopUp)) return { ...(await giveOpenTrade(sdk, bot, o.partner, items, mode, timeoutMs, fixed, o.stopIf)), topUps: [], ask: null };
    if (!o.pkg.scope || !o.ask) throw new Error(`Package ${o.pkg.name} has a top-up: it needs a scope and the ask's options`);
    const ask = await awaitAsk(sdk, { ...o.ask, scope: o.pkg.scope });
    const topUps = topUpCounts(o.pkg, items, ask);
    const unserved = topUps.filter(t => t.asked === null || t.n < Math.min(t.asked === 'all' ? t.max : t.asked, t.max));
    if (!ask) o.log?.('top-up: no usable ask; offering none of the top-up lines', { package: o.pkg.name, scope: o.pkg.scope, waitedTicks: o.ask.maxTicks });
    else if (unserved.length) o.log?.('top-up: short of the ask', { package: o.pkg.name, lines: unserved });
    const amounts = new Map([...(fixed ?? []), ...topUps.flatMap(t => (t.id === null ? [] : [[t.id, t.n] as const]))]);
    return { ...(await giveOpenTrade(sdk, bot, o.partner, items, mode, timeoutMs, amounts, o.stopIf)), topUps, ask };
}

// ============ Receiver (the scored account's side) ============

export interface ReceiveOptions {
    /** The mule's account name. */
    mule: string;
    /**
     * What the offer must contain before accepting (re-checked on the confirm
     * screen). Without it, the receiver accepts once the mule has accepted its own
     * offer, which the burst giver does right after its last item.
     */
    want?: TradeItemSpec[];
    timeoutMs?: number;
}

export interface ReceiveResult {
    success: boolean;
    message: string;
    /** Ticks on this account's clock from the trade request to the items in the inventory. */
    ticks: number;
    received: TradeItem[];
}

/**
 * Receive a package from the mule. Sends one trade request (which opens the
 * trade at once when the mule has already requested this account), accepts the
 * moment the offer is complete, re-verifies on the confirm screen, and returns
 * when the items are in the inventory. Gives nothing.
 */
export async function receivePackage(sdk: BotSDK, bot: BotActions, options: ReceiveOptions): Promise<ReceiveResult> {
    const startTick = tick(sdk);
    const invBefore = sdk.getInventory();
    const deadline = Date.now() + (options.timeoutMs ?? 60_000);
    const exact = new RegExp(`^${escapeRegExp(canonName(options.mule))}$`);
    const result = (success: boolean, message: string): ReceiveResult => ({
        success,
        message,
        ticks: tick(sdk) - startTick,
        received: diffItems(invBefore, sdk.getInventory()).gained
    });

    // lib/trade.ts openTrade re-sends a busy refusal (the mule is briefly "busy" while its bank is
    // open, re-arming the next package) on the frame that shows it.
    const opened = await openTrade(sdk, options.mule, { timeoutMs: Math.max(1, deadline - Date.now()) });
    if (!opened.ok) return result(false, `Trade not opened: ${opened.reason}`);

    const complete = (offer: TradeItem[], partnerAccepted: boolean): boolean =>
        offer.length > 0 && (options.want ? offerSatisfies(options.want, offer) : partnerAccepted);

    let lastAcceptTick = -1;
    let closedTicks = 0;
    let theirFinal: TradeItem[] = [];
    while (Date.now() < deadline) {
        const t = sdk.getTradeState();
        const now = tick(sdk);
        if (!t.isOpen) {
            const got = countById(diffItems(invBefore, sdk.getInventory()).gained);
            if (theirFinal.length > 0 && holds(got, countById(theirFinal))) return result(true, 'Received package');
            if (++closedTicks >= 3) return result(false, 'Trade closed before completion');
        } else {
            closedTicks = 0;
            if (!accountMatches(t.partner, exact)) {
                await bot.declineTrade();
                return result(false, `Declined: partner is ${t.partner}`);
            }
            if (t.screen === 'offer' && complete(t.theirOffer, t.partnerAccepted) && !t.myAccepted && now !== lastAcceptTick) {
                lastAcceptTick = now;
                await sdk.sendAcceptTrade();
            } else if (t.screen === 'confirm') {
                if (options.want && !offerSatisfies(options.want, t.theirOffer)) {
                    await bot.declineTrade();
                    return result(false, 'Declined: confirm screen offer does not satisfy want');
                }
                theirFinal = t.theirOffer;
                if (!t.myAccepted && now !== lastAcceptTick) {
                    lastAcceptTick = now;
                    await sdk.sendAcceptTrade();
                }
            }
        }
        // Wait on any state update, not only a new tick: the inventory update and the
        // screen change can land mid-tick and the result should be observed at once.
        await sdk.waitForStateChange(1_000).catch(() => {});
    }
    if (sdk.getTradeState().isOpen) await bot.declineTrade();
    return result(false, 'Timed out');
}

// ============ Mule ============

export interface GeOrder {
    /** Exact item name as in the bank. */
    item: string;
    quantity: number | 'all';
    /** Price per item in coins. */
    price: number;
    /**
     * Fill the scored account's standing buy offer: list only while the market's
     * best bid equals `price` (so the fill goes to that bidder, not a higher one).
     */
    fill?: boolean;
}

export interface MuleOptions {
    /** The scored account served with packages (and allowed to trade). */
    serve?: string;
    /** Courier account-name RegExp source(s), matched against login names. */
    couriers?: string | string[];
    packages?: Package[];
    /**
     * 'request': serve only the package a cue asks for (packageForCue: a cue in `cueDir` scoped to the
     * package's hand-off, written by the scored side before the hand-off). 'order': serve the packages
     * not marked onRequest in order, one per trade from `serve`; a cue still asks for any package.
     */
    serveMode?: 'order' | 'request';
    giver?: GiverMode;
    /** Send `serve` a trade request when a package is ready and it comes within 12 tiles. Default true. */
    preRequest?: boolean;
    stand?: { x: number; z: number };
    ge?: { orders?: GeOrder[]; collectEveryMin?: number };
    /** Observed ticks a top-up package waits after the open for the scored account's ask. Default 3. */
    askWaitTicks?: number;
    /** Where package cues and top-up asks are read (altar-cue.ts cueDir: RC_CUE_DIR, else run-machine/rc-cue). */
    cueDir?: string;
    /** The packages are in the inventory from login, served where each package's `at` says; no bank, no GE. */
    carried?: boolean;
    /** Unique run identity for automatic ledger-order staging and session-bound delivery readiness. */
    deliveryRun?: string;
    /** NPC name RegExp sources to kill within `clearTiles` before a trade, with any NPC that hits the mule. Default DEFAULT_WILDLIFE when carried, else none ([] turns it off). */
    wildlife?: string | string[];
    /** Chebyshev tiles from the mule a named NPC is cleared within. Default 1 (the atoll wildlife's hunt range). */
    clearTiles?: number;
    /** Minutes without input before a keep-alive step (keepAliveStep); 0 never. Default 5 when carried, else 0. */
    keepAliveMinutes?: number;
}

/** A cue older than this when the mule starts is a past hand-off's, never served. */
export const STALE_CUE_MS = 60_000;

/**
 * Where the mule's cues start to count (newCue's `startMs`): its start, or, for an account the
 * launcher logged in on a cue (standalone.ts loginOn), that cue's write (LOGIN_CUE_MS) when it is
 * earlier. The login can take longer than STALE_CUE_MS, and the cue that logged the mule in is the
 * request it is there to serve.
 */
export function cueEpoch(env: Record<string, string | undefined> = process.env, now = Date.now()): number {
    const ms = Number(env.LOGIN_CUE_MS);
    return Number.isFinite(ms) && ms > 0 ? Math.min(now, ms) : now;
}

/**
 * The cue half of a `deliveryRun` carrier's trade authorization (Mule.deliveryAuthorized): the live,
 * unstopped {row, mule} cue under the row's delivery session, for `serve`, written within STALE_CUE_MS.
 */
export function deliveryCueAuthorizes(cue: Cue | null, o: { session: string; row: string; serve: string; now?: number }): boolean {
    const now = o.now ?? Date.now();
    return !!cue && !cue.stop && cue.session === o.session
        && cue.scope?.family === 'mule' && cue.scope.step === o.row
        && cue.receiver?.sha256 === nameHash(o.serve)
        && cue.ms <= now && now - cue.ms <= STALE_CUE_MS;
}

/** A cue the mule has not acted on yet: a new session, or a later write of the last one. */
export function newCue(cue: Pick<Cue, 'session' | 'seq' | 'ms'> | null, last: { session: string; seq: number } | null, startMs: number): boolean {
    if (!cue || cue.ms < startMs - STALE_CUE_MS) return false;
    return !last || cue.session !== last.session || cue.seq > last.seq;
}

/**
 * What a mule cue does. A cue session asks once: its first write the mule sees is the request
 * (`ask`); a later write of the same session (fresh beacons) asks nothing again, so a package served
 * is never re-staged by its own cue. A write with `stop` (any seq, either session) withdraws the
 * request (`stop`): the package, if still pending, is dropped. So one writer per hand-off (the run's
 * cue keeper, or requestPackage) may rewrite and stop its cue freely.
 */
export function muleCueAction(cue: Pick<Cue, 'session' | 'seq' | 'ms' | 'stop'> | null, last: { session: string; seq: number } | null, startMs: number): 'ask' | 'stop' | 'none' {
    if (!newCue(cue, last, startMs)) return 'none';
    if (cue!.stop) return 'stop';
    return !last || cue!.session !== last.session ? 'ask' : 'none';
}

/** A package's lines from options: `{ item | id, amount, noted? }`, or `{ item | id, topUp: { max }, noted? }`. */
export function packageItems(name: string, items: unknown, pack?: ObjPack): PackageItem[] {
    if (!Array.isArray(items)) throw new Error(`Package ${name}: items must be a list`);
    return (items as Record<string, unknown>[]).map((raw, j) => {
        const where = `Package ${name} item ${j}`;
        const ref = itemRef(raw ?? {}, where, pack);
        if (raw.topUp !== undefined) {
            if (raw.amount !== undefined) throw new Error(`${where}: a top-up takes its count from the ask, so it has no amount`);
            const max = Number((raw.topUp as { max?: unknown } | null)?.max);
            if (!Number.isInteger(max) || max < 1) throw new Error(`${where}: topUp.max must be a whole number of at least 1`);
            if (raw.noted !== undefined && typeof raw.noted !== 'boolean') throw new Error(`${where}: noted must be true or false`);
            if (raw.noted === false && namesNote(ref, pack)) throw new Error(`${where}: obj ${ref.id} is a note, so it cannot be noted: false`);
            return { ...ref, topUp: { max }, ...(typeof raw.noted === 'boolean' ? { noted: raw.noted } : {}) };
        }
        const amount = Number(raw.amount);
        if (!Number.isInteger(amount) || (amount < 1 && amount !== -1)) throw new Error(`Package ${name}: bad amount for ${refLabel(ref)}`);
        if (raw.noted !== undefined && typeof raw.noted !== 'boolean') throw new Error(`${where}: noted must be true or false`);
        if (raw.noted === false && namesNote(ref, pack)) throw new Error(`${where}: obj ${ref.id} is a note, so it cannot be noted: false`);
        return { ...ref, amount, ...(typeof raw.noted === 'boolean' ? { noted: raw.noted } : {}) };
    });
}

/**
 * A package from options. One with a top-up line needs `scope: { step, family: 'mule' }`, the ask
 * it reads; a fixed package takes no scope, and comes back exactly as before (name and items).
 */
export function packageOf(raw: unknown, pack?: ObjPack): Package {
    const p = (raw ?? {}) as Record<string, unknown>;
    const name = String(p.name);
    const items = packageItems(name, p.items, pack);
    if (p.onRequest !== undefined && typeof p.onRequest !== 'boolean') throw new Error(`Package ${name}: onRequest must be true or false`);
    const onRequest = p.onRequest === true ? { onRequest: true as const } : {};
    const at = p.at === undefined ? {} : { at: tileOption(p.at, `Package ${name} at`) };
    const bank = p.bank === undefined ? {} : { bank: worldTile(p.bank, `Package ${name} bank`) };
    if (p.carryNext !== undefined && p.carryNext !== true) throw new Error(`Package ${name}: carryNext must be true`);
    if (p.takeBackSlots !== undefined && (typeof p.takeBackSlots !== 'number' || !Number.isInteger(p.takeBackSlots) || p.takeBackSlots < 0 || p.takeBackSlots > 28)) throw new Error(`Package ${name}: takeBackSlots must be an integer from 0 to 28`);
    const carry = { ...(p.carryNext === true ? { carryNext: true as const } : {}), ...(p.takeBackSlots === undefined ? {} : { takeBackSlots: p.takeBackSlots as number }) };
    if (!items.some(isTopUp)) {
        // The scope keys the package for a cue (its hand-off id); a fixed package may go without.
        const scope = p.scope === undefined ? {} : { scope: scopeOption(p.scope, ['mule'], `Package ${name} scope`) };
        return { name, items, ...scope, ...onRequest, ...at, ...bank, ...carry };
    }
    const labels = items.map(i => refLabel(i).toLowerCase());
    for (const t of items.filter(isTopUp)) {
        const l = refLabel(t).toLowerCase();
        if (labels.filter(x => x === l).length > 1) throw new Error(`Package ${name}: ${refLabel(t)} is a top-up line and another line too`);
    }
    return { name, items, scope: scopeOption(p.scope, ['mule'], `Package ${name} scope`), ...onRequest, ...at, ...bank, ...carry };
}

/** A tile from options: `{ x, z }`, whole numbers. */
export function tileOption(raw: unknown, where: string): Tile {
    const t = (raw ?? {}) as Record<string, unknown>;
    const x = t.x;
    const z = t.z;
    if (typeof x !== 'number' || typeof z !== 'number' || !Number.isSafeInteger(x) || !Number.isSafeInteger(z) || x < 0 || z < 0) throw new Error(`${where} must be { x, z } in whole tiles (got ${JSON.stringify(raw)})`);
    const level = t.level;
    if (level !== undefined && (!Number.isInteger(level) || Number(level) < 0 || Number(level) > 3)) throw new Error(`${where}: invalid plane`);
    return { x, z, ...(level === undefined ? {} : { level: Number(level) }) };
}

export function muleOptions(raw: Record<string, unknown>, env: Record<string, string | undefined> = process.env): Required<Omit<MuleOptions, 'serve' | 'ge'>> & Pick<MuleOptions, 'serve' | 'ge'> {
    const o = raw as MuleOptions;
    const packages = (o.packages ?? []).map(p => packageOf(p));
    if ('requestFile' in raw) throw new Error('requestFile is gone: a package is asked for by a cue scoped { step: <hand-off id>, family: "mule" } in cueDir (mule.md)');
    const askWaitTicks = Number(o.askWaitTicks ?? 3);
    if (!Number.isInteger(askWaitTicks) || askWaitTicks < 0) throw new Error(`askWaitTicks must be a whole number (got ${o.askWaitTicks})`);
    if (o.carried !== undefined && typeof o.carried !== 'boolean') throw new Error('carried must be true or false');
    const carried = o.carried === true;
    const deliveryRun = o.deliveryRun ?? '';
    if (o.deliveryRun !== undefined) {
        deliverySession(deliveryRun, 'validate');
        if (carried || o.ge) throw new Error('deliveryRun is banked delivery; carried packages and GE use their own lifecycle');
        if (o.giver && o.giver !== 'burst') throw new Error('deliveryRun requires the observable burst trade protocol');
        if (!o.serve?.trim()) throw new Error('deliveryRun requires serve');
        if (!packages.length) throw new Error('deliveryRun requires a nonempty itinerary');
        const rows = new Set<string>();
        for (const p of packages) {
            if (!p.scope || p.scope.family !== 'mule') throw new Error(`Package ${p.name}: delivery requires mule scope`);
            deliverySession(deliveryRun, p.scope.step);
            if (rows.has(p.scope.step)) throw new Error(`Duplicate delivery row ${p.scope.step}`);
            rows.add(p.scope.step);
            worldTile(p.at, `Package ${p.name} at`);
            worldTile(p.bank, `Package ${p.name} bank`);
            for (const item of p.items) {
                if (item.id === undefined) throw new Error(`Package ${p.name}: delivery requires a canonical object id`);
                if (untradeable(item.id)) throw new Error(`Package ${p.name}: obj ${item.id} is untradeable`);
            }
        }
    }
    const ordered = packages.filter(p => !p.onRequest);
    for (const p of packages) {
        if ((p.carryNext || p.takeBackSlots !== undefined) && !deliveryRun) throw new Error(`Package ${p.name}: carry metadata requires deliveryRun`);
        if (!p.carryNext) continue;
        if (p.onRequest || !ordered[ordered.indexOf(p) + 1]) throw new Error(`Package ${p.name}: carryNext requires a next ordered delivery`);
        for (const member of deliveryGroup(ordered, p)) {
            if (member.items.some(i => !isTopUp(i) && i.amount === -1)) throw new Error(`Package ${member.name}: carry groups require bounded counts`);
        }
    }
    const tiled = packages.filter(p => p.at || p.bank).map(p => p.name);
    if (!carried && !deliveryRun && tiled.length) throw new Error(`Package tiles are for carried packages only unless deliveryRun binds explicit banked delivery (${tiled.join(', ')})`);
    if (carried && o.ge) throw new Error('A carried mule has no bank, so no GE orders');
    const keepAliveMinutes = Number(o.keepAliveMinutes ?? (carried || deliveryRun ? 5 : 0));
    if (!Number.isFinite(keepAliveMinutes) || keepAliveMinutes < 0) throw new Error(`keepAliveMinutes must be 0 or more (got ${o.keepAliveMinutes})`);
    const clearTiles = Number(o.clearTiles ?? 1);
    if (!Number.isInteger(clearTiles) || clearTiles < 0) throw new Error(`clearTiles must be a whole number (got ${o.clearTiles})`);
    return {
        carried,
        deliveryRun,
        wildlife: o.wildlife ?? (carried ? DEFAULT_WILDLIFE : []),
        clearTiles,
        keepAliveMinutes,
        askWaitTicks,
        cueDir: typeof o.cueDir === 'string' ? o.cueDir : cueDir(env),
        serve: o.serve,
        couriers: o.couriers ?? (deliveryRun ? [] : DEFAULT_COURIERS),
        packages,
        serveMode: o.serveMode ?? 'order',
        giver: o.giver ?? 'burst',
        preRequest: o.preRequest ?? true,
        stand: o.stand ?? (deliveryRun ? packages[0]!.at! : MULE_STAND),
        ge: o.ge
    };
}

class Mule {
    private readonly o: ReturnType<typeof muleOptions>;
    private readonly courierPatterns: RegExp[];
    private readonly requests: ChatCursor;
    /** The last mule cue acted on, and when this role's cues start to count (cueEpoch; a cue older than that, less STALE_CUE_MS, is a past one). */
    private lastCue: { session: string; seq: number } | null = null;
    private readonly startMs = cueEpoch();
    /** Package to serve next, or null. */
    private pending: Package | null = null;
    /** Order mode's packages: every package but those served only on request. */
    private readonly ordered: Package[];
    private nextIndex = 0;
    /** Ids/counts of the pending package while it sits in the inventory. */
    private held: Map<number, number> | null = null;
    /** Full frozen carry inventory, including only confirmed incoming trade items. */
    private carryStage: ReturnType<typeof planCarryGroup> | null = null;
    private shortSince = 0;
    private needsBank = true;
    private lastPreRequest = 0;
    /** The pre-request's clicks (lib/trade.ts decideTradeClick). */
    private click: ClickCtx = newClickCtx();
    private lastGeCollect = 0;
    private readonly geDone = new Set<string>();
    private current = 'start';
    /** Date.now() at the first frame showing the current trade open (altar-cue.ts usableAsk). */
    private openSeenMs = 0;
    /** Date.now() of the last top-up ask served. */
    private lastAskMs = 0;
    /** The cue session that asked for the pending package ('order' when order mode made it pending). */
    private pendingSession = 'order';
    /** Carried mode: packages served or withdrawn this login, whose tiles the mule has moved past (carriedStand). */
    private readonly done = new Set<string>();
    private readonly wildlife: RegExp[];
    /** The tile the mule last walked to; a different standTile() walks it there at once. */
    private lastStand: Tile | null = null;
    /** Date.now() of the mule's last input (a walk, a click, a fight): the keep-alive's clock. */
    private lastInputMs = Date.now();
    private keepAlives = 0;
    private travelling = false;
    private deliveryFault = false;
    private deliveryPaused = false;
    private preparationSeq = 0;
    private consumedPreparation = 0;
    private observedTick = -1;
    private observedMs = 0;
    private settledAfterTick = -1;
    /** The served hand-off whose receiving cue has not yet been closed; the helper keeps its stand meanwhile. */
    private awaitingStop: { session: string; row: string } | null = null;
    /** That session's cue ended with a final stop: service is over and the helper never moves again. */
    private finalStopped = false;

    private controlAllowsDelivery(): boolean {
        const control = readMulePreparation(this.o.cueDir, this.ctx.account);
        if (!control) return !existsSync(mulePreparationPath(this.o.cueDir, this.ctx.account));
        if (control.op !== 'prepare') return false;
        const pkg = this.o.packages.find(p => p.scope?.step === control.row);
        return control.runId === this.o.deliveryRun && !!pkg
            && control.receiverHash === nameHash(this.o.serve!) && sameWorldTile(control.at, pkg.at);
    }

    /** This run's matching initial hold: logged in and stationary, never banking, walking or trading. */
    private heldControl(): MuleHold | null {
        if (!this.o.deliveryRun) return null;
        const control = readMulePreparation(this.o.cueDir, this.ctx.account);
        if (control?.op !== 'hold' || control.runId !== this.o.deliveryRun) return null;
        const pkg = this.o.packages.find(p => p.scope?.step === control.row);
        return pkg && control.receiverHash === nameHash(this.o.serve!) && sameWorldTile(control.at, pkg.at)
            && !this.deliveryWasServed(pkg) ? control : null;
    }

    private async syncPreparation(): Promise<void> {
        if (!this.o.deliveryRun) return;
        const control = readMulePreparation(this.o.cueDir, this.ctx.account);
        this.deliveryPaused = !this.controlAllowsDelivery();
        const hold = this.heldControl();
        if (hold && hold.seq > this.consumedPreparation) {
            // Held status needs a new frame after this point; only this run's prepare releases it.
            this.consumedPreparation = hold.seq;
            this.preparationSeq = hold.seq;
            this.settledAfterTick = this.observedTick;
            this.ctx.log('delivery held', { row: hold.row, seq: hold.seq, attempt: hold.attempt });
            this.publishDelivery();
            return;
        }
        if (!control || this.deliveryPaused || control.op !== 'prepare' || control.seq <= this.consumedPreparation) return;
        const pkg = this.o.packages.find(p => p.scope?.step === control.row);
        if (!pkg || control.receiverHash !== nameHash(this.o.serve!) || !sameWorldTile(control.at, pkg.at)) {
            this.deliveryPaused = true;
            this.ctx.log('delivery preparation refused', { row: control.row, seq: control.seq });
            return;
        }
        // A future preparation may arrive while the previous receiving step still owns its cue.
        const active = readCue(this.o.cueDir);
        if (pkg !== this.pending && (this.ctx.sdk.getTradeState().isOpen
            || (active && !active.stop && active.session === this.pendingSession))) return;
        this.consumedPreparation = control.seq;
        this.preparationSeq = control.seq;
        this.settledAfterTick = this.observedTick;
        if (this.deliveryWasServed(pkg)) {
            this.ctx.log('delivery already served', { row: control.row, session: control.session });
            this.publishDelivery();
            return;
        }
        if (pkg !== this.pending) {
            this.carryStage = null;
            this.pending = pkg;
            this.pendingSession = control.session;
            const index = this.ordered.indexOf(pkg);
            if (index >= 0) this.nextIndex = index;
            this.held = null;
            this.shortSince = 0;
            this.needsBank = true;
            this.click = newClickCtx();
        }
        await this.ctx.state.set('mule-delivery-selection', { runId: this.o.deliveryRun, row: control.row, nextIndex: this.nextIndex });
        this.ctx.log('delivery preparation selected', { row: control.row, seq: control.seq, at: pkg.at });
        this.publishDelivery();
    }

    private deliveryEntries(): CarriedServed[] {
        return carriedServedEntries(this.ctx.state.get('mule-delivery-served'));
    }

    private deliveryWasServed(p: Package): boolean {
        return this.deliveryEntries().some(e => e.pkg === p.name && e.session === deliverySession(this.o.deliveryRun, p.scope!.step));
    }

    private selectNextDelivery(): void {
        while (this.ordered[this.nextIndex] && this.deliveryWasServed(this.ordered[this.nextIndex]!)) this.nextIndex++;
        this.pending = this.ordered[this.nextIndex] ?? null;
        this.preparationSeq = 0;
        this.pendingSession = this.pending ? deliverySession(this.o.deliveryRun, this.pending.scope!.step) : 'order';
        this.held = this.pending ? this.carryStage?.held.get(this.pending) ?? null : null;
        if (!this.held) this.carryStage = null;
        this.shortSince = 0;
        this.needsBank = !this.held;
        this.click = newClickCtx();
    }

    private async finishDelivery(pkg: Package): Promise<void> {
        const session = deliverySession(this.o.deliveryRun, pkg.scope!.step);
        if (!this.deliveryWasServed(pkg)) await this.ctx.state.set('mule-delivery-served', [...this.deliveryEntries(), { pkg: pkg.name, session, ms: Date.now() }]);
        await this.ctx.state.set('mule-delivery-attempt', undefined);
        this.awaitingStop = { session, row: pkg.scope!.step };
        if (!pkg.onRequest) this.nextIndex = this.ordered.indexOf(pkg) + 1;
        this.selectNextDelivery();
        await this.ctx.state.set('mule-delivery-selection', { runId: this.o.deliveryRun, row: this.pending?.scope?.step ?? null, nextIndex: this.nextIndex });
    }

    /**
     * After a served hand-off the helper keeps its stand until the receiver closes that session's
     * cue. A final stop ends service where it stands (its launcher then logs it out); a plain stop,
     * a newer cue, or this run's prepare for another row releases it to bank or travel. Leaving
     * earlier races the final stop: a walk already sent keeps moving after the role is aborted.
     */
    private keepsStandAfterServe(): boolean {
        if (this.finalStopped) return true;
        if (!this.awaitingStop) return false;
        const cue = readCue(this.o.cueDir);
        const control = readMulePreparation(this.o.cueDir, this.ctx.account);
        const moved = control?.runId === this.o.deliveryRun && control.op === 'prepare' && control.row !== this.awaitingStop.row;
        if (!moved && cue?.session === this.awaitingStop.session && cue.scope?.family === 'mule') {
            if (!cue.stop) return true;
            if (cue.final) {
                this.finalStopped = true;
                this.ctx.log('delivery final stop: service ends on the stand', { row: this.awaitingStop.row, session: cue.session, seq: cue.seq });
                return true;
            }
        }
        this.awaitingStop = null;
        return false;
    }

    private deliveryAt(): boolean {
        return !!this.pending?.at && inArea(this.ctx.sdk.getState(), { ...this.pending.at, tol: 0 });
    }

    /** Preparation alone never authorizes a trade. Only the receiving step's live cue does. */
    private deliveryAuthorized(): boolean {
        if (!this.pending || this.deliveryFault || this.deliveryPaused || !this.controlAllowsDelivery()
            || !this.observedMs || Date.now() - this.observedMs > 3000 || this.observedTick <= this.settledAfterTick) return false;
        return deliveryCueAuthorizes(readCue(this.o.cueDir), { session: this.pendingSession, row: this.pending.scope!.step, serve: this.o.serve! });
    }

    private publishDelivery(off = false): void {
        if (!this.o.deliveryRun) return;
        const s = this.ctx.sdk.getState();
        const hold = off ? null : this.heldControl();
        if (hold) {
            const healthy = hold.seq === this.consumedPreparation && this.observedMs > 0
                && this.observedTick > this.settledAfterTick && Date.now() - this.observedMs <= 3000
                && muleHealthy(s);
            writeMuleReady(this.o.cueDir, {
                runId: this.o.deliveryRun, account: this.ctx.account, row: hold.row, preparationSeq: hold.seq,
                session: hold.session, receiverHash: hold.receiverHash, phase: healthy ? 'held' : 'off',
                tile: s?.player ? { x: s.player.worldX, z: s.player.worldZ, level: s.player.level } : null,
                staged: false, tick: Math.max(0, s?.tick ?? 0), ms: healthy ? this.observedMs : Date.now()
            });
            return;
        }
        const p = this.pending ?? this.ordered.at(-1) ?? this.o.packages[0]!;
        const staged = !!this.pending && this.packageReady() && stagedExactly(this.ctx.sdk.getInventory(), this.carryStage?.inventory ?? this.held).exact;
        const ready = !off && !this.deliveryFault && !this.deliveryPaused && this.controlAllowsDelivery()
            && this.observedMs > 0 && this.observedTick > this.settledAfterTick && Date.now() - this.observedMs <= 3000
            && !this.needsBank && !!this.pending
            && muleCanReady(s, worldTile(p.at), staged, this.travelling);
        writeMuleReady(this.o.cueDir, {
            runId: this.o.deliveryRun, account: this.ctx.account, row: p.scope!.step, preparationSeq: this.preparationSeq,
            session: deliverySession(this.o.deliveryRun, p.scope!.step), receiverHash: nameHash(this.o.serve!),
            phase: off || !this.pending || this.deliveryPaused || !this.controlAllowsDelivery() ? 'off' : this.deliveryFault ? 'fault' : s?.trade?.isOpen ? 'trading' : this.travelling ? 'travel' : ready ? 'ready' : 'staging',
            tile: s?.player ? { x: s.player.worldX, z: s.player.worldZ, level: s.player.level } : null,
            staged, tick: Math.max(0, s?.tick ?? 0), ms: ready ? this.observedMs : Date.now()
        });
    }

    private async deliveryWalk(to: WorldTile, purpose: 'bank' | 'meeting'): Promise<boolean> {
        if (this.deliveryFault || this.deliveryPaused || !this.controlAllowsDelivery() || this.ctx.signal.aborted) return false;
        const player = this.ctx.sdk.getState()?.player;
        if (!player) return false;
        const from = { x: player.worldX, z: player.worldZ };
        if (westOfTaverley(from) !== westOfTaverley(to)) {
            this.deliveryFault = true;
            this.ctx.log('delivery unsafe crossing refused', { row: this.pending?.scope?.step, purpose, from, to });
            this.publishDelivery();
            return false;
        }
        if (inArea(this.ctx.sdk.getState(), { ...to, tol: 0 })) return true;
        this.travelling = true;
        this.publishDelivery();
        const started = tick(this.ctx.sdk);
        let tiles = 0;
        let ok = false;
        let reason: string | undefined;
        const stopReason = (s = this.ctx.sdk.getState()): string | null =>
            this.ctx.signal.aborted || this.deliveryFault || this.deliveryPaused || !this.controlAllowsDelivery() ? 'delivery aborted'
                : !s?.player || s.player.isDead || s.player.hp <= 0 ? 'delivery helper died' : null;
        const walk = async (destination: WorldTile): Promise<void> => {
            const stopped = stopReason();
            if (stopped) throw new Error(stopped);
            const r = await runTo(this.ctx.sdk, { ...destination, tol: 0 }, { bot: this.ctx.bot, stopIf: stopReason });
            tiles += r.tiles;
            if (!r.ok || !inArea(this.ctx.sdk.getState(), { ...destination, tol: 0 })) throw new Error(r.reason ?? 'delivery walk did not arrive');
            const after = stopReason();
            if (after) throw new Error(after);
        };
        try {
            const crossings = player.level === 0 && to.level === 0 ? crossingsBetween(from, to) ?? [] : [];
            for (const crossing of crossings) {
                await crossForDelivery({
                    sdk: this.ctx.sdk, log: this.ctx.log, stopped: () => stopReason() !== null,
                    walk: destination => walk({ ...destination, level: 0 })
                }, crossing);
                tiles += Math.max(Math.abs(crossing.to.x - crossing.from.x), Math.abs(crossing.to.z - crossing.from.z));
            }
            await walk(to);
            ok = true;
            return true;
        } catch (e) {
            reason = e instanceof Error ? e.message : String(e);
            return false;
        } finally {
            this.ctx.log('delivery travel', { row: this.pending?.scope?.step, purpose, to, ok, ticks: tick(this.ctx.sdk) - started, tiles, reason });
            this.travelling = false;
            this.settledAfterTick = this.observedTick;
            this.touch();
            this.publishDelivery();
        }
    }

    /** What the mule is doing: idle, consolidate (taking courier stock in), serve (preparing or giving a package), ge. */
    private phase(to: 'idle' | 'consolidate' | 'serve' | 'ge'): void {
        if (to === this.current) return;
        this.ctx.log('phase', { from: this.current, to });
        this.current = to;
    }

    constructor(private readonly ctx: RoleContext) {
        this.o = muleOptions(ctx.options);
        this.courierPatterns = toRegExps(this.o.couriers);
        this.requests = new ChatCursor(ctx.sdk, [TRADE_REQUEST_CHAT_TYPE]);
        this.ordered = this.o.packages.filter(p => !p.onRequest);
        if (this.o.serveMode === 'order') this.pending = this.ordered[0] ?? null;
        this.wildlife = toRegExps(this.o.wildlife);
        if (this.o.deliveryRun) {
            const selection = this.ctx.state.get('mule-delivery-selection') as { runId?: string; row?: string; nextIndex?: number } | undefined;
            if (selection?.runId === this.o.deliveryRun && Number.isInteger(selection.nextIndex)
                && selection.nextIndex! >= 0 && selection.nextIndex! <= this.ordered.length) this.nextIndex = selection.nextIndex!;
            this.selectNextDelivery();
            const selected = selection?.runId === this.o.deliveryRun ? this.o.packages.find(p => p.scope?.step === selection.row) : null;
            if (selected && !this.deliveryWasServed(selected)) {
                this.pending = selected;
                this.pendingSession = deliverySession(this.o.deliveryRun, selected.scope!.step);
            }
            // An interrupted acceptance has an ambiguous outcome. Never replay it automatically.
            const attempt = this.ctx.state.get('mule-delivery-attempt') as { runId?: string; pkg?: string; session?: string } | undefined;
            if (attempt?.runId === this.o.deliveryRun && !this.deliveryEntries().some(e => e.pkg === attempt.pkg && e.session === attempt.session)) this.deliveryFault = true;
            const fault = this.ctx.state.get('mule-delivery-fault') as { runId?: string } | undefined;
            if (fault?.runId === this.o.deliveryRun) this.deliveryFault = true;
        }
        if (this.o.carried) {
            // No bank to visit; and what this login already served (a restarted role) stays served.
            this.needsBank = false;
            for (const name of carriedDoneSince(this.servedEntries(), this.startMs)) this.done.add(name);
            if (this.pending && this.done.has(this.pending.name)) ({ nextIndex: this.nextIndex, pending: this.pending } = this.afterCarried(this.pending));
        }
    }

    private servedEntries(): CarriedServed[] {
        return carriedServedEntries(this.ctx.state.get(CARRIED_SERVED_KEY));
    }

    /**
     * A carried package's cue stopped: the mule moves on to the next tile. Stopped before its trade, the
     * scored account asked for none of it (every top-up met, so it made no trade) or skipped the hand-off;
     * that is recorded as served for the cue session, as a trade is, so a restarted role never takes it up.
     */
    private async passCarried(pkg: Package, session: string): Promise<void> {
        this.done.add(pkg.name);
        if (this.servedEntries().some(e => e.pkg === pkg.name && e.session === session)) return;
        await this.ctx.state.set(CARRIED_SERVED_KEY, [...this.servedEntries(), { pkg: pkg.name, session, ms: Date.now() } satisfies CarriedServed]);
        this.ctx.log('carried: asked for nothing; passed without a trade', { package: pkg.name, session });
    }

    /** Order mode past a carried package served before a restart: the next one not done. */
    private afterCarried(served: Package): { nextIndex: number; pending: Package | null } {
        let r = afterServe(this.ordered, this.nextIndex, served);
        while (r.pending && this.done.has(r.pending.name)) r = afterServe(this.ordered, r.nextIndex, r.pending);
        return r;
    }

    /** Where the mule stands: `stand`, or in carried mode the tile of the package it serves next. */
    private standTile(): Tile {
        if (this.o.deliveryRun) return this.pending?.at ?? this.o.stand;
        return this.o.carried ? carriedStand(this.o.packages, this.pending, this.done, this.o.stand) : this.o.stand;
    }

    private standTolerance(): number {
        return this.o.carried ? 1 : 3;
    }

    private touch(): void {
        this.lastInputMs = Date.now();
    }

    private isServe(name: string | null | undefined): boolean {
        return !!this.o.serve && canonName(name ?? '') === canonName(this.o.serve);
    }

    private isCourier(name: string | null | undefined): boolean {
        return this.courierPatterns.some(p => accountMatches(name, p));
    }

    async run(): Promise<void> {
        const { ctx } = this;
        pointMarketAtServer(ctx.sdk);
        await ensureOutOfTutorial(ctx);
        await ctx.bot.dismissBlockingUI();
        if (ctx.sdk.getTradeState().isOpen) await ctx.bot.declineTrade();
        const stand = this.standTile();
        const from = ctx.sdk.getState()?.player;
        const t0 = tick(ctx.sdk);
        if (!this.o.deliveryRun) await walkNear(ctx, stand.x, stand.z, this.standTolerance());
        this.lastStand = stand;
        this.touch();
        if (this.o.carried) {
            const inv = ctx.sdk.getInventory();
            const short = carriedShort(this.o.packages, inv);
            ctx.log(short.length ? 'carried: SHORT of the packages it carries' : 'carried: loaded', {
                short,
                done: [...this.done],
                packages: this.o.packages.map(p => ({ name: p.name, at: p.at ?? null, ...carriedNeedsLog(carriedNeeds(p, inv)) })),
                at: stand,
                walk: { from: from ? { x: from.worldX, z: from.worldZ } : null, ticks: tick(ctx.sdk) - t0 }
            });
        }
        ctx.log(this.o.deliveryRun ? 'mule delivery started' : 'mule ready', { serve: this.o.serve, packages: this.o.packages.map(p => p.name), giver: this.o.giver, serveMode: this.o.serveMode, ...(this.o.carried ? { carried: true } : {}) });

        this.observedTick = tick(ctx.sdk);
        this.publishDelivery();
        let wasOpen = false;
        const unsubOpen = ctx.sdk.onStateUpdate(st => {
            const open = !!st.trade?.isOpen;
            if (open && !wasOpen) this.openSeenMs = Date.now();
            wasOpen = open;
            if (st.tick > this.observedTick) {
                this.observedTick = st.tick;
                this.observedMs = Date.now();
            }
            if (this.o.deliveryRun && open && (!this.controlAllowsDelivery() || ctx.signal.aborted)) void ctx.bot.declineTrade();
            this.publishDelivery();
        });
        try {
            while (!ctx.signal.aborted) {
                try {
                    await this.cycle();
                } catch (e) {
                    if (this.o.deliveryRun && this.ctx.state.get('mule-delivery-attempt')) this.deliveryFault = true;
                    this.publishDelivery();
                    ctx.log('cycle error', { error: String(e) });
                    await ctx.sdk.waitForTicks(5).catch(() => {});
                }
            }
        } finally {
            unsubOpen();
            this.publishDelivery(true);
        }
        if (ctx.sdk.getTradeState().isOpen) await ctx.bot.declineTrade();
        await closeBank(ctx);
    }

    private async cycle(): Promise<void> {
        const { ctx } = this;
        const { sdk } = ctx;

        // 1. Package requests: a new mule cue in the cue directory, scoped to one of our packages.
        const cue = readCue(this.o.cueDir);
        const action = cue?.scope?.family === 'mule' ? muleCueAction(cue, this.lastCue, this.startMs) : 'none';
        await this.syncPreparation();
        if (!this.o.deliveryRun && cue && action !== 'none') {
            const last = this.lastCue;
            this.lastCue = { session: cue.session, seq: cue.seq };
            const pkg = packageForCue(cue, this.o.packages, this.o.serve);
            ctx.log(action === 'ask' ? 'package request' : 'package request stopped', { step: cue.scope.step, session: cue.session, seq: cue.seq, found: pkg?.name ?? null, after: last });
            if (action === 'ask' && pkg && this.o.carried && this.servedEntries().some(e => e.pkg === pkg.name && e.session === cue.session)) {
                // A restarted role re-reads the cue it already served.
                ctx.log('carried: already served for this cue session', { package: pkg.name, session: cue.session });
                this.done.add(pkg.name);
            } else if (action === 'ask' && pkg && pkg !== this.pending) {
                this.pending = pkg;
                this.pendingSession = cue.session;
                this.held = null;
                this.shortSince = 0;
            } else if (action === 'stop' && pkg && pkg === this.pending && (this.o.serveMode === 'request' || pkg.onRequest)) {
                // Withdrawn: bank the staged package; order mode returns to the package due.
                this.pending = this.o.serveMode === 'order' ? (this.ordered[this.nextIndex] ?? null) : null;
                this.held = null;
                this.needsBank = !this.o.carried;
            }
            if (action === 'stop' && pkg && this.o.carried) await this.passCarried(pkg, cue.session);
        }

        if (this.deliveryFault || this.deliveryPaused) {
            this.publishDelivery();
            if (sdk.getTradeState().isOpen) await ctx.bot.declineTrade();
            else if (!this.deliveryFault) await this.heldKeepAlive();
            await nextTick(sdk);
            return;
        }

        // 2. Trade requests: the scored account first, then couriers; anyone else is ignored.
        const requesters = [...new Set(this.requests.next().map(m => m.sender))];
        requesters.sort((a, b) => Number(this.isServe(b)) - Number(this.isServe(a)));
        for (const name of requesters) {
            if (this.isServe(name)) await this.serveTrade(name);
            else if (this.isCourier(name) && !this.o.carried) await this.courierTrade(name);
            else ctx.log('ignored trade request', { from: name });
        }
        // A request that raced the cursor can leave a screen open.
        const open = sdk.getTradeState();
        if (open.isOpen) {
            if (this.isServe(open.partner)) await this.serveTrade(open.partner!);
            else if (this.isCourier(open.partner) && !this.o.carried) await this.courierTrade(open.partner!);
            else await ctx.bot.declineTrade();
        }

        if (this.o.deliveryRun && this.keepsStandAfterServe()) {
            this.publishDelivery();
            await this.stationaryKeepAlive({ served: this.awaitingStop?.row ?? null, finalStopped: this.finalStopped });
            await nextTick(sdk);
            return;
        }

        // 3. Housekeeping between trades.
        if (!this.o.carried && (this.needsBank || this.wantsPackage())) await this.bankCycle();
        if (this.o.ge && Date.now() - this.lastGeCollect > (this.o.ge.collectEveryMin ?? 10) * 60_000) await this.geCycle();
        // Wildlife first: a hit on either trader closes the trade the pre-request would open.
        if (this.wildlife.length) await this.clearWildlife();
        await this.keepStand();
        this.publishDelivery();
        this.preRequest();
        await this.keepAlive();
        this.phase('idle');
        await nextTick(sdk);
    }

    /**
     * Back to the stand tile. A changed tile (carried mode: the next package's) is walked to at once;
     * otherwise only once the last pre-request is 20 s old, so the mule doesn't undo the pre-request's
     * walk to the scored account.
     */
    private async keepStand(): Promise<void> {
        const { ctx } = this;
        const { sdk } = ctx;
        if (sdk.getTradeState().isOpen) return;
        if (this.o.deliveryRun) {
            if (this.pending && this.packageReady() && !this.needsBank) await this.deliveryWalk(worldTile(this.pending.at), 'meeting');
            return;
        }
        const stand = this.standTile();
        const tolerance = this.standTolerance();
        if (this.lastStand && (stand.x !== this.lastStand.x || stand.z !== this.lastStand.z)) {
            const from = sdk.getState()?.player;
            const t0 = tick(sdk);
            const ok = await walkNear(ctx, stand.x, stand.z, tolerance);
            this.lastStand = stand;
            this.touch();
            ctx.log('carried: moved to the next package tile', { to: stand, from: from ? { x: from.worldX, z: from.worldZ } : null, ok, ticks: tick(sdk) - t0, next: this.pending?.name ?? this.o.packages.find(p => !this.done.has(p.name))?.name ?? null });
            return;
        }
        if (Date.now() - this.lastPreRequest > 20_000 && distanceTo(sdk, stand.x, stand.z) > tolerance) {
            await walkNear(ctx, stand.x, stand.z, tolerance);
            this.touch();
        }
    }

    /** Kill the NPCs wildlifeThreat names, one at a time, while no trade is open (at most 5 a cycle). */
    private async clearWildlife(): Promise<void> {
        const { ctx } = this;
        const { sdk } = ctx;
        for (let i = 0; i < 5 && !ctx.signal.aborted; i++) {
            const s = sdk.getState();
            if (!s || s.trade?.isOpen) return;
            const npc = wildlifeThreat(s, this.wildlife, this.o.clearTiles);
            if (!npc) return;
            this.touch();
            const hp0 = s.player?.hp ?? null;
            const r = await fight(sdk, npc, { maxTicks: 60, findTicks: 1 });
            this.touch();
            ctx.log('wildlife', { npc: npc.name, index: npc.index, at: { x: npc.tileX ?? npc.x, z: npc.tileZ ?? npc.z }, end: r.end, ticks: r.ticks, dealt: r.dealt, taken: r.taken, hp: [hp0, sdk.getState()?.player?.hp ?? null] });
        }
    }

    /** A held helper keeps the same stationary client activity as a ready one, and nothing else. */
    private async heldKeepAlive(): Promise<void> {
        const hold = this.heldControl();
        if (!hold || hold.seq !== this.consumedPreparation) return;
        await this.stationaryKeepAlive({ held: true });
    }

    /** A wait in place on a healthy fresh frame: client activity that never moves the helper. */
    private async stationaryKeepAlive(reason: Record<string, unknown>): Promise<void> {
        const { ctx } = this;
        const { sdk } = ctx;
        if (ctx.signal.aborted || !keepAliveDue(Date.now(), this.lastInputMs, this.o.keepAliveMinutes * 60_000)) return;
        const s = sdk.getState();
        if (!muleHealthy(s) || sdk.isBankOpen()
            || !this.observedMs || Date.now() - this.observedMs > 3000 || this.observedTick <= this.settledAfterTick) return;
        const idleMs = Date.now() - this.lastInputMs;
        const result = await sdk.sendWait(1);
        this.touch();
        ctx.log('keep-alive', { stationary: true, ...reason, success: result.success, idleMs, tick: s.tick });
    }

    /** Keep the client active without interrupting a trade or moving a delivery off its exact stand. */
    private async keepAlive(): Promise<void> {
        const { ctx } = this;
        const { sdk } = ctx;
        const idleMs = Date.now() - this.lastInputMs;
        if (!keepAliveDue(Date.now(), this.lastInputMs, this.o.keepAliveMinutes * 60_000)) return;
        const s = sdk.getState();
        if (!s?.player || s.trade?.isOpen || sdk.isBankOpen()) return;
        if (this.o.deliveryRun) {
            if (ctx.signal.aborted || !this.pending || this.deliveryFault || this.deliveryPaused
                || !this.controlAllowsDelivery() || this.needsBank || !this.observedMs
                || Date.now() - this.observedMs > 3000 || this.observedTick <= this.settledAfterTick
                || !muleCanReady(s, worldTile(this.pending.at), this.packageReady()
                    && stagedExactly(sdk.getInventory(), this.carryStage?.inventory ?? this.held).exact, this.travelling)) return;
            // Browser SDK actions reset its AFK timer. A wait changes no world
            // state; lite already sends NO_TIMEOUT independently. Neither an
            // acknowledgement nor this activity renews observation freshness.
            const result = await sdk.sendWait(1);
            this.touch();
            ctx.log('keep-alive', { stationary: true, success: result.success, idleMs, tick: s.tick });
            return;
        }
        if (this.o.serve && s.nearbyPlayers.some(p => sameName(p.name, this.o.serve) && p.distance <= PRE_REQUEST_TILES)) return;
        const at = { x: s.player.worldX, z: s.player.worldZ };
        const r = await keepAliveStep(sdk, at, this.keepAlives++);
        this.touch();
        ctx.log('keep-alive', { at, ...r, idleMs, tick: s.tick });
    }

    private wantsPackage(): boolean {
        if (!this.pending || this.held) return false;
        // A package the bank cannot fill is re-checked once a minute, not every tick.
        return this.shortSince === 0 || Date.now() - this.shortSince > 60_000;
    }

    private packageReady(): boolean {
        if (this.o.carried) return !!this.pending && carriedReady(carriedNeeds(this.pending, this.ctx.sdk.getInventory()));
        return !!this.pending && !!this.held && holds(countById(this.ctx.sdk.getInventory()), this.held);
    }

    private preRequest(): void {
        const { sdk } = this.ctx;
        const s = sdk.getState();
        if (!s || !this.o.preRequest || !this.o.serve) return;
        // A carried package shares the inventory with the others, so only a banked one must be staged exactly.
        const ready = this.packageReady() && (this.o.carried || stagedExactly(sdk.getInventory(), this.carryStage?.inventory ?? this.held).exact)
            && (!this.o.deliveryRun || (this.deliveryAt() && this.deliveryAuthorized() && !this.needsBank && !this.travelling));
        const d = decidePreRequest(s, this.click, this.o.serve, ready && !this.ctx.signal.aborted, !!this.o.deliveryRun);
        this.click = d.next;
        if (d.send === undefined) return;
        this.lastPreRequest = Date.now();
        this.touch();
        // The scored account sees "wishes to trade", and its own click then opens the trade on the tick it lands.
        sendTradeClick(sdk, d.send, this.click.sentTick, (sent, tick) => (this.click = clickBack(this.click, sent, tick)));
        this.ctx.log('pre-requested', { serve: this.o.serve, package: this.pending?.name, sends: this.click.sends });
    }

    /** Deposit everything that is not the held package, report the bank, and withdraw the pending package. */
    private async bankCycle(): Promise<void> {
        // A staged group is immutable until served or explicitly replaced by preparation.
        if (this.carryStage) return;
        const { ctx } = this;
        const { sdk, bot } = ctx;
        this.phase(this.wantsPackage() ? 'serve' : 'consolidate');
        if (sdk.getTradeState().isOpen) return;
        if (this.o.deliveryRun) {
            const bank = this.pending?.bank ?? this.o.packages.at(-1)!.bank!;
            if (!(await this.deliveryWalk(bank, 'bank'))) return;
        }
        if (!(await openBank(ctx))) return;
        const keep = this.packageReady() ? this.held! : new Map<number, number>();
        const deposited = await depositAllExcept(sdk, keep);
        if (!deposited) ctx.log('deposit incomplete', { inventory: sdk.getInventory().map(i => `${i.name} x${i.count}`) });
        if (!this.packageReady()) this.held = null;

        if (this.pending?.carryNext && !this.held && deposited) {
            await this.stageCarryGroup(this.pending);
            ctx.reportBank(bankSnapshot(sdk));
            this.needsBank = false;
            await closeBank(ctx);
            return;
        }
        // A package is staged only into an otherwise empty inventory, so `held` is the package alone.
        if (this.pending && !this.held && deposited) {
            const plan = planPackage(this.pending, sdk.getBankItems());
            if (plan.missing.length || plan.ambiguous.length || plan.slots > 28 || plan.withdrawals.length === 0 || (this.o.deliveryRun && plan.topUpShort.length)) {
                if (this.shortSince === 0) ctx.log('package short', { package: this.pending.name, missing: plan.missing, ambiguous: plan.ambiguous, slots: plan.slots, topUpShort: plan.topUpShort });
                this.shortSince = Date.now();
            } else {
                if (plan.topUpShort.length) ctx.log('package: top-up staged below its max', { package: this.pending.name, topUpShort: plan.topUpShort });
                let ok = true;
                for (const w of plan.withdrawals) {
                    // Bank slots compact as preceding stacks are emptied.
                    const live = sdk.getBankItems().find(i => i.id === w.bankItem.id);
                    const r = live ? await bot.withdrawItem(live, w.amount, { asNote: w.noted }) : { success: false, message: 'bank item disappeared' };
                    if (!r.success) {
                        ok = false;
                        ctx.log('withdraw failed', { item: w.bankItem.name, amount: w.amount, result: r.message });
                        break;
                    }
                }
                if (ok && this.o.deliveryRun) {
                    const expected = new Map<number, number>();
                    for (const w of plan.withdrawals) {
                        const id = w.noted ? noteOf(w.bankItem.id) : w.bankItem.id;
                        if (id === undefined) { ok = false; break; }
                        expected.set(id, (expected.get(id) ?? 0) + w.amount);
                    }
                    ok = ok && sameItems(expected, countById(sdk.getInventory()));
                    if (!ok) ctx.log('delivery staging inventory mismatch', { package: this.pending.name, expected: Object.fromEntries(expected), observed: Object.fromEntries(countById(sdk.getInventory())) });
                }
                if (ok) {
                    this.held = countById(sdk.getInventory());
                    this.shortSince = 0;
                    ctx.log('package ready', { package: this.pending.name, items: sdk.getInventory().map(i => `${i.name} x${i.count}`) });
                } else {
                    await depositAllExcept(sdk);
                    this.shortSince = Date.now();
                }
            }
        }
        ctx.reportBank(bankSnapshot(sdk));
        this.needsBank = false;
        await closeBank(ctx);
    }

    private async stageCarryGroup(first: Package): Promise<void> {
        const { sdk, bot } = this.ctx;
        const group = deliveryGroup(this.ordered, first);
        try {
            if (group.some(p => this.deliveryWasServed(p))) throw new Error('carry group contains an already served delivery');
            const stage = planCarryGroup(group, sdk.getBankItems());
            for (const w of stage.withdrawals) {
                if (!this.controlAllowsDelivery() || this.ctx.signal.aborted) throw new Error('delivery staging aborted');
                const live = sdk.getBankItems().find(b => b.id === w.bankItem.id);
                if (!live || !(await bot.withdrawItem(live, w.amount, { asNote: w.noted })).success) throw new Error(`carry withdrawal failed: ${w.bankItem.name}`);
            }
            if (!stagedExactly(sdk.getInventory(), stage.inventory).exact) throw new Error('carry staged inventory differs from bank plan');
            for (const pkg of group) {
                const needs = carriedNeeds(fullDeliveryPackage(pkg), sdk.getInventory());
                if (!carriedReady(needs) || !sameItems(needs.held, stage.held.get(pkg)!)) throw new Error(`carry reservation mismatch: ${pkg.name}`);
            }
            this.carryStage = stage;
            this.held = stage.held.get(first)!;
            this.shortSince = 0;
            this.ctx.log('carry group ready', { packages: group.map(p => p.name), peakSlots: stage.peakSlots, inventory: Object.fromEntries(stage.inventory) });
        } catch (e) {
            this.shortSince = Date.now();
            this.ctx.log('carry group refused', { package: first.name, reason: String(e) });
        }
    }

    private async openTradeWith(name: string): Promise<boolean> {
        const { sdk, bot } = this.ctx;
        const t = sdk.getTradeState();
        if (t.isOpen && canonName(t.partner ?? '') === canonName(name)) return true;
        await closeBank(this.ctx);
        // About 15 s of ticks at 400 ms; the default backstop only gives up.
        const r = await openTrade(sdk, name, {
            maxTicks: 38,
            ...(this.o.deliveryRun ? { stopped: (s: BotWorldState) => !this.deliveryAuthorized() || !this.deliveryAt() || this.ctx.signal.aborted || !deliveryTradeReach(s, name) } : {})
        });
        if (!r.ok) this.ctx.log('trade open failed', { with: name, result: r.reason });
        return r.ok;
    }

    private async serveTrade(name: string): Promise<void> {
        const { ctx } = this;
        const { sdk, bot } = ctx;
        this.phase(this.packageReady() ? 'serve' : 'consolidate');
        if (this.o.deliveryRun && (!this.deliveryAuthorized() || !this.deliveryAt() || !this.packageReady() || this.needsBank || this.travelling)) {
            if (sdk.getTradeState().isOpen) await bot.declineTrade();
            ctx.log('delivery trade refused', { row: this.pending?.scope?.step });
            return;
        }
        if (!this.packageReady()) {
            // Nothing to give: take what the scored account hands back.
            await this.receiveFrom(name);
            return;
        }
        this.touch();
        if (this.o.carried) {
            // Its own counts from the inventory; and no wildlife beside it when the trade opens.
            if (this.wildlife.length && !sdk.getTradeState().isOpen) await this.clearWildlife();
            this.held = carriedNeeds(this.pending!, sdk.getInventory()).held;
        } else {
            const staged = stagedExactly(sdk.getInventory(), this.carryStage?.inventory ?? this.held);
            if (!staged.exact) {
                ctx.log('serve refused: the inventory is not exactly the package; re-staging', { package: this.pending?.name, extra: staged.extra, short: staged.short });
                if (sdk.getTradeState().isOpen) await bot.declineTrade();
                if (this.carryStage) this.deliveryFault = true;
                else {
                    this.held = null;
                    this.needsBank = true;
                }
                return;
            }
        }
        if (!(await this.openTradeWith(name))) return;
        const pkg = this.pending!;
        if (this.o.deliveryRun) await this.ctx.state.set('mule-delivery-attempt', { runId: this.o.deliveryRun, pkg: pkg.name, session: this.pendingSession });
        this.publishDelivery();
        const session = this.pendingSession;
        const stage = this.carryStage;
        let confirmed: { gave: TradeItem[]; received: TradeItem[] } | null = null;
        const topUpIds = new Set(sdk.getInventory().filter(i => pkg.items.some(spec => isTopUp(spec) && refMatches(spec, i))).map(i => i.id));
        const deliveryStop = (s: BotWorldState): string | null => {
            if (!this.deliveryAuthorized() || ctx.signal.aborted) return 'delivery authorization withdrawn';
            if (!stage || !s.trade?.isOpen) return null;
            const incomingSlots = s.trade.theirOffer.reduce((n, i) => {
                let noted = false;
                try { noted = namesNote({ id: i.id }); } catch { /* Unknown ids are conservatively unstackable. */ }
                return n + (noted || isStackableName(i.name) ? 1 : i.count);
            }, 0);
            if (incomingSlots > (pkg.takeBackSlots ?? 0)) return 'carry take-back slot limit exceeded';
            const offered = countById(s.trade.myOffer);
            const validOffer = offered.size > 0 && holds(this.held!, offered)
                && [...this.held!].every(([id, count]) => topUpIds.has(id) || offered.get(id) === count);
            // Completion can publish empty confirm lists and inventory changes before the close.
            // Preserve the real confirm snapshot; intermediate inventory is not a stable boundary.
            if (!confirmed && s.trade.screen === 'confirm' && sameName(s.trade.partner ?? '', this.o.serve!) && validOffer) {
                confirmed = { gave: s.trade.myOffer.map(i => ({ ...i })), received: s.trade.theirOffer.map(i => ({ ...i })) };
            }
            return null;
        };
        // 30 s, not 60: a pre-request can open a trade the scored account did not ask for
        // yet (it accepts a stale request of theirs), and that screen must not linger.
        const r = await serveStaged(sdk, bot, {
            partner: this.o.serve!,
            pkg,
            held: this.held!,
            mode: this.o.giver,
            timeoutMs: 30_000,
            ask: { dir: this.o.cueDir, openMs: this.openSeenMs || Date.now(), lastServedMs: this.lastAskMs, maxTicks: this.o.askWaitTicks, signal: ctx.signal },
            log: ctx.log,
            exact: this.o.carried || !!stage,
            ...(this.o.deliveryRun ? { stopIf: deliveryStop } : {})
        });
        this.touch();
        if (r.ask) this.lastAskMs = r.ask.ms;
        ctx.log('hand-off', {
            to: name,
            package: pkg.name,
            success: r.success,
            giverTicks: r.ticks,
            stacks: this.held!.size,
            mode: this.o.giver,
            result: r.message,
            received: r.received.map(i => `${i.name} x${i.count}`),
            ...(r.topUps.length ? { asked: r.ask?.items ?? null, topUps: r.topUps.map(t => ({ item: t.item, asked: t.asked, n: t.n })) } : {})
        });
        if (r.success) {
            if (stage) {
                // Only the proved trade's confirmed offers may change the frozen inventory.
                const outcome = confirmed as { gave: TradeItem[]; received: TradeItem[] } | null;
                const expected = new Map(stage.inventory);
                if (outcome) {
                    for (const i of outcome.gave) expected.set(i.id, (expected.get(i.id) ?? 0) - i.count);
                    for (const i of outcome.received) expected.set(i.id, (expected.get(i.id) ?? 0) + i.count);
                    for (const [id, count] of expected) if (count === 0) expected.delete(id);
                }
                if (!outcome || !stagedExactly(sdk.getInventory(), expected).exact) {
                    this.deliveryFault = true;
                    await ctx.state.set('mule-delivery-fault', {
                        runId: this.o.deliveryRun, pkg: pkg.name, session, reason: 'carry trade inventory mismatch',
                        expected: Object.fromEntries(expected), observed: Object.fromEntries(countById(sdk.getInventory()))
                    });
                    ctx.log('carry trade inventory mismatch: reconciliation required', { package: pkg.name });
                } else stage.inventory = expected;
                stage.held.delete(pkg);
            }
            this.held = null;
            if (this.o.carried) {
                // On disk before anything else: a restart must find it served (role.ts RoleState).
                await this.ctx.state.set(CARRIED_SERVED_KEY, [...this.servedEntries(), { pkg: pkg.name, session, ms: Date.now() } satisfies CarriedServed]);
                this.done.add(pkg.name);
            }
            if (this.o.deliveryRun) {
                await this.finishDelivery(pkg);
            } else if (this.o.serveMode === 'order') {
                ({ nextIndex: this.nextIndex, pending: this.pending } = afterServe(this.ordered, this.nextIndex, pkg));
            } else {
                this.pending = null;
            }
            if (!this.o.deliveryRun) this.pendingSession = 'order';
            if (this.o.carried) ctx.log('carried: left', { inventory: sdk.getInventory().length, short: carriedShort(this.o.packages.filter(p => !this.done.has(p.name)), sdk.getInventory()) });
        }
        if (this.o.deliveryRun && !r.success) {
            if (sdk.getTradeState().isOpen) await bot.declineTrade();
            if (r.uncertain) {
                this.deliveryFault = true;
                ctx.log('delivery outcome uncertain: reconciliation required', { row: pkg.scope!.step, session });
            } else {
                await this.ctx.state.set('mule-delivery-attempt', undefined);
            }
        }
        if (!this.o.deliveryRun) this.needsBank = !this.o.carried;
        this.publishDelivery();
    }

    private async courierTrade(name: string): Promise<void> {
        const { ctx } = this;
        this.phase('consolidate');
        // Room for a full courier load: bank the held package if it crowds the inventory.
        if (freeSlots(ctx.sdk) < 24 && !ctx.sdk.getTradeState().isOpen) {
            if (await openBank(ctx)) {
                await depositAllExcept(ctx.sdk);
                this.held = null;
                await closeBank(ctx);
            }
        }
        await this.receiveFrom(name);
    }

    private async receiveFrom(name: string): Promise<void> {
        const { ctx } = this;
        if (!(await this.openTradeWith(name))) return;
        // Give nothing, accept any non-empty offer: couriers and the scored account only
        // hand stock in. A session that stays empty is declined so it cannot hold the mule.
        const r = await ctx.bot.trade(playerPattern(name), {
            accept: offer => offer.length > 0,
            rejectAfterMs: 30_000,
            timeout: 90_000,
            requestTimeout: 5_000
        });
        ctx.log('received', {
            from: name,
            success: r.success,
            result: r.message,
            received: r.received.map(i => `${i.name} x${i.count}`),
            gave: r.gave.map(i => `${i.name} x${i.count}`)
        });
        if (r.success) this.needsBank = true;
    }

    // ---- Grand Exchange ----

    private async geCycle(): Promise<void> {
        const { ctx } = this;
        const { sdk, bot } = ctx;
        this.phase('ge');
        this.lastGeCollect = Date.now();
        if (sdk.getTradeState().isOpen) return;
        await closeBank(ctx);
        const opened = await bot.openGE();
        if (!opened.success) {
            ctx.log('GE open failed', { result: opened.message });
            return;
        }
        const offers = sdk.getGEState()?.offers ?? [];
        if (offers.some(o => o.items > 0 || o.coins > 0)) {
            const c = await bot.collectGE();
            ctx.log('GE collected', { success: c.success, items: c.items, coins: c.coins, result: c.message });
            this.needsBank = true;
        }
        const listed = new Set(
            (sdk.getGEState()?.offers ?? []).filter(o => o.side === 'sell' && o.state === 'open').map(o => `${o.item}@${o.price}`)
        );
        await bot.closeInterface();

        for (const order of this.o.ge?.orders ?? []) {
            const key = `${order.item}@${order.price}`;
            if (this.geDone.has(key)) continue;
            await this.geSell(order, listed);
        }
        // Proceeds and unsold notes go back to the bank on the next bank cycle.
        if (sdk.getInventory().some(i => !this.held?.has(i.id))) this.needsBank = true;
    }

    private async geSell(order: GeOrder, listed: Set<string>): Promise<void> {
        const { ctx } = this;
        const { sdk, bot } = ctx;
        const key = `${order.item}@${order.price}`;
        if (!(await openBank(ctx))) return;
        const bankItem = sdk.getBankItems().find(b => b.name.toLowerCase() === order.item.toLowerCase());
        if (!bankItem) {
            await closeBank(ctx);
            ctx.log('GE: nothing to sell', { item: order.item });
            return;
        }
        if (listed.has(`${bankItem.id}@${order.price}`)) {
            this.geDone.add(key);
            await closeBank(ctx);
            return;
        }
        let quantity = order.quantity === 'all' ? bankItem.count : Math.min(order.quantity, bankItem.count);
        if (order.fill) {
            const quote = await sdk.getMarketItem(bankItem.id).catch(() => null);
            if (!quote || quote.bid !== order.price) {
                await closeBank(ctx);
                ctx.log('GE fill: best bid is not the expected price, not listing', { item: order.item, bid: quote?.bid ?? null, price: order.price });
                return;
            }
            quantity = Math.min(quantity, quote.buyQuantity ?? quantity);
        }
        const w = await bot.withdrawItem(bankItem, quantity, { asNote: true });
        ctx.reportBank(bankSnapshot(sdk));
        await closeBank(ctx);
        if (!w.success) {
            ctx.log('GE: withdraw failed', { item: order.item, result: w.message });
            this.needsBank = true;
            return;
        }
        const opened = await bot.openGE();
        if (!opened.success) {
            ctx.log('GE open failed', { result: opened.message });
            this.needsBank = true;
            return;
        }
        const placed = await bot.placeGEOffer({ item: bankItem.id, side: 'sell', quantity: w.amountWithdrawn ?? quantity, price: order.price });
        ctx.log('GE sell', { item: order.item, quantity: w.amountWithdrawn ?? quantity, price: order.price, success: placed.success, outcome: placed.outcome, result: placed.message });
        if (placed.success) this.geDone.add(key);
        await bot.closeInterface();
        this.needsBank = true;
    }
}

export const role: Role = {
    name: 'mule',
    produces: [],
    async run(ctx) {
        await new Mule(ctx).run();
    }
};

// ============ Courier ============

export interface CourierOptions {
    mule: string;
    /** Item-name RegExp sources, case-insensitive. */
    items: string | string[];
    /** Make the trip only when the bank holds at least this many matching item types. Default 1. */
    minStacks?: number;
    /** Walk back to where the trip started. Default true. */
    returnHome?: boolean;
}

/**
 * One courier trip. Safe to restart at any point: an open trade is declined
 * (both sides keep their items), notes already carried are offered first, and
 * the bank is the source of truth for what is left to carry.
 */
export async function courierTrip(ctx: RoleContext): Promise<{ trades: number; carried: string[] }> {
    const o = ctx.options as unknown as CourierOptions;
    if (!o.mule) throw new Error('courier: options.mule is required');
    const patterns = toRegExps(o.items);
    if (patterns.length === 0) throw new Error('courier: options.items is required');
    const minStacks = o.minStacks ?? 1;
    const { sdk, bot } = ctx;
    const carried: string[] = [];
    let trades = 0;

    await ensureOutOfTutorial(ctx);
    await bot.dismissBlockingUI();
    if (sdk.getTradeState().isOpen) await bot.declineTrade();
    const p = sdk.getState()?.player;
    if (!p) throw new Error('courier: no player state');
    const home = { x: p.worldX, z: p.worldZ };
    const matching = () => sdk.getInventory().filter(i => patterns.some(re => re.test(i.name)));
    const keepNonMatching = () => countById(sdk.getInventory().filter(i => !patterns.some(re => re.test(i.name))));

    if (!(await walkNear(ctx, MULE_STAND.x, MULE_STAND.z, 4))) throw new Error('courier: could not reach Varrock west bank');

    for (let round = 0; round < 20 && !ctx.signal.aborted; round++) {
        if (!(await openBank(ctx))) throw new Error('courier: could not open the bank');
        // Matching items already carried (produce, or notes from an interrupted trip)
        // go in first: the bank un-notes them, and everything comes back out as notes.
        if (matching().length) await depositAllExcept(sdk, keepNonMatching());
        const picks = courierPicks(sdk.getBankItems(), patterns, freeSlots(sdk));
        if (round === 0 && picks.length + matching().length < minStacks) {
            ctx.log('courier: not enough stock to carry', { stacks: picks.length, minStacks });
            ctx.reportBank(bankSnapshot(sdk));
            await closeBank(ctx);
            break;
        }
        for (const b of picks) {
            const r = await bot.withdrawItem(b, -1, { asNote: true });
            if (!r.success) ctx.log('courier: withdraw failed', { item: b.name, result: r.message });
        }
        ctx.reportBank(bankSnapshot(sdk));
        await closeBank(ctx);

        const give = matching();
        if (give.length === 0) break;
        const mule = sdk.findNearbyPlayer(playerPattern(o.mule));
        if (!mule) {
            ctx.log('courier: mule not in sight; banking the notes again', { mule: o.mule });
            if (await openBank(ctx)) {
                await depositAllExcept(sdk, keepNonMatching());
                ctx.reportBank(bankSnapshot(sdk));
                await closeBank(ctx);
            }
            break;
        }
        const r = await bot.trade(playerPattern(o.mule), {
            give: firstSlotPerId(give).map(i => ({ item: new RegExp(`^${escapeRegExp(i.name)}$`, 'i'), amount: -1 })),
            requestTimeout: 60_000,
            timeout: 60_000,
            retryOnBusy: true
        });
        ctx.log('courier: trade', { success: r.success, result: r.message, gave: r.gave.map(i => `${i.name} x${i.count}`) });
        if (!r.success) break;
        trades++;
        carried.push(...r.gave.map(i => `${i.name} x${i.count}`));
        // Another round only if the bank still holds matching stock.
        if (!(await openBank(ctx))) break;
        const left = courierPicks(sdk.getBankItems(), patterns, 28);
        ctx.reportBank(bankSnapshot(sdk));
        if (left.length === 0) {
            await closeBank(ctx);
            break;
        }
    }

    // Anything matching still carried (a failed trade) goes back to the bank.
    if (matching().length && (await openBank(ctx))) {
        await depositAllExcept(sdk, keepNonMatching());
        ctx.reportBank(bankSnapshot(sdk));
    }
    await closeBank(ctx);
    if (o.returnHome !== false) await walkNear(ctx, home.x, home.z, 3);
    ctx.log('courier: trip done', { trades, carried });
    return { trades, carried };
}

export const courier: Role = {
    name: 'courier',
    produces: [],
    async run(ctx) {
        await courierTrip(ctx);
    }
};

export const roles: Role[] = [role, courier];

if (import.meta.main) await runStandalone(process.argv[3] === 'courier' ? courier : role);
