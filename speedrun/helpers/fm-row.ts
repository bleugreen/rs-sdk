// fm-row (role): H6, the log-row dropper for SCORED's S03 Firemaking. It drops the
// route's 157 logs (logs 2, oak 4, willow 7, maple 13, yew 24, magic 107;
// docs/speedrun/skills/firemaking.md section 7) one per tile along the snake the
// scored account lights with the ground op, in row order, each paced so that it
// turns public just before SCORED can want it. Contract and measurements:
// docs/speedrun/helpers/fm-row.md.
//
// The rule it paces around. A player's drop is private to the dropper for
// REVEAL_TICKS (World.ts addObj, NODE_OBJ_REVEAL_TICKS) and gone after
// DROP_LIFETIME (drop.rs2, lootdrop_duration x 3/2). So log i has to leave the
// dropper's hands at least REVEAL_TICKS before SCORED reaches it (else SCORED
// waits on a log it cannot see), and should not leave much earlier (anyone may take
// a public log). SCORED lights one log per 4-tick roll, chained (firemaking.md
// section 4): after the success of log i-1 it wants log i at once. The dropper
// sees each success as a fire on that log's tile, so it always knows how far SCORED
// has got, and every later log is wanted no sooner than one roll per log after
// that. Failed rolls only push SCORED later, so pacing on the no-failure bound is
// never late; it reveals a log early only by the failed rolls between the drop and
// the light (none from level 43, which comes after the 25th log).
//
// Inventories. The dropper carries 28 logs, so it restocks five times. Log j of an
// inventory that is followed by a restock is dropped early enough that the restock
// (restockTicks) still ends before the next inventory's first log is due
// (dropTarget). With `parts` > 1 several droppers share the row, inventory k going
// to part k % parts, so each has (parts - 1) inventories of SCORED's time for its
// bank trip.
//
// Role options (ROLE_OPTIONS):
//   row          { x, z, len, rows }: the snake (firemaking-line.ts --row/--rows), default LAB_ROW
//   tiles        [[x, z], ...] in place of row: the tiles in lighting order, cycled (row and tiles together are an error)
//   logs         [{obj, n}, ...] in lighting order, in place of the route's 157 (S03_LOGS): each obj one of its
//                  tiers, n >= 1; e.g. [{obj: 'logs', n: 20}] for a demo row of normal logs
//   part, parts  this dropper's share of the inventories (default 0 of 1)
//   skipOccupied a planned tile with a fire or a ground item (not ashes) on it takes no log; the log
//                  goes on the next free tile of its inventory's block (default false). A fire seen
//                  lit at F does not count for a log needed at F + FIRE_OUT_TICKS or later
//   spareTiles   empty tiles after each inventory's 28 for those skips (skipOccupied only;
//                  default 2 when parts > 1, else 0)
//   start        'now' | 'sighted' | 'cue' (default 'sighted'): when log 0's 100 ticks start
//                  now: at once; sighted: when SCORED (scoredSha256, else the cue's receiver
//                  hash) is within sightRange; cue: when <cueDir>/fm-row-go.json is written
//   cueAt        'seen' | 'written' (start cue only; default 'seen'): count from the tick the go
//                  file is seen, or from its ms for a dropper that logs in late, at the tick period
//                  it observed (cuePeriod)
//   tickMs       nominal ms per server tick, cueAt 'written''s last fallback (default wait.ts tickMs())
//   scoredSha256 sha-256 of SCORED's canonical name (altar-cue.ts nameHash); never its name
//   sightRange   default 15
//   restock      { kind: 'bank' | 'cheat' | 'held', bank?: {x,z} } (cheat: local lab only; bank default
//                  Falador east; held: logs in carrying its one inventory and never restocks)
//   lead         ticks between a log turning public and SCORED's earliest want of it,
//                  beyond the drop's own 1-tick latency (default 4)
//   restockTicks a restock's round trip, row to row (default 6 cheat; bank: distance + 20)
//   dropTicks    ticks per drop when catching up (default 2)
//   scanRadius   tiles scanned for SCORED's fires when they are out of the state's 15 (default 32)
//   lingerTicks  after the last drop, how long to watch for SCORED to light it (default 400)
//   cueDir       default RC_CUE_DIR, else run-machine/rc-cue in the checkout
import { join } from 'node:path';
import type { BotWorldState, GroundItem, NearbyLoc } from '../../sdk/types';
import { withdrawMany } from '../lib/bank';
import { feedTickPeriod, tickMs as defaultTickMs, TickPeriod, waitUntil } from '../lib/wait';
import { cueDir, nameHash, readJson, type Cue } from './altar-cue';
import { chebyshev, cheat, isLocalServer, labTele, pos, type Tile } from './altar-room';
import { closeBank, depositAllExcept, ensureOutOfTutorial, openBank, walkNear } from './mule';
import { runStandalone, type Role, type RoleContext } from './role';

/** A drop stays private to its dropper this long (World.ts addObj; NODE_OBJ_REVEAL_TICKS, default 100). */
export const REVEAL_TICKS = 100;
/** A player's drop despawns this long after it lands (drop.rs2: lootdrop_duration 200 x 3/2). */
export const DROP_LIFETIME = 300;
/** One lighting roll, chained (firemaking.rs2: success and failure both set map_clock + 4). */
export const ROLL_TICKS = 4;
export const INVENTORY = 28;
/** A fire is gone this long after it is lit (firemaking.rs2: loc_add for 100 + random(100) ticks, so 100-199). */
export const FIRE_OUT_TICKS = 200;

export interface Tier {
    /** Debug name for ::give. */
    obj: string;
    /** Display name, as the inventory and the ground report it. */
    name: string;
    n: number;
}

/** The route's logs in lighting order, highest tier unlocked (firemaking.md section 7). */
export const S03_LOGS: readonly Tier[] = [
    { obj: 'logs', name: 'Logs', n: 2 },
    { obj: 'oak_logs', name: 'Oak logs', n: 4 },
    { obj: 'willow_logs', name: 'Willow logs', n: 7 },
    { obj: 'maple_logs', name: 'Maple logs', n: 13 },
    { obj: 'yew_logs', name: 'Yew logs', n: 24 },
    { obj: 'magic_logs', name: 'Magic logs', n: 107 }
];
export const S03_TOTAL = S03_LOGS.reduce((n, t) => n + t.n, 0);

/** A snake: row 0 runs west from (x, z) over `len` tiles, row 1 (z - 1) back east, and so on, repeating after `rows`. */
export interface Row {
    x: number;
    z: number;
    len: number;
    rows: number;
}

/**
 * The confirmed lab row south of Falador east bank (firemaking.md section 4: z=3362 and
 * z=3361 clear for 27 tiles). The run's row beside the Lumbridge chicken coop
 * (SUPPLIES.md H2) is not confirmed yet; pass it as `row` once it is.
 */
export const LAB_ROW: Row = { x: 3019, z: 3362, len: 27, rows: 2 };
export const FALADOR_EAST_BANK: Tile = { x: 3013, z: 3357 };

/** The i-th tile of the snake, as firemaking-line.ts lights it. */
export function snakeTile(row: Row, i: number): Tile {
    const r = Math.floor(i / row.len) % row.rows;
    const k = i % row.len;
    return { x: r % 2 === 0 ? row.x - k : row.x - row.len + 1 + k, z: row.z - r };
}

/** Where the logs go: a snake (`row`), or an explicit list of tiles (`tiles`) walked in order and cycled. */
export type Path = Row | readonly Tile[];

const isList = (p: Path): p is readonly Tile[] => Array.isArray(p);

/** The tile at `slot` along the path. */
export function pathTile(path: Path, slot: number): Tile {
    return isList(path) ? path[slot % path.length]! : snakeTile(path, slot);
}

export interface PlannedLog {
    i: number;
    /** Its planned tile's index along the path. */
    slot: number;
    tile: Tile;
    tier: Tier;
}

/** Inventory k carries logs 28k .. 28k + 27. */
export const inventoryOf = (i: number): number => Math.floor(i / INVENTORY);

/** Log i's planned slot: inventory k's 28 logs take slots k(28 + spareTiles) on, and its spares follow them. */
export const primarySlot = (i: number, spareTiles = 0): number => inventoryOf(i) * (INVENTORY + spareTiles) + (i % INVENTORY);

export function rowPlan(path: Path, tiers: readonly Tier[] = S03_LOGS, spareTiles = 0): PlannedLog[] {
    const plan: PlannedLog[] = [];
    for (const tier of tiers)
        for (let n = 0; n < tier.n; n++) {
            const i = plan.length;
            const slot = primarySlot(i, spareTiles);
            plan.push({ i, slot, tile: pathTile(path, slot), tier });
        }
    return plan;
}

export interface PlannedTile {
    slot: number;
    tile: Tile;
    inventory: number;
    /** The dropper that carries this block. */
    part: number;
    /** The log planned here; null on a spare. */
    log: number | null;
}

/** The planned layout, tile by tile: each inventory's block is its logs, then `spareTiles` spares. */
export function plannedTiles(path: Path, parts: number, spareTiles: number, logs = S03_TOTAL): PlannedTile[] {
    const out: PlannedTile[] = [];
    for (let k = 0; k * INVENTORY < logs; k++) {
        const n = Math.min(INVENTORY, logs - k * INVENTORY);
        const first = k * (INVENTORY + spareTiles);
        for (let m = 0; m < n + spareTiles; m++)
            out.push({ slot: first + m, tile: pathTile(path, first + m), inventory: k, part: k % parts, log: m < n ? k * INVENTORY + m : null });
    }
    return out;
}

/**
 * The fewest logs between two logs on one tile: on a cycled path, the next log on a tile is
 * lit that many rolls after the last one. Below FIRE_OUT_TICKS / ROLL_TICKS (50) the lighter
 * can reach a tile while its last fire still burns. Spares shorten it: a 51-tile lap with
 * spareTiles 2 comes round in 47 logs on some tiles. Null when no tile comes round.
 */
export function shortestRevisit(layout: readonly PlannedTile[]): number | null {
    const last = new Map<string, number>();
    let min: number | null = null;
    for (const t of layout) {
        if (t.log === null) continue;
        const prev = last.get(tileKey(t.tile));
        if (prev !== undefined) min = Math.min(min ?? Number.POSITIVE_INFINITY, t.log - prev);
        last.set(tileKey(t.tile), t.log);
    }
    return min;
}

/**
 * The last slot a skip may push log i to: its block's last spare. A skip never crosses
 * into the next block when parts > 1, because the next block's dropper cannot see our
 * private log there. One dropper sees all its own logs, so with parts = 1 there is no limit
 * and a skip shifts the later logs on.
 */
export function blockLast(i: number, planLength: number, spareTiles: number, parts: number): number {
    if (parts === 1) return Number.POSITIVE_INFINITY;
    const k = inventoryOf(i);
    return k * (INVENTORY + spareTiles) + Math.min(INVENTORY, planLength - k * INVENTORY) + spareTiles - 1;
}

/** The first free slot from `from` to `last`. With none free the log goes on `last` anyway (`full`). */
export function placeSlot(from: number, last: number, occupied: (slot: number) => boolean): { slot: number; full: boolean } {
    const end = Math.min(last, from + 2 * INVENTORY);
    for (let s = from; s <= end; s++) if (!occupied(s)) return { slot: s, full: false };
    return { slot: end, full: true };
}

const ASHES = /^ashes$/i;
const FIRE = /^fire$/i;

/**
 * A tile a skip-occupied drop avoids: a fire on it, or any ground item except ashes. A
 * burnt-out fire leaves ashes for 100 ticks (firemaking.rs2), so on a 50-tile lap our own
 * ashes often lie on the next lap's tiles, and they do not stop a light. `fireOut`: the fire
 * on t is sure to be out before the log is lit (`fireOutBy`), so it does not count.
 */
export function occupied(
    t: Tile,
    locs: readonly Pick<NearbyLoc, 'name' | 'x' | 'z'>[],
    ground: readonly Pick<GroundItem, 'name' | 'x' | 'z'>[],
    fireOut = false
): boolean {
    return (!fireOut && locs.some(l => l.x === t.x && l.z === t.z && FIRE.test(l.name))) || ground.some(g => g.x === t.x && g.z === t.z && !ASHES.test(g.name));
}

/**
 * Whether a fire first seen lighting at `seen` (FireLedger.freshSince) is out by `need`, the
 * earliest tick its tile's next log can be lit. On a lapped row a log goes down about 105 ticks
 * before it is lit, while the last lap's fire on its tile is only about 100 ticks old and burns
 * up to 199. A fire whose start was not seen (null) may be any age, so it is never known out.
 */
export function fireOutBy(seen: number | null, need: number): boolean {
    return seen !== null && need >= seen + FIRE_OUT_TICKS;
}

/** The row indexes this dropper drops: every log of the inventories k with k % parts === part, in order. */
export function ownLogs(planLength: number, part: number, parts: number): number[] {
    const own: number[] = [];
    for (let i = 0; i < planLength; i++) if (inventoryOf(i) % parts === part) own.push(i);
    return own;
}

/** What to carry for own logs from[cursor] up to the end of that log's inventory: [tier, count] in row order. */
export function loadFor(plan: readonly PlannedLog[], own: readonly number[], cursor: number): Array<{ tier: Tier; n: number }> {
    const out: Array<{ tier: Tier; n: number }> = [];
    const k = inventoryOf(own[cursor]!);
    for (let c = cursor; c < own.length && inventoryOf(own[c]!) === k; c++) {
        const tier = plan[own[c]!]!.tier;
        const last = out.at(-1);
        if (last && last.tier === tier) last.n++;
        else out.push({ tier, n: 1 });
    }
    return out;
}

// ------------------------------------------------------------------ SCORED's progress

export interface Progress {
    /** Logs SCORED has lit, in row order; log `lit` is the one it lights next. */
    lit: number;
    /** The tick (this client's) on which log lit - 1 was first seen burning; null before the first. */
    litTick: number | null;
}

export const NO_PROGRESS: Progress = { lit: 0, litTick: null };

/**
 * Move past every consecutive log whose tile is burning. `mayCount(i)` says whether
 * log i can have been lit at all (it has been dropped); it keeps a stray fire on a
 * tile from counting before its log is down.
 */
export function advance(p: Progress, plan: readonly PlannedLog[], burning: (t: Tile) => boolean, mayCount: (i: number) => boolean, tick: number): Progress {
    let lit = p.lit;
    while (lit < plan.length && mayCount(lit) && burning(plan[lit]!.tile)) lit++;
    return lit === p.lit ? p : { lit, litTick: tick };
}

const tileKey = (t: Tile) => `${t.x},${t.z}`;

/**
 * Fires by tile, for skip-occupied progress. A fire is fresh if its tile was watched with
 * no fire on it before the fire appeared, so a fire already burning when first seen (a
 * foreign one, or one from before arming) never counts. A tile watched clear forgets its
 * fire, so a tile relit on the next lap counts again.
 */
export class FireLedger {
    private readonly tiles = new Map<string, 'clear' | 'stale' | { since: number }>();

    watch(t: Tile, burning: boolean, tick: number): void {
        const k = tileKey(t);
        const r = this.tiles.get(k);
        if (!burning) this.tiles.set(k, 'clear');
        else if (r === 'clear') this.tiles.set(k, { since: tick });
        else if (r === undefined) this.tiles.set(k, 'stale');
    }

    /** The tick a fresh fire on t was first seen; null if t has no fresh fire. */
    freshSince(t: Tile): number | null {
        const r = this.tiles.get(tileKey(t));
        return typeof r === 'object' ? r.since : null;
    }
}

/**
 * Skip-occupied progress: move past every consecutive log whose fire `fireAt` finds,
 * searching from the slot after the last one's fire.
 *
 * @param litSlot  slot of log lit - 1's fire (-1 before the first)
 * @param fireAt   (i, from) => slot of the fire that lit log i, or null
 */
export function advanceFresh(
    p: Progress,
    litSlot: number,
    n: number,
    fireAt: (i: number, from: number) => number | null,
    tick: number
): { progress: Progress; litSlot: number } {
    let lit = p.lit;
    let slot = litSlot;
    for (let s = lit < n ? fireAt(lit, slot + 1) : null; s !== null; s = lit < n ? fireAt(lit, slot + 1) : null) {
        slot = s;
        lit++;
    }
    return { progress: lit === p.lit ? p : { lit, litTick: tick }, litSlot: slot };
}

/**
 * Progress for a dropper that arms after SCORED has started. The fires of the first logs
 * are burnt out by then, so `advance` from log 0 would never move. The frontier is past the
 * highest log that burns now together with the log before it (one fire alone may be
 * anyone's), if SCORED can have got that far: log i is lit no sooner than start + a roll per
 * log. That fire was seen by now, so the next log is wanted from the next tick on.
 *
 * @param fireSlot  slot of a fire on log i's tile(s), or null
 */
export function catchUp(n: number, fireSlot: (i: number) => number | null, start: number, now: number): { progress: Progress; litSlot: number } | null {
    for (let i = n - 1; i >= 0; i--) {
        if (start + ROLL_TICKS * (i + 1) > now) continue;
        const s = fireSlot(i);
        if (s !== null && (i === 0 || fireSlot(i - 1) !== null)) return { progress: { lit: i + 1, litTick: now - ROLL_TICKS }, litSlot: s };
    }
    return null;
}

/**
 * The tick (this client's clock) a go file written at `cueMs` stands for, seen at `tick`
 * and `nowMs`: one tick per `tickMs` back from now, and never later than now.
 */
export function cueTick(tick: number, nowMs: number, cueMs: number, tickMs: number): number {
    return tick - Math.max(0, Math.round((nowMs - cueMs) / tickMs));
}

/** A period watched over fewer ms than this is left to the fallbacks (wait.ts TickPeriod.msPerTick). */
export const PERIOD_MIN_SPAN_MS = 20_000;
/**
 * A measured period is held within these. The engine's fixed grid catches up at most two
 * ticks (World.ts), so over 20 s it never runs much faster than 300 ms; a reading slower than
 * twice that is a client that missed frames, not a slow server.
 */
export const TICK_MS_FLOOR = 250;
export const TICK_MS_CEILING = 600;

export type PeriodFrom = 'observed' | 'cue' | 'nominal';

/**
 * The ms per tick a written cue is counted back with: the period this client observed, else
 * the one the go file's writer observed (its `tickMs`), else the nominal `tickMs` option. The
 * nominal one is only right on a server that keeps time; the demo has run at 340-370 ms.
 */
export function cuePeriod(observed: number | null, written: unknown, nominal: number): { tickMs: number; from: PeriodFrom } {
    const held = (ms: number) => Math.min(TICK_MS_CEILING, Math.max(TICK_MS_FLOOR, ms));
    if (observed !== null) return { tickMs: held(observed), from: 'observed' };
    if (typeof written === 'number' && Number.isFinite(written) && written > 0) return { tickMs: held(written), from: 'cue' };
    return { tickMs: nominal, from: 'nominal' };
}

/**
 * The earliest tick on which SCORED can want log i in view (the tick it sees the
 * success of log i - 1 and sends the next light). `start` is the tick log 0 is due:
 * the trigger, plus the drop's tick, plus REVEAL_TICKS. Nothing is lit by `now`
 * beyond what `p` says, so the next success is at least a roll after the last one
 * and at least a tick from now; each later log is one more roll. Lower bounds, so a
 * drop paced on them is never late.
 */
export function needTick(p: Progress, i: number, now: number, start: number): number {
    if (i < p.lit) return Number.NEGATIVE_INFINITY;
    const anchor = p.litTick ?? start;
    if (i === p.lit) return anchor;
    const next = Math.max(anchor + ROLL_TICKS, now + 1);
    return next + ROLL_TICKS * (i - p.lit - 1);
}

export interface Pace {
    reveal: number;
    lead: number;
    restockTicks: number;
    dropTicks: number;
}

/** The last tick on which a drop decision still turns the log public `lead` ticks before `need` (the drop lands a tick after the decision). */
export function latestDrop(need: number, o: Pick<Pace, 'reveal' | 'lead'>): number {
    return need - o.reveal - o.lead - 1;
}

/** A drop decided before this turns the log public more than `reveal` ticks before SCORED can want it. */
export function earliestDrop(need: number, o: Pick<Pace, 'reveal'>): number {
    return need - 2 * o.reveal - 1;
}

/**
 * When to drop own log j: as late as `latestDrop`, unless a restock follows its
 * inventory. Then the inventory's last log must be down `restockTicks` before the
 * next own inventory's first log is due, and each earlier log `dropTicks` before
 * the one after it.
 *
 * @param invLast  the last own log of j's inventory
 * @param nextOwn  the first own log after the restock, or null when none follows
 */
export function dropTarget(j: number, invLast: number, nextOwn: number | null, need: (i: number) => number, o: Pace): number {
    let t = latestDrop(need(j), o);
    if (nextOwn !== null) {
        const leave = latestDrop(need(nextOwn), o) - o.restockTicks;
        t = Math.min(t, leave - o.dropTicks * (invLast - j));
    }
    return t;
}

/**
 * The longest restock round trip `parts` droppers can afford. Two limits: each
 * dropper has `parts` inventories of SCORED's time (28 rolls each) to restock and
 * drop its next 28 logs; and the last log before a restock is pulled forward by
 * the trip, which must not make it public more than `reveal` ticks early.
 */
export function maxRestockTicks(parts: number, o: Pick<Pace, 'reveal' | 'lead' | 'dropTicks'>): number {
    const perInventory = INVENTORY * ROLL_TICKS;
    return Math.min(parts * perInventory - INVENTORY * o.dropTicks, o.reveal + (parts - 1) * perInventory + ROLL_TICKS - o.lead);
}

/**
 * The first own log to drop on a (re)start: after the last own log already lying on its tile.
 * `carried` (a held dropper: how many of a tier it holds) comes first: a dropper still holding
 * its whole own load has dropped nothing, so it starts at 0. On a lapped row its tiles are
 * shared with other inventories, and the logs lying on them are other droppers' drops.
 */
export function resumeCursor(
    plan: readonly PlannedLog[],
    own: readonly number[],
    ground: readonly Pick<GroundItem, 'name' | 'x' | 'z'>[],
    carried?: (tier: Tier) => number
): number {
    if (carried && loadFor(plan, own, 0).every(l => carried(l.tier) >= l.n)) return 0;
    const lying = (l: PlannedLog) => ground.some(g => g.x === l.tile.x && g.z === l.tile.z && g.name.toLowerCase() === l.tier.name.toLowerCase());
    for (let c = own.length - 1; c >= 0; c--) if (lying(plan[own[c]!]!)) return c + 1;
    return 0;
}

// ------------------------------------------------------------------ options

export type StartMode = 'now' | 'sighted' | 'cue';
export type CueAt = 'seen' | 'written';
export type RestockKind = 'bank' | 'cheat' | 'held';
export const GO_FILE = 'fm-row-go.json';

/** The go file. `tickMs`: the writer's observed ms per tick (wait.ts tickPeriod), if it measured one. */
export interface GoCue {
    v: 1;
    ms: number;
    tickMs?: number;
}

export interface FmRowOptions extends Pace {
    row: Row;
    /** In place of `row` when given. */
    tiles: Tile[] | null;
    /** The logs in lighting order (default S03_LOGS, the route). */
    logs: readonly Tier[];
    part: number;
    parts: number;
    skipOccupied: boolean;
    spareTiles: number;
    start: StartMode;
    cueAt: CueAt;
    tickMs: number;
    scoredSha256: string | null;
    sightRange: number;
    restock: { kind: RestockKind; bank: Tile };
    scanRadius: number;
    lingerTicks: number;
    cueDir: string;
}

const int = (v: unknown, def: number, what: string, min = 0): number => {
    const n = v === undefined ? def : Number(v);
    if (!Number.isInteger(n) || n < min) throw new Error(`${what} must be an integer >= ${min} (got ${v})`);
    return n;
};

function tileList(v: unknown): Tile[] {
    if (!Array.isArray(v) || v.length === 0) throw new Error('tiles must be a non-empty list of [x, z]');
    return v.map((t: unknown, n) => {
        if (!Array.isArray(t) || t.length !== 2) throw new Error(`tiles[${n}] must be [x, z] (got ${JSON.stringify(t)})`);
        return { x: int(t[0], NaN, `tiles[${n}].x`), z: int(t[1], NaN, `tiles[${n}].z`) };
    });
}

/** The `logs` option: tiers of S03_LOGS by debug name, each with a count, in lighting order. */
function logList(v: unknown): Tier[] {
    if (!Array.isArray(v) || v.length === 0) throw new Error('logs must be a non-empty list of {obj, n}');
    return v.map((e: unknown, k) => {
        const o = (e ?? {}) as Record<string, unknown>;
        const tier = S03_LOGS.find(t => t.obj === o.obj);
        if (!tier) throw new Error(`logs[${k}].obj must be one of ${S03_LOGS.map(t => t.obj).join(', ')} (got ${JSON.stringify(o.obj)})`);
        return { obj: tier.obj, name: tier.name, n: int(o.n, NaN, `logs[${k}].n`, 1) };
    });
}

export function fmRowOptions(raw: Record<string, unknown>, env: Record<string, string | undefined> = process.env): FmRowOptions {
    if (raw.row !== undefined && raw.tiles !== undefined) throw new Error('give row or tiles, not both');
    const r = (raw.row ?? LAB_ROW) as Record<string, unknown>;
    const row: Row = { x: int(r.x, NaN, 'row.x'), z: int(r.z, NaN, 'row.z'), len: int(r.len, NaN, 'row.len', 1), rows: int(r.rows, 2, 'row.rows', 1) };
    const tiles = raw.tiles === undefined ? null : tileList(raw.tiles);
    const logs: readonly Tier[] = raw.logs === undefined ? S03_LOGS : logList(raw.logs);
    const total = logs.reduce((n, t) => n + t.n, 0);
    const parts = int(raw.parts, 1, 'parts', 1);
    const part = int(raw.part, 0, 'part');
    if (part >= parts) throw new Error(`part must be below parts (got ${part} of ${parts})`);
    const skip = raw.skipOccupied ?? false;
    if (typeof skip !== 'boolean') throw new Error(`skipOccupied must be true or false (got ${raw.skipOccupied})`);
    if (raw.spareTiles !== undefined && !skip) throw new Error('spareTiles is for skipOccupied only');
    const spareTiles = int(raw.spareTiles, skip && parts > 1 ? 2 : 0, 'spareTiles');
    const start = (raw.start ?? 'sighted') as StartMode;
    if (!['now', 'sighted', 'cue'].includes(start)) throw new Error(`start must be now, sighted or cue (got ${raw.start})`);
    const cueAt = (raw.cueAt ?? 'seen') as CueAt;
    if (cueAt !== 'seen' && cueAt !== 'written') throw new Error(`cueAt must be seen or written (got ${raw.cueAt})`);
    if (cueAt === 'written' && start !== 'cue') throw new Error("cueAt 'written' needs start 'cue'");
    const tickMs = raw.tickMs === undefined ? defaultTickMs(env) : Number(raw.tickMs);
    if (!Number.isFinite(tickMs) || tickMs <= 0) throw new Error(`tickMs must be a positive number (got ${raw.tickMs})`);
    const sha = raw.scoredSha256 === undefined ? null : String(raw.scoredSha256);
    if (sha !== null && !/^[0-9a-f]{64}$/.test(sha)) throw new Error('scoredSha256 must be a sha-256 hex digest (altar-cue.ts nameHash), never the name');
    const rs = (raw.restock ?? {}) as Record<string, unknown>;
    const kind = (rs.kind ?? 'bank') as RestockKind;
    if (kind !== 'bank' && kind !== 'cheat' && kind !== 'held') throw new Error(`restock.kind must be bank, cheat or held (got ${kind})`);
    if (kind === 'held') {
        const inventories = new Set(ownLogs(total, part, parts).map(inventoryOf)).size;
        if (inventories !== 1)
            throw new Error(`restock held carries one inventory, but part ${part} of ${parts} owns ${inventories} (parts must be ${Math.ceil(total / INVENTORY)})`);
    }
    if (ownLogs(total, part, parts).length === 0)
        throw new Error(`part ${part} of ${parts} owns no logs: ${total} logs are ${Math.ceil(total / INVENTORY)} inventories of ${INVENTORY}`);
    const bank = rs.bank ? { x: int((rs.bank as Tile).x, NaN, 'restock.bank.x'), z: int((rs.bank as Tile).z, NaN, 'restock.bank.z') } : FALADOR_EAST_BANK;
    const restockDefault = kind === 'cheat' ? 6 : kind === 'held' ? 0 : chebyshev(bank, tiles?.[0] ?? row) + 20;
    return {
        row,
        tiles,
        logs,
        part,
        parts,
        skipOccupied: skip,
        spareTiles,
        start,
        cueAt,
        tickMs,
        scoredSha256: sha,
        sightRange: int(raw.sightRange, 15, 'sightRange'),
        restock: { kind, bank },
        reveal: int(raw.reveal, REVEAL_TICKS, 'reveal', 1),
        lead: int(raw.lead, 4, 'lead'),
        restockTicks: int(raw.restockTicks, restockDefault, 'restockTicks'),
        dropTicks: int(raw.dropTicks, 2, 'dropTicks', 1),
        scanRadius: int(raw.scanRadius, 32, 'scanRadius', 1),
        lingerTicks: int(raw.lingerTicks, 400, 'lingerTicks'),
        cueDir: typeof raw.cueDir === 'string' ? raw.cueDir : cueDir(env)
    };
}

// ------------------------------------------------------------------ role

const at = (s: BotWorldState | null, t: Tile) => !!s?.player && s.player.worldX === t.x && s.player.worldZ === t.z;

export class FmRow {
    readonly o: FmRowOptions;
    readonly plan: PlannedLog[];
    readonly own: number[];
    private cursor = 0;
    private progress: Progress = NO_PROGRESS;
    private start = 0;
    private readonly dropped = new Map<number, number>();
    private readonly lost = new Set<number>();
    private walkSent = { tick: -10, x: -1, z: -1 };
    private early = 0;
    private readonly path: Path;
    // skipOccupied only: where own logs actually went, the current log's candidate slot, fires by tile.
    private readonly placed = new Map<number, { slot: number; tick: number }>();
    private candidate: { i: number; slot: number; full: boolean } | null = null;
    private litSlot = -1;
    private readonly ledger = new FireLedger();
    private readonly watchTiles: Tile[] = [];
    // cueAt 'written' only: this client's tick period, watched from construction until the cue is
    // placed on an observed one; and the moment the go file was seen, to place it again from.
    private readonly period = new TickPeriod();
    private stopPeriod = () => {};
    private cue: { seenTick: number; seenMs: number; writtenMs: number; writerTickMs?: number; from: PeriodFrom } | null = null;

    constructor(private readonly ctx: RoleContext) {
        this.o = fmRowOptions(ctx.options);
        if (this.o.cueAt === 'written') {
            this.stopPeriod = feedTickPeriod(ctx.sdk, this.period);
        }
        this.path = this.o.tiles ?? this.o.row;
        this.plan = rowPlan(this.path, this.o.logs, this.o.spareTiles);
        this.own = ownLogs(this.plan.length, this.o.part, this.o.parts);
        if (this.o.skipOccupied) {
            // Every tile a log may land on, with room for one-dropper skips past the layout's end.
            const seen = new Set<string>();
            const end = plannedTiles(this.path, this.o.parts, this.o.spareTiles, this.plan.length).at(-1)!.slot + 2 * INVENTORY;
            for (let s = 0; s <= end; s++) {
                const t = pathTile(this.path, s);
                if (seen.has(tileKey(t))) continue;
                seen.add(tileKey(t));
                this.watchTiles.push(t);
            }
        }
    }

    private isOwn(i: number): boolean {
        return inventoryOf(i) % this.o.parts === this.o.part;
    }

    /** Where log i lies: where it was dropped (skipOccupied), else its planned tile. */
    private tileOf(i: number): Tile {
        const p = this.placed.get(i);
        return p ? pathTile(this.path, p.slot) : this.plan[i]!.tile;
    }

    private get s(): BotWorldState | null {
        return this.ctx.sdk.getState();
    }

    private phase(to: string, data: Record<string, unknown> = {}): void {
        this.ctx.log('phase', { phase: to, ...data });
    }

    private held(tier: Tier) {
        return this.s?.inventory.find(i => i.name.toLowerCase() === tier.name.toLowerCase());
    }

    private heldCount(tier: Tier): number {
        return (this.s?.inventory ?? []).filter(i => i.name.toLowerCase() === tier.name.toLowerCase()).reduce((n, i) => n + i.count, 0);
    }

    async run(): Promise<void> {
        const { ctx, o } = this;
        await ensureOutOfTutorial(ctx);
        await ctx.bot.dismissBlockingUI();
        const first = this.plan[this.own[0]!]!.tile;
        if (process.env.HELPER_LAB_TELE === '1' && chebyshev(pos(this.s), first) > 30) await labTele(ctx, first);

        const room = maxRestockTicks(o.parts, o);
        if (o.restockTicks > room) ctx.log('warning: restocks too slow for this many droppers', { restockTicks: o.restockTicks, max: room, parts: o.parts });
        const revisit = shortestRevisit(plannedTiles(this.path, o.parts, o.spareTiles, this.plan.length));
        if (revisit !== null && ROLL_TICKS * revisit < FIRE_OUT_TICKS)
            ctx.log('warning: a tile comes round before its last fire is surely out', { logs: revisit, ticks: ROLL_TICKS * revisit, fireOut: FIRE_OUT_TICKS, spareTiles: o.spareTiles });
        if (!(await this.resume())) {
            await this.restock();
            await this.goTo(this.plan[this.own[0]!]!.tile);
            this.phase('armed', { start: o.start, part: o.part, parts: o.parts, logs: this.own.length });
            const t = await this.trigger();
            if (t === null) return;
            this.start = this.startOf(t);
            ctx.log('start', { tick: t, logZeroDue: this.start });
        }
        this.phase('dropping');
        let state = this.s!;
        let lastDropTick = state.tick;
        while (!ctx.signal.aborted) {
            const r = await waitUntil(ctx.sdk, st => st.tick > state.tick, { maxTicks: 50 });
            if (!r.ok || !r.state) throw new Error('no state from the client for 50 ticks');
            state = r.state;
            this.refineCue();
            await this.observe(state);
            if (this.cursor >= this.own.length) {
                if (this.progress.lit > this.own.at(-1)! || state.tick - lastDropTick > o.lingerTicks) break;
                continue;
            }
            if (await this.step(state)) lastDropTick = state.tick;
        }
        this.stopPeriod();
        ctx.log('fm-row: finished', { dropped: this.dropped.size, lit: this.progress.lit, lost: [...this.lost], early: this.early });
    }

    /** Log 0 leaves the dropper's hands on the tick after the trigger and turns public REVEAL_TICKS later. */
    private startOf(trigger: number): number {
        return trigger + 1 + this.o.reveal + this.o.lead;
    }

    /** cueAt 'written': the go file's tick at the best period known now (`cuePeriod`), logged as `m`. Once observed, the watch ends. */
    private placeCue(m: 'cue' | 'cue: refined'): number {
        const c = this.cue!;
        const observed = this.period.msPerTick(PERIOD_MIN_SPAN_MS);
        const p = cuePeriod(observed, c.writerTickMs, this.o.tickMs);
        const t = cueTick(c.seenTick, c.seenMs, c.writtenMs, p.tickMs);
        c.from = p.from;
        if (p.from === 'observed') this.stopPeriod();
        this.ctx.log(m, {
            seenTick: c.seenTick,
            seenMs: c.seenMs,
            writtenMs: c.writtenMs,
            tickMs: p.tickMs,
            tickMsFrom: p.from,
            observedTickMs: observed === null ? null : Math.round(observed * 10) / 10,
            writerTickMs: c.writerTickMs ?? null,
            nominalTickMs: this.o.tickMs,
            cueTick: t
        });
        return t;
    }

    /**
     * A dropper that reaches its trigger within PERIOD_MIN_SPAN_MS of starting (a held one
     * logs in at the row) places the cue on a fallback period. Once it has watched the ticks long
     * enough it places it again on the observed one, from the same moment it saw the go file.
     * A nominal period that runs fast places the cue early, so until then it paces early, not late.
     */
    private refineCue(): void {
        if (!this.cue || this.cue.from === 'observed' || this.period.msPerTick(PERIOD_MIN_SPAN_MS) === null) return;
        const was = this.start;
        this.start = this.startOf(this.placeCue('cue: refined'));
        this.ctx.log('start', { logZeroDue: this.start, was });
    }

    /**
     * A restart mid-row (`resumeCursor`): the own logs already down are taken as dropped, and
     * SCORED's progress is relearned from the fires; until then it paces as if SCORED starts now.
     * False on a fresh start, which arms, waits for its trigger and (held) checks its load.
     */
    private async resume(): Promise<boolean> {
        const { ctx, o } = this;
        const ground = await ctx.sdk.scanGroundItems(o.scanRadius).catch(() => [] as GroundItem[]);
        const carried = o.restock.kind === 'held' ? (t: Tier) => this.heldCount(t) : undefined;
        this.cursor = resumeCursor(this.plan, this.own, ground, carried);
        if (this.cursor === 0) return false;
        for (let c = 0; c < this.cursor; c++) {
            this.dropped.set(this.own[c]!, -1);
            if (o.skipOccupied) this.placed.set(this.own[c]!, { slot: this.plan[this.own[c]!]!.slot, tick: -1 });
        }
        this.start = this.s!.tick;
        ctx.log('resume', { cursor: this.cursor, next: this.own[this.cursor] });
        return true;
    }

    private async trigger(): Promise<number | null> {
        const { ctx, o } = this;
        const startedMs = Date.now();
        const sha = o.scoredSha256 ?? readJson<Cue>(join(o.cueDir, 'cue.json'))?.receiver?.sha256 ?? null;
        if (o.start === 'sighted' && !sha) throw new Error('start sighted needs scoredSha256 (or a cue.json with the receiver hash)');
        const go = () => {
            const g = readJson<{ v: number; ms: number }>(join(o.cueDir, GO_FILE));
            return !!g && g.v === 1 && g.ms >= startedMs - 15 * 60_000;
        };
        const fired = (st: BotWorldState) =>
            o.start === 'now' ||
            (o.start === 'sighted' && st.nearbyPlayers.some(p => nameHash(p.name) === sha && chebyshev(pos(st), p) <= o.sightRange)) ||
            (o.start === 'cue' && go());
        let heartbeat = Date.now();
        while (!ctx.signal.aborted) {
            const r = await waitUntil(ctx.sdk, fired, { maxTicks: 100 });
            if (r.ok && o.start === 'cue' && o.cueAt === 'written') {
                // A dropper that logs in after the cue counts from when it was written, not from now,
                // in ticks as long as this client has seen them take (rs/158: timed on observed ticks).
                const g = readJson<GoCue>(join(o.cueDir, GO_FILE))!;
                this.cue = { seenTick: r.tick, seenMs: Date.now(), writtenMs: g.ms, writerTickMs: g.tickMs, from: 'nominal' };
                return this.placeCue('cue');
            }
            if (r.ok) return r.tick;
            if (Date.now() - heartbeat > 60_000) {
                ctx.log('armed: waiting', { start: o.start });
                heartbeat = Date.now();
            }
        }
        return null;
    }

    /** Fires on the next logs' tiles move SCORED's progress on; own logs gone without a fire are reported lost. */
    private async observe(st: BotWorldState): Promise<void> {
        const { o } = this;
        const p = this.progress;
        if (p.lit >= this.plan.length) return;
        const frontier = this.plan[p.lit]!.tile;
        let locs: NearbyLoc[] = st.nearbyLocs;
        let view = 14;
        if (chebyshev(pos(st), frontier) > 14) {
            const scanned = await this.ctx.sdk.scanNearbyLocs(o.scanRadius).catch(() => [] as NearbyLoc[]);
            if (scanned.length > 0) [locs, view] = [scanned, o.scanRadius - 1];
        }
        const burning = (t: Tile) => locs.some(l => l.x === t.x && l.z === t.z && FIRE.test(l.name));
        // An empty loc list is a failed scan, not a view with nothing in it: it must not clear the ledger's tiles.
        if (o.skipOccupied && locs.length > 0) for (const t of this.watchTiles) if (chebyshev(pos(st), t) <= view) this.ledger.watch(t, burning(t), st.tick);
        if (o.cueAt === 'written' && p.lit === 0) {
            const c = catchUp(this.plan.length, i => this.fireSlot(i, burning), this.start, st.tick);
            if (c) {
                [this.progress, this.litSlot] = [c.progress, c.litSlot];
                this.ctx.log('catch-up', { lit: c.progress.lit, slot: c.litSlot, tick: st.tick });
            }
        }
        const from = this.progress;
        if (o.skipOccupied) {
            const r = advanceFresh(from, this.litSlot, this.plan.length, (i, s) => this.freshFireAt(i, s), st.tick);
            [this.progress, this.litSlot] = [r.progress, r.litSlot];
        } else {
            // Another part's logs are not seen while private; their fires are the only sign, so they always count.
            const mayCount = (i: number) => !this.isOwn(i) || this.dropped.has(i);
            this.progress = advance(from, this.plan, burning, mayCount, st.tick);
        }
        const next = this.progress;
        if (next !== p && (Math.floor(next.lit / 10) > Math.floor(p.lit / 10) || next.lit >= this.plan.length)) this.ctx.log('progress', { lit: next.lit, tick: st.tick });
        for (const [i, t] of this.dropped) {
            if (i < this.progress.lit || this.lost.has(i) || t < 0) continue;
            const l = this.plan[i]!;
            const tile = this.tileOf(i);
            if (chebyshev(pos(st), tile) > 14 || burning(tile)) continue;
            if (!st.groundItems.some(g => g.x === tile.x && g.z === tile.z && g.name.toLowerCase() === l.tier.name.toLowerCase())) {
                this.lost.add(i);
                this.ctx.log('lost', { i, tier: l.tier.name, droppedAt: t, tick: st.tick });
            }
        }
    }

    /** For catchUp: the slot of a fire on log i now (skipOccupied: where it was dropped, else anywhere its spares reach). */
    private fireSlot(i: number, burning: (t: Tile) => boolean): number | null {
        const placed = this.placed.get(i);
        if (placed) return burning(pathTile(this.path, placed.slot)) ? placed.slot : null;
        const first = this.plan[i]!.slot;
        const last = this.o.skipOccupied ? Math.min(first + this.o.spareTiles, blockLast(i, this.plan.length, this.o.spareTiles, this.o.parts)) : first;
        for (let s = first; s <= last; s++) if (burning(pathTile(this.path, s))) return s;
        return null;
    }

    /**
     * For advanceFresh: the fresh fire that lit log i. An own log burns where it was
     * dropped, seen at or after the drop. Another part's log lies somewhere from the slot
     * after the last fire (or its planned slot) to its block's end; the first fresh fire there counts.
     */
    private freshFireAt(i: number, from: number): number | null {
        if (this.isOwn(i)) {
            const d = this.placed.get(i);
            if (!d) return null;
            const since = this.ledger.freshSince(pathTile(this.path, d.slot));
            return since !== null && since >= d.tick ? d.slot : null;
        }
        const first = Math.max(from, this.plan[i]!.slot);
        const last = Math.min(blockLast(i, this.plan.length, this.o.spareTiles, this.o.parts), first + 2 * INVENTORY);
        for (let s = first; s <= last; s++) if (this.ledger.freshSince(pathTile(this.path, s)) !== null) return s;
        return null;
    }

    /**
     * skipOccupied: the tile own log j goes on. It starts at its planned slot, or the slot
     * after the previous log where a skip pushed that one on, and moves on past any
     * occupied tile in view, never beyond its block (`blockLast`). A fire it saw lit long
     * enough before log j's need (`fireOutBy`) will be out when j is lit, so it is no skip.
     */
    private chooseTile(j: number, st: BotWorldState): Tile {
        let c = this.candidate;
        if (c?.i !== j) c = this.candidate = { i: j, slot: Math.max(this.plan[j]!.slot, (this.placed.get(j - 1)?.slot ?? -1) + 1), full: false };
        const need = needTick(this.progress, j, st.tick, this.start);
        const inView = (s: number) => {
            const t = pathTile(this.path, s);
            return chebyshev(pos(st), t) <= 14 && occupied(t, st.nearbyLocs, st.groundItems, fireOutBy(this.ledger.freshSince(t), need));
        };
        if (!c.full && inView(c.slot)) {
            const r = placeSlot(c.slot, blockLast(j, this.plan.length, this.o.spareTiles, this.o.parts), inView);
            this.ctx.log(r.full ? 'skip: block full' : 'skip', { i: j, from: c.slot, to: r.slot, tile: pathTile(this.path, r.slot), tick: st.tick });
            [c.slot, c.full] = [r.slot, r.full];
        }
        return pathTile(this.path, c.slot);
    }

    /** One tick of the drop loop. True when a log was dropped. */
    private async step(st: BotWorldState): Promise<boolean> {
        const { ctx, o } = this;
        const j = this.own[this.cursor]!;
        const log = this.plan[j]!;
        const item = this.held(log.tier);
        if (!item) {
            await this.restock();
            return false;
        }
        const tile = o.skipOccupied ? this.chooseTile(j, st) : log.tile;
        if (!at(st, tile)) {
            await this.walk(tile, st.tick);
            return false;
        }
        const now = st.tick;
        const need = (i: number) => needTick(this.progress, i, now, this.start);
        const k = inventoryOf(j);
        let c = this.cursor;
        while (c + 1 < this.own.length && inventoryOf(this.own[c + 1]!) === k) c++;
        const invLast = this.own[c]!;
        const nextOwn = this.own[c + 1] ?? null;
        const target = dropTarget(j, invLast, nextOwn, need, o);
        if (now < target) return false;
        const before = this.heldCount(log.tier);
        await ctx.sdk.sendDropItem(item.slot);
        const r = await waitUntil(ctx.sdk, s2 => this.heldCount(log.tier) < before || s2 !== st && s2.tick > now + 3, { maxTicks: 5, after: now });
        if (!(this.heldCount(log.tier) < before)) {
            ctx.log('drop: not taken', { i: j, tick: r.tick });
            return false;
        }
        const n = need(j);
        const early = now < earliestDrop(n, o);
        if (early) this.early++;
        this.dropped.set(j, now);
        if (o.skipOccupied) this.placed.set(j, { slot: this.candidate!.slot, tick: now });
        this.cursor++;
        const where = o.skipOccupied ? { slot: this.candidate!.slot, tile } : {};
        ctx.log('drop', { i: j, tier: log.tier.name, tick: now, ms: Date.now(), target, need: n, lit: this.progress.lit, ...where, ...(early ? { early } : {}) });
        const after = this.own[this.cursor];
        if (after !== undefined && inventoryOf(after) === k) await this.walk(o.skipOccupied ? this.chooseTile(after, st) : this.plan[after]!.tile, now, true);
        return true;
    }

    private async walk(t: Tile, now: number, force = false): Promise<void> {
        const w = this.walkSent;
        if (!force && w.x === t.x && w.z === t.z && now - w.tick < 3) return;
        if (chebyshev(pos(this.s), t) > 20) {
            await this.goTo(t);
            return;
        }
        this.walkSent = { tick: now, x: t.x, z: t.z };
        await this.ctx.sdk.sendWalk(t.x, t.z, true);
    }

    private async goTo(t: Tile): Promise<void> {
        if (chebyshev(pos(this.s), t) > 3) await walkNear(this.ctx, t.x, t.z, 2);
        for (let attempt = 0; attempt < 5 && !at(this.s, t) && !this.ctx.signal.aborted; attempt++) {
            await this.ctx.sdk.sendWalk(t.x, t.z, true);
            await waitUntil(this.ctx.sdk, st => at(st, t), { maxTicks: 6 });
        }
    }

    /** Carry exactly the logs of the current own inventory, then come back to its next tile. */
    private async restock(): Promise<void> {
        const { ctx, o } = this;
        const load = loadFor(this.plan, this.own, this.cursor);
        const t0 = this.s?.tick ?? 0;
        const has = () => load.every(l => this.heldCount(l.tier) >= l.n);
        if (o.restock.kind === 'held') {
            // A held dropper logs in carrying its inventory and has no bank trip to fall back on.
            const short = load.filter(l => this.heldCount(l.tier) < l.n).map(l => `${l.n} ${l.tier.name} (holds ${this.heldCount(l.tier)})`);
            if (short.length > 0) throw new Error(`restock held: short of ${short.join(', ')}; log in carrying the inventory`);
            ctx.log('held', { inventory: inventoryOf(this.own[this.cursor]!), load: load.map(l => `${l.n} ${l.tier.name}`).join(', ') });
            return;
        }
        this.phase('restock', { inventory: inventoryOf(this.own[this.cursor]!), load: load.map(l => `${l.n} ${l.tier.name}`).join(', ') });
        if (o.restock.kind === 'cheat') {
            if (!isLocalServer()) throw new Error('restock kind cheat is for the local lab only');
            if ((this.s?.inventory.length ?? 0) > 0) {
                await cheat(ctx, '~clearinv inv');
                await waitUntil(ctx.sdk, st => st.inventory.length === 0, { maxTicks: 10 });
            }
            for (const l of load) await cheat(ctx, `give ${l.tier.obj} ${l.n}`);
            if (!(await waitUntil(ctx.sdk, () => has(), { maxTicks: 10 })).ok) throw new Error('staff give did not arrive');
        } else {
            await walkNear(ctx, o.restock.bank.x, o.restock.bank.z, 3);
            if (!(await openBank(ctx))) throw new Error('could not open the bank');
            await depositAllExcept(ctx.sdk);
            const w = await withdrawMany(ctx.sdk, load.map(l => ({ item: new RegExp(`^${l.tier.name}$`, 'i'), n: l.n })));
            await closeBank(ctx);
            if (!w.ok || !has()) throw new Error(`bank withdraw short for ${load.map(l => `${l.n} ${l.tier.name}`).join(', ')} (${w.reason ?? 'short'})`);
            await this.goTo(this.tileOf(this.own[this.cursor]!));
        }
        ctx.log('restocked', { ticks: (this.s?.tick ?? t0) - t0 });
    }
}

export const role: Role = {
    name: 'fm-row',
    produces: [],
    async run(ctx: RoleContext) {
        await new FmRow(ctx).run();
    }
};

if (import.meta.main) await runStandalone(role);
