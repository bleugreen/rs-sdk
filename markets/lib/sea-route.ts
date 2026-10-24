/**
 * Travel for a markets account from wherever it stands: out through any scripted passage that encloses it (the Gnome
 * Stronghold's gate, the Grand Tree's doors: speedrun/lib/passages.ts), the voyages between the mainland, Karamja and
 * the Ardougne side that speedrun/lib/ships.ts chooses (30 coins a voyage), and the walks on each land mass with
 * toll-gate.ts `travelTo` (out of the underground and across the Al-Kharid toll gate when needed), then in through any
 * passage in front of the destination. A walk the long-path map cannot route falls back to pickpocket.ts's door
 * recovery (`walkThroughDoors`, rs/736). This is the one router: every stage of the phase-2 runner reaches its start
 * through it (docs/markets/phase2.md 'Reaching a stage from anywhere').
 *
 * A route is a list of legs planned from its two ends alone (`routeBetween`), so its fares can be counted before
 * anything moves. `planTrip` adds a stop at this side's fare bank (`FARE_BANKS`) when the pack cannot pay, and refuses
 * the trip when nothing can (`Unreachable`): no fare bank on this side, or a bank last seen holding too little.
 * Running it records every leg's ticks; a voyage's ticks include the walk to its dock, a crossing's the walk to its
 * near side, the fares leg's the walk to its bank.
 *
 * The Karamja leg (`KARAMJA_LEG`) is the crossing between any Karamja tile and Port Sarim through Musa Point: out on
 * the customs officer's ship, in on a Port Sarim sailor's. The Ardougne side reaches the mainland through it after
 * the Brimhaven ship, and an account on Karamja itself (a Shilo mule outside the Shilo gate, rs/685) takes it with
 * nothing else: `regionOf` counts Shilo as Karamja. The Gnome Stronghold counts as the Ardougne side's land mass.
 */
import type { BotActions } from '../../sdk/actions';
import type { BotSDK } from '../../sdk/index';
import type { BotWorldState } from '../../sdk/types';
import { BANKS } from '../../speedrun/helpers/buyer';
import { cross, crossingsBetween, reachesOnGround, type Crossing, type Reaches } from '../../speedrun/lib/passages';
import { disembark, FARE, regionOf, sail, VOYAGES, voyagesBetween, type Region, type Sailor, type Tile, type Voyage } from '../../speedrun/lib/ships';
import { travelTo } from '../../speedrun/lib/toll-gate';
import { waitUntil } from '../../speedrun/lib/wait';
import { liveDoorWalk, walkThroughDoors } from '../methods/pickpocket.ts';

export type { Reaches, Tile };

export type Leg =
    | { kind: 'sail'; name: string; voyage: Voyage }
    | { kind: 'walk'; name: 'walk'; to: Tile; tolerance: number }
    /** Through a scripted passage; named after it. */
    | { kind: 'cross'; name: string; crossing: Crossing }
    /** Take coins from the bank at `bank` until the pack holds `need`. */
    | { kind: 'fares'; name: 'fares'; bank: Tile; need: number };

/** Short names for the four voyages, as the trip records them. */
const LEG_NAMES: Readonly<Record<string, string>> = {
    'Port Sarim to Karamja': 'sarim-musa',
    'Musa Point to Port Sarim': 'musa-sarim',
    'Brimhaven to Ardougne': 'brimhaven-ardougne',
    'Ardougne to Brimhaven': 'ardougne-brimhaven'
};

const sailLeg = (voyage: Voyage): Leg => ({ kind: 'sail', name: LEG_NAMES[voyage.name] ?? voyage.name, voyage });
const voyage = (name: string): Voyage => {
    const v = VOYAGES.find(x => x.name === name);
    if (!v) throw new Error(`ships.ts has no voyage '${name}'`);
    return v;
};

/** The Karamja leg, both ways. `out` walks from wherever the account stands on Karamja to the Musa Point dock first. */
export const KARAMJA_LEG: Readonly<{ out: Leg; in: Leg }> = {
    out: sailLeg(voyage('Musa Point to Port Sarim')),
    in: sailLeg(voyage('Port Sarim to Karamja'))
};

/** Ashore on the Ardougne side from the Brimhaven ship: where a trip to "the Ardougne side" aims. */
export const ARDOUGNE_LANDING: Tile = voyage('Brimhaven to Ardougne').lands;

const legOf = (v: Voyage): Leg => [KARAMJA_LEG.out, KARAMJA_LEG.in].find(l => l.kind === 'sail' && l.voyage === v) ?? sailLeg(v);

/** The passages between `from` and `to` on one land mass; none when a plain walk gets there or no passage helps. */
const crossLegs = (from: Tile, to: Tile, reaches: Reaches): Leg[] => (crossingsBetween(from, to, reaches) ?? []).map(c => ({ kind: 'cross', name: c.passage.name, crossing: c }));

/**
 * The legs from `from` to `to`: before each voyage the passages out to its dock, the voyage, then the passages from
 * the last landing to `to` and the walk to within `tolerance` of it. `reaches` is the long-path map's (tests pass
 * their own).
 */
export function routeBetween(from: Tile, to: Tile, tolerance = 3, reaches: Reaches = reachesOnGround): Leg[] {
    const legs: Leg[] = [];
    let at = from;
    for (const v of voyagesBetween(regionOf(from), regionOf(to))) {
        legs.push(...crossLegs(at, v.dock, reaches), legOf(v));
        at = v.lands;
    }
    legs.push(...crossLegs(at, to, reaches), { kind: 'walk', name: 'walk', to, tolerance });
    return legs;
}

/** Whether a stage starting at `to` needs a trip first: another land mass, or a passage between. */
export function needsTravel(from: Tile, to: Tile, reaches: Reaches = reachesOnGround): boolean {
    return regionOf(from) !== regionOf(to) || (crossingsBetween(from, to, reaches)?.length ?? 0) > 0;
}

/** Coins a route's voyages cost. */
export const faresOf = (legs: readonly Leg[]): number => legs.filter(l => l.kind === 'sail').length * FARE;

/**
 * Where a trip short of fares takes them, on each side it can start from: the Ardougne south bank (where the iron
 * method banks) and Draynor beside Port Sarim. Karamja has none on any route of ours.
 */
export const FARE_BANKS: Readonly<Partial<Record<Region, Tile>>> = { kandarin: BANKS.ardougneSouth, mainland: BANKS.draynor };

/** A trip that cannot be made from where the account stands: the runner parks the account rather than retrying. */
export class Unreachable extends Error {
    override name = 'Unreachable';
}

export interface Purse {
    carried: number;
    /** Coins in the bank at the runner's last sight of it; null when not seen this run. */
    banked: number | null;
}

export type TripPlan = { ok: true; legs: Leg[]; fares: number } | { ok: false; reason: string; fares: number };

/**
 * The route from `from` to `to`, paid for: when the pack holds less than its fares, first this side's fare bank (the
 * passages out to it, the bank, then the route from there). Refused with the reason when no fare bank is on this side,
 * or the bank was last seen holding too little.
 */
export function planTrip(from: Tile, to: Tile, purse: Purse, tolerance = 3, reaches: Reaches = reachesOnGround): TripPlan {
    const legs = routeBetween(from, to, tolerance, reaches);
    const fares = faresOf(legs);
    if (purse.carried >= fares) return { ok: true, legs, fares };
    const region = regionOf(from);
    const short = `the route needs ${fares} coins for its voyages and the pack holds ${purse.carried}`;
    const bank = FARE_BANKS[region];
    if (!bank) return { ok: false, fares, reason: `${short}; ${region} has no fare bank` };
    if (purse.banked !== null && purse.carried + purse.banked < fares) return { ok: false, fares, reason: `${short}; the bank held ${purse.banked} when last seen` };
    return { ok: true, fares, legs: [...crossLegs(from, bank, reaches), { kind: 'fares', name: 'fares', bank, need: fares }, ...routeBetween(bank, to, tolerance, reaches)] };
}

export type Stacks = { id: number; name: string; count: number }[];

export interface RouteCtx {
    bot: BotActions;
    sdk: BotSDK;
    signal: AbortSignal;
    event(message: string, data?: Record<string, unknown>): void;
    /** Coins in the bank at the runner's last sight of it (null when not seen): a trip it cannot pay is refused unmoved. */
    bankCoins?(): number | null;
    reportBank?(items: Stacks): void;
    /** Every trip run, once it has arrived. */
    trip?(t: Trip): void;
}

export interface LegMark {
    leg: string;
    ticks: number;
    x: number;
    z: number;
}

export interface Trip {
    from: Tile;
    /** Where the trip was asked to go. */
    dest: Tile;
    /** Where it ended. */
    to: Tile;
    ticks: number;
    fares: number;
    legs: LegMark[];
}

const state = (x: Pick<RouteCtx, 'sdk'>): BotWorldState => {
    const s = x.sdk.getState();
    if (!s?.player) throw new Error('no game state');
    return s;
};
export const hereOf = (s: Pick<BotWorldState, 'player'>): Tile => ({ x: s.player?.worldX ?? 0, z: s.player?.worldZ ?? 0 });
const coins = (s: BotWorldState) => s.inventory.filter(i => /^coins$/i.test(i.name)).reduce((n, i) => n + i.count, 0);
const cheb = (a: Tile, b: Tile) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
const stacksOf = (sdk: BotSDK): Stacks => sdk.getBankItems().map(i => ({ id: i.id, name: i.name, count: i.count }));

/**
 * Walk to within `tolerance` of `to` on the current land mass; throws when it cannot get there. A walk the long-path
 * map cannot route ('cant reach') tries the door recovery once before giving up.
 */
export async function walk(x: RouteCtx, to: Tile, tolerance: number): Promise<void> {
    x.signal.throwIfAborted();
    const r = await travelTo(x.bot, x.sdk, to, { tolerance, signal: x.signal, log: (m, d) => m !== 'walking' && x.event(m, d) });
    x.signal.throwIfAborted();
    if (r.ok) return;
    let recovery = '';
    if (r.reason === 'cant reach') {
        try {
            await walkThroughDoors(liveDoorWalk(x.bot, x.sdk, (m, d) => x.event(m, d)), to);
        } catch (e) {
            recovery = `; the door recovery: ${e instanceof Error ? e.message : String(e)}`;
        }
        x.signal.throwIfAborted();
        if (cheb(hereOf(state(x)), to) <= Math.max(tolerance, 2)) return;
    }
    const p = hereOf(state(x));
    throw new Error(`walk to (${to.x}, ${to.z}): ${r.reason} at (${p.x}, ${p.z})${recovery}`);
}

/** Walk to the bank at `at` and open it afresh, waiting for its items (an empty bank costs the wait's 5 ticks). */
export async function openBankAt(x: RouteCtx, at: Tile): Promise<ReturnType<BotSDK['getBankItems']>> {
    await travel(x, at, 3);
    // A sale falls due when the method reports its bank, so the method is stopped with that bank still open or
    // closing, and reading it then gave no items (lab, rs/732).
    if (x.sdk.getState()?.bank?.isOpen) {
        await x.bot.closeBank();
        await waitUntil(x.sdk, s => !s.bank?.isOpen, { maxTicks: 5 });
    }
    const opened = await x.bot.openBank();
    if (!opened.success) throw new Error(`openBank: ${opened.message}`);
    await waitUntil(x.sdk, s => s.bank?.isOpen === true && s.bank.items.length > 0, { maxTicks: 5 });
    return x.sdk.getBankItems();
}

/** Take coins from the bank at `bank` until the pack holds `need`, as far as the bank has them. Returns the bank's coins before. */
export async function withdrawFares(x: RouteCtx, bank: Tile, need: number): Promise<number> {
    const stack = (await openBankAt(x, bank)).find(i => /^coins$/i.test(i.name));
    const before = coins(state(x));
    const take = Math.min(stack?.count ?? 0, need - before);
    if (stack && take > 0) {
        const w = await x.bot.withdrawItem(stack, take);
        if (!w.success) x.event('fare withdrawal failed', { message: w.message });
        await waitUntil(x.sdk, s => coins(s) >= before + take, { maxTicks: 5 });
    }
    x.reportBank?.(stacksOf(x.sdk));
    await x.bot.closeBank();
    return stack?.count ?? 0;
}

/** Run `legs` from where the account stands. Throws when a leg fails, Unreachable when the fares cannot be paid. */
export async function runRoute(x: RouteCtx, legs: readonly Leg[], dest: Tile = (legs.at(-1) as { to?: Tile } | undefined)?.to ?? hereOf(state(x))): Promise<Trip> {
    let s = state(x);
    // a session stopped mid-voyage comes back on the deck (level 1), where no walk starts
    if (s.player!.level !== 0 && s.nearbyLocs.some(l => /gangplank/i.test(l.name))) await disembark(x);
    s = state(x);
    const fares = faresOf(legs);
    if (!legs.some(l => l.kind === 'fares') && coins(s) < fares) throw new Unreachable(`the route needs ${fares} coins for its voyages, the pack holds ${coins(s)}`);
    const t0 = s.tick;
    const from = hereOf(s);
    const log = (m: string, d?: Record<string, unknown>) => x.event(m, d);
    const sailor: Sailor = { bot: x.bot, sdk: x.sdk, log, walk: t => walk(x, t, 2) };
    const marks: LegMark[] = [];
    let last = t0;
    for (const leg of legs) {
        x.signal.throwIfAborted();
        switch (leg.kind) {
            case 'sail':
                await sail(sailor, leg.voyage);
                break;
            case 'walk':
                await walk(x, leg.to, leg.tolerance);
                break;
            case 'cross':
                await cross({ bot: x.bot, sdk: x.sdk, log, walk: t => walk(x, t, 2) }, leg.crossing);
                break;
            case 'fares': {
                const banked = await withdrawFares(x, leg.bank, leg.need);
                const held = coins(state(x));
                if (held < leg.need) throw new Unreachable(`the route needs ${leg.need} coins for its voyages: the pack holds ${held} after the fare bank, which had ${banked}`);
                break;
            }
        }
        s = state(x);
        marks.push({ leg: leg.name, ticks: s.tick - last, ...hereOf(s) });
        last = s.tick;
    }
    const trip: Trip = { from, dest, to: hereOf(s), ticks: last - t0, fares, legs: marks };
    x.event('route', { ...trip });
    x.trip?.(trip);
    return trip;
}

/**
 * From where the account stands to within `tolerance` of `to`: out through passages, by sea when they are on
 * different land masses, fares fetched first when the pack is short. Throws Unreachable, unmoved, when the trip
 * cannot be paid for.
 */
export async function travel(x: RouteCtx, to: Tile, tolerance = 3): Promise<Trip> {
    const s = state(x);
    const plan = planTrip(hereOf(s), to, { carried: coins(s), banked: x.bankCoins?.() ?? null }, tolerance);
    if (!plan.ok) throw new Unreachable(`(${to.x}, ${to.z}): ${plan.reason}`);
    return runRoute(x, plan.legs, to);
}
