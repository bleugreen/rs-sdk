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
//   item         item to give (default 'Dragon bones'; S18 'Babydragon bones', the dragon-first rule)
//   obj          its staff-give name for restock cheat (default the item name in snake case)
//   n            per trade (default 23: the knife loop's free slots)
//   group        standing mode only: the accounts taking turns at the site, this one included
//                (S07's b01-b04). Only the group's server keeps a request standing (boneServer,
//                altar-cue.ts turnOrder); the rest wait loaded on the tile without requesting
//   sites        [{ giver: {x,z}, receiver: {x,z} }] in run order (default: the oak tile, then the Taverley willow)
//   siteWaitTicks  how long to wait at a site for the receiver before trying the next (default 30)
//   trades       stop after this many trades (default: until the cue says stop)
//   restock      { kind: 'bank'|'cheat', bank?: {x,z} } (cheat: local lab only; bank default Falador west)
//   noReplyTicks re-send when neither answer came back (default lib/trade.ts DROPPED_TICKS, 2 frames after the click's result: the giver stands beside the receiver)
//   resendTicks  re-send a standing request after this long without a trade (default 100)
//   finalExtras  [{ item, count, obj? }] offered beside the bones on the LAST load only (needs `trades`;
//                S07's T07-08 Camelot runes, law 1 and air 5); `obj` names the staff give for restock cheat
//   finalN       bones on that last load (default n - finalExtras.length: the same free slots as every load)
//   cueDir       default RC_CUE_DIR, else run-machine/rc-cue in the checkout
//   scope        required: { step, family }, the cue this giver serves (altar-cue.ts CueScope):
//                family 'bone' in the standing mode (S07), 'courier' in on-request (S18)
//
// mode 'on-request' (S18's stun-pack courier, SUPPLIES.md H14.1-H14.13): the scored
// account requests at a stun offset of its choosing (the Thieving module's top-up),
// and once the trade is open it writes what it wants (the top-up ask, altar-cue.ts:
// bones to fill its free slots, food back to 2, an arrowtip tier once) to the cue
// directory. The courier can't size a load itself: it can't see the scored account's
// inventory. It holds a side tile of the scored account (orthogonally adjacent, never
// an NPC's tile, re-stepped whenever it moves), answers the request on the frame that
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
import { give, DROPPED_TICKS, openTrade, tradeOf, type GiveSpec } from '../lib/trade';
import { waitUntil } from '../lib/wait';
import { existsSync, readdirSync } from 'node:fs';
import { runIsOn } from '../lib/run-mode';
import { assertUntracked, canonName, CueWatcher, cueDir, nameHash, newRequestFrom, readJson, readTopUpAsk, scopeOption, turnOrder, usableAsk, writeJsonAtomicSync, type Cue, type CueScope, type TopUpAsk } from './altar-cue';
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
    { receiver: { x: 2920, z: 3406 }, giver: { x: 2920, z: 3407 } } // Taverley willows
];

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
    item: string;
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
    restock: { kind: 'bank' | 'cheat'; bank: Tile };
    noReplyTicks: number;
    resendTicks: number;
    finalExtras: Extra[];
    /** Bones on the last load, the one that carries finalExtras. */
    finalN: number;
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
    const item = String(raw.item ?? 'Dragon bones');
    if (raw.group !== undefined && (!Array.isArray(raw.group) || raw.group.length < 2 || raw.group.some(g => typeof g !== 'string' || !g.trim()))) throw new Error('group must list at least two account names, this one included');
    const group = ((raw.group ?? []) as string[]).map(canonName);
    if (group.length && mode !== 'standing') throw new Error('group is for the standing mode (S07) only');
    if (new Set(group).size !== group.length) throw new Error('group names an account twice');
    return {
        mode,
        item,
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
        restock: { kind, bank: r.bank ? tile(r.bank, 'restock.bank') : DEFAULT_BONE_BANK },
        noReplyTicks: Number(raw.noReplyTicks ?? DROPPED_TICKS),
        resendTicks: Number(raw.resendTicks ?? 100),
        finalExtras,
        finalN: finalExtras.length ? finalN : n,
        cueDir: typeof raw.cueDir === 'string' ? raw.cueDir : cueDir(env),
        scope: scopeOption(raw.scope, [mode === 'standing' ? 'bone' : 'courier'])
    };
}

const exact = (name: string) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');

/** True when the load after `tradesDone` completed trades is the last one, the one that carries `finalExtras`. */
export function isFinalLoad(o: Pick<BoneGiverOptions, 'trades' | 'finalExtras'>, tradesDone: number): boolean {
    return o.finalExtras.length > 0 && tradesDone === o.trades - 1;
}

/** Bones on the load after `tradesDone` trades: `finalN` on the last load, else `n`. */
export function loadBones(o: Pick<BoneGiverOptions, 'n' | 'finalN' | 'trades' | 'finalExtras'>, tradesDone: number): number {
    return isFinalLoad(o, tradesDone) ? o.finalN : o.n;
}

/** The standing mode's offer for the load after `tradesDone` trades: `n` bones, or `finalN` bones and `finalExtras` on the last load. */
export function loadOffer(o: Pick<BoneGiverOptions, 'item' | 'n' | 'finalN' | 'trades' | 'finalExtras'>, tradesDone: number): GiveSpec[] {
    const extras = isFinalLoad(o, tradesDone) ? o.finalExtras : [];
    return [{ item: exact(o.item), n: loadBones(o, tradesDone) }, ...extras.map(e => ({ item: exact(e.item), n: e.count }))];
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
 * The side tiles of `receiver` the giver may hold, nearest to `me` first: orthogonally
 * adjacent, never a tile an NPC stands on (the knight the scored account pickpockets).
 */
export function sideTiles(receiver: Tile, me: Tile, npcs: readonly Tile[]): Tile[] {
    const dist = (a: Tile) => Math.abs(a.x - me.x) + Math.abs(a.z - me.z);
    return SIDES.map(([dx, dz]) => ({ x: receiver.x + dx, z: receiver.z + dz }))
        .filter(t => !npcs.some(n => n.x === t.x && n.z === t.z))
        .sort((a, b) => dist(a) - dist(b));
}

// ------------------------------------------------------------------ role

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
    detail?: string;
    ms: number;
}

export function readBoneStatuses(dir: string): BoneStatus[] {
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
        .filter(f => /^bones-.+\.json$/.test(f))
        .map(f => readJson<BoneStatus>(join(dir, f)))
        .filter((s): s is BoneStatus => !!s && s.v === 1 && typeof s.account === 'string');
}

/**
 * The group's server: the one giver of `group` that keeps a request standing with the scored
 * account and that the scored side trades next (altar-cue.ts turnOrder). The giver already
 * requesting or trading keeps it; else the loaded giver that has waited at the site longest. Both
 * sides read it from the same status files, so a group giver requests only while it is the
 * server, and the scored step's trade click names it.
 */
export function boneServer(statuses: readonly BoneStatus[], group: readonly string[], now: number): string | undefined {
    const g = new Set(group.map(canonName));
    return turnOrder(
        statuses.filter(s => g.has(canonName(s.account))),
        now,
        {
            eligible: s => (s.phase === 'waiting' || s.phase === 'requested' || s.phase === 'trading') && s.held > 0 && s.readyAt !== null,
            holding: s => s.phase === 'requested' || s.phase === 'trading'
        }
    )[0]?.account;
}

export class BoneGiver {
    readonly o: BoneGiverOptions;
    private readonly re: RegExp;
    private cue: Cue | null = null;
    private phase: BonePhase = 'start';
    private detail = '';
    private site = 0;
    private trades = 0;
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
    private trip: { tick: number; energy: number | null; bank?: { tick: number; energy: number | null } } | null = null;

    private energy(): number | null {
        return this.s?.player?.runEnergy ?? null;
    }

    constructor(private readonly ctx: RoleContext) {
        this.o = boneGiverOptions(ctx.options);
        this.re = exact(this.o.item);
        if (this.o.group.length && !this.o.group.includes(canonName(ctx.account))) throw new Error(`group must include this account (${ctx.account})`);
    }

    /** No group, or this giver is the group's server now. */
    private ourTurn(): boolean {
        if (!this.o.group.length) return true;
        return canonName(boneServer(readBoneStatuses(this.o.cueDir), this.o.group, Date.now()) ?? '') === canonName(this.ctx.account);
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

    /** bones-<account>.json beside the altar givers' status files, so the scored side can see a load is standing. */
    private publish(): void {
        writeJsonAtomicSync(join(this.o.cueDir, `bones-${canonName(this.ctx.account)}.json`), {
            v: 1,
            account: this.ctx.account,
            phase: this.phase,
            held: this.held(),
            n: this.o.n,
            trades: this.trades,
            bounces: this.bounces,
            tile: this.s?.player ? pos(this.s) : null,
            readyAt: this.readyAt,
            ...(this.detail ? { detail: this.detail } : {}),
            ms: Date.now()
        } satisfies BoneStatus);
    }

    /** On a side tile of the scored account (or trading with it). */
    private besideReceiver(): boolean {
        const s = this.s;
        if (!s) return false;
        if (tradeOf(s).isOpen) return true;
        const r = this.receiverInSight();
        return !!r && onSide(pos(s), r);
    }

    private receiverInSight(): NearbyPlayer | undefined {
        const hash = this.cue?.receiver.sha256;
        return hash ? this.s?.nearbyPlayers.find(p => nameHash(p.name) === hash) : undefined;
    }

    async run(): Promise<void> {
        const { ctx } = this;
        assertUntracked(this.o.cueDir);
        const watcher = new CueWatcher(this.o.cueDir, this.o.scope, cue => (this.cue = cue), { log: (m, d) => ctx.log(m, d) });
        const heartbeat = setInterval(() => this.publish(), 2000);
        let wasOpen = false;
        const unsubOpen = ctx.sdk.onStateUpdate(st => {
            const open = tradeOf(st).isOpen;
            if (open && !wasOpen) this.openSeenMs = Date.now();
            wasOpen = open;
        });
        try {
            await ensureOutOfTutorial(ctx);
            await ctx.bot.dismissBlockingUI();
            if (ctx.sdk.getTradeState().isOpen) await ctx.sdk.sendDeclineTrade();
            while (!ctx.signal.aborted && this.trades < this.o.trades && !this.cue?.stop) {
                try {
                    await this.cycle();
                } catch (e) {
                    if (ctx.signal.aborted) break;
                    this.setPhase('fault', String(e).slice(0, 200));
                    await ctx.sdk.waitForTicks(10).catch(() => {});
                }
            }
        } finally {
            unsubOpen();
            watcher.close();
            clearInterval(heartbeat);
            this.setPhase('off');
        }
        ctx.log('bone-giver: finished', { trades: this.trades, bounces: this.bounces });
    }

    /** One load: restock, get beside the receiver, keep a request standing, give. Restartable from any position. */
    private async cycle(): Promise<void> {
        if (this.o.mode === 'on-request') return this.onRequestCycle();
        const { ctx, o } = this;
        const extras = isFinalLoad(o, this.trades) ? o.finalExtras : [];
        const bones = loadBones(o, this.trades);
        if (this.held() !== bones || extras.some(e => count(this.s, exact(e.item)) < e.count)) {
            this.setPhase('restock', extras.length ? 'the last load' : '');
            await this.restock(bones, extras);
        }
        const site = o.sites[this.site]!;
        const p = pos(this.s);
        // Already on the tile (a request that came to nothing, a turn waited out): keep our place in the group's order.
        if (p.x !== site.giver.x || p.z !== site.giver.z) {
            this.setPhase('travel', `site ${this.site}`);
            if (process.env.HELPER_LAB_TELE === '1' && chebyshev(p, site.giver) > 150) await labTele(ctx, site.giver);
            await walkNear(ctx, site.giver.x, site.giver.z, 2);
            await standOn(ctx, site.giver);
        }
        if (this.trip) this.logTrip();
        this.setPhase('waiting', `site ${this.site}`);
        if (!(await until(ctx, () => !!this.receiverInSight() || !!this.cue?.stop, o.siteWaitTicks))) {
            this.site = (this.site + 1) % o.sites.length;
            this.setPhase('travel', `site ${this.site}`);
            return;
        }
        if (this.cue?.stop) return;
        // A group takes turns: wait loaded, without requesting, until we are its server.
        while (!this.ourTurn()) {
            if (this.cue?.stop || ctx.signal.aborted || !this.receiverInSight()) return;
            const server = boneServer(readBoneStatuses(o.cueDir), o.group, Date.now());
            this.setPhase('waiting', server ? `queued behind ${server}` : 'queued');
            await until(ctx, () => this.ourTurn() || !!this.cue?.stop, 2);
        }
        this.setPhase('requested');
        // Two group givers can both start requesting on one frame: the order keeps the one ready longest, and the other stands down.
        const req = await requestUntilOpen(ctx, o, { receiver: () => this.receiverInSight(), stopped: () => !!this.cue?.stop || !this.ourTurn(), log: ctx.log });
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
        const r = await give(ctx.sdk, t.partner, loadOffer(o, this.trades), { openTimeoutMs: 5_000 });
        if (r.ok) {
            this.trades++;
            this.trip = { tick: this.s?.tick ?? 0, energy: this.energy() };
        }
        ctx.log('trade', { ok: r.ok, ticks: r.ticks, gave: r.gave.map(i => `${i.name} x${i.count}`), final: extras.length > 0, waited: req.waited, sends: req.sends, bounces: req.bounces, ...(r.reason ? { reason: r.reason } : {}) });
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
        if (!onSide(pos(this.s), receiver)) {
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
        const r = await give(ctx.sdk, t.partner, offer!.specs, { openTimeoutMs: 5_000 });
        if (r.ok) {
            this.trades++;
            for (const c of o.carry) if (c.once && r.gave.some(g => exact(c.item).test(g.name))) this.delivered.add(c.item.toLowerCase());
        }
        ctx.log('trade', { ok: r.ok, ticks: r.ticks, asked: ask.items, gave: r.gave.map(i => `${i.name} x${i.count}`), answerToOpen: openTick - answered, openToAsk: askTick - openTick, ...(r.reason ? { reason: r.reason } : {}) });
    }

    /** The ask for the trade open now (altar-cue.ts usableAsk), waiting up to `askWaitTicks` observed ticks; null if none came or the trade closed. */
    private async waitForAsk(): Promise<TopUpAsk | null> {
        const { ctx, o } = this;
        const t0 = this.s!.tick;
        for (;;) {
            const ask = usableAsk(readTopUpAsk(o.cueDir), this.openSeenMs, this.lastAskMs);
            if (ask) return ask;
            const s = this.s;
            if (!s || !tradeOf(s).isOpen || s.tick - t0 > o.askWaitTicks || ctx.signal.aborted) return null;
            await Bun.sleep(15);
        }
    }

    /**
     * One bounded step toward a free side tile of the scored account. The walk's action result is
     * not awaited: among the wandering knights it can take a minute to come back (lab, 300 ms: the
     * courier stood 180-350 ticks in one standOn while the account moved on, and about half the due
     * top-ups found it 5-15 tiles off). Instead it waits at most SIDE_STEP_TICKS observed ticks, or
     * until it is on a side or the account has moved, and the caller re-reads. A side the walk did
     * not get nearer to (a wall, a fence) yields to the next one on the following step.
     */
    private async stepToSide(receiver: Tile): Promise<void> {
        const { ctx } = this;
        const sides = sideTiles(receiver, pos(this.s), npcTiles(this.s));
        if (!sides.length) throw new Error(`no free side tile beside the scored account at ${receiver.x},${receiver.z}`);
        const side = sides[this.sideMisses % sides.length]!;
        const from = pos(this.s);
        const dist = (t: Tile) => Math.abs(t.x - side.x) + Math.abs(t.z - side.z);
        void ctx.sdk.sendWalk(side.x, side.z).catch(() => {});
        const hash = this.cue?.receiver.sha256;
        await until(ctx, st => {
            const r = st.nearbyPlayers.find(p => nameHash(p.name) === hash);
            return !r || r.x !== receiver.x || r.z !== receiver.z || onSide(pos(st), r);
        }, SIDE_STEP_TICKS);
        this.sideMisses = dist(pos(this.s)) < dist(from) || onSide(pos(this.s), receiver) ? 0 : this.sideMisses + 1;
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
                if (!receiver || !onSide(pos(st), receiver)) return finish(null);
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
     * whether each leg ran. A walk click carries the run flag, so a leg runs while energy lasts:
     * energy that fell on a leg means it ran.
     */
    private logTrip(): void {
        const t = this.trip!;
        this.trip = null;
        const now = { tick: this.s?.tick ?? 0, energy: this.energy() };
        const fell = (a: number | null, b: number | null) => (a === null || b === null ? null : b < a);
        const bank = t.bank ?? null;
        this.ctx.log('trip', {
            roundTrip: now.tick - t.tick,
            toBank: bank ? bank.tick - t.tick : null,
            backWithBank: bank ? now.tick - bank.tick : null,
            energy: { start: t.energy, bank: bank?.energy ?? null, end: now.energy },
            ranToBank: bank ? fell(t.energy, bank.energy) : null,
            ranBack: bank ? fell(bank.energy, now.energy) : null,
            runToggle: runIsOn(this.s)
        });
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
        await walkNear(ctx, bank.x, bank.z, 3);
        if (this.trip && !this.trip.bank) this.trip.bank = { tick: this.s?.tick ?? 0, energy: this.energy() };
        if (!(await openBank(ctx))) throw new Error('could not open the bank');
        await depositAllExcept(ctx.sdk);
        const w = await withdrawMany(ctx.sdk, [{ item: this.re, n }, ...extraRes.map(e => ({ item: e.re, n: e.count }))]);
        await closeBank(ctx);
        if (!w.ok || this.held() !== n || !extrasHeld()) {
            throw new Error(`bank withdraw left ${this.held()} of ${n}${extraRes.map(e => `, ${count(this.s, e.re)} of ${e.count} ${e.item}`).join('')} (${w.reason ?? 'short'})`);
        }
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
