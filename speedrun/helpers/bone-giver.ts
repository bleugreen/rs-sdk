// bone-giver (role): the S07 dragon-bone giver. While the scored account chops
// with the knife cycle and buries a bone every roll (docs/speedrun/skills/
// woodcutting.md section 9), this helper stands on the tile beside its chopping
// tile with exactly one trade's worth of bones and keeps a trade request standing
// with it. The scored step's own trade click (lib/trade.ts receiveFrom) then opens
// both screens at once, and the helper offers the whole load in one press
// (lib/trade.ts give). Then it restocks and comes back. Measurements and the
// contract: docs/speedrun/helpers/bone-giver.md.
//
// Why a standing request. The engine answers a request that lands "Sending trade
// offer...", and it stays standing until a trade opens or closes (trade.rs2
// [opplayer4]), so the scored account's first click that lands opens both screens.
// When to click is lib/trade.ts's one rule (decideTradeClick, through openTrade): a
// refusal while the target is busy (a bury, a level-up page) is re-sent on the frame
// that shows it, a dropped click a couple of frames after its action result came back,
// never while a click is pending or the trade is open, and a standing request only
// after `resendTicks` without a trade (re-sending sooner would spam the scored
// account's chat), in case it relogged.
//
// The receiver is never named in config or logs: it is whoever in sight matches
// the receiver hash in the cue directory (altar-cue.ts), the same cue the altar
// givers read. Started by the run-machine launcher (standalone.ts) like them.
//
// Role options (ROLE_OPTIONS):
//   item         item to give (default 'Dragon bones'; S18 'Babydragon bones', the dragon-first rule). In the
//                standing mode a priority list (S07: ["Dragon bones", "Babydragon bones"]): each restock fills the
//                load from the first the bank still holds, then the next (boneWithdrawals), and the load offers what
//                is carried in the same order, so every giver buries its own dragon bones first
//   obj          the (first) item's staff-give name for restock cheat (default the item name in snake case)
//   n            per trade (default 23: the knife loop's free slots)
//   group        standing mode only: the accounts taking turns at the site, this one included
//                (S07's b01-b04). Only the group's server keeps a request standing (boneServer,
//                altar-cue.ts turnOrder); the rest wait loaded on the tile without requesting.
//                With a group, `trades` counts the group's loads, and the one giver whose entry
//                carries finalExtras serves the group's last load (boneServer)
//   sites        [{ giver: {x,z}, receiver: {x,z} }] in run order (default: the oak tile, then the Taverley willow).
//                Standing mode: while the cue names a site (Cue.site, SCORED's stand: namedSite) the giver goes
//                to that site's giver tile and waits there for as long as it is named; before any cue it holds
//                on its current site (sites[0] at launch); a cue naming none of the sites keeps the rotation
//   siteWaitTicks  rotation only (a cue naming no site): how long to wait at a site for the receiver before trying the next (default 30)
//   trades       stop after this many trades, the group's with a group (default: until the cue says stop)
//   restock      { kind: 'bank'|'cheat', bank?: {x,z}, labSeed? } (cheat: local lab only; bank default Falador west).
//                labSeed [{ obj, n }] (bank, local lab only): staff-give these into the pack before the first bank
//                visit, which banks them, so the lab's withdrawals are real ones
//   noReplyTicks re-send when neither answer came back (default lib/trade.ts DROPPED_TICKS, 2 frames after the click's result: the giver stands beside the receiver)
//   resendTicks  re-send a standing request after this long without a trade (default 100)
//   finalExtras  [{ item, count, obj? }] offered beside the bones on the LAST load only (needs `trades`;
//                S07's T07-08 Camelot runes, law 1 and air 5); `obj` names the staff give for restock cheat.
//                In a group, on one giver only: it carries them on every trip and offers them on the
//                group's last load, which boneServer keeps for it
//   finalN       bones on that last load (default n - finalExtras.length: the same free slots as every load)
//   acceptReturn standing mode, rehearsals only (default false): after each trade take the load straight
//                back from the scored-side account (bone-receiver.ts returnLoads), and when the group is
//                done bank everything held, so the bank ends as it was staged. Never set on the run
//   cueDir       default RC_CUE_DIR, else run-machine/rc-cue in the checkout
//   scope        required: { step, family }, the cue this giver serves (altar-cue.ts CueScope):
//                family 'bone' in the standing mode (S07), 'courier' in on-request (S18)
//
// mode 'on-request' (S18's stun-pack courier, SUPPLIES.md H14.1-H14.13): the scored
// account requests at a stun offset of its choosing (the Thieving module's top-up),
// and once the trade is open it writes what it wants (the top-up ask, altar-cue.ts:
// bones to fill its free slots, food back to 2, an arrowtip tier once) to the cue
// directory. The courier can't size a load itself: it can't see the scored account's
// inventory. It holds a side tile of the scored account (orthogonally adjacent, no wall
// on the edge between, never an NPC's tile, re-stepped whenever it moves), answers the request on the frame that
// carries it, offers what the ask names (each item in one press), and refills to `hold`
// bones and its `carry` list whenever it holds fewer than `refillBelow` bones or less
// than a carried count. Why a side: an op on a player reaches it only from a side
// (rsmod's rectangle reach, GameMap.reachedEntity), and a stunned account cannot step
// round a corner, so a request between a stunned account and a giver on a corner or 2-3
// tiles off goes nowhere and draws no message (rs/279's lab: 6 of 17 due top-ups lost
// that way). Options for it:
//   hold, refillBelow  bones held after a restock (default 28; less the carry's slots) and the refill bar (21)
//   carry        [{ item, count, obj?, once? }] the other stacks the courier keeps for the ask:
//                sharks, the adamant and rune arrowtips (`once`: delivered once, then not restocked)
//   standing     keep our own trade request standing with the scored account, so its
//                click opens both screens (default off; rs/158's acceptance in bone-giver.md)
//   askWaitTicks observed ticks to wait after the open for the ask (default 2), then decline
//   sites[0]     where to wait when the scored account is out of sight (required)
import { join } from 'node:path';
import type { BotWorldState, NearbyPlayer } from '../../sdk/types';
import { withdrawMany } from '../lib/bank';
import { give, DROPPED_TICKS, openTrade, receiveFrom, tradeOf, type GiveSpec } from '../lib/trade';
import { waitUntil, type StateSource } from '../lib/wait';
import { existsSync, readdirSync } from 'node:fs';
import { runIsOn } from '../lib/run-mode';
import { assertUntracked, awaitAsk, canonName, CueWatcher, cueDir, nameHash, newRequestFrom, readJson, scopeOption, turnOrder, writeJsonAtomicSync, type Cue, type CueScope, type TopUpAsk } from './altar-cue';
import { chebyshev, cheat, count, isLocalServer, labTele, pos, standOn, until, type Tile } from './altar-room';
import { closeBank, depositAllExcept, ensureOutOfTutorial, openBank, walkNear } from './mule';
import { runStandalone, type Role, type RoleContext } from './role';

export interface Site {
    giver: Tile;
    receiver: Tile;
}

/** S07's chopping tiles (woodcutting.md, bones-placement.md section 3): the giver stands on the tile beside. */
export const S07_SITES: Site[] = [
    { receiver: { x: 2914, z: 3494 }, giver: { x: 2913, z: 3494 } }, // Taverley oaks
    // Taverley willows: (2920,3407) is inside a willow and can't be stood on (attempt 2); players don't block players.
    { receiver: { x: 2920, z: 3406 }, giver: { x: 2920, z: 3405 } }
];

/** How far (Chebyshev) a cue's site may be from a site's receiver tile and still name it: woodcutting.ts NEAR, the radius a band starts within. */
export const SITE_MATCH_TILES = 8;

/**
 * The index of the site the cue names: the one whose receiver tile is the cue's `site` (SCORED's
 * stand), else the nearest receiver within SITE_MATCH_TILES (the first on a tie). null when the cue
 * names no site, none of ours, or is a stop.
 */
export function namedSite(sites: readonly Site[], cue: Pick<Cue, 'site' | 'stop'> | null | undefined): number | null {
    const at = cue && !cue.stop ? cue.site : undefined;
    if (!at) return null;
    let best: number | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (const [i, s] of sites.entries()) {
        const d = chebyshev(s.receiver, at);
        if (d < bestD) [best, bestD] = [i, d];
    }
    return bestD <= SITE_MATCH_TILES ? best : null;
}

/** Walks onto a named site that may fail in a row before the giver stops trying and stays, faulted, until the cue names another site. */
export const NAMED_TRAVEL_TRIES = 3;

/** Falador west bank, the nearest to Taverley's trees. */
export const DEFAULT_BONE_BANK: Tile = { x: 2946, z: 3368 };

export type BoneMode = 'standing' | 'on-request';

/** An item carried beside the bones; `obj` is its staff-give name (restock kind cheat). */
export interface Extra {
    item: string;
    count: number;
    obj?: string;
}

/** A stack the on-request courier keeps for the ask; `once`: delivered in one top-up, then not restocked. */
export interface Carried extends Extra {
    once?: boolean;
}

export interface BoneGiverOptions {
    mode: BoneMode;
    /** The first of `items`. */
    item: string;
    /** The bones in priority order: one, or (standing mode) a list filled first to last. */
    items: string[];
    /** The item's staff-give name (restock kind cheat). */
    obj: string;
    n: number;
    hold: number;
    refillBelow: number;
    /** on-request: the other stacks kept for the ask. */
    carry: Carried[];
    /** on-request: keep our own request standing with the scored account. */
    standing: boolean;
    /** on-request: observed ticks after the open to wait for the ask. */
    askWaitTicks: number;
    sites: Site[];
    siteWaitTicks: number;
    /** standing: the accounts taking turns (canonical names, this one included); empty: no group. */
    group: string[];
    trades: number;
    restock: { kind: 'bank' | 'cheat'; bank: Tile; labSeed?: { obj: string; n: number }[] };
    noReplyTicks: number;
    resendTicks: number;
    finalExtras: Extra[];
    /** Bones on the last load, the one that carries finalExtras. */
    finalN: number;
    /** Rehearsal only: take each load back from the scored-side account, and bank everything at the end. */
    acceptReturn: boolean;
    cueDir: string;
    scope: CueScope;
}

const tile = (t: unknown, what: string): Tile => {
    const r = (t ?? {}) as Record<string, unknown>;
    const x = Number(r.x);
    const z = Number(r.z);
    if (!Number.isInteger(x) || !Number.isInteger(z)) throw new Error(`${what} needs integer x and z`);
    return { x, z };
};

export function boneGiverOptions(raw: Record<string, unknown>, env: Record<string, string | undefined> = process.env): BoneGiverOptions {
    const mode = (raw.mode ?? 'standing') as BoneMode;
    if (mode !== 'standing' && mode !== 'on-request') throw new Error(`mode must be standing or on-request (got ${raw.mode})`);
    if (mode === 'on-request' && raw.sites === undefined) throw new Error('mode on-request needs sites (where to wait for the scored account)');
    const n = raw.n === undefined ? 23 : Number(raw.n);
    if (!Number.isInteger(n) || n < 1 || n > 28) throw new Error(`n must be 1-28 (got ${raw.n})`);
    const hold = Number(raw.hold ?? 28);
    const refillBelow = Number(raw.refillBelow ?? 21);
    if (!Number.isInteger(hold) || hold < 1 || hold > 28 || !(refillBelow >= 1 && refillBelow <= hold)) throw new Error('hold must be 1-28 and refillBelow 1-hold');
    const sites = raw.sites === undefined ? S07_SITES : (raw.sites as unknown[]).map((s, i) => ({ giver: tile((s as Site).giver, `sites[${i}].giver`), receiver: tile((s as Site).receiver, `sites[${i}].receiver`) }));
    if (sites.length === 0) throw new Error('sites must not be empty');
    const r = (raw.restock ?? {}) as Record<string, unknown>;
    const kind = r.kind ?? 'bank';
    if (kind !== 'bank' && kind !== 'cheat') throw new Error(`restock.kind must be bank or cheat (got ${kind})`);
    const trades = raw.trades === undefined ? Number.POSITIVE_INFINITY : Number(raw.trades);
    if (!(trades >= 1)) throw new Error(`trades must be at least 1 (got ${raw.trades})`);
    const extra = (what: string) => (e: unknown, i: number): Carried => {
        const r = (e ?? {}) as Record<string, unknown>;
        const count = Number(r.count);
        if (typeof r.item !== 'string' || !r.item || !Number.isInteger(count) || count < 1) throw new Error(`${what}[${i}] needs an item name and a whole count`);
        if (kind === 'cheat' && typeof r.obj !== 'string') throw new Error(`${what}[${i}] needs obj (the staff-give name) with restock kind cheat`);
        return { item: r.item, count, ...(typeof r.obj === 'string' ? { obj: r.obj } : {}), ...(r.once === true ? { once: true } : {}) };
    };
    const finalExtras: Extra[] = ((raw.finalExtras ?? []) as unknown[]).map(extra('finalExtras')).map(({ once: _, ...e }) => e);
    const carry = ((raw.carry ?? []) as unknown[]).map(extra('carry'));
    if (mode !== 'on-request' && (carry.length || raw.standing !== undefined || raw.askWaitTicks !== undefined)) throw new Error('carry, standing and askWaitTicks are for the on-request mode (S18) only');
    const askWaitTicks = Number(raw.askWaitTicks ?? 2);
    if (!Number.isInteger(askWaitTicks) || askWaitTicks < 0) throw new Error(`askWaitTicks must be a whole number (got ${raw.askWaitTicks})`);
    if (raw.standing !== undefined && typeof raw.standing !== 'boolean') throw new Error('standing must be true or false');
    if (finalExtras.length) {
        if (mode !== 'standing') throw new Error('finalExtras is for the standing mode (S07) only');
        if (!Number.isFinite(trades)) throw new Error('finalExtras needs trades: the last load is the trades-th');
        // Bones are unstackable, each extra is one stack: the last load is n + extras slots.
    }
    // The receiver frees `n` slots a load; by default the last load fits the same slots, extras included.
    const finalN = raw.finalN === undefined ? n - finalExtras.length : Number(raw.finalN);
    if (finalExtras.length && (!Number.isInteger(finalN) || finalN < 1 || finalN + finalExtras.length > 28)) {
        throw new Error(`finalN must be at least 1 and finalN + finalExtras must fit 28 slots (got ${raw.finalN ?? finalN} + ${finalExtras.length})`);
    }
    const items = Array.isArray(raw.item) ? raw.item : [raw.item ?? 'Dragon bones'];
    if (!items.length || items.some(i => typeof i !== 'string' || !i.trim())) throw new Error('item must be a name or a non-empty list of names');
    if (new Set(items.map(i => (i as string).toLowerCase())).size !== items.length) throw new Error('item names a bone twice');
    if (items.length > 1 && mode !== 'standing') throw new Error('an item list is for the standing mode (S07) only');
    const item = items[0] as string;
    let labSeed: { obj: string; n: number }[] | undefined;
    if (r.labSeed !== undefined) {
        if (kind !== 'bank' || !Array.isArray(r.labSeed) || r.labSeed.some(s => typeof (s as { obj?: unknown })?.obj !== 'string' || !(Number((s as { n?: unknown }).n) >= 1))) {
            throw new Error('restock.labSeed is a list of { obj, n } for restock kind bank');
        }
        labSeed = (r.labSeed as { obj: string; n: number }[]).map(s => ({ obj: s.obj, n: Number(s.n) }));
    }
    if (raw.group !== undefined && (!Array.isArray(raw.group) || raw.group.length < 2 || raw.group.some(g => typeof g !== 'string' || !g.trim()))) throw new Error('group must list at least two account names, this one included');
    const group = ((raw.group ?? []) as string[]).map(canonName);
    if (group.length && mode !== 'standing') throw new Error('group is for the standing mode (S07) only');
    if (new Set(group).size !== group.length) throw new Error('group names an account twice');
    // The group's last-load giver carries a whole load and the extras on every trip (the last load is any of its trips).
    if (group.length && finalExtras.length && (n + finalExtras.length > 28 || finalN > n)) {
        throw new Error(`in a group the finalExtras giver carries n bones and the extras on every trip: n + finalExtras must fit 28 slots and finalN must be at most n (got ${n} + ${finalExtras.length}, finalN ${finalN})`);
    }
    return {
        mode,
        item,
        items: items as string[],
        obj: typeof raw.obj === 'string' ? raw.obj : item.toLowerCase().replace(/\s+/g, '_'),
        n,
        hold,
        refillBelow,
        carry,
        standing: raw.standing === true,
        askWaitTicks,
        sites,
        siteWaitTicks: Number(raw.siteWaitTicks ?? 30),
        group,
        trades,
        restock: { kind, bank: r.bank ? tile(r.bank, 'restock.bank') : DEFAULT_BONE_BANK, ...(labSeed ? { labSeed } : {}) },
        noReplyTicks: Number(raw.noReplyTicks ?? DROPPED_TICKS),
        resendTicks: Number(raw.resendTicks ?? 100),
        finalExtras,
        finalN: finalExtras.length ? finalN : n,
        acceptReturn: acceptReturnOption(raw.acceptReturn, mode, kind),
        cueDir: typeof raw.cueDir === 'string' ? raw.cueDir : cueDir(env),
        scope: scopeOption(raw.scope, [mode === 'standing' ? 'bone' : 'courier'])
    };
}

function acceptReturnOption(raw: unknown, mode: BoneMode, kind: string): boolean {
    if (raw === undefined || raw === false) return false;
    if (raw !== true) throw new Error('acceptReturn must be true or false');
    if (mode !== 'standing' || kind !== 'bank') throw new Error('acceptReturn is for the standing mode with restock kind bank (a trade-and-return rehearsal)');
    return true;
}

/** The same items merged by name: what to want back from a give()'s `gave`. */
export function returnWants(gave: readonly { name: string; count: number }[]): { name: string; count: number }[] {
    const by = new Map<string, number>();
    for (const g of gave) by.set(g.name, (by.get(g.name) ?? 0) + g.count);
    return [...by].map(([name, count]) => ({ name, count }));
}

/** The bank can't make the next load (bones or extras): in a group the giver leaves rather than retrying. */
export class BankShortError extends Error {}

const escape = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exact = (name: string) => new RegExp(`^${escape(name)}$`, 'i');
/** Any of the names, exactly. */
const exactAny = (names: readonly string[]) => new RegExp(`^(?:${names.map(escape).join('|')})$`, 'i');

/**
 * The bank withdrawals for a load of `n` bones: from the first of `items` the bank holds, then the
 * next, so a giver's own dragon bones go before its babydragon. `short`: bones the bank lacks.
 */
export function boneWithdrawals(bank: readonly { name: string; count: number }[], items: readonly string[], n: number): { specs: { item: RegExp; n: number }[]; short: number } {
    let need = n;
    const specs: { item: RegExp; n: number }[] = [];
    for (const name of items) {
        if (need <= 0) break;
        const re = exact(name);
        const take = Math.min(need, bank.filter(i => re.test(i.name)).reduce((a, i) => a + i.count, 0));
        if (take > 0) specs.push({ item: re, n: take });
        need -= take;
    }
    return { specs, short: need };
}

/**
 * True when the load after `tradesDone` completed trades (the group's, with a group) is the last one,
 * the one that carries `finalExtras`: by the count, or at once when the cue says `lastLoad` (Cue.lastLoad).
 */
export function isFinalLoad(o: Pick<BoneGiverOptions, 'trades' | 'finalExtras'>, tradesDone: number, lastLoad = false): boolean {
    return o.finalExtras.length > 0 && (lastLoad || tradesDone === o.trades - 1);
}

/** Bones on the load after `tradesDone` trades: `finalN` on the last load, none on the cue's `lastLoad` (the extras alone), else `n`. */
export function loadBones(o: Pick<BoneGiverOptions, 'n' | 'finalN' | 'trades' | 'finalExtras'>, tradesDone: number, lastLoad = false): number {
    if (lastLoad && isFinalLoad(o, tradesDone, true)) return 0;
    return isFinalLoad(o, tradesDone) ? o.finalN : o.n;
}

/**
 * The standing mode's offer for the load after `tradesDone` trades: `n` bones, or `finalN` bones and
 * `finalExtras` on the last load by the count. With the cue's `lastLoad` the last-load giver offers
 * `finalExtras` alone: SCORED wants no more bones, and T07-08 has no room to carry them. With an item
 * list the bones are split by what is carried (`carried`, by name), first item first.
 */
export function loadOffer(
    o: Pick<BoneGiverOptions, 'items' | 'n' | 'finalN' | 'trades' | 'finalExtras'>,
    tradesDone: number,
    carried: (item: string) => number = () => Number.POSITIVE_INFINITY,
    lastLoad = false
): GiveSpec[] {
    const extras = isFinalLoad(o, tradesDone, lastLoad) ? o.finalExtras : [];
    let need = loadBones(o, tradesDone, lastLoad);
    if (need <= 0) return extras.map(e => ({ item: exact(e.item), n: e.count }));
    const bones: GiveSpec[] = [];
    for (const [i, name] of o.items.entries()) {
        // The last type takes whatever is still to give, so a short pack fails in give(), not silently here.
        const take = i === o.items.length - 1 ? need : Math.min(need, carried(name));
        if (take > 0) bones.push({ item: exact(name), n: take });
        need -= take;
        if (need <= 0) break;
    }
    return [...bones, ...extras.map(e => ({ item: exact(e.item), n: e.count }))];
}

// ------------------------------------------------------------------ the standing request

export interface RequestOutcome {
    ok: boolean;
    /** Frames from our first request to the screens opening. */
    waited: number;
    /** First frame our request was answered "Sending trade offer..." (it stood); -1 if it never was. */
    landedTick: number;
    sends: number;
    bounces: number;
    reason?: string;
}

export interface StandingRequestHooks {
    /** The receiver, found in sight by its name hash; undefined while it is out of sight. */
    receiver(): NearbyPlayer | undefined;
    /** True when the cue says stop. */
    stopped(): boolean;
    log(message: string, data?: Record<string, unknown>): void;
}

/**
 * Keep a trade request standing with the receiver (lib/trade.ts openTrade, the one
 * click rule) until its own trade click opens both screens. Waits up to 10 frames for
 * it to come into sight, and gives up when it is out of sight for 10 frames, the cue
 * stops, or the role is aborted. Shared by every giver that requests first: the bone
 * giver, the anvil holder (anvil.ts) and the cannon holder's serve mode (cannon.ts).
 */
export async function requestUntilOpen(ctx: Pick<RoleContext, 'sdk' | 'signal'>, o: Pick<BoneGiverOptions, 'noReplyTicks' | 'resendTicks'>, hooks: StandingRequestHooks): Promise<RequestOutcome> {
    const { sdk } = ctx;
    const none = (reason: string): RequestOutcome => ({ ok: false, waited: 0, landedTick: -1, sends: 0, bounces: 0, reason });
    if (!hooks.receiver() && !tradeOf(sdk.getState() ?? ({} as BotWorldState)).isOpen) {
        await waitUntil(sdk, () => !!hooks.receiver() || hooks.stopped() || ctx.signal.aborted, { maxTicks: 10 });
    }
    if (ctx.signal.aborted) return none('aborted');
    if (hooks.stopped()) return none('cue stop');
    const receiver = hooks.receiver();
    const s = sdk.getState();
    const partner = receiver?.name ?? (s ? tradeOf(s).partner : null);
    if (!partner) return none('receiver left sight');
    const r = await openTrade(sdk, partner, {
        noReplyTicks: o.noReplyTicks,
        resendTicks: o.resendTicks,
        goneTicks: 10,
        timeoutMs: Infinity,
        stopped: () => hooks.stopped() || ctx.signal.aborted
    });
    if (r.bounces) hooks.log('bounces', { bounces: r.bounces });
    const out = { waited: r.ok ? r.openTick - r.firstClickTick : 0, landedTick: r.landedTick, sends: r.sends, bounces: r.bounces };
    if (r.ok) return { ok: true, ...out };
    const reason = r.reason === 'stopped' ? (ctx.signal.aborted ? 'aborted' : 'cue stop') : r.reason === 'player_not_found' ? 'receiver left sight' : (r.reason ?? 'no_response');
    return { ok: false, ...out, reason };
}

/** True when the open trade's partner is the receiver (by name hash). */
export function partnerIs(s: BotWorldState | null | undefined, receiverHash: string | null | undefined): boolean {
    const partner = s ? tradeOf(s).partner : null;
    return !!partner && !!receiverHash && nameHash(partner) === receiverHash;
}

// ------------------------------------------------------------------ on request (S18)

/** What the courier offers for an ask: each asked item it holds, at most the asked count, and what it is short of. */
export interface AskOffer {
    specs: GiveSpec[];
    /** Asked items held short of the count (or not at all), by pattern. */
    short: Array<{ item: string; asked: number | 'all'; held: number }>;
}

export function askOffer(ask: Pick<TopUpAsk, 'items'>, inventory: readonly { name: string; count: number }[]): AskOffer {
    const specs: GiveSpec[] = [];
    const short: AskOffer['short'] = [];
    for (const a of ask.items) {
        const re = new RegExp(a.item, 'i');
        const held = inventory.filter(i => re.test(i.name)).reduce((s, i) => s + i.count, 0);
        if (held === 0 || (a.count !== 'all' && held < a.count)) short.push({ item: a.item, asked: a.count, held });
        if (held > 0) specs.push({ item: re, n: a.count === 'all' ? 'all' : Math.min(a.count, held) });
    }
    return { specs, short };
}

/** The carried stacks still to keep: a `once` stack drops out after it is delivered. */
export function carryDue(carry: readonly Carried[], delivered: ReadonlySet<string>): Carried[] {
    return carry.filter(c => !(c.once && delivered.has(c.item.toLowerCase())));
}

// ------------------------------------------------------------------ the side tile (S18)

const SIDES: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** True when `me` is orthogonally adjacent to `t`: a side, not a corner, not further. */
export function onSide(me: Tile, t: Tile): boolean {
    return Math.abs(me.x - t.x) + Math.abs(me.z - t.z) === 1;
}

/** Every tile an NPC stands on (its SW route tile and footprint). */
export function npcTiles(s: BotWorldState | null | undefined): Tile[] {
    const out: Tile[] = [];
    for (const n of s?.nearbyNpcs ?? []) {
        const x0 = n.tileX ?? n.x;
        const z0 = n.tileZ ?? n.z;
        const size = n.size ?? 1;
        for (let dx = 0; dx < size; dx++) for (let dz = 0; dz < size; dz++) out.push({ x: x0 + dx, z: z0 + dz });
    }
    return out;
}

/**
 * A tile's collision flags on the courier's level: true when any bit of `mask` is set. At runtime
 * the SDK pathfinder's map (sdk/pathfinding.ts isFlagged), which keeps rsmod's directional wall flags.
 */
export type FlagReader = (x: number, z: number, mask: number) => boolean;

// rsmod's CollisionFlag wall bits (server/vendor/rsmod-pathfinder): a wall on that edge of the tile.
const WALL_NORTH = 2;
const WALL_EAST = 8;
const WALL_SOUTH = 32;
const WALL_WEST = 128;

/**
 * Whether a wall stands on the edge between orthogonal neighbours `a` and `b`, read from either
 * tile's flags in the matching direction (the map flags a wall on both of its tiles; either is enough).
 */
export function wallBetween(a: Tile, b: Tile, flagged: FlagReader): boolean {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const [out, back] = dx === 1 ? [WALL_EAST, WALL_WEST] : dx === -1 ? [WALL_WEST, WALL_EAST] : dz === 1 ? [WALL_NORTH, WALL_SOUTH] : [WALL_SOUTH, WALL_NORTH];
    return flagged(a.x, a.z, out) || flagged(b.x, b.z, back);
}

/**
 * True when `me` is on a side of `t` that `t` can trade from without stepping: orthogonally
 * adjacent with no wall on the edge between. A stunned scored account cannot step, so across a
 * wall its request draws 'I can't reach that!' and dies (rs/454's probe).
 */
export function onOpenSide(me: Tile, t: Tile, flagged: FlagReader): boolean {
    return onSide(me, t) && !wallBetween(t, me, flagged);
}

/**
 * The side tiles of `receiver` the giver may hold, nearest to `me` first: orthogonally
 * adjacent, no wall on the edge between it and `receiver`, and never a tile an NPC stands on
 * (the knight the scored account pickpockets). A blocking loc (a stall) is no wall: it stays.
 */
export function sideTiles(receiver: Tile, me: Tile, npcs: readonly Tile[], flagged: FlagReader): Tile[] {
    const dist = (a: Tile) => Math.abs(a.x - me.x) + Math.abs(a.z - me.z);
    return SIDES.map(([dx, dz]) => ({ x: receiver.x + dx, z: receiver.z + dz }))
        .filter(t => !npcs.some(n => n.x === t.x && n.z === t.z) && !wallBetween(receiver, t, flagged))
        .sort((a, b) => dist(a) - dist(b));
}

// ------------------------------------------------------------------ role

/**
 * Whether a leg ran, by its pace: a walk covers at most one tile a tick, so a leg that took fewer
 * ticks than the tiles between its ends (Chebyshev, a lower bound on the path) ran at least part of
 * the way. A slower leg may have walked or run round obstacles: null, undecided. Run energy is no
 * evidence: the demo keeps it at 100 (rs/163, and every rs/383 demo trip read 100 at each end).
 */
export function legRan(from: Tile, to: Tile, ticks: number): boolean | null {
    if (from.x < 0 || to.x < 0 || ticks <= 0) return null;
    return ticks < chebyshev(from, to) ? true : null;
}

/** Observed ticks one side step waits before the courier re-reads where the scored account is. */
export const SIDE_STEP_TICKS = 4;

export type BonePhase = 'start' | 'restock' | 'travel' | 'waiting' | 'requested' | 'trading' | 'fault' | 'off';

/** bones-<account>.json: a bone giver's status, beside the altar givers' in the cue directory. */
export interface BoneStatus {
    v: 1;
    account: string;
    phase: BonePhase;
    held: number;
    n: number;
    trades: number;
    bounces: number;
    tile: { x: number; z: number; level: number } | null;
    /** Loaded at the site since (Date.now()): waiting, requesting or trading. null otherwise. */
    readyAt: number | null;
    /** The cue session `trades` was counted in (null before the first cue): the group's count is per session. */
    session: string | null;
    /** This giver carries the group's last load (its entry has finalExtras). */
    final: boolean;
    /** The `trades` option, the group's load count with a group; null without one. */
    loads: number | null;
    /** This giver served the load the cue's `lastLoad` asked for, in `session`: the group has no load left to give there. */
    lastGiven?: boolean;
    detail?: string;
    ms: number;
}

/**
 * Every status in `dir`, each from its own account's file only: a status counts when its file is
 * `bones-<canonName(account)>.json`, the name its giver writes (statusPath). A renamed or copied file
 * claiming another account is skipped, so no account counts twice and none is a phantom.
 */
export function readBoneStatuses(dir: string): BoneStatus[] {
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
        .filter(f => /^bones-.+\.json$/.test(f))
        .map(f => ({ f, s: readJson<BoneStatus>(join(dir, f)) }))
        .filter((x): x is { f: string; s: BoneStatus } => !!x.s && x.s.v === 1 && typeof x.s.account === 'string' && x.f === `bones-${canonName(x.s.account)}.json`)
        .map(x => x.s);
}

/**
 * The group's statuses: with a `session`, exactly those counted in it. A status in another
 * session (a file another run left) or in none (a giver yet to read this cue, or a file from before
 * sessions) contributes nothing: no trades, no final, no server. A giver publishes as soon as it reads
 * a new cue session (BoneGiver.onCue), and the scored step's `awaitBoneServer` waits on observed ticks
 * for that. Without a `session`, every status of the group (tests and the stand-in only).
 */
function sessionStatuses(statuses: readonly BoneStatus[], group: readonly string[], session?: string): BoneStatus[] {
    const g = new Set(group.map(canonName));
    const mine = statuses.filter(s => g.has(canonName(s.account)));
    return session === undefined ? mine : mine.filter(s => s.session === session);
}

/** The loads the group has given in the session: its givers' trades added up. */
export function groupLoadsDone(statuses: readonly BoneStatus[], group: readonly string[], session?: string): number {
    return sessionStatuses(statuses, group, session).reduce((n, s) => n + (Number.isFinite(s.trades) ? s.trades : 0), 0);
}

/** The group's load count in the session (its givers' `trades` option, published as `loads`), or null when no status there carries one. */
export function groupLoads(statuses: readonly BoneStatus[], group: readonly string[], session?: string): number | null {
    return sessionStatuses(statuses, group, session).map(s => s.loads).find((l): l is number => typeof l === 'number' && Number.isFinite(l)) ?? null;
}

/** The group's giver of the cue's `lastLoad` has served it in the session (BoneStatus.lastGiven). */
export function lastLoadGiven(statuses: readonly BoneStatus[], group: readonly string[], session?: string): boolean {
    return sessionStatuses(statuses, group, session).some(s => s.lastGiven === true);
}

/**
 * The group's server: the one giver of `group` that keeps a request standing with the scored
 * account and that the scored side trades next (altar-cue.ts turnOrder). The giver already
 * requesting or trading keeps it; else the loaded giver that has waited at the site longest. Both
 * sides read it from the same status files, so a group giver requests only while it is the
 * server, and the scored step's trade click names it.
 *
 * The last load (the group's `loads`) belongs to the giver marked `final`, which carries the
 * extras: no other giver serves it, and the final giver serves no load within one rotation of it
 * (fewer than group-size loads before the last), so it is back from its last bank trip and waiting
 * when the last load comes. Once the group has given its loads there is no server.
 *
 * `lastLoad`, the session cue's (Cue.lastLoad; each side passes what it knows of the cue): the next
 * load is the last, whatever the count. Only the `final` giver serves it, with no one-rotation bar,
 * and once it has (`lastGiven`) there is no server. Ignored without a `final` giver in the session.
 */
export function boneServer(statuses: readonly BoneStatus[], group: readonly string[], now: number, session?: string, lastLoad = false): string | undefined {
    const current = sessionStatuses(statuses, group, session);
    const done = current.reduce((n, s) => n + s.trades, 0);
    // A status without `loads` or `final` (written before they existed, or a fixture) sets neither.
    const loads = groupLoads(statuses, group, session);
    if (loads !== null && done >= loads) return undefined;
    const flagged = lastLoad && current.some(s => s.final === true);
    if (flagged && current.some(s => s.lastGiven === true)) return undefined;
    const last = loads !== null && done === loads - 1;
    const withFinal = loads !== null && current.some(s => s.final === true);
    const takes = (s: BoneStatus) => (flagged ? s.final === true : !withFinal || (s.final === true ? last || done + group.length <= loads! - 1 : !last));
    return turnOrder(current, now, {
        eligible: s => (s.phase === 'waiting' || s.phase === 'requested' || s.phase === 'trading') && s.held > 0 && s.readyAt !== null && takes(s),
        holding: s => s.phase === 'requested' || s.phase === 'trading'
    })[0]?.account;
}

/** Observed ticks the scored side waits for the group's server before it refuses the load (about two restock round trips). */
export const SERVER_WAIT_TICKS = 400;

export interface ServerWait {
    /** The group's server, or undefined when none served within the bound. */
    server: string | undefined;
    /** Observed ticks waited for it: 0 when one was serving at the call. */
    waited: number;
}

/**
 * The scored side's half of the turn rule, before each load's receiveFrom: the group's server
 * (boneServer, read from the same status files the givers read), waiting on observed ticks while
 * none serves, for at most `maxTicks`. The S07 step (woodcutting.ts `bones.group`) and the
 * stand-in (bone-receiver `givers`) both take their partner from here. With `session` (the S07 cue's,
 * which the givers record in their statuses) only that session's statuses count, as on the givers' side.
 */
export async function awaitBoneServer(sdk: StateSource, dir: string, group: readonly string[], maxTicks: number = SERVER_WAIT_TICKS, session?: string, lastLoad = false): Promise<ServerWait> {
    const t0 = sdk.getState()?.tick ?? 0;
    let server: string | undefined;
    const r = await waitUntil(sdk, () => (server = boneServer(readBoneStatuses(dir), group, Date.now(), session, lastLoad)) !== undefined, { maxTicks });
    return { server: r.ok ? server : undefined, waited: Math.max(0, r.tick - t0) };
}

export class BoneGiver {
    readonly o: BoneGiverOptions;
    private readonly re: RegExp;
    private cue: Cue | null = null;
    private phase: BonePhase = 'start';
    private detail = '';
    private site = 0;
    private trades = 0;
    /** Served the cue's `lastLoad` in the cue's session (BoneStatus.lastGiven). */
    private lastGiven = false;
    private bounces = 0;
    private lastRequestTick = -1;
    /** Date.now() of the last ask served (altar-cue.ts usableAsk). */
    private lastAskMs = 0;
    /** Date.now() at the first frame showing the current trade open. */
    private openSeenMs = 0;
    /** `once` stacks handed over, by lower-case name. */
    private readonly delivered = new Set<string>();
    /** Side steps in a row that got no nearer (stepToSide tries the next side). */
    private sideMisses = 0;
    /** Loaded at the site since (BoneStatus.readyAt). */
    private readyAt: number | null = null;
    /** The restock round trip under way: from the trade that emptied us, through the bank, back onto the giver tile. */
    private trip: { tick: number; energy: number | null; at: Tile; bank?: { tick: number; energy: number | null; at: Tile } } | null = null;

    private energy(): number | null {
        return this.s?.player?.runEnergy ?? null;
    }

    /** The status a previous process of this account left, read before our first write: a relaunch resumes its trades (onCue). */
    private readonly prior: BoneStatus | null;
    private resumeChecked = false;
    /** restock.labSeed given (once a process). */
    private seeded = false;
    /** Why the giver went off early (BankShortError in a group). */
    private offDetail = '';
    /** sdk/pathfinding.ts isFlagged, loaded by run() in on-request mode; until then no wall is known. */
    private isFlagged: ((x: number, z: number, level: number, mask: number) => boolean) | null = null;
    /** The collision flags on the level we stand on (the scored account's: it is in sight). */
    private readonly flagged: FlagReader = (x, z, mask) => !!this.isFlagged?.(x, z, pos(this.s).level, mask);
    /** acceptReturn: a returned load waits in the pack; bank it on the next cycle even though it is a full load. */
    private mustBank = false;
    /** Date.now() at the role's start: a cue written before it counts only on a resume (onCue). */
    private readonly startedMs = Date.now();
    /** Failed walks in a row onto the named site (by aim key); NAMED_TRAVEL_TRIES of them and the giver stays. */
    private refused = { key: '', n: 0, error: '' };

    constructor(private readonly ctx: RoleContext) {
        this.o = boneGiverOptions(ctx.options);
        this.re = exactAny(this.o.items);
        if (this.o.group.length && !this.o.group.includes(canonName(ctx.account))) throw new Error(`group must include this account (${ctx.account})`);
        this.prior = readJson<BoneStatus>(this.statusPath());
    }

    private statusPath(): string {
        return join(this.o.cueDir, `bones-${canonName(this.ctx.account)}.json`);
    }

    /** The first cue: a relaunch within the same scored session carries on from the trades its last process counted. */
    onCue(cue: Cue): void {
        // cue.json outlives a launch: one written before we started (a previous attempt's final stop, a
        // rehearsal's willow-band cue) is no cue at all, its site, stop and receiver alike, unless it is the
        // session our own last status counted in (a relaunch mid-session). The giver holds until a cue counts.
        if (!(cue.ms >= this.startedMs || (!!this.prior && this.prior.session === cue.session))) {
            this.ctx.log('cue ignored: written before this giver started, in another session', { session: cue.session, seq: cue.seq, stop: !!cue.stop });
            return;
        }
        const fresh = this.cue?.session !== cue.session;
        // `lastGiven` is the session's: another session's last load is not this one's.
        if (fresh) this.lastGiven = false;
        this.cue = cue;
        if (!this.resumeChecked) {
            this.resumeChecked = true;
            const p = this.prior;
            if (p && p.session === cue.session && Number.isInteger(p.trades) && p.trades > this.trades) {
                this.trades = p.trades;
                this.ctx.log('resumed', { trades: p.trades, session: cue.session });
            }
            if (p && p.session === cue.session && p.lastGiven === true) {
                this.lastGiven = true;
                this.ctx.log('resumed: the last load was given', { session: cue.session });
            }
        }
        // The receiver counts only statuses in its cue's session: show ours in it at once, not at the next heartbeat.
        if (fresh) this.publish();
    }

    /**
     * Where the standing mode waits this cycle. 'named': the site the cue names (namedSite), held with
     * no timeout. 'hold': before any cue (one that counts, onCue), or on a stop: the current site, held with
     * no timeout, since there is no receiver to find and the stop stands the giver down. 'rotate': a cue
     * naming none of our sites: the next site after siteWaitTicks without the receiver, as before sites
     * were named. `key` changes exactly when the aim does: a wait on one aim ends when it changes.
     */
    private aim(): { index: number; how: 'named' | 'hold' | 'rotate'; key: string } {
        const cue = this.cue;
        const named = namedSite(this.o.sites, cue);
        const how = named !== null ? 'named' : !cue || cue.stop ? 'hold' : 'rotate';
        const index = named ?? this.site;
        return { index, how, key: `${how}:${index}` };
    }

    /** The group's statuses, ours as of now rather than as last written. */
    private statuses(): BoneStatus[] {
        const me = canonName(this.ctx.account);
        return [...readBoneStatuses(this.o.cueDir).filter(s => canonName(s.account) !== me), this.snapshot()];
    }

    /** Loads given so far: the group's in this cue's session with a group, else ours. Before any cue there is no session to count in: ours. */
    private loadsDone(): number {
        return this.o.group.length && this.cue ? groupLoadsDone(this.statuses(), this.o.group, this.cue.session) : this.trades;
    }

    /** The cue's `lastLoad` was served: the group's in this cue's session with a group, else ours. */
    private lastLoadDone(): boolean {
        return this.o.group.length && this.cue ? lastLoadGiven(this.statuses(), this.o.group, this.cue.session) : this.lastGiven;
    }

    /** No group, or this giver is the group's server now. */
    private ourTurn(): boolean {
        if (!this.o.group.length) return true;
        return canonName(this.server() ?? '') === canonName(this.ctx.account);
    }

    /** The group's server in this cue's session; none before any cue. */
    private server(): string | undefined {
        return this.cue ? boneServer(this.statuses(), this.o.group, Date.now(), this.cue.session, this.cue.lastLoad === true) : undefined;
    }

    private get s(): BotWorldState | null {
        return this.ctx.sdk.getState();
    }

    private held(): number {
        return count(this.s, this.re);
    }

    private setPhase(phase: BonePhase, detail = ''): void {
        if (phase !== this.phase || detail !== this.detail) this.ctx.log('phase', { from: this.phase, to: phase, ...(detail ? { detail } : {}) });
        this.phase = phase;
        this.detail = detail;
        this.readyAt = phase === 'waiting' || phase === 'requested' || phase === 'trading' ? (this.readyAt ?? Date.now()) : null;
        this.publish();
    }

    private snapshot(): BoneStatus {
        return {
            v: 1,
            account: this.ctx.account,
            phase: this.phase,
            held: this.held(),
            n: this.o.n,
            trades: this.trades,
            bounces: this.bounces,
            tile: this.s?.player ? pos(this.s) : null,
            readyAt: this.readyAt,
            session: this.cue?.session ?? null,
            final: this.o.group.length > 0 && this.o.finalExtras.length > 0,
            loads: Number.isFinite(this.o.trades) ? this.o.trades : null,
            ...(this.lastGiven ? { lastGiven: true } : {}),
            ...(this.detail ? { detail: this.detail } : {}),
            ms: Date.now()
        };
    }

    /** bones-<account>.json beside the altar givers' status files, so the scored side can see a load is standing. */
    private publish(): void {
        writeJsonAtomicSync(this.statusPath(), this.snapshot());
    }

    /** On a side tile of the scored account (or trading with it). */
    private besideReceiver(): boolean {
        const s = this.s;
        if (!s) return false;
        if (tradeOf(s).isOpen) return true;
        const r = this.receiverInSight();
        return !!r && onOpenSide(pos(s), r, this.flagged);
    }

    private receiverInSight(): NearbyPlayer | undefined {
        const hash = this.cue?.receiver.sha256;
        return hash ? this.s?.nearbyPlayers.find(p => nameHash(p.name) === hash) : undefined;
    }

    async run(): Promise<void> {
        const { ctx } = this;
        assertUntracked(this.o.cueDir);
        const watcher = new CueWatcher(this.o.cueDir, this.o.scope, cue => this.onCue(cue), { log: (m, d) => ctx.log(m, d) });
        const heartbeat = setInterval(() => this.publish(), 2000);
        let wasOpen = false;
        const unsubOpen = ctx.sdk.onStateUpdate(st => {
            const open = tradeOf(st).isOpen;
            if (open && !wasOpen) this.openSeenMs = Date.now();
            wasOpen = open;
        });
        try {
            // The side tile's wall rule reads the SDK's collision map. The launch already loaded and
            // warmed it (role.ts, sdk/runner.ts); imported here so the module alone does not load it.
            if (this.o.mode === 'on-request') this.isFlagged = (await import('../../sdk/pathfinding')).isFlagged;
            await ensureOutOfTutorial(ctx);
            await ctx.bot.dismissBlockingUI();
            if (ctx.sdk.getTradeState().isOpen) await ctx.sdk.sendDeclineTrade();
            while (!ctx.signal.aborted && this.loadsDone() < this.o.trades && !this.lastLoadDone() && !this.cue?.stop) {
                try {
                    await this.cycle();
                } catch (e) {
                    if (ctx.signal.aborted) break;
                    // In a group the others cover a giver whose bank can't make its load: it leaves, saying why.
                    if (e instanceof BankShortError && this.o.group.length) {
                        this.offDetail = e.message;
                        ctx.log('bank short: leaving the group', { detail: e.message, trades: this.trades });
                        break;
                    }
                    this.setPhase('fault', String(e).slice(0, 200));
                    await ctx.sdk.waitForTicks(10).catch(() => {});
                }
            }
            if (this.o.acceptReturn && !ctx.signal.aborted) await this.bankAll().catch(e => ctx.log('final bank failed', { error: String(e).slice(0, 200) }));
        } finally {
            unsubOpen();
            watcher.close();
            clearInterval(heartbeat);
            this.setPhase('off', this.offDetail);
        }
        ctx.log('bone-giver: finished', { trades: this.trades, bounces: this.bounces });
    }

    /** One load: restock, get beside the receiver, keep a request standing, give. Restartable from any position. */
    private async cycle(): Promise<void> {
        if (this.o.mode === 'on-request') return this.onRequestCycle();
        const { ctx, o } = this;
        // A group's last-load giver carries a whole load and the extras on every trip: any of them can be the last load.
        const carriesFinal = o.group.length > 0 && o.finalExtras.length > 0;
        const k = this.loadsDone();
        const flagged = this.cue?.lastLoad === true;
        const extras = carriesFinal || isFinalLoad(o, k, flagged) ? o.finalExtras : [];
        const bones = o.group.length ? o.n : loadBones(o, k, flagged);
        // An extras-only load (a lone giver on the cue's lastLoad) offers no bones: whatever it holds is no reason to bank.
        const bonesOk = this.held() === bones || (bones === 0 && flagged);
        if (this.mustBank || !bonesOk || extras.some(e => count(this.s, exact(e.item)) < e.count)) {
            this.mustBank = false;
            this.setPhase('restock', carriesFinal ? 'with the last load\'s extras' : extras.length ? 'the last load' : '');
            await this.restock(bones, extras);
        }
        if (this.cue?.stop) return;
        // The cue's site, set every cycle before the travel check: a restock comes back to SCORED's site, not the rotation's next.
        const aim = this.aim();
        this.site = aim.index;
        const moved = () => this.aim().key !== aim.key;
        const site = o.sites[this.site]!;
        const p = pos(this.s);
        // Already on the tile (a request that came to nothing, a turn waited out): keep our place in the group's order.
        if (p.x !== site.giver.x || p.z !== site.giver.z) {
            if (aim.how === 'named' && this.refused.key === aim.key && this.refused.n >= NAMED_TRAVEL_TRIES) {
                // Never rotate away from the site SCORED is at: stay, faulted (the phase gate refuses it), until the cue names another site or stops.
                this.setPhase('fault', `site ${this.site} refused ${this.refused.n} walks: ${this.refused.error}`);
                await until(ctx, () => moved() || !!this.cue?.stop || ctx.signal.aborted, Number.POSITIVE_INFINITY);
                return;
            }
            this.setPhase('travel', `site ${this.site}`);
            try {
                await this.travel(site);
            } catch (e) {
                const error = String(e).slice(0, 200);
                if (aim.how === 'named') {
                    this.refused = { key: aim.key, n: this.refused.key === aim.key ? this.refused.n + 1 : 1, error };
                    ctx.log('travel fault: named site', { site: this.site, tries: this.refused.n, of: NAMED_TRAVEL_TRIES, error });
                    throw e;
                }
                // A site we cannot reach or stand on must not hold us: the next cycle tries the next site
                // (attempt 2: an unstandable willow tile kept b01-b04 retrying it while SCORED waited at the oaks).
                const from = this.site;
                if (!ctx.signal.aborted) this.site = (this.site + 1) % o.sites.length;
                ctx.log('travel fault: next site', { from, to: this.site, error });
                throw e;
            }
            // The cue named another site on the way: go there, never publishing 'waiting' on this one.
            if (moved()) return;
        }
        this.refused = { key: '', n: 0, error: '' };
        if (this.trip) this.logTrip();
        this.setPhase('waiting', `site ${this.site}`);
        // Only the rotation gives up on a site; a named or held one waits for the receiver, the stop, or a new aim.
        const found = await until(ctx, () => !!this.receiverInSight() || !!this.cue?.stop || moved() || ctx.signal.aborted, aim.how === 'rotate' ? o.siteWaitTicks : Number.POSITIVE_INFINITY);
        if (!found && aim.how === 'rotate') {
            this.site = (this.site + 1) % o.sites.length;
            this.setPhase('travel', `site ${this.site}`);
            return;
        }
        if (!found || this.cue?.stop || moved()) return;
        // A group takes turns: wait loaded, without requesting, until we are its server.
        while (!this.ourTurn()) {
            if (this.cue?.stop || ctx.signal.aborted || !this.receiverInSight() || this.loadsDone() >= o.trades || this.lastLoadDone() || moved()) return;
            const server = this.server();
            this.setPhase('waiting', server ? `queued behind ${server}` : carriesFinal ? 'holding the last load' : 'queued');
            await until(ctx, () => this.ourTurn() || !!this.cue?.stop, 2);
        }
        this.setPhase('requested');
        // Two group givers can both start requesting on one frame: the order keeps the one ready longest, and the other stands down.
        const req = await requestUntilOpen(ctx, o, { receiver: () => this.receiverInSight(), stopped: () => !!this.cue?.stop || !this.ourTurn() || moved(), log: ctx.log });
        this.bounces += req.bounces;
        if (!req.ok) {
            ctx.log('request', { ...req });
            return;
        }
        const t = tradeOf(this.s!);
        if (!t.partner || !partnerIs(this.s, this.cue?.receiver.sha256)) {
            ctx.log('request: someone else opened a trade; declining');
            await ctx.sdk.sendDeclineTrade();
            return;
        }
        this.setPhase('trading');
        // No expectTheirs: the scored account offers nothing, and anything it does offer is declined.
        // The load's index now, the group's with a group: the last one offers finalN bones and the extras,
        // or, on the cue's lastLoad, the extras alone. Read once: a flag landing mid-trade makes the next load the last.
        const load = this.loadsDone();
        const lastLoad = this.cue?.lastLoad === true;
        const final = isFinalLoad(o, load, lastLoad);
        const r = await give(ctx.sdk, t.partner, loadOffer(o, load, name => count(this.s, exact(name)), lastLoad), { openMaxTicks: 17 });
        if (r.ok) {
            this.trades++;
            if (lastLoad && final) this.lastGiven = true;
            this.trip = { tick: this.s?.tick ?? 0, energy: this.energy(), at: pos(this.s) };
        }
        if (r.ok && o.acceptReturn) await this.takeReturn(t.partner, r.gave);
        ctx.log('trade', { ok: r.ok, ticks: r.ticks, load, gave: r.gave.map(i => `${i.name} x${i.count}`), final, ...(lastLoad ? { lastLoad: true } : {}), waited: req.waited, sends: req.sends, bounces: req.bounces, ...(r.reason ? { reason: r.reason } : {}) });
    }

    /** Onto `site`'s giver tile; throws when the walk cannot stand there (altar-room.ts standOn). */
    private async travel(site: Site): Promise<void> {
        const { ctx } = this;
        if (process.env.HELPER_LAB_TELE === '1' && chebyshev(pos(this.s), site.giver) > 150) await labTele(ctx, site.giver);
        await walkNear(ctx, site.giver.x, site.giver.z, 2);
        await standOn(ctx, site.giver);
    }

    /** S18: stay on a side tile of the scored account, answer its request at once, give what its ask names. */
    private async onRequestCycle(): Promise<void> {
        const { ctx, o } = this;
        const carry = carryDue(o.carry, this.delivered);
        if (this.held() < o.refillBelow || carry.some(c => count(this.s, exact(c.item)) < c.count)) {
            this.setPhase('restock');
            await this.restock(o.hold, carry);
        }
        let receiver = this.receiverInSight();
        if (!receiver) {
            const site = o.sites[0]!;
            this.setPhase('travel', 'to the scored account');
            if (process.env.HELPER_LAB_TELE === '1' && chebyshev(pos(this.s), site.giver) > 150) await labTele(ctx, site.giver);
            await walkNear(ctx, site.giver.x, site.giver.z, 2);
            if (!(await until(ctx, () => !!this.receiverInSight() || !!this.cue?.stop, o.siteWaitTicks))) return;
            receiver = this.receiverInSight();
            if (!receiver) return;
        }
        if (!onOpenSide(pos(this.s), receiver, this.flagged)) {
            this.setPhase('travel', 'to a side tile');
            await this.stepToSide(receiver);
            return; // re-read where the scored account is now
        }
        if (o.standing) {
            // Our request stands (lib/trade.ts's one click rule: a busy refusal re-sent on the next
            // frame, a landed one only after resendTicks), so the scored account's own top-up click
            // opens both screens. Off its side we drop it and re-step.
            this.setPhase('requested', 'standing');
            const req = await requestUntilOpen(ctx, o, {
                receiver: () => this.receiverInSight(),
                stopped: () => !!this.cue?.stop || !this.besideReceiver(),
                log: ctx.log
            });
            this.bounces += req.bounces;
            if (!req.ok) {
                ctx.log('request', { ...req, standing: true });
                return;
            }
            return this.serveAsk(true, this.s!.tick);
        }
        this.setPhase('waiting', 'for a request');
        const answered = await this.answerRequest();
        if (answered === null) return;
        // Our click on the player who requested us is the acceptance (lib/trade.ts openTrade's rule).
        const name = this.receiverInSight()?.name;
        const opened = !!name && (tradeOf(this.s!).isOpen || (await openTrade(ctx.sdk, name, { maxTicks: 5, goneTicks: 2, timeoutMs: Infinity, noReplyTicks: this.o.noReplyTicks, stopped: () => !!this.cue?.stop || ctx.signal.aborted })).ok);
        await this.serveAsk(opened, answered);
    }

    /** The open trade with the scored account: wait for its ask, offer what it names, and decline without one. */
    private async serveAsk(opened: boolean, answered: number): Promise<void> {
        const { ctx, o } = this;
        const t = tradeOf(this.s!);
        if (!opened || !t.partner || !partnerIs(this.s, this.cue?.receiver.sha256)) {
            ctx.log('request: no trade with the scored account opened', { opened });
            if (opened) await ctx.sdk.sendDeclineTrade();
            return;
        }
        const openTick = this.s!.tick;
        const ask = await this.waitForAsk();
        const offer = ask ? askOffer(ask, this.s!.inventory) : null;
        if (!ask || !offer!.specs.length) {
            ctx.log('request: no usable ask; declining', { ask: ask?.items ?? null, waited: this.s!.tick - openTick });
            await ctx.sdk.sendDeclineTrade();
            return;
        }
        this.lastAskMs = ask.ms;
        if (offer!.short.length) ctx.log('ask: short', { short: offer!.short });
        this.setPhase('trading', ask.items.map(a => `${a.item} ${a.count}`).join(', '));
        const askTick = this.s!.tick;
        const r = await give(ctx.sdk, t.partner, offer!.specs, { openMaxTicks: 17 });
        if (r.ok) {
            this.trades++;
            for (const c of o.carry) if (c.once && r.gave.some(g => exact(c.item).test(g.name))) this.delivered.add(c.item.toLowerCase());
        }
        ctx.log('trade', { ok: r.ok, ticks: r.ticks, asked: ask.items, gave: r.gave.map(i => `${i.name} x${i.count}`), answerToOpen: openTick - answered, openToAsk: askTick - openTick, ...(r.reason ? { reason: r.reason } : {}) });
    }

    /** The ask for the trade open now (altar-cue.ts awaitAsk: an unscoped ask), waiting up to `askWaitTicks` observed ticks; null if none came or the trade closed. */
    private waitForAsk(): Promise<TopUpAsk | null> {
        const { ctx, o } = this;
        return awaitAsk(ctx.sdk, { dir: o.cueDir, openMs: this.openSeenMs, lastServedMs: this.lastAskMs, maxTicks: o.askWaitTicks, signal: ctx.signal });
    }

    /**
     * One bounded step toward a free side tile of the scored account. The walk's action result is
     * not awaited: among the wandering knights it can take a minute to come back (lab, 300 ms: the
     * courier stood 180-350 ticks in one standOn while the account moved on, and about half the due
     * top-ups found it 5-15 tiles off). Instead it waits at most SIDE_STEP_TICKS observed ticks, or
     * until it is on a side or the account has moved, and the caller re-reads. A side the walk did
     * not get nearer to (a wall, a fence) yields to the next one on the following step. A side across
     * a wall edge from the account is never chosen (sideTiles).
     */
    private async stepToSide(receiver: Tile): Promise<void> {
        const { ctx } = this;
        const sides = sideTiles(receiver, pos(this.s), npcTiles(this.s), this.flagged);
        if (!sides.length) throw new Error(`no free side tile beside the scored account at ${receiver.x},${receiver.z}`);
        const side = sides[this.sideMisses % sides.length]!;
        const from = pos(this.s);
        const dist = (t: Tile) => Math.abs(t.x - side.x) + Math.abs(t.z - side.z);
        void ctx.sdk.sendWalk(side.x, side.z).catch(() => {});
        const hash = this.cue?.receiver.sha256;
        await until(ctx, st => {
            const r = st.nearbyPlayers.find(p => nameHash(p.name) === hash);
            return !r || r.x !== receiver.x || r.z !== receiver.z || onOpenSide(pos(st), r, this.flagged);
        }, SIDE_STEP_TICKS);
        this.sideMisses = dist(pos(this.s)) < dist(from) || onOpenSide(pos(this.s), receiver, this.flagged) ? 0 : this.sideMisses + 1;
    }

    /** Wait for the scored account's request. Resolves with the tick of the frame that carries it (or shows the trade open), or null when it moved off or the cue stopped. */
    private answerRequest(): Promise<number | null> {
        const { ctx } = this;
        return new Promise(resolve => {
            const finish = (v: number | null) => {
                unsub();
                clearInterval(guard);
                resolve(v);
            };
            const onFrame = (st: BotWorldState) => {
                const hash = this.cue?.receiver.sha256;
                if (this.cue?.stop || !hash) return finish(null);
                if (tradeOf(st).isOpen) return finish(st.tick);
                // Off its side (it moved, or we were pushed): re-step before the next request.
                const receiver = st.nearbyPlayers.find(p => nameHash(p.name) === hash);
                if (!receiver || !onOpenSide(pos(st), receiver, this.flagged)) return finish(null);
                const at = newRequestFrom(st, hash, this.lastRequestTick);
                if (at === null) return;
                this.lastRequestTick = at;
                finish(st.tick);
            };
            const unsub = ctx.sdk.onStateUpdate(onFrame);
            const guard = setInterval(() => ctx.signal.aborted && finish(null), 500);
            // Requests already answered or from before we started are not ours to answer.
            if (this.lastRequestTick < 0) this.lastRequestTick = this.s?.tick ?? -1;
        });
    }

    /**
     * One restock round trip, logged on arriving back on the giver tile: ticks to the bank and back
     * (the bank visit inside the second leg), run energy at the trade, the bank and the tile, and
     * whether each leg ran (legRan, by pace: energy is no evidence on the demo, which keeps it full).
     */
    private logTrip(): void {
        const t = this.trip!;
        this.trip = null;
        const now = { tick: this.s?.tick ?? 0, energy: this.energy(), at: pos(this.s) };
        const bank = t.bank ?? null;
        this.ctx.log('trip', {
            roundTrip: now.tick - t.tick,
            toBank: bank ? bank.tick - t.tick : null,
            backWithBank: bank ? now.tick - bank.tick : null,
            energy: { start: t.energy, bank: bank?.energy ?? null, end: now.energy },
            ranToBank: bank ? legRan(t.at, bank.at, bank.tick - t.tick) : null,
            ranBack: bank ? legRan(bank.at, now.at, now.tick - bank.tick) : null,
            runToggle: runIsOn(this.s)
        });
    }

    /** Rehearsal: the load just given comes straight back (bone-receiver.ts returnLoads); the next restock banks it. */
    private async takeReturn(partner: string, gave: readonly { name: string; count: number }[]): Promise<void> {
        const want = returnWants(gave);
        // Still 'trading', so it keeps the turn: the next giver must not request while the stand-in is in
        // this trade. Such a request got no busy refusal in the lab, so that giver took it as standing and
        // waited out resendTicks (35 ticks per load) before the stand-in's click could open.
        this.setPhase('trading', 'taking the load back');
        const r = await receiveFrom(this.ctx.sdk, partner, { want: want.map(w => ({ item: exact(w.name), amount: w.count })), openTimeoutMs: 60_000 });
        this.ctx.log('return', { ok: r.ok, ticks: r.ticks, received: r.received.map(i => `${i.name} x${i.count}`), ...(r.reason ? { reason: r.reason } : {}) });
        // The returned load is banked at the next restock and the next one withdrawn: the run's round trip, dragon first.
        this.mustBank = true;
    }

    /** Rehearsal end: bank everything held, so the bank is back to its staged count; log what it holds. */
    private async bankAll(): Promise<void> {
        const { ctx, o } = this;
        const bank = o.restock.bank;
        this.setPhase('restock', 'banking everything at the end');
        await walkNear(ctx, bank.x, bank.z, 3);
        if (!(await openBank(ctx))) throw new Error('could not open the bank');
        await depositAllExcept(ctx.sdk);
        const items = ctx.sdk.getBankItems();
        const keep = [...o.items, ...o.finalExtras.map(e => e.item)];
        ctx.log('final bank', { bank: keep.map(name => `${items.filter(i => exact(name).test(i.name)).reduce((a, i) => a + i.count, 0)} ${name}`), carried: this.s?.inventory.length ?? 0 });
        await closeBank(ctx);
    }

    /** Carry exactly `n` of the item and `extras`, and nothing else. */
    private async restock(n: number, extras: readonly Extra[] = []): Promise<void> {
        const { ctx, o } = this;
        const extraRes = extras.map(e => ({ ...e, re: exact(e.item) }));
        const extrasHeld = () => extraRes.every(e => count(this.s, e.re) >= e.count);
        if (o.restock.kind === 'cheat') {
            if (!isLocalServer()) throw new Error('restock kind cheat is for the local lab only');
            // Carry nothing else: a fresh lab account's starter kit leaves fewer free slots than a load needs.
            if ((this.s?.inventory ?? []).some(i => !this.re.test(i.name) && !extraRes.some(e => e.re.test(i.name)))) {
                await cheat(ctx, '~clearinv inv');
                await until(ctx, st => st.inventory.length === 0, 10);
            }
            const missing = n - this.held();
            if (missing > 0) await cheat(ctx, `give ${o.obj} ${missing}`);
            for (const e of extraRes) {
                const short = e.count - count(this.s, e.re);
                if (short > 0) await cheat(ctx, `give ${e.obj} ${short}`);
            }
            if (!(await until(ctx, () => this.held() >= n && extrasHeld(), 10))) throw new Error('staff give did not arrive');
            return;
        }
        const bank = o.restock.bank;
        this.setPhase('restock', `to the bank at ${bank.x},${bank.z}`);
        if (process.env.HELPER_LAB_TELE === '1' && chebyshev(pos(this.s), bank) > 150) await labTele(ctx, bank);
        await walkNear(ctx, bank.x, bank.z, 3);
        if (this.trip && !this.trip.bank) this.trip.bank = { tick: this.s?.tick ?? 0, energy: this.energy(), at: pos(this.s) };
        if (o.restock.labSeed && isLocalServer() && !this.seeded) {
            this.seeded = true;
            const before = this.s?.inventory.length ?? 0;
            for (const g of o.restock.labSeed) await cheat(ctx, `give ${g.obj} ${g.n}`);
            await until(ctx, st => st.inventory.length >= before + o.restock.labSeed!.length, 10);
            ctx.log('lab: seeded the bank', { seed: o.restock.labSeed });
        }
        if (!(await openBank(ctx))) throw new Error('could not open the bank');
        await depositAllExcept(ctx.sdk);
        const bankItems = ctx.sdk.getBankItems();
        const bones = boneWithdrawals(bankItems, o.items, n);
        const extrasShort = extraRes.filter(e => bankItems.filter(i => e.re.test(i.name)).reduce((a, i) => a + i.count, 0) < e.count);
        if (bones.short > 0 || extrasShort.length) {
            await closeBank(ctx);
            throw new BankShortError(`the bank is short: ${bones.short > 0 ? `${bones.short} of a load of ${n} ${o.items.join(' or ')}` : ''}${bones.short > 0 && extrasShort.length ? '; ' : ''}${extrasShort.map(e => `${e.count} ${e.item}`).join(', ')}`);
        }
        const w = await withdrawMany(ctx.sdk, [...bones.specs, ...extraRes.map(e => ({ item: e.re, n: e.count }))]);
        await closeBank(ctx);
        if (!w.ok || this.held() !== n || !extrasHeld()) {
            throw new Error(`bank withdraw left ${this.held()} of ${n}${extraRes.map(e => `, ${count(this.s, e.re)} of ${e.count} ${e.item}`).join('')} (${w.reason ?? 'short'})`);
        }
        if (o.items.length > 1) ctx.log('restock', { bones: o.items.map(i => `${count(this.s, exact(i))} ${i}`) });
    }
}

export const role: Role = {
    name: 'bone-giver',
    produces: [],
    async run(ctx: RoleContext) {
        await new BoneGiver(ctx).run();
    }
};

if (import.meta.main) await runStandalone(role);
