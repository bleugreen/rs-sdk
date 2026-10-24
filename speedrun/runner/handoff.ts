// Hand-off steps: one Step builder for every hand-off row of STEP-MANIFEST.md's inventory ledger
// (H1 from the mule at S01, the out-and-back hand-offs H13, H16, H18, H22, H23, and any later H
// row). The row is the data: what SCORED receives is its `in`, what it gives is its `out` (reason
// `swap` or `trade`), and what it wears afterwards is its `equip`. Nothing here names an item; the
// rows are read through speedrun/tools/slot-ledger.ts's parser, the one reader of that table.
//
// An entry matches the game by its ITEM form: `NAME @ID` by obj id (an `in` at [n] by the id of
// its note, read through obj.pack's cert link; an `out` by either form held), `NAME(*)` by any
// dose of the potion, an unmarked NAME by game name. An id or family entry is offered one obj at a
// time, so a give-back takes every dose form held. A `<NAME>` placeholder is the module's (magic.ts,
// smithing.ts): it is neither traded nor checked here.
//
// The trade is lib/trade.ts: swap() when SCORED gives anything (with or without receiving),
// receiveFrom() when it only receives. swap() offers only the inventory, so an item the row gives
// while it is worn is unequipped first; the row's `+NAME` / `-NAME` are applied after the trade.
//
// An `out` of reason `drop` is dropped on the hand-off tile before the trade (unequipped first when
// worn) and is never offered: the engine refuses an untradeable obj in a trade (trade.rs2), so the
// ledger writes those as drops (H13's Khazard helmet and platemail), and an untradeable drop is shown
// to no other player (InvOps.ts). A `swap` or `trade` of an obj the content marks untradeable is
// refused when the row is planned, so a launch dry-run names it rather than the trade's confirm.
// The drop is idempotent: what a restart finds already gone is not dropped again.
//
// The partner (an account name, fleet staging, rs/41's) stands on the hand-off tile before SCORED
// arrives; the step does not wait for it or walk (the legs carry the travel). preconditions refuse
// with a reason when the partner is not in view, when SCORED does not hold what it gives, or when
// what it receives will not fit the free slots, counting the slots the given items free (the
// server counts offered items as freed, trade.rs2) and the slot each unequip takes first.
//
// Resume: `done` is the post-hand-off state (every `in` held at its count, every given item gone,
// the equip changes in place), so a restart after the trade skips it. The resume walk needs every
// done milestone to stay done, and the steps after a hand-off consume what it brought, so `done`
// also holds when:
// - `supersededBy`, the next milestone's own `done` (chain.ts passes it in), holds; or
// - the hand-off is in `record` (HandOffRecord: run and resume mark it once the post-hand-off
//   state shows) and nothing it gave is held again. Between the hand-off and the next milestone a
//   band eats into the items (S18's first stun, S22's first catch), and the state alone cannot
//   tell that from a hand-off not yet traded: the band's own `inProgress` already holds on arrival
//   (Thieving 57 at the knights, Fishing 78 at the river). A demo rollback across a swap hands its
//   given items back, which the second clause sees; across a receive-only trade it leaves the next
//   step's own kit check to refuse.
// A logout after the trade landed but before the equip changes leaves `inProgress`, entered
// through `resume`, which applies the equip only. A logout mid-trade refunds both sides, and the
// step runs again.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { BotSDK } from '../../sdk/index';
import type { BotWorldState, InventoryItem, TradeItem } from '../../sdk/types';
import { INVENTORY_SIZE, noteOf, objIdsNamed, objName, untradeable } from '../lib/items';
import { DROPPED_TICKS, receiveFrom, sameName, swap, tradeOf, type GiveSpec, type SwapSdk, type WantSpec } from '../lib/trade';
import { waitOrThrow, waitUntil } from '../lib/wait';
import { writeTopUpAsk, type AskItem, type CueScope, type TopUpAsk } from '../helpers/altar-cue';
import { opIndex } from '../lib/world';
import { itemLabel, MANIFEST, parseLedger, type InEntry, type ItemRef, type Kind, type LedgerRow, type Reason } from '../tools/slot-ledger';
import type { ObservedCheck, Step, StepContext } from './step';

/**
 * Ledger names whose game name differs (the ledger says `normal logs` where the game says `Logs`).
 * Every other ledger name is the game's, lower-cased; a potion's dose suffix `(4)` is matched.
 */
const GAME_NAMES: Readonly<Record<string, string>> = { 'normal logs': 'logs' };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The game's name for a ledger NAME, lower-cased (the mule's package lines name items this way). */
export const gameName = (name: string): string => GAME_NAMES[name] ?? name;

/** The game items a ledger NAME stands for. */
export function itemPattern(name: string): RegExp {
    return new RegExp(`^${escape(gameName(name))}(?:\\(\\d\\))?$`, 'i');
}

/** What a ledger entry matches in the game. */
export interface ItemMatch {
    /** The ledger NAME; with `ids`, only a label. */
    name: string;
    /** The game names NAME stands for (itemPattern), matched when there are no `ids`. */
    pattern: RegExp;
    /** `NAME @ID`: the obj ids it matches. */
    ids?: readonly number[];
    /** Offered one obj at a time (an id entry, a family): every form held goes. */
    perObj: boolean;
}

export const matches = (m: ItemMatch, i: { id: number; name: string }) => (m.ids ? m.ids.includes(i.id) : m.pattern.test(i.name));

/**
 * An entry's match: by id for `NAME @ID` (`noted` true: the note only; false: the obj only; unset,
 * as for an out: either), by any dose for `NAME(*)`, else by name.
 */
export function matchOf(e: ItemRef, at: string, noted?: boolean): ItemMatch {
    const base = { name: e.name, pattern: itemPattern(e.name) };
    if (e.id === undefined) return { ...base, perObj: e.family === true };
    const label = itemLabel(e);
    const obj = objName(e.id);
    if (obj === undefined) throw new Error(`${at}: ${label}: obj.pack has no obj ${e.id}`);
    if (obj.startsWith('cert_')) throw new Error(`${at}: ${label} is a banknote (${obj}); the ledger names the unnoted obj, [n] its note`);
    const note = noteOf(e.id);
    if (noted && note === undefined) throw new Error(`${at}: ${label} [n]: ${obj} has no note`);
    const ids = noted ? [note!] : noted === false || note === undefined ? [e.id] : [e.id, note];
    return { ...base, ids, perObj: true };
}

/** Two matches that can name the same item: shared ids, or the same name where either has none. */
const overlaps = (a: ItemMatch, b: ItemMatch) => (a.ids && b.ids ? a.ids.some(id => b.ids!.includes(id)) : a.name === b.name);

export interface Received extends ItemMatch {
    count: number;
    kind: Kind;
    /** Top up to `count` counting what SCORED holds (the H10 form): the trade asks for the difference. */
    topUp: boolean;
}

export interface Given extends ItemMatch {
    /** `any`: all of it when some is held, and nothing (the entry skipped) when none is (resolvePlan). */
    count: number | 'all' | 'any';
}

export type Worn = ItemMatch;

export interface HandOffPlan {
    id: string;
    /** The row's line in the source file. */
    line: number;
    receive: Received[];
    /** The `out` entries of reason `swap` or `trade`: offered in the trade. */
    give: Given[];
    /** The `out` entries of reason `drop`: dropped on the tile before the trade, never offered. */
    drop: Given[];
    /** `+NAME`: worn after the trade. */
    wield: Worn[];
    /** `-NAME`: not worn after the trade (displaced by a wield, or taken off). */
    unwield: Worn[];
    /** The row's `<NAME>` entries, as written: the module's, not traded here. */
    placeholders: string[];
}

export type TradeKind = 'swap' | 'receive';

/** swap() when SCORED gives anything; receiveFrom() when it only receives. */
export const tradeKind = (p: HandOffPlan): TradeKind => (p.give.length ? 'swap' : 'receive');

/** The `out` reasons a hand-off offers in its trade; `drop` is the one other it carries out. */
export const GIVEN_REASONS: readonly Reason[] = ['swap', 'trade'];

/** Why the trade can never offer what `m` names (every obj it can be is untradeable), or null. */
export function untradeableGive(m: ItemMatch): string | null {
    const ids = m.ids ?? objIdsNamed(m.pattern);
    if (!ids.length || !ids.every(untradeable)) return null;
    return `the engine refuses it in a trade (obj ${ids.join(', ')} untradeable in the content's obj config; trade.rs2)`;
}

/** A ledger row as a hand-off: refused when it is not a hand-off the trade can carry out. */
export function planHandOff(row: LedgerRow): HandOffPlan {
    const at = `${row.row} (line ${row.line})`;
    if (!/^H/.test(row.row)) throw new Error(`${at} is not a hand-off row`);
    const placeholders = [...row.in, ...row.out].filter(e => e.placeholder).map(itemLabel);
    const outs = row.out.filter(e => !e.placeholder);
    for (const e of outs) {
        if (!GIVEN_REASONS.includes(e.reason) && e.reason !== 'drop') throw new Error(`${at}: out ${itemLabel(e)} (${e.reason}) is neither given in the trade nor dropped on the tile; a hand-off gives (swap or trade) or drops`);
    }
    const give = outs.filter(e => GIVEN_REASONS.includes(e.reason)).map(e => {
        const m = matchOf(e, at);
        const refused = untradeableGive(m);
        if (refused) throw new Error(`${at}: out ${itemLabel(e)} (${e.reason}): ${refused}, so the row must drop it`);
        return { ...m, count: e.count ?? 'all' };
    });
    const drop = outs.filter(e => e.reason === 'drop').map(e => ({ ...matchOf(e, at), count: e.count ?? 'all' }));
    const receive = row.in.filter(e => !e.placeholder).map((e: InEntry) => {
        if (e.count === null) throw new Error(`${at}: in ${itemLabel(e)} x? has no count, so the trade cannot check the offer`);
        return { ...matchOf(e, at, e.kind === 'n'), count: e.count, kind: e.kind, topUp: e.topUp === true };
    });
    const both = give.filter(g => receive.some(r => overlaps(g, r)));
    if (both.length) throw new Error(`${at}: ${both.map(g => g.name).join(', ')} both given and received`);
    const dropIn = drop.filter(g => receive.some(r => overlaps(g, r)));
    if (dropIn.length) throw new Error(`${at}: ${dropIn.map(g => g.name).join(', ')} both dropped and received`);
    if (!give.length && !receive.length && !placeholders.length) throw new Error(`${at}: nothing given and nothing received`);
    const worn = (on: boolean) => row.equip.filter(e => e.on === on).map(e => ({ name: e.name, pattern: itemPattern(e.name), perObj: false }));
    return { id: row.row, line: row.line, receive, give, drop, wield: worn(true), unwield: worn(false), placeholders };
}

/** The row `id` of the inventory ledger in `markdown` (STEP-MANIFEST.md), as a hand-off. */
export function handOffFrom(markdown: string, id: string): HandOffPlan {
    const { rows, errors } = parseLedger(markdown);
    if (errors.length) throw new Error(`the inventory ledger does not parse: ${errors.join('; ')}`);
    const found = rows.filter(r => r.row === id);
    if (found.length !== 1) throw new Error(found.length ? `${found.length} ledger rows named ${id}` : `no ledger row ${id}`);
    return planHandOff(found[0]!);
}

/** `handOffFrom` on a file, STEP-MANIFEST.md by default. */
export function loadHandOff(id: string, file: string = MANIFEST): HandOffPlan {
    return handOffFrom(readFileSync(file, 'utf8'), id);
}

// ------------------------------------------------------------------ state checks

const total = (items: readonly InventoryItem[], m: ItemMatch) => items.reduce((a, i) => a + (matches(m, i) ? i.count : 0), 0);
const held = (s: BotWorldState, m: ItemMatch) => total(s.inventory, m) + total(s.equipment, m);
const isWorn = (s: BotWorldState, m: ItemMatch) => s.equipment.some(e => matches(m, e));
/** Everything the row's `out` takes off SCORED: what the trade gives and what is dropped. */
const leaving = (plan: HandOffPlan): Given[] => [...plan.give, ...plan.drop];

/**
 * `plan` as state `s` makes it: an `any` give or drop is `all` when some of it is held, and drops out
 * of the plan when none is (dead stock an earlier step used up, a backstop with nothing to drop). The
 * trade, its slot arithmetic and its offer work on this; an `all` with none held still refuses.
 */
export function resolvePlan(s: BotWorldState, plan: HandOffPlan): HandOffPlan {
    const resolve = (gs: readonly Given[]) => gs.flatMap((g): Given[] => (g.count !== 'any' ? [g] : held(s, g) > 0 ? [{ ...g, count: 'all' }] : []));
    return { ...plan, give: resolve(plan.give), drop: resolve(plan.drop) };
}

/** Worn items the row gives or drops that must come off first: swap() offers, and a drop takes, only the inventory. */
export function toUnequip(s: BotWorldState, plan: HandOffPlan): InventoryItem[] {
    return leaving(resolvePlan(s, plan)).flatMap(g => {
        const inPack = total(s.inventory, g);
        if (typeof g.count === 'number' && inPack >= g.count) return [];
        return s.equipment.filter(e => matches(g, e));
    });
}

/**
 * The trade's offer, from the inventory as it stands: an unmarked entry by its name pattern; an id
 * or family entry one offer per obj held (an obj and its note, every dose form), so all of it goes.
 */
export function giveSpecs(s: BotWorldState, plan: HandOffPlan): GiveSpec[] {
    return resolvePlan(s, plan).give.flatMap((g): GiveSpec[] => {
        const n = g.count === 'any' ? 'all' : g.count;
        if (!g.perObj) return [{ item: g.pattern, n }];
        const ids = [...new Set(s.inventory.filter(i => matches(g, i)).map(i => i.id))];
        // More than one obj: handOffPre has checked the row gives all it holds.
        return ids.map(id => ({ item: id, n: ids.length === 1 ? n : 'all' }));
    });
}

/** Inventory slots the given items free once offered and the dropped ones once gone (after the unequips, one slot each). */
function slotsFreed(s: BotWorldState, plan: HandOffPlan, unequipped: readonly InventoryItem[]): number {
    const pack = [...s.inventory, ...unequipped];
    return leaving(resolvePlan(s, plan)).reduce((a, g) => {
        const slots = pack.filter(i => matches(g, i));
        if (typeof g.count !== 'number') return a + slots.length;
        const stacked = slots.length === 1 && slots[0]!.count > 1;
        return a + (stacked ? (g.count >= slots[0]!.count ? 1 : 0) : Math.min(g.count, slots.length));
    }, 0);
}

/** How many of `r` the trade asks for: its COUNT, or for a top-up what SCORED lacks of it. */
export function wanted(s: BotWorldState, r: Received): number {
    return r.topUp ? Math.max(0, r.count - held(s, r)) : r.count;
}

/**
 * The top-up ask for `plan` from SCORED's state `s` (helpers/altar-cue.ts TopUpAsk, read by mule.ts's
 * `topUp` package lines): every received `to N` entry not yet met, at what SCORED lacks of it (wanted),
 * by its item pattern. Empty when every top-up is met: then no ask is written.
 */
export function askFor(s: BotWorldState, plan: HandOffPlan): AskItem[] {
    return plan.receive.filter(r => r.topUp).map(r => ({ item: r.pattern.source, count: wanted(s, r) })).filter(a => a.count > 0);
}

/** Slots the received items add: one per unstackable asked for, one for a stack SCORED does not hold. */
function slotsAdded(s: BotWorldState, plan: HandOffPlan): number {
    return plan.receive.reduce((a, r) => {
        const n = wanted(s, r);
        if (n === 0) return a;
        return a + (r.kind === 'u' ? n : s.inventory.some(i => matches(r, i)) ? 0 : 1);
    }, 0);
}

/** The trade's slot arithmetic: free now, the unequips it needs first, what the gives free and the receives take, and what is left after the equip changes. */
export interface SlotPlan {
    free: number;
    off: InventoryItem[];
    freed: number;
    adds: number;
    /** Free slots for the receives: free, less the unequips, plus what the gives free. */
    room: number;
    /** Free slots once the trade and the equip changes are done (negative: short). */
    after: number;
}

export function slotPlan(s: BotWorldState, plan: HandOffPlan): SlotPlan {
    const free = INVENTORY_SIZE - s.inventory.length;
    const off = toUnequip(s, plan);
    const freed = slotsFreed(s, plan, off);
    const adds = slotsAdded(s, plan);
    const room = free - off.length + freed;
    // Each wield frees a slot, each item it displaces (a `-NAME`) takes one back.
    return { free, off, freed, adds, room, after: room - adds + plan.wield.length - plan.unwield.length };
}

export function handOffPre(s: BotWorldState, plan: HandOffPlan, partner: string, o: { partnerInView?: boolean } = {}): true | string {
    if (!s.inGame) return 'not in game';
    if (o.partnerInView !== false && !s.nearbyPlayers.some(p => sameName(p.name, partner))) return `${plan.id}: ${partner} is not in view (the partner stands on the hand-off tile before SCORED arrives)`;
    for (const g of plan.give) {
        const h = held(s, g);
        // `any` with none held gives nothing (resolvePlan): not a refusal. `all` and a count still need some.
        if (h === 0 && g.count === 'any') continue;
        if (h === 0) return `${plan.id}: holds no ${g.name} to give`;
        if (typeof g.count === 'number' && h < g.count) return `${plan.id}: holds ${h} ${g.name}, gives ${g.count}`;
        // done reads a given item as gone; part of it left behind would never read done.
        if (typeof g.count === 'number' && h > g.count) return `${plan.id}: holds ${h} ${g.name} and gives ${g.count}; the row must give all of it`;
        // planHandOff refused a name that is only ever untradeable; this is a held obj of a mixed name.
        const refused = [...s.inventory, ...s.equipment].find(i => matches(g, i) && untradeable(i.id));
        if (refused) return `${plan.id}: gives ${g.name}, but the engine refuses ${refused.name} (obj ${refused.id}) in a trade: the row must drop it`;
    }
    for (const g of plan.drop) {
        // None held is a drop already made (a restart after it): nothing to do, not a refusal.
        const h = held(s, g);
        if (typeof g.count === 'number' && h > g.count) return `${plan.id}: holds ${h} ${g.name} and drops ${g.count}; the row must drop all of it`;
    }
    for (const w of plan.wield) {
        if (!plan.receive.some(r => r.name === w.name) && !held(s, w)) return `${plan.id}: +${w.name} is neither held nor received`;
    }
    return handOffRoom(s, plan);
}

/**
 * The slot half of handOffPre, which needs no partner in view: the unequips, the trade and the
 * equip changes after it fit the free slots, counting the slots the given and dropped items free.
 */
export function handOffRoom(s: BotWorldState, plan: HandOffPlan): true | string {
    const { free, off, freed, adds, room, after } = slotPlan(s, plan);
    if (free < off.length) return `${plan.id}: ${free} free slots, and taking off ${off.map(i => i.name).join(', ')} to give needs ${off.length}`;
    if (room < adds) return `${plan.id}: ${free} free slots, ${freed} freed by what it gives: the trade adds ${adds}, ${adds - room} short`;
    if (after < 0) return `${plan.id}: the equip changes after the trade need ${-after} more free slots`;
    return true;
}

/** What the post-hand-off state still lacks; empty once the hand-off is complete. */
export function handOffMissing(s: BotWorldState, plan: HandOffPlan): string[] {
    const out: string[] = [];
    for (const r of plan.receive) {
        const h = held(s, r);
        if (h < r.count) out.push(`${r.name} ${h} of ${r.count}`);
    }
    for (const g of plan.give) {
        const h = held(s, g);
        if (h > 0) out.push(`${g.name} x${h} still held`);
    }
    for (const g of plan.drop) {
        const h = held(s, g);
        if (h > 0) out.push(`${g.name} x${h} still held (dropped on the tile)`);
    }
    for (const w of plan.wield) if (!isWorn(s, w)) out.push(`${w.name} not worn`);
    for (const w of plan.unwield) if (isWorn(s, w)) out.push(`${w.name} still worn`);
    return out;
}

/** The trade has landed: every `in` held, every given and dropped item gone (the equip changes may be pending). */
export function tradeLanded(s: BotWorldState, plan: HandOffPlan): boolean {
    return plan.receive.every(r => held(s, r) >= r.count) && leaving(plan).every(g => held(s, g) === 0);
}

/** Nothing the row gives or drops is held: false once a rollback across the hand-off hands it back. */
export const givenGone = (s: BotWorldState, plan: HandOffPlan): boolean => leaving(plan).every(g => held(s, g) === 0);

// ------------------------------------------------------------------ the completion record

export const HANDOFFS_FILE = 'handoffs.json';

export interface HandOffEntry {
    /** The attempt (run.ts attemptOf: the run id of its tick log's first row, the same in every process that resumes it). */
    attempt: string;
    /** The ledger row (H14). */
    row: string;
    /** The client tick the post-hand-off state showed at (-1: none). */
    tick: number;
    at: string;
}

/**
 * The hand-offs found complete in an attempt: <run dir>/handoffs.json, beside relogs.json, read from
 * disk on every `has` so a resumed process sees what an earlier one marked. Keyed by the attempt, so
 * a fresh attempt starts with none and nothing has to clear the file.
 */
export class HandOffRecord {
    readonly file: string;

    constructor(readonly dir: string, readonly attempt: string, private readonly pid: number = process.pid) {
        this.file = join(dir, HANDOFFS_FILE);
    }

    entries(): HandOffEntry[] {
        if (!existsSync(this.file)) return [];
        try {
            const f = JSON.parse(readFileSync(this.file, 'utf8')) as { entries?: unknown };
            return Array.isArray(f.entries) ? (f.entries as HandOffEntry[]) : [];
        } catch {
            throw new Error(`${this.file} does not parse: fix or remove it before the run goes on`);
        }
    }

    has(row: string): boolean {
        return this.entries().some(e => e.attempt === this.attempt && e.row === row);
    }

    /** Record `row` complete in this attempt (once). */
    mark(row: string, tick: number): void {
        if (this.has(row)) return;
        const entries = [...this.entries(), { attempt: this.attempt, row, tick, at: new Date().toISOString() }];
        mkdirSync(this.dir, { recursive: true });
        const tmp = `${this.file}.${this.pid}.tmp`;
        writeFileSync(tmp, JSON.stringify({ v: 1, entries }, null, 2) + '\n', { mode: 0o600 });
        renameSync(tmp, this.file);
    }
}

// ------------------------------------------------------------------ the step

export type HandOffSdk = SwapSdk & Pick<BotSDK, 'sendUseItem' | 'sendUseEquipmentItem' | 'sendDropItem'>;

export interface HandOffReport {
    id: string;
    partner: string;
    trade: TradeKind;
    ok: boolean;
    /** SCORED's clock: its first trade click to the outcome. */
    ticks: number;
    /** swap() only: its first trade click to the screens opening. */
    openTicks?: number;
    received: string[];
    gave: string[];
    /** Items taken off to be given, before the trade. */
    unequipped: string[];
    /** The row's `drop` entries dropped on the tile before the trade (none already gone on a restart). */
    dropped: string[];
    reason?: string;
    /** The top-up ask written on the trade's first open frame (a cue with `ask`). */
    asked?: AskItem[];
}

export interface HandOffOptions<C> {
    /** The partner's account name (fleet staging, rs/41). */
    partner: string | ((c: C) => string);
    /** The next milestone's `done`: once it holds, this hand-off counts as done whatever the inventory shows. */
    supersededBy?: ObservedCheck<C>;
    /** The attempt's completion record (run.ts's): marked once the post-hand-off state shows, read by `done`. */
    record?: HandOffRecord;
    /** Observed ticks to get the screens open (default 30): swap()'s openTicks, receiveFrom()'s openMaxTicks. */
    openTicks?: number;
    /** Observed ticks from the screens opening to the outcome (default 40). */
    maxTicks?: number;
    /** receiveFrom only: re-send a trade click that drew no reply after this many ticks (default DROPPED_TICKS: the partner stands beside SCORED). swap() always uses DROPPED_TICKS. */
    noReplyTicks?: number;
    onReport?: (r: HandOffReport) => void;
    /** Called once just before the trade's first click: a delivery row rewrites its cue (CueKeeper.refresh), so the carrier meets a fresh one. */
    beforeTrade?: () => void;
    /** A partner that serves on a cue (the cannon holder, cannon.ts serve mode: see runHandOffOnCue), or sizes its top-ups from SCORED's ask (`ask`). */
    cue?: HandOffCue;
}

/**
 * A hand-off whose partner waits for a cue (helpers/altar-cue.ts) before it comes and requests:
 * the cannon holder serves H11 and H23 only to the receiver its {S14|S27, cannon} cue names.
 */
export interface HandOffCue {
    scope: CueScope;
    /** Open `scope`'s cue for the partner, who comes after it: the run's CueKeeper (runner/chain.ts), or a stand-in's own. */
    open?: (ctx: Pick<StepContext<unknown>, 'sdk'>) => Promise<void>;
    /**
     * A standing partner that sizes the row's top-ups from SCORED's ask (mule.ts `topUp` lines, rs/429):
     * on the first frame showing the trade with it open, askFor's items are written to `dir`'s
     * topup-ask.json carrying `scope`; nothing is written when every top-up is met.
     */
    ask?: { dir: string };
    /** Observed ticks to wait for the partner to come into sight after the cue (default 6000). */
    waitTicks?: number;
    /** Observed ticks, once it is in sight, for its standing request to arrive (default 30). */
    requestTicks?: number;
}

/** What runHandOffOnCue adds to the trade's report. */
export interface CueHandOffReport extends HandOffReport {
    /** The partner's request was standing when SCORED clicked. */
    standingAtClick: boolean;
    /** Observed ticks from the cue to the partner in sight. */
    arriveTicks: number;
}

const requestFrom = (partner: string, since: number) => (s: BotWorldState) =>
    s.gameMessages.some(m => m.tick >= since && m.type === 4 && /wishes to trade/i.test(m.text) && sameName(m.sender, partner));

/**
 * The cue-served hand-off, one sequence for the run (H11, H23) and the lab stand-in
 * (helpers/cannon-receiver.ts): open the cue, wait (bounded, observed ticks) for the partner in
 * sight, give its standing request a moment, then the row's own trade (runHandOff), so every `in`
 * of the row, the extras with the set, is wanted and checked.
 */
export async function runHandOffOnCue(ctx: Pick<StepContext<unknown>, 'sdk'>, plan: HandOffPlan, partner: string, cue: HandOffCue, o: Omit<HandOffOptions<unknown>, 'partner' | 'supersededBy' | 'cue' | 'record'> = {}): Promise<CueHandOffReport> {
    const sdk = ctx.sdk as unknown as HandOffSdk;
    if (!cue.open) throw new Error(`${plan.id}: runHandOffOnCue needs a cue to open`);
    await cue.open(ctx);
    const since = sdk.getState()?.tick ?? 0;
    const near = (s: BotWorldState) => s.nearbyPlayers.some(p => sameName(p.name, partner));
    const seen = await waitUntil(sdk, near, { maxTicks: cue.waitTicks ?? 6000 });
    if (!seen.ok) throw new Error(`${plan.id}: ${partner} did not come into sight within ${cue.waitTicks ?? 6000} ticks of the ${cue.scope.step}/${cue.scope.family} cue`);
    const arriveTicks = seen.tick - since;
    await waitUntil(sdk, requestFrom(partner, since), { maxTicks: cue.requestTicks ?? 30 });
    const standingAtClick = requestFrom(partner, since)(sdk.getState()!);
    const report = await runHandOff(sdk, plan, partner, o);
    return { ...report, standingAtClick, arriveTicks };
}

const names = (xs: readonly TradeItem[]) => xs.map(i => `${i.name} x${i.count}`);

/** Take off the worn items the row gives or drops, all in one tick, and wait until they are in the pack. */
export async function unequipGives(sdk: HandOffSdk, plan: HandOffPlan): Promise<InventoryItem[]> {
    const off = toUnequip(sdk.getState()!, plan);
    if (!off.length) return off;
    for (const e of off) void sdk.sendUseEquipmentItem(e.slot, opIndex(e, /^remove$/i) ?? 1);
    await waitOrThrow(sdk, s => off.every(e => !s.equipment.some(x => x.slot === e.slot && x.id === e.id)), 5, `${plan.id}: taking off ${off.map(e => e.name).join(', ')} to give`);
    return off;
}

/** Drop what the row's `drop` entries name that is still in the pack, all in one tick, and wait until it is gone. */
async function dropOuts(sdk: HandOffSdk, plan: HandOffPlan): Promise<InventoryItem[]> {
    const drop = sdk.getState()!.inventory.filter(i => plan.drop.some(g => matches(g, i)));
    if (!drop.length) return drop;
    for (const i of drop) void sdk.sendDropItem(i.slot);
    await waitOrThrow(sdk, s => drop.every(d => !s.inventory.some(x => x.slot === d.slot && x.id === d.id)), 5, `${plan.id}: dropping ${drop.map(i => i.name).join(', ')}`);
    return drop;
}

/** The row's equip changes: every wield in one tick, then any `-NAME` a wield did not displace. */
export async function applyEquip(sdk: HandOffSdk, plan: HandOffPlan): Promise<void> {
    const s = sdk.getState()!;
    const on = plan.wield.filter(w => !isWorn(s, w));
    for (const w of on) {
        const item = s.inventory.find(i => matches(w, i));
        if (!item) throw new Error(`${plan.id}: +${w.name}: not in the pack`);
        void sdk.sendUseItem(item.slot, opIndex(item, /^(wield|wear)$/i) ?? 2);
    }
    if (on.length) await waitOrThrow(sdk, st => on.every(w => isWorn(st, w)), 5, `${plan.id}: wielding ${on.map(w => w.name).join(', ')}`);
    const st = sdk.getState()!;
    const off = plan.unwield.flatMap(w => st.equipment.filter(e => matches(w, e)));
    for (const e of off) void sdk.sendUseEquipmentItem(e.slot, opIndex(e, /^remove$/i) ?? 1);
    if (off.length) await waitOrThrow(sdk, x => plan.unwield.every(w => !isWorn(x, w)), 5, `${plan.id}: taking off ${off.map(e => e.name).join(', ')}`);
}

/** One hand-off: unequip what is given or dropped while worn, drop the row's drops, trade, then the equip changes. */
export async function runHandOff(sdk: HandOffSdk, rowPlan: HandOffPlan, partner: string, o: Omit<HandOffOptions<unknown>, 'partner' | 'supersededBy' | 'record'> = {}): Promise<HandOffReport> {
    // `any` entries as the pack stands: with none held of every give, the trade only receives.
    const plan = resolvePlan(sdk.getState()!, rowPlan);
    const off = await unequipGives(sdk, plan);
    // The drops are observed gone before the trade, so the slots they free are real when it counts them.
    const dropped = (await dropOuts(sdk, plan)).map(i => i.name);
    const s0 = sdk.getState()!;
    const want: WantSpec[] = plan.receive.map(r => ({ item: r.ids ? r.ids[0]! : r.pattern, amount: wanted(s0, r) })).filter(w => w.amount > 0);
    const openTicks = o.openTicks ?? 30;
    const ask = o.cue?.ask;
    const items = ask ? askFor(s0, plan) : [];
    let asked: TopUpAsk | null = null;
    // Written from the frame handler, so it lands on the first frame that shows the trade open, before any accept.
    const unAsk = items.length
        ? sdk.onStateUpdate(st => {
              if (asked) return;
              const t = tradeOf(st);
              if (t.isOpen && sameName(t.partner, partner)) asked = writeTopUpAsk(ask!.dir, items, Date.now(), o.cue!.scope);
          })
        : () => {};
    let report: HandOffReport;
    try {
    if (want.length || plan.give.length) o.beforeTrade?.();
    if (!want.length && !plan.give.length) {
        // Every top-up already met and nothing to give: no trade.
        report = { id: plan.id, partner, trade: 'receive', ok: true, ticks: 0, received: [], gave: [], unequipped: off.map(e => e.name), dropped };
    } else if (tradeKind(plan) === 'swap') {
        const give = giveSpecs(s0, plan);
        const r = await swap(sdk, partner, give, want, { closeModals: true, openTicks, maxTicks: o.maxTicks ?? 40 });
        report = { id: plan.id, partner, trade: 'swap', ok: r.ok, ticks: r.ticks, openTicks: r.openTicks, received: names(r.received), gave: names(r.gave), unequipped: off.map(e => e.name), dropped, ...(r.reason ? { reason: r.reason } : {}) };
    } else {
        const r = await receiveFrom(sdk, partner, { want, maxTicks: o.maxTicks ?? 40, openMaxTicks: openTicks, openTimeoutMs: Infinity, noReplyTicks: o.noReplyTicks ?? DROPPED_TICKS });
        report = { id: plan.id, partner, trade: 'receive', ok: r.ok, ticks: r.ticks, received: names(r.received), gave: [], unequipped: off.map(e => e.name), dropped, ...(r.reason ? { reason: r.reason } : {}) };
    }
    } finally {
        unAsk();
    }
    if (asked) report.asked = (asked as TopUpAsk).items;
    o.onReport?.(report);
    if (!report.ok) throw new Error(`${plan.id} with ${partner}: ${report.reason ?? 'the trade failed'}`);
    await applyEquip(sdk, plan);
    return report;
}

/** The resumable Step for one hand-off row. Its name starts with the row id (`H13 hand-off`). */
export function handOffStep<C>(plan: HandOffPlan, opts: HandOffOptions<C>): Step<C> {
    const partner = (c: C) => (typeof opts.partner === 'function' ? opts.partner(c) : opts.partner);
    const sdkOf = (sdk: unknown) => sdk as HandOffSdk;
    const { record, supersededBy, ...trade } = opts;
    /** Marked only once the post-hand-off state shows: a mark with the equip pending would skip it. */
    const mark = (sdk: unknown) => {
        const s = sdkOf(sdk).getState();
        if (record && s && handOffMissing(s, plan).length === 0) record.mark(plan.id, s.tick);
    };
    return {
        name: `${plan.id} hand-off`,
        logoutSafe: true,
        // A cue-served partner comes after the cue, so it need not be in view yet.
        preconditions: (s, c) => handOffPre(s, plan, partner(c), { partnerInView: !opts.cue?.open }),
        postconditions: s => {
            const missing = handOffMissing(s, plan);
            return missing.length ? `${plan.id} after the trade: ${missing.join('; ')}` : true;
        },
        done: (o, c) => handOffMissing(o.state, plan).length === 0 || !!supersededBy?.(o, c) || (!!record?.has(plan.id) && givenGone(o.state, plan)),
        inProgress: o => tradeLanded(o.state, plan) && handOffMissing(o.state, plan).length > 0,
        async run(ctx) {
            if (trade.cue?.open) await runHandOffOnCue(ctx, plan, partner(ctx.c), trade.cue, trade);
            else await runHandOff(sdkOf(ctx.sdk), plan, partner(ctx.c), trade);
            mark(ctx.sdk);
        },
        async resume(ctx) {
            await applyEquip(sdkOf(ctx.sdk), plan);
            mark(ctx.sdk);
        },
    };
}

/** `handOffStep` for ledger row `id`, read from STEP-MANIFEST.md (or `file`). */
export function handOff<C>(id: string, opts: HandOffOptions<C> & { file?: string }): Step<C> {
    return handOffStep(loadHandOff(id, opts.file), opts);
}
