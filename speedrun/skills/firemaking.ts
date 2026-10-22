// Firemaking: STEP-MANIFEST.md entry 16 (S03), and the assisted 1-99 rehearsal (rs/228).
//
// One step lights logs that a helper has dropped on the ground, one per planned tile, with the
// ground item's "Light" op (op 4), chaining one 4-tick roll per log (docs/speedrun/skills/
// firemaking.md section 4). The log bands (normal 1-15, oak 15-30, willow 30-45, maple 45-60, yew
// 60-75, magic 75-99) are measure rows inside that one loop, not steps: a band boundary is just
// the next log, so it costs no tick. The step reads the level from the state, so it runs from any
// start level up to `toLevel`, and the scored S03 chains it after S02 with its own row.
//
// The timing this loop is built around (firemaking.rs2, read; firemaking.md, measured):
// - A roll at tick R that succeeds pushes the player one tile (west first) and delays them, and
//   "The fire catches" arrives at R+1. The next light must land at R+2, R+3 or R+4 to be queued
//   onto the running clock, and it then rolls at R+4. One landing at R+5 or later starts afresh
//   ("You attempt to light the logs.") and rolls 3 ticks after it lands, which costs the chain at
//   least 4 ticks. So the next light is sent on the success message itself.
// - A failed roll is silent apart from the animation. It re-arms the clock by 4 and retries the
//   same log, so failures are inferred from the gaps between successes.
// - A dropped obj is private to its dropper for 100 ticks and despawns at 300 (World.ts addObj
//   NODE_OBJ_REVEAL_TICKS, drop.rs2). The dropper (speedrun/helpers/fm-row.ts) puts each log down
//   about 100 + lead ticks before this loop can want it, so a log this loop can't see is missing,
//   not early. The loop waits for it (`maxGap`) and logs the gap rather than stopping.
// - A tile under any active loc, a burning fire included, refuses a fire (map_locaddunsafe). The
//   loop skips a planned tile with a fire on it and follows the log to the next planned tile, as
//   the dropper does when it finds a tile occupied.
//
// The ground op walks to the log by itself, so the loop sends no walk clicks on the row. That is
// why `act` (send, then resend until an effect shows) isn't used for the light: an op that has
// taken can be rolling and failing for several ticks with nothing to show for it, so the loop
// resends only when there is no sign at all that the light took (`RESEND_AFTER`).
//
// The trade supply (`supply: 'trade'`, the manifest's fallback) has no row on the ground. A trade
// giver standing beside the line hands SCORED one inventory of logs at a time, and the same Lighter,
// in its `held` mode, uses the tinderbox on the best held log while SCORED stands on the next planned
// tile. That light drops the log on SCORED's own tile and runs the same 4-tick clock (firemaking.rs2
// light_logs_inv), so the chain and the push are the row's. Three things differ:
// - A held light that took is seen at once: the log leaves the inventory when the op runs
//   (inv_dropslot comes before the clock check). So the loop resends only while the log is still
//   held, never after; a resend after the drop would put a second log on the tile (firemaking.md
//   section 6). A refused light ("can't light a fire here") is checked before the drop, so the log
//   stays in hand and is lit on the next tile.
// - The ground op walks by itself; the use doesn't. On a westward run the push leaves SCORED on the
//   next tile, so nothing is walked. A return row or a lap turn is one run step, sent on the success
//   message, with the use sent the tick SCORED stands on the tile (firemaking.md section 4: the
//   2-tile step east keeps the chain).
// - A chained light prints no attempt message, so held mode reads the roll animation as the sign
//   that the dropped log is still rolling before it relights it (the backstop).
// When no lightable log is held, the step refills: `receiveFrom` (lib/trade.ts) from the giver,
// wanting the next `capacity` logs of `routeLogs` from the current xp. The hand-off is stated as data
// by `tradePlan`: when each refill falls due (SCORED's fire count), SCORED's tile then, the giver's
// tile beside it, and the package by tier. The giver requests first, as SCORED's last held log rolls,
// so SCORED's click on its last success accepts at once (firemaking-supply.ts: 5 ticks, 6 of 6).
// A refill holds SCORED's free slots, not 27: at S03's real start SCORED carries the tinderbox and
// its rune stacks (RUN-ORDER.md S00-S02), so `capacity` defaults to 28 less the non-log items held.

import { ChatHistory } from '../../sdk/chat-history';
import { isFlagged, isTileWalkable } from '../../sdk/pathfinding';
import { CollisionFlag } from '../../server/vendor/rsmod-pathfinder';
import type { ActionResult, BotWorldState, GameMessage, GroundItem, InventoryItem } from '../../sdk/types';
import { levelUpStep, newWatcherMemory, type WatcherMemory } from '../lib/levelup';
import type { TickRow } from '../lib/ticks';
import { receiveFrom, type WantSpec } from '../lib/trade';
import { tickMs, waitUntil } from '../lib/wait';
import { levelForXp, XP_RATE, xpForLevel } from '../lib/xp';
import type { Step, StepContext } from '../runner/step';

export const skill = 'firemaking';

/** The step's name when no `id` is given: the scored run's S03. */
export const DEFAULT_ID = 'S03 firemaking';

// ------------------------------------------------------------------ logs and bands

export interface Tier {
    /** The item's name as the state shows it. */
    name: string;
    /** The debug name (::give, fm-row's tiers). */
    obj: string;
    level: number;
    /** Base xp per log (firemaking.obj productexp, tenths / 10); game xp is x XP_RATE. */
    base: number;
}

export const TIERS: readonly Tier[] = [
    { name: 'Logs', obj: 'logs', level: 1, base: 40 },
    { name: 'Oak logs', obj: 'oak_logs', level: 15, base: 60 },
    { name: 'Willow logs', obj: 'willow_logs', level: 30, base: 90 },
    { name: 'Maple logs', obj: 'maple_logs', level: 45, base: 135 },
    { name: 'Yew logs', obj: 'yew_logs', level: 60, base: 202.5 },
    { name: 'Magic logs', obj: 'magic_logs', level: 75, base: 303.8 }
];

export interface Band {
    id: string;
    tier: Tier;
    from: number;
    to: number;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** One band per tier, from its level to the next tier's (the last to 99). */
export const BANDS: readonly Band[] = TIERS.map((tier, i) => {
    const to = TIERS[i + 1]?.level ?? 99;
    return { id: `fm-${pad2(tier.level)}-${pad2(to)}`, tier, from: tier.level, to };
});

/** The band a level is in (99 counts as the last band's end, so it is the last band). */
export function bandFor(level: number): Band {
    return [...BANDS].reverse().find(b => b.from <= level) ?? BANDS[0]!;
}

/** The best log a level may light. Every tier rolls the same 4 ticks, so the best is always used. */
export function tierFor(level: number): Tier {
    return [...TIERS].reverse().find(t => t.level <= level) ?? TIERS[0]!;
}

export function tierOf(name: string): Tier | undefined {
    const n = name.trim().toLowerCase();
    return TIERS.find(t => t.name.toLowerCase() === n);
}

/**
 * The logs, in order, that take `fromXp` (game xp) to `toLevel` when each is the best one the
 * level allows. A failed roll retries the same log, so the count is exact. From level 1 to 99 it is
 * 157: 2 normal, 4 oak, 7 willow, 13 maple, 24 yew, 107 magic (fm-row's S03_LOGS).
 */
export function routeLogs(fromXp: number, toLevel = 99): Tier[] {
    const out: Tier[] = [];
    const end = xpForLevel(toLevel);
    let xp = fromXp;
    while (xp < end) {
        const t = tierFor(levelForXp(xp));
        out.push(t);
        xp += t.base * XP_RATE;
    }
    return out;
}

/** stat_random(firemaking, 64, 512): the chance a roll succeeds, the same for every tier (PlayerOps.ts). */
export function rollChance(level: number): number {
    return Math.min(1, (Math.floor((64 * (99 - level)) / 98) + Math.floor((512 * (level - 1)) / 98) + 1) / 256);
}

// ------------------------------------------------------------------ tiles

export type Tile = readonly [number, number];

const key = (t: Tile) => `${t[0]},${t[1]}`;
const cheb = (a: Tile, b: Tile) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));

function int(v: string, what: string): number {
    const n = Number(v);
    if (!Number.isInteger(n)) throw new Error(`firemaking: bad ${what} "${v}"`);
    return n;
}

function run(a: number, b: number): number[] {
    const out: number[] = [];
    for (let i = a; ; i += a <= b ? 1 : -1) {
        out.push(i);
        if (i === b) return out;
    }
}

/**
 * The planned tiles, in lighting order. Accepts `[[x,z],...]` (or a JSON string of it), or a
 * compact string of segments separated by `;` or spaces, which is what `--skill-opt` carries:
 * `x0-x1@z` is a run along z (either direction, inclusive), `x@z0-z1` a run along x, `x,z` or
 * `x@z` one tile. `3222-3218@3219;3218-3236@3218` is west along 3219 then east along 3218.
 */
export function parseTiles(v: unknown): Tile[] {
    if (v === undefined || v === null || v === '') return [];
    if (typeof v === 'string' && v.trim().startsWith('[')) return parseTiles(JSON.parse(v));
    if (Array.isArray(v)) {
        return v.map((t, i) => {
            const p = Array.isArray(t) ? t : t && typeof t === 'object' ? [(t as { x: unknown }).x, (t as { z: unknown }).z] : [];
            if (p.length !== 2 || !p.every(n => Number.isInteger(n))) throw new Error(`firemaking: tile ${i} must be [x,z], not ${JSON.stringify(t)}`);
            return [p[0], p[1]] as Tile;
        });
    }
    if (typeof v !== 'string') throw new Error(`firemaking: tiles must be a list or a string, not ${typeof v}`);
    const out: Tile[] = [];
    for (const seg of v.split(/[;\s]+/).filter(Boolean)) {
        const at = seg.split('@');
        if (at.length === 2) {
            const [a, b] = at as [string, string];
            if (a.includes('-') && !b.includes('-')) {
                const [x0, x1] = a.split('-') as [string, string];
                const z = int(b, `z in "${seg}"`);
                for (const x of run(int(x0, `x in "${seg}"`), int(x1, `x in "${seg}"`))) out.push([x, z]);
            } else if (b.includes('-') && !a.includes('-')) {
                const [z0, z1] = b.split('-') as [string, string];
                const x = int(a, `x in "${seg}"`);
                for (const z of run(int(z0, `z in "${seg}"`), int(z1, `z in "${seg}"`))) out.push([x, z]);
            } else if (!a.includes('-') && !b.includes('-')) out.push([int(a, `x in "${seg}"`), int(b, `z in "${seg}"`)]);
            else throw new Error(`firemaking: segment "${seg}" must be x0-x1@z, x@z0-z1 or x@z`);
        } else {
            const p = seg.split(',');
            if (p.length !== 2) throw new Error(`firemaking: segment "${seg}" must be x0-x1@z, x@z0-z1 or x,z`);
            out.push([int(p[0]!, `x in "${seg}"`), int(p[1]!, `z in "${seg}"`)]);
        }
    }
    return out;
}

// ------------------------------------------------------------------ options

export type Supply = 'row' | 'trade' | 'bank';

export interface FiremakingOptions {
    /** The step's name (default `S03 firemaking`). */
    id?: string;
    /** Stop at this level (default 99). The rehearsal harness passes --to here. */
    toLevel?: number | string;
    /** Where the logs come from: `row` (helper-dropped logs) or `trade` (a giver beside the line). `bank` is not built. */
    supply?: Supply;
    /** supply trade: the trade giver's name (a helper; never SCORED's). */
    giver?: string;
    /** supply trade: logs per refill (default 28 less the non-log items SCORED holds when the step starts). */
    capacity?: number | string;
    /** The planned tiles in lighting order, the same list the dropper is given (`parseTiles`). */
    tiles?: string | ReadonlyArray<Tile>;
    /** The first log's tile; default the first planned tile. */
    entry?: string | Tile;
    /** Ticks to wait for the first lightable log before giving up (default 150: a dropper's reveal). */
    waitForRow?: number | string;
    /** Ticks mid-row with nothing lightable before giving up (default 120). */
    maxGap?: number | string;
    /** Planned tiles searched past the next one for a log (default 6). */
    lookahead?: number | string;
    /** The step starts only within this many tiles of `entry` (default 15). */
    near?: number | string;
}

export interface Resolved {
    id: string;
    toLevel: number;
    supply: Supply;
    tiles: Tile[];
    entry: Tile | null;
    waitForRow: number;
    maxGap: number;
    lookahead: number;
    near: number;
    giver: string | null;
    capacity: number | null;
}

function whole(v: unknown, def: number, what: string, min: number, max = Infinity): number {
    const n = v === undefined || v === '' ? def : Number(v);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`firemaking: ${what} must be a whole number from ${min}${max < Infinity ? ` to ${max}` : ''}, not ${String(v)}`);
    return n;
}

export function resolveOptions(raw: FiremakingOptions = {}): Resolved {
    const supply = (raw.supply ?? 'row') as Supply;
    if (!['row', 'trade', 'bank'].includes(supply)) throw new Error(`firemaking: supply must be row, trade or bank, not ${String(raw.supply)}`);
    const tiles = parseTiles(raw.tiles);
    const entry = raw.entry === undefined ? (tiles[0] ?? null) : (parseTiles(typeof raw.entry === 'string' ? raw.entry : [raw.entry])[0] ?? null);
    return {
        id: raw.id ?? DEFAULT_ID,
        toLevel: whole(raw.toLevel, 99, 'toLevel', 2, 99),
        supply,
        tiles,
        entry,
        waitForRow: whole(raw.waitForRow, 150, 'waitForRow', 1),
        maxGap: whole(raw.maxGap, 120, 'maxGap', 1),
        lookahead: whole(raw.lookahead, 6, 'lookahead', 0),
        near: whole(raw.near, 15, 'near', 0),
        giver: raw.giver === undefined || raw.giver === '' ? null : String(raw.giver),
        capacity: raw.capacity === undefined || raw.capacity === '' ? null : whole(raw.capacity, 0, 'capacity', 1, 27)
    };
}

// ------------------------------------------------------------------ the trade supply's hand-off

/** An inventory holds 28; the tinderbox always takes one. */
export const INVENTORY = 28;
/**
 * A trade refill's size at S03's real start: the account holds the tinderbox and seven rune stacks
 * (RUN-ORDER.md S00-S02), so 20 slots are free and the route is 8 refills of 20 (`tradePlan`).
 */
export const S03_REFILL = 20;

export interface TradeRefill {
    /** 0-based refill number. */
    k: number;
    /** SCORED's fire count when this refill is due (all held logs lit). The giver requests at atLit - 1. */
    atLit: number;
    /** Logs in the package. */
    logs: number;
    /** The package by tier, in route order: obj debug name and count. */
    package: Array<{ obj: string; name: string; n: number }>;
    /** Where SCORED stands when the refill is due (the planned tile of log atLit), if tiles are given. */
    scoredTile: Tile | null;
    /** Where the giver stands: beside scoredTile, off the planned tiles. */
    giverTile: Tile | null;
}

/** The logs a package holds, grouped by tier in route order. */
export function packageOf(logs: readonly Tier[]): TradeRefill['package'] {
    const out: TradeRefill['package'] = [];
    for (const t of logs) {
        const last = out.at(-1);
        if (last && last.obj === t.obj) last.n++;
        else out.push({ obj: t.obj, name: t.name, n: 1 });
    }
    return out;
}

/** Whether a player on tile `a` can step onto the orthogonally adjacent tile `b`. */
export type Reach = (a: Tile, b: Tile) => boolean;

/**
 * `Reach` from the SDK's collision map (sdk/pathfinding): `b` is walkable and no wall edge lies
 * between the two tiles. A trade partner one tile away across a wall edge is out of reach ("I can't
 * reach that!"), as at the west end of the Falador east lab snake's first row.
 */
export function mapReach(a: Tile, b: Tile): boolean {
    if (!isTileWalkable(0, b[0], b[1])) return false;
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    if (Math.abs(dx) + Math.abs(dz) !== 1) return false;
    const [out, back] =
        dz === 1 ? [CollisionFlag.WALL_NORTH, CollisionFlag.WALL_SOUTH]
        : dz === -1 ? [CollisionFlag.WALL_SOUTH, CollisionFlag.WALL_NORTH]
        : dx === 1 ? [CollisionFlag.WALL_EAST, CollisionFlag.WALL_WEST]
        : [CollisionFlag.WALL_WEST, CollisionFlag.WALL_EAST];
    return !isFlagged(a[0], a[1], 0, out) && !isFlagged(b[0], b[1], 0, back);
}

/**
 * Where the giver stands for a refill due at planned tile `index`: beside that tile, off the planned
 * tiles and within `reach` of it (north, then south, east, west). When none is, beside the planned
 * tile before it, so SCORED's trade click takes one step. Null when neither has one.
 */
export function giverTileFor(tiles: readonly Tile[], index: number, reach: Reach = mapReach): Tile | null {
    if (!tiles.length) return null;
    const planned = new Set(tiles.map(key));
    const i = Math.min(index, tiles.length - 1);
    for (const j of [i, (i - 1 + tiles.length) % tiles.length]) {
        const at = tiles[j]!;
        const options: Tile[] = [[at[0], at[1] + 1], [at[0], at[1] - 1], [at[0] + 1, at[1]], [at[0] - 1, at[1]]];
        const ok = options.find(t => !planned.has(key(t)) && reach(at, t));
        if (ok) return ok;
    }
    return null;
}

/**
 * The trade supply's hand-off contract as data: one entry per refill of `capacity` logs, from
 * `fromXp` to `toLevel`, in the route's order. The giver stands on `giverTile` and sends its trade
 * request when SCORED's fire count reaches `atLit - 1`; SCORED clicks trade back on its last
 * success and accepts as soon as the offer holds the package (lib/trade.ts receiveFrom). From 1 to
 * 99 with an inventory holding only a tinderbox it is SUPPLIES.md H2's 6 trades of 27.
 */
export function tradePlan(fromXp: number, toLevel: number, capacity: number, tiles: readonly Tile[] = [], reach: Reach = mapReach): TradeRefill[] {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error(`firemaking: capacity must be 1 or more, not ${capacity}`);
    const route = routeLogs(fromXp, toLevel);
    const out: TradeRefill[] = [];
    for (let atLit = 0, k = 0; atLit < route.length; atLit += capacity, k++) {
        const logs = route.slice(atLit, atLit + capacity);
        out.push({ k, atLit, logs: logs.length, package: packageOf(logs), scoredTile: tiles.length ? tiles[atLit % tiles.length]! : null, giverTile: giverTileFor(tiles, atLit % Math.max(1, tiles.length), reach) });
    }
    return out;
}

/** Logs per refill when no `capacity` is given: the slots not taken by anything but logs. */
export function defaultCapacity(inventory: readonly Pick<InventoryItem, 'name'>[]): number {
    return Math.max(0, INVENTORY - inventory.filter(i => !tierOf(i.name)).length);
}

// ------------------------------------------------------------------ state readers

export function fmLevel(s: BotWorldState | null | undefined): number {
    return s?.skills.find(k => k.name.toLowerCase() === 'firemaking')?.baseLevel ?? 1;
}

function fmXp(s: BotWorldState): number {
    return s.skills.find(k => k.name.toLowerCase() === 'firemaking')?.experience ?? 0;
}

const here = (s: BotWorldState): Tile => [s.player?.worldX ?? 0, s.player?.worldZ ?? 0];
const FIRE = /^fire$/i;
const hasFire = (s: BotWorldState, t: Tile) => s.nearbyLocs.some(l => l.x === t[0] && l.z === t[1] && FIRE.test(l.name));

export const MSG = {
    attempt: /you attempt to light/i,
    success: /fire catches/i,
    refused: /can't light a fire here/i,
    tooLow: /need a firemaking level/i,
    /** A wall loc the collision map doesn't carry (x=3217 beside the Lumbridge spawn, lab): no path to the log. */
    unreachable: /can't reach that/i
} as const;

// ------------------------------------------------------------------ the lighting engine

/**
 * Ticks after a send with no sign the light took (no attempt message, no animation, no movement,
 * no success) before the same light is sent again. A queued light rolls at R+4 and its success is
 * seen at R+5, four ticks after the send at R+1, so this never resends one that is on time.
 */
export const RESEND_AFTER = 4;
/** Resend even with signs of life after this many ticks without a success or an attempt message. */
export const BACKSTOP_TICKS = 16;
/** Held mode: ticks walking to a planned tile without arriving before it is passed as unreachable. */
export const HELD_WALK_TICKS = 12;
/**
 * Held mode: ticks without the roll animation before a dropped log is relit where it lies. A rolling
 * light shows the animation on two ticks of every four (lab trace), so eight quiet ticks mean the
 * clock has stopped (the lab saw a light roll once and stop at level 82).
 */
export const HELD_BACKSTOP_TICKS = 8;

/** Where the Lighter's logs are: on the planned tiles (`ground`, the row) or in SCORED's inventory (`held`, the trade supply). */
export type LightSource = 'ground' | 'held';

const TINDERBOX = /^tinderbox$/i;

/** How many logs of this name SCORED holds. */
export function heldCount(s: BotWorldState, name: string): number {
    const n = name.toLowerCase();
    return s.inventory.filter(i => i.name.toLowerCase() === n).reduce((a, i) => a + i.count, 0);
}

/** The best held log the level may light (every tier rolls the same 4 ticks, so the best is used). */
export function bestHeld(s: BotWorldState, level: number): InventoryItem | undefined {
    for (const t of [...TIERS].reverse()) {
        if (t.level > level) continue;
        const item = s.inventory.find(i => i.name.toLowerCase() === t.name.toLowerCase());
        if (item) return item;
    }
    return undefined;
}

export type LightEvent =
    | {
          kind: 'fire';
          tick: number;
          /** 0-based count of fires this step. */
          n: number;
          tile: Tile;
          tier: string;
          /** The level the log was lit at (before its xp). */
          level: number;
          /** Ticks since the previous success, null for the first. */
          gap: number | null;
          /** Failed rolls inferred from the gap. */
          failures: number;
          /** The light started afresh ("You attempt") instead of queueing onto the running clock. */
          fresh: boolean;
          /** Ticks after the previous success that the light was first sent (0: on the message, lands R+2). */
          send: number | null;
          /** Ticks the chain lost to a late or fresh start (0 when chained). */
          slip: number;
          /** No success message was seen: the log turned into a fire with this account's xp (see onTick). */
          inferred?: true;
      }
    | { kind: 'refused'; tick: number; tile: Tile; reason: 'tile' | 'level' | 'unreachable' }
    | { kind: 'lost'; tick: number; tile: Tile; tier: string }
    | { kind: 'resend'; tick: number; tile: Tile; backstop: boolean }
    | { kind: 'skip'; tick: number; tile: Tile; reason: 'fire' | 'refused' | 'empty' }
    | { kind: 'nolog'; tick: number; from: number; ticks: number; first: boolean };

export interface Decision {
    dismiss: boolean;
    light?: { x: number; z: number; itemId: number };
    walk?: Tile;
    /** Held mode: use the tinderbox (slot) on the log (slot), standing on `tile`. */
    use?: { tinderbox: number; log: number; itemId: number; tile: Tile };
}

interface Pending {
    tile: Tile;
    index: number;
    itemId: number;
    tier: string;
    firstSent: number;
    sentTick: number;
    from: Tile;
    evidence: boolean;
    goneSince: number | null;
    /** Firemaking xp when the light was first sent. */
    xp: number;
    /** Held mode: how many of this tier SCORED held when the light was sent. */
    heldBefore?: number;
    /** Held mode: the dropped log has been seen lying on its tile. */
    landed?: boolean;
    /** Held mode: the last tick a roll animation was seen. */
    rollTick?: number;
}

/**
 * The lighting loop as a pure state machine: fed one published state per tick, it says what to
 * send this tick and records what happened. The async loop (`lightRow`) only carries it out.
 */
export class Lighter {
    readonly events: LightEvent[] = [];
    /** Planned-tile index of the next log. Grows past the list's end; tiles repeat lap by lap. */
    cursor = 0;
    fires = 0;
    resends = 0;
    dismissed = 0;
    startTick: number;
    firstAttemptTick: number | null = null;
    firstSuccessTick: number | null = null;
    lastSuccessTick: number | null = null;
    private lastInferred = false;
    private attemptTick: number | null = null;
    private pending: Pending | null = null;
    private waitFrom: number | null = null;
    private walked = -100;
    private prevLevel: number | null;
    /** Every message of a publication shares its observationId, so new lines are read through the SDK's rule. */
    private readonly chat = new ChatHistory();
    private levelUp: WatcherMemory = newWatcherMemory();
    private readonly refusedTiles = new Set<string>();
    /** Held mode: the planned tile being walked to and since when. */
    private walkTo: { index: number; since: number } | null = null;

    constructor(
        readonly tiles: readonly Tile[],
        start: BotWorldState,
        readonly o: Pick<Resolved, 'lookahead' | 'entry'> & { source?: LightSource } = { lookahead: 6, entry: tiles[0] ?? null }
    ) {
        this.startTick = start.tick;
        this.prevLevel = fmLevel(start);
        this.chat.record(start.gameMessages);
        this.levelUp = levelUpStep(this.levelUp, start).mem;
    }

    get busy(): boolean {
        return this.pending !== null;
    }

    /** Ticks since the loop last had something to light or was lighting, or 0. */
    waiting(tick: number): number {
        return this.waitFrom === null ? 0 : tick - this.waitFrom;
    }

    private tileAt(i: number): Tile {
        return this.tiles[((i % this.tiles.length) + this.tiles.length) % this.tiles.length]!;
    }

    onTick(s: BotWorldState): Decision {
        const t = s.tick;
        const level = fmLevel(s);
        // The success's xp arrives with its message, so the level the log was lit at is last tick's.
        const litAt = this.prevLevel ?? level;
        this.prevLevel = level;
        const lu = levelUpStep(this.levelUp, s);
        this.levelUp = lu.mem;
        if (lu.click) this.dismissed++;
        const d: Decision = { dismiss: lu.click };

        for (const m of this.chat.record(s.gameMessages)) {
            if (MSG.attempt.test(m.text)) {
                this.attemptTick = t;
                this.firstAttemptTick ??= t;
                if (this.pending) this.pending.evidence = true;
            } else if (MSG.success.test(m.text)) {
                // Successes are at least 4 ticks apart, so one this soon after an inferred success is
                // that success's own message arriving late, not the next log's.
                if (!(this.lastInferred && this.lastSuccessTick !== null && t - this.lastSuccessTick < 4)) this.onSuccess(t, litAt);
            }
            else if (MSG.refused.test(m.text)) this.onRefused(t, 'tile');
            else if (MSG.tooLow.test(m.text)) this.onRefused(t, 'level');
            else if (MSG.unreachable.test(m.text)) this.onRefused(t, 'unreachable');
        }

        if (this.o.source === 'held') return this.heldTick(s, level, litAt, d);

        const p = this.pending;
        if (p) {
            const me = here(s);
            if (cheb(me, p.from) > 0 || (t >= p.sentTick + 2 && (s.player?.animId ?? -1) !== -1)) p.evidence = true;
            const onGround = s.groundItems.some(g => g.x === p.tile[0] && g.z === p.tile[1] && g.id === p.itemId);
            if (onGround) p.goneSince = null;
            else if (p.goneSince === null) p.goneSince = t;
            else if (t - p.goneSince >= 1) {
                if (hasFire(s, p.tile) && fmXp(s) > p.xp) {
                    // Lit, and the success message never showed (5 times on the demo, rs/269): the
                    // log became a fire on its tile and this account's xp rose. A stranger's pickup
                    // leaves no fire, and a stranger's light gives this account no xp.
                    this.onSuccess(p.goneSince, litAt, true);
                } else {
                    // Gone a whole tick without a success: taken, or despawned. Move on past it.
                    this.events.push({ kind: 'lost', tick: t, tile: p.tile, tier: p.tier });
                    this.cursor = p.index + 1;
                    this.pending = null;
                }
            }
            const q = this.pending;
            if (q && onGround) {
                const quiet = !q.evidence && t - q.sentTick >= RESEND_AFTER;
                const backstop = t - q.sentTick >= BACKSTOP_TICKS && (this.attemptTick === null || this.attemptTick < q.firstSent);
                if (quiet || backstop) {
                    this.events.push({ kind: 'resend', tick: t, tile: q.tile, backstop: !quiet });
                    this.resends++;
                    q.sentTick = t;
                    q.from = me;
                    q.evidence = false;
                    d.light = { x: q.tile[0], z: q.tile[1], itemId: q.itemId };
                }
            }
            if (this.pending) return d;
        }

        const target = this.pick(s, level);
        if (!target) {
            this.waitFrom ??= t;
            const entry = this.o.entry;
            if (this.fires === 0 && entry && cheb(here(s), entry) > 1 && t - this.walked >= 8) {
                this.walked = t;
                d.walk = entry;
            }
            return d;
        }
        if (this.waitFrom !== null) {
            const ticks = t - this.waitFrom;
            if (ticks > 0) this.events.push({ kind: 'nolog', tick: t, from: this.waitFrom, ticks, first: this.fires === 0 });
            this.waitFrom = null;
        }
        this.cursor = target.index;
        this.pending = { tile: target.tile, index: target.index, itemId: target.item.id, tier: target.item.name, firstSent: t, sentTick: t, from: here(s), evidence: false, goneSince: null, xp: fmXp(s) };
        d.light = { x: target.tile[0], z: target.tile[1], itemId: target.item.id };
        return d;
    }

    /** Held mode: no lightable log is held and none is being lit, so the step must refill. */
    outOfLogs(s: BotWorldState): boolean {
        return this.o.source === 'held' && this.pending === null && !bestHeld(s, fmLevel(s));
    }

    /** Held mode: a refill has just landed; the ticks it took are the refill's, not a wait for logs. */
    refilled(): void {
        this.waitFrom = null;
        this.walked = -100;
        this.walkTo = null;
    }

    /**
     * Held mode, one tick. A pending light took once its log left the inventory; until then it is
     * resent after `RESEND_AFTER` quiet ticks, and never after. Once the dropped log has lain on its
     * tile, it is lit when its success message shows, or, when the message never does, when it has
     * been gone from the tile a whole tick with a fire there and this account's xp risen (the row's
     * rule, rs/269); gone without that, it is lost. A dropped log with no roll animation for
     * `HELD_BACKSTOP_TICKS` (a chained light prints no attempt message, so the animation is the sign
     * of rolling) is lit where it lies with the ground op. With nothing pending, the best held log is
     * lit on the next free planned tile, walking there first when SCORED isn't on it.
     */
    private heldTick(s: BotWorldState, level: number, litAt: number, d: Decision): Decision {
        const t = s.tick;
        const p = this.pending;
        if (p) {
            if (heldCount(s, p.tier) < (p.heldBefore ?? 0)) p.evidence = true;
            const anim = s.player?.animId ?? -1;
            if (anim !== -1) p.rollTick = t;
            if (p.evidence) {
                const onGround = s.groundItems.some(g => g.x === p.tile[0] && g.z === p.tile[1] && g.id === p.itemId);
                if (onGround) {
                    p.landed = true;
                    p.goneSince = null;
                } else if (p.landed && p.goneSince === null) p.goneSince = t;
                else if (p.landed && p.goneSince !== null && t - p.goneSince >= 1) {
                    if (hasFire(s, p.tile) && fmXp(s) > p.xp) this.onSuccess(p.goneSince, litAt, true);
                    else {
                        this.events.push({ kind: 'lost', tick: t, tile: p.tile, tier: p.tier });
                        this.cursor = p.index + 1;
                        this.pending = null;
                    }
                    return d;
                }
            }
            if (!p.evidence && t - p.sentTick >= RESEND_AFTER) {
                const use = useOf(s, p.tier);
                if (use) {
                    this.events.push({ kind: 'resend', tick: t, tile: p.tile, backstop: false });
                    this.resends++;
                    p.sentTick = t;
                    p.heldBefore = heldCount(s, p.tier);
                    d.use = { ...use, tile: p.tile };
                }
            } else if (p.evidence && t - Math.max(p.sentTick, p.rollTick ?? p.sentTick) >= HELD_BACKSTOP_TICKS && anim === -1) {
                const g = s.groundItems.find(x => x.x === p.tile[0] && x.z === p.tile[1] && x.name.toLowerCase() === p.tier.toLowerCase());
                if (g) {
                    this.events.push({ kind: 'resend', tick: t, tile: p.tile, backstop: true });
                    this.resends++;
                    p.sentTick = t;
                    d.light = { x: g.x, z: g.z, itemId: g.id };
                }
            }
            return d;
        }

        const item = bestHeld(s, level);
        const target = item ? this.pickTile(s) : null;
        if (!item || !target) {
            this.waitFrom ??= t;
            return d;
        }
        if (cheb(here(s), target.tile) !== 0) {
            if (this.walkTo?.index !== target.index) this.walkTo = { index: target.index, since: t };
            else if (t - this.walkTo.since > HELD_WALK_TICKS) {
                this.events.push({ kind: 'refused', tick: t, tile: target.tile, reason: 'unreachable' });
                this.refusedTiles.add(key(target.tile));
                this.cursor = target.index + 1;
                this.walkTo = null;
                return d;
            }
            if (t - this.walked >= 3) {
                this.walked = t;
                d.walk = target.tile;
            }
            return d;
        }
        this.walkTo = null;
        if (this.waitFrom !== null) {
            const ticks = t - this.waitFrom;
            if (ticks > 0) this.events.push({ kind: 'nolog', tick: t, from: this.waitFrom, ticks, first: this.fires === 0 });
            this.waitFrom = null;
        }
        const use = useOf(s, item.name)!;
        this.cursor = target.index;
        this.pending = { tile: target.tile, index: target.index, itemId: item.id, tier: item.name, firstSent: t, sentTick: t, from: here(s), evidence: false, goneSince: null, xp: fmXp(s), heldBefore: heldCount(s, item.name) };
        d.use = { ...use, tile: target.tile };
        return d;
    }

    /**
     * Held mode: the next planned tile to light on, from the cursor, within `lookahead` tiles past
     * it, with no fire and not refused. Before the first fire, the nearest such planned tile.
     */
    private pickTile(s: BotWorldState): { index: number; tile: Tile } | null {
        const free = (t: Tile) => !hasFire(s, t) && !this.refusedTiles.has(key(t));
        if (this.fires === 0 && this.cursor === 0) {
            const me = here(s);
            let best: { index: number; tile: Tile } | null = null;
            for (let index = 0; index < this.tiles.length; index++) {
                const tile = this.tiles[index]!;
                if (free(tile) && (!best || cheb(me, tile) < cheb(me, best.tile))) best = { index, tile };
            }
            return best;
        }
        for (let i = this.cursor; i <= this.cursor + this.o.lookahead; i++) {
            const tile = this.tileAt(i);
            if (!free(tile)) continue;
            for (let j = this.cursor; j < i; j++) {
                const skipped = this.tileAt(j);
                this.events.push({ kind: 'skip', tick: s.tick, tile: skipped, reason: hasFire(s, skipped) ? 'fire' : 'refused' });
            }
            return { index: i, tile };
        }
        return null;
    }

    /**
     * The next log to light: the first planned tile from the cursor, within `lookahead` tiles past
     * it, that holds a log this level may light and no fire. Before the first fire every planned
     * tile is searched, nearest first, so a restart mid-row finds where the logs are.
     */
    private pick(s: BotWorldState, level: number): { index: number; tile: Tile; item: GroundItem } | null {
        const lightable = (t: Tile) =>
            s.groundItems.find(g => g.x === t[0] && g.z === t[1] && (tierOf(g.name)?.level ?? Infinity) <= level);
        if (this.fires === 0 && this.cursor === 0) {
            const me = here(s);
            let best: { index: number; tile: Tile; item: GroundItem } | null = null;
            for (let index = 0; index < this.tiles.length; index++) {
                const tile = this.tiles[index]!;
                if (hasFire(s, tile) || this.refusedTiles.has(key(tile))) continue;
                const item = lightable(tile);
                if (item && (!best || cheb(me, tile) < cheb(me, best.tile))) best = { index, tile, item };
            }
            return best;
        }
        for (let i = this.cursor; i <= this.cursor + this.o.lookahead; i++) {
            const tile = this.tileAt(i);
            if (hasFire(s, tile) || this.refusedTiles.has(key(tile))) continue;
            const item = lightable(tile);
            if (!item) continue;
            for (let j = this.cursor; j < i; j++) {
                const skipped = this.tileAt(j);
                const reason = hasFire(s, skipped) ? 'fire' : this.refusedTiles.has(key(skipped)) ? 'refused' : 'empty';
                this.events.push({ kind: 'skip', tick: s.tick, tile: skipped, reason });
            }
            return { index: i, tile, item };
        }
        return null;
    }

    private onSuccess(t: number, level: number, inferred = false): void {
        const p = this.pending;
        const prev = this.lastSuccessTick;
        const fresh = this.attemptTick !== null && (prev === null || this.attemptTick > prev);
        const gap = prev === null ? null : t - prev;
        let failures: number;
        let slip = 0;
        if (fresh) {
            // A fresh light rolls 3 ticks after its attempt message, then every 4.
            failures = Math.max(0, Math.round((t - this.attemptTick! - 3) / 4));
            if (gap !== null) slip = Math.max(0, gap - 4 * (failures + 1));
        } else failures = gap === null ? 0 : Math.max(0, Math.round(gap / 4) - 1);
        const tile = p?.tile ?? this.tileAt(this.cursor);
        this.events.push({
            kind: 'fire', tick: t, n: this.fires, tile, tier: p?.tier ?? '?', level, gap, failures, fresh,
            send: p && prev !== null ? p.firstSent - prev : null, slip, ...(inferred ? { inferred: true as const } : {})
        });
        this.fires++;
        this.firstSuccessTick ??= t;
        this.lastSuccessTick = t;
        this.lastInferred = inferred;
        this.cursor = (p?.index ?? this.cursor) + 1;
        this.pending = null;
    }

    private onRefused(t: number, reason: 'tile' | 'level' | 'unreachable'): void {
        const p = this.pending;
        if (!p) return;
        this.events.push({ kind: 'refused', tick: t, tile: p.tile, reason });
        if (reason !== 'level') this.refusedTiles.add(key(p.tile));
        this.cursor = p.index + 1;
        this.pending = null;
    }
}

/** The tinderbox and log slots for a held light of this tier, or undefined if either is missing. */
function useOf(s: BotWorldState, tier: string): { tinderbox: number; log: number; itemId: number } | undefined {
    const tinder = s.inventory.find(i => TINDERBOX.test(i.name));
    const log = s.inventory.find(i => i.name.toLowerCase() === tier.toLowerCase());
    return tinder && log ? { tinderbox: tinder.slot, log: log.slot, itemId: log.id } : undefined;
}

// ------------------------------------------------------------------ summaries

export interface BandSummary {
    band: string;
    fires: number;
    failures: number;
    expectedFailures: number;
    slips: number;
    slipTicks: number;
    fresh: number;
    startTick: number | null;
    endTick: number | null;
}

/** Per-band totals of the fire events: the band is the level each log was lit at. */
export function summarizeBands(events: readonly LightEvent[]): BandSummary[] {
    const out = new Map<string, BandSummary>();
    for (const e of events) {
        if (e.kind !== 'fire') continue;
        const b = bandFor(e.level);
        const s = out.get(b.id) ?? { band: b.id, fires: 0, failures: 0, expectedFailures: 0, slips: 0, slipTicks: 0, fresh: 0, startTick: null, endTick: null };
        s.fires++;
        s.failures += e.failures;
        const p = rollChance(e.level);
        s.expectedFailures = +(s.expectedFailures + (1 - p) / p).toFixed(3);
        if (e.slip > 0) {
            s.slips++;
            s.slipTicks += e.slip;
        }
        if (e.fresh) s.fresh++;
        s.startTick ??= e.gap === null ? e.tick : e.tick - e.gap;
        s.endTick = e.tick;
        out.set(b.id, s);
    }
    return [...out.values()];
}

/**
 * The line's modelled length for the rolls this run actually had: 3 ticks to the first roll after
 * the first attempt, 4 per roll after it, and the success seen 1 tick after its roll. The
 * overhead the lab gate prices is the run's total less this.
 */
export function modelledLine(fires: number, failures: number): number {
    return fires === 0 ? 0 : 3 + 4 * (fires + failures - 1) + 1;
}

// ------------------------------------------------------------------ the step

function note(ctx: StepContext<any>, step: string, meta: Record<string, unknown>, startTick: number, endTick = startTick): void {
    const row: TickRow = {
        v: 1, kind: 'program', runId: ctx.log.runId, account: ctx.session.name, sessionId: ctx.session.sessionId, step,
        startTick, endTick, ticks: Math.max(0, endTick - startTick), wallMs: 0, ok: true, meta, tickMs: tickMs(), at: new Date().toISOString()
    };
    ctx.log.append(row);
}

type LightSdk = StepContext<any>['sdk'];

/** The ground item's op 4 ("Light"). The SDK keeps its dispatch private and has no wrapper for it. */
export function lightGroundItem(sdk: LightSdk, l: { x: number; z: number; itemId: number }): Promise<ActionResult> {
    return (sdk as unknown as { sendAction(a: unknown): Promise<ActionResult> }).sendAction({ type: 'interactGroundItem', x: l.x, z: l.z, itemId: l.itemId, optionIndex: 4, reason: 'firemaking' });
}

/**
 * One trade refill: the next `capacity` logs of the route from the current xp (at most the free
 * slots), received from the giver with lib/trade.ts `receiveFrom`. Logged as a `refill` row.
 */
async function refill(ctx: StepContext<any>, o: Resolved, k: number, capacity: number): Promise<{ state: BotWorldState; ticks: number; logs: number }> {
    const { sdk } = ctx;
    const s0 = sdk.getState();
    if (!s0) throw new Error('firemaking: no state');
    const n = Math.min(capacity, INVENTORY - s0.inventory.length);
    if (n < 1) throw new Error('firemaking: no free slot for a refill');
    const pkg = packageOf(routeLogs(fmXp(s0), o.toLevel).slice(0, n));
    const want: WantSpec[] = pkg.map(p => ({ item: new RegExp(`^${p.name}$`, 'i'), amount: p.n }));
    const r = await receiveFrom(sdk, o.giver!, { want, maxTicks: 60 });
    const s = sdk.getState() ?? s0;
    note(ctx, `${o.id} refill`, { k, ok: r.ok, ticks: r.ticks, want: pkg, received: r.received.map(i => ({ name: i.name, n: i.count })), ...(r.reason ? { reason: r.reason } : {}) }, s0.tick, s.tick);
    if (!r.ok) throw new Error(`firemaking: refill ${k} from the trade giver failed: ${r.reason ?? 'unknown'}`);
    return { state: s, ticks: r.ticks, logs: pkg.reduce((a, p) => a + p.n, 0) };
}

export interface RowResult {
    fires: number;
    failures: number;
    expectedFailures: number;
    startTick: number;
    endTick: number;
    events: LightEvent[];
}

/**
 * Light the row until `toLevel`, logging a row per fire, per band and per event, then a summary.
 * With `supply: 'trade'` the Lighter lights held logs, and the loop refills from the giver whenever
 * none is left (a `refill` row each, and `refills`/`refillTicks` in the summary).
 */
export async function lightRow(ctx: StepContext<any>, o: Resolved): Promise<RowResult> {
    const { sdk } = ctx;
    let s = sdk.getState();
    if (!s) throw new Error('firemaking: no state');
    const trade = o.supply === 'trade';
    const L = new Lighter(o.tiles, s, trade ? { ...o, source: 'held' } : o);
    const capacity = o.capacity ?? defaultCapacity(s.inventory);
    let refills = 0;
    let refillTicks = 0;
    const id = o.id;
    let logged = 0;
    let lastFireTick = s.tick;
    let band = bandFor(fmLevel(s));
    const flush = () => {
        for (; logged < L.events.length; logged++) {
            const e = L.events[logged]!;
            if (e.kind === 'fire') {
                note(ctx, `${id} fire`, { ...e, tile: [...e.tile] }, e.gap === null ? lastFireTick : e.tick - e.gap, e.tick);
                lastFireTick = e.tick;
            } else note(ctx, `${id} ${e.kind}`, { ...e, ...('tile' in e ? { tile: [...e.tile] } : {}) }, e.kind === 'nolog' ? e.from : e.tick, e.tick);
        }
    };
    const closeBand = (b: Band, endTick: number) => {
        const sum = summarizeBands(L.events).find(x => x.band === b.id);
        if (sum) note(ctx, `${id} ${b.id}`, { ...sum }, sum.startTick ?? endTick, endTick);
    };
    let ended = 'done';
    let failure: unknown;
    try {
        while (fmLevel(s) < o.toLevel) {
            const d = L.onTick(s);
            if (d.dismiss) void sdk.sendClickDialog(0).catch(() => {});
            if (d.light) void lightGroundItem(sdk, d.light).catch(() => {});
            if (d.walk) void sdk.sendWalk(d.walk[0], d.walk[1], true).catch(() => {});
            if (d.use) void sdk.sendUseItemOnItem(d.use.tinderbox, d.use.log).catch(() => {});
            flush();
            const lvl = fmLevel(s);
            if (bandFor(lvl).id !== band.id) {
                closeBand(band, s.tick);
                band = bandFor(lvl);
            }
            if (trade && L.outOfLogs(s)) {
                const r = await refill(ctx, o, refills, capacity);
                refills++;
                refillTicks += r.ticks;
                L.refilled();
                s = r.state;
                continue;
            }
            const waited = L.waiting(s.tick);
            if (L.fires === 0 && waited > o.waitForRow) throw new Error(`firemaking: no lightable log on the row within ${o.waitForRow} ticks`);
            if (L.fires > 0 && waited > o.maxGap) throw new Error(`firemaking: nothing to light for ${waited} ticks after ${L.fires} fires (cursor ${L.cursor})`);
            const prev = s.tick;
            const r = await waitUntil(sdk, st => st.tick > prev, { maxTicks: 20, after: prev });
            if (!r.ok || !r.state) throw new Error(`firemaking: no state from the client for 20 ticks after tick ${prev}`);
            s = r.state;
        }
        // The tick the target level is seen: take this tick's success into the log, and stop.
        L.onTick(s);
    } catch (e) {
        failure = e;
        ended = e instanceof Error ? e.message : String(e);
    }
    // The summary is written on a give-up too, so a stopped attempt leaves its whole record.
    flush();
    closeBand(band, s.tick);
    const bands = summarizeBands(L.events);
    const failures = bands.reduce((a, b) => a + b.failures, 0);
    const expectedFailures = +bands.reduce((a, b) => a + b.expectedFailures, 0).toFixed(2);
    const fireEvents = L.events.filter(e => e.kind === 'fire');
    const count = (k: LightEvent['kind']) => L.events.filter(e => e.kind === k).length;
    const line = modelledLine(L.fires, failures);
    const total = s.tick - L.startTick;
    note(ctx, `${id} summary`, {
        ended, fires: L.fires, failures, expectedFailures, line, overhead: total - line,
        firstAttemptTick: L.firstAttemptTick, firstSuccessTick: L.firstSuccessTick,
        fixedTicks: L.firstAttemptTick === null ? null : L.firstAttemptTick - L.startTick,
        slips: fireEvents.filter(e => e.slip > 0).length, slipTicks: fireEvents.reduce((a, e) => a + e.slip, 0),
        fresh: fireEvents.filter(e => e.fresh).length, inferred: fireEvents.filter(e => e.inferred).length,
        sends: Object.fromEntries([0, 1, 2, 3].map(k => [`R+${k + 2}`, fireEvents.filter(e => e.send === k).length]).concat([['later', fireEvents.filter(e => (e.send ?? 0) > 3).length]])),
        lost: count('lost'), refused: count('refused'), skips: count('skip'), resends: L.resends, nolog: count('nolog'),
        nologTicks: L.events.reduce((a, e) => a + (e.kind === 'nolog' && !e.first ? e.ticks : 0), 0),
        dismissed: L.dismissed, endLevel: fmLevel(s), endXp: fmXp(s),
        ...(trade ? { supply: 'trade', capacity, refills, refillTicks } : {})
    }, L.startTick, s.tick);
    if (failure !== undefined) throw failure;
    return { fires: L.fires, failures, expectedFailures, startTick: L.startTick, endTick: s.tick, events: L.events };
}

export function precheck(s: BotWorldState, o: Resolved): true | string {
    if (o.supply === 'bank') return `supply '${o.supply}' not built`;
    if (fmLevel(s) >= o.toLevel) return true;
    if (!s.inGame || !s.player) return 'not in game';
    if (!s.inventory.some(i => /^tinderbox$/i.test(i.name))) return 'no tinderbox';
    if (!o.tiles.length) return 'no planned tiles (the tiles option)';
    const entry = o.entry!;
    const d = cheb(here(s), entry);
    if (d > o.near) return `not within ${o.near} tiles of the row's entry ${entry[0]},${entry[1]} (${d} away)`;
    // The row lights logs where they lie and picks nothing up, so it needs no free slot. A trade
    // refill needs `capacity` slots (default S03_REFILL) beside the non-log items held; held logs
    // are lit before it.
    if (o.supply === 'trade') {
        if (!o.giver) return "supply 'trade' needs the giver option (the trade giver's name)";
        const other = s.inventory.filter(i => !tierOf(i.name));
        const need = o.capacity ?? S03_REFILL;
        if (INVENTORY - other.length < need) return `${other.length} other items (${[...new Set(other.map(i => i.name))].join(', ')}): need ${need} free slots`;
    }
    return true;
}

export function steps(raw: FiremakingOptions = {}): Step<any>[] {
    const o = resolveOptions(raw);
    const runIt = async (ctx: StepContext<any>) => {
        if (fmLevel(ctx.sdk.getState()) >= o.toLevel) return;
        await lightRow(ctx, o);
    };
    return [
        {
            name: o.id,
            preconditions: s => precheck(s, o),
            run: runIt,
            postconditions: s => (fmLevel(s) >= o.toLevel ? true : `Firemaking ${fmLevel(s)}, below ${o.toLevel}`),
            logoutSafe: true,
            done: ({ state }) => fmLevel(state) >= o.toLevel,
            inProgress: ({ state }) => fmLevel(state) > 1 && fmLevel(state) < o.toLevel,
            resume: runIt
        }
    ];
}
