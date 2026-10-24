/**
 * Travel between the mainland, Karamja and the Ardougne side for a markets account: the voyages speedrun/lib/ships.ts
 * chooses, each walked to and sailed with its `sail` (30 coins a voyage), and the walks on each land mass with
 * toll-gate.ts `travelTo` (out of the underground and across the Al-Kharid toll gate when needed).
 *
 * A route is a list of legs planned from its two ends alone (`routeBetween`), so its fares can be counted and found
 * before anything moves. Running it records every leg's ticks; a voyage's ticks include the walk to its dock.
 *
 * The Karamja leg (`KARAMJA_LEG`) is the crossing between any Karamja tile and Port Sarim through Musa Point: out on
 * the customs officer's ship, in on a Port Sarim sailor's. The Ardougne side reaches the mainland through it after
 * the Brimhaven ship, and an account on Karamja itself (a Shilo mule outside the Shilo gate, rs/685) takes it with
 * nothing else: `regionOf` counts Shilo as Karamja.
 */
import type { BotActions } from '../../sdk/actions';
import type { BotSDK } from '../../sdk/index';
import type { BotWorldState } from '../../sdk/types';
import { disembark, FARE, regionOf, sail, VOYAGES, voyagesBetween, type Sailor, type Tile, type Voyage } from '../../speedrun/lib/ships';
import { travelTo } from '../../speedrun/lib/toll-gate';

export type { Tile };

export type Leg = { kind: 'sail'; name: string; voyage: Voyage } | { kind: 'walk'; name: 'walk'; to: Tile; tolerance: number };

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

const legOf = (v: Voyage): Leg => [KARAMJA_LEG.out, KARAMJA_LEG.in].find(l => l.kind === 'sail' && l.voyage === v) ?? sailLeg(v);

/** The legs from `from` to `to`: each voyage between their land masses, then the walk to within `tolerance` of `to`. */
export function routeBetween(from: Tile, to: Tile, tolerance = 3): Leg[] {
    return [...voyagesBetween(regionOf(from), regionOf(to)).map(legOf), { kind: 'walk', name: 'walk', to, tolerance }];
}

/** Coins a route's voyages cost. */
export const faresOf = (legs: readonly Leg[]): number => legs.filter(l => l.kind === 'sail').length * FARE;

export interface RouteCtx {
    bot: BotActions;
    sdk: BotSDK;
    signal: AbortSignal;
    event(message: string, data?: Record<string, unknown>): void;
}

export interface LegMark {
    leg: string;
    ticks: number;
    x: number;
    z: number;
}

export interface Trip {
    from: Tile;
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

/** Walk to within `tolerance` of `to` on the current land mass; throws when it cannot get there. */
export async function walk(x: RouteCtx, to: Tile, tolerance: number): Promise<void> {
    x.signal.throwIfAborted();
    const r = await travelTo(x.bot, x.sdk, to, { tolerance, signal: x.signal, log: (m, d) => m !== 'walking' && x.event(m, d) });
    x.signal.throwIfAborted();
    if (!r.ok) {
        const p = hereOf(state(x));
        throw new Error(`walk to (${to.x}, ${to.z}): ${r.reason} at (${p.x}, ${p.z})`);
    }
}

/** Run `legs` from where the account stands. Throws when a leg fails or the pack lacks the fares; the trip so far is lost. */
export async function runRoute(x: RouteCtx, legs: readonly Leg[]): Promise<Trip> {
    let s = state(x);
    // a session stopped mid-voyage comes back on the deck (level 1), where no walk starts
    if (s.player!.level !== 0 && s.nearbyLocs.some(l => /gangplank/i.test(l.name))) await disembark(x);
    s = state(x);
    const fares = faresOf(legs);
    if (coins(s) < fares) throw new Error(`the route needs ${fares} coins for its voyages, the pack holds ${coins(s)}`);
    const t0 = s.tick;
    const from = hereOf(s);
    const sailor: Sailor = { bot: x.bot, sdk: x.sdk, log: (m, d) => x.event(m, d), walk: t => walk(x, t, 2) };
    const marks: LegMark[] = [];
    let last = t0;
    for (const leg of legs) {
        x.signal.throwIfAborted();
        if (leg.kind === 'sail') await sail(sailor, leg.voyage);
        else await walk(x, leg.to, leg.tolerance);
        s = state(x);
        marks.push({ leg: leg.name, ticks: s.tick - last, ...hereOf(s) });
        last = s.tick;
    }
    const trip: Trip = { from, to: hereOf(s), ticks: last - t0, fares, legs: marks };
    x.event('route', { ...trip });
    return trip;
}

/** From where the account stands to within `tolerance` of `to`, by sea when they are on different land masses. */
export const travel = (x: RouteCtx, to: Tile, tolerance = 3): Promise<Trip> => runRoute(x, routeBetween(hereOf(state(x)), to, tolerance));
