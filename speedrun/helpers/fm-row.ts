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
//   part, parts  this dropper's share of the inventories (default 0 of 1)
//   start        'now' | 'sighted' | 'cue' (default 'sighted'): when log 0's 100 ticks start
//                  now: at once; sighted: when SCORED (scoredSha256, else the cue's receiver
//                  hash) is within sightRange; cue: when <cueDir>/fm-row-go.json is written
//   scoredSha256 sha-256 of SCORED's canonical name (altar-cue.ts nameHash); never its name
//   sightRange   default 15
//   restock      { kind: 'bank' | 'cheat', bank?: {x,z} } (cheat: local lab only; bank default Falador east)
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
import { waitUntil } from '../lib/wait';
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

export interface PlannedLog {
    i: number;
    tile: Tile;
    tier: Tier;
}

export function rowPlan(row: Row, tiers: readonly Tier[] = S03_LOGS): PlannedLog[] {
    const plan: PlannedLog[] = [];
    for (const tier of tiers) for (let n = 0; n < tier.n; n++) plan.push({ i: plan.length, tile: snakeTile(row, plan.length), tier });
    return plan;
}

/** Inventory k carries logs 28k .. 28k + 27. */
export const inventoryOf = (i: number): number => Math.floor(i / INVENTORY);

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

/** The first own log to drop on a (re)start: after the last own log already lying on its tile. */
export function resumeCursor(plan: readonly PlannedLog[], own: readonly number[], ground: readonly Pick<GroundItem, 'name' | 'x' | 'z'>[]): number {
    const lying = (l: PlannedLog) => ground.some(g => g.x === l.tile.x && g.z === l.tile.z && g.name.toLowerCase() === l.tier.name.toLowerCase());
    for (let c = own.length - 1; c >= 0; c--) if (lying(plan[own[c]!]!)) return c + 1;
    return 0;
}

// ------------------------------------------------------------------ options

export type StartMode = 'now' | 'sighted' | 'cue';
export const GO_FILE = 'fm-row-go.json';

export interface FmRowOptions extends Pace {
    row: Row;
    part: number;
    parts: number;
    start: StartMode;
    scoredSha256: string | null;
    sightRange: number;
    restock: { kind: 'bank' | 'cheat'; bank: Tile };
    scanRadius: number;
    lingerTicks: number;
    cueDir: string;
}

const int = (v: unknown, def: number, what: string, min = 0): number => {
    const n = v === undefined ? def : Number(v);
    if (!Number.isInteger(n) || n < min) throw new Error(`${what} must be an integer >= ${min} (got ${v})`);
    return n;
};

export function fmRowOptions(raw: Record<string, unknown>, env: Record<string, string | undefined> = process.env): FmRowOptions {
    const r = (raw.row ?? LAB_ROW) as Record<string, unknown>;
    const row: Row = { x: int(r.x, NaN, 'row.x'), z: int(r.z, NaN, 'row.z'), len: int(r.len, NaN, 'row.len', 1), rows: int(r.rows, 2, 'row.rows', 1) };
    const parts = int(raw.parts, 1, 'parts', 1);
    const part = int(raw.part, 0, 'part');
    if (part >= parts) throw new Error(`part must be below parts (got ${part} of ${parts})`);
    const start = (raw.start ?? 'sighted') as StartMode;
    if (!['now', 'sighted', 'cue'].includes(start)) throw new Error(`start must be now, sighted or cue (got ${raw.start})`);
    const sha = raw.scoredSha256 === undefined ? null : String(raw.scoredSha256);
    if (sha !== null && !/^[0-9a-f]{64}$/.test(sha)) throw new Error('scoredSha256 must be a sha-256 hex digest (altar-cue.ts nameHash), never the name');
    const rs = (raw.restock ?? {}) as Record<string, unknown>;
    const kind = rs.kind ?? 'bank';
    if (kind !== 'bank' && kind !== 'cheat') throw new Error(`restock.kind must be bank or cheat (got ${kind})`);
    const bank = rs.bank ? { x: int((rs.bank as Tile).x, NaN, 'restock.bank.x'), z: int((rs.bank as Tile).z, NaN, 'restock.bank.z') } : FALADOR_EAST_BANK;
    const restockDefault = kind === 'cheat' ? 6 : chebyshev(bank, row) + 20;
    return {
        row,
        part,
        parts,
        start,
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

const FIRE = /^fire$/i;
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

    constructor(private readonly ctx: RoleContext) {
        this.o = fmRowOptions(ctx.options);
        this.plan = rowPlan(this.o.row);
        this.own = ownLogs(this.plan.length, this.o.part, this.o.parts);
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
        const ground = await ctx.sdk.scanGroundItems(o.scanRadius).catch(() => [] as GroundItem[]);
        this.cursor = resumeCursor(this.plan, this.own, ground);
        if (this.cursor > 0) {
            // A restart mid-row: SCORED's progress is relearned from the fires; until then, pace as if it starts now.
            for (let c = 0; c < this.cursor; c++) this.dropped.set(this.own[c]!, -1);
            this.start = this.s!.tick;
            ctx.log('resume', { cursor: this.cursor, next: this.own[this.cursor] });
        } else {
            await this.restock();
            await this.goTo(this.plan[this.own[0]!]!.tile);
            this.phase('armed', { start: o.start, part: o.part, parts: o.parts, logs: this.own.length });
            const t = await this.trigger();
            if (t === null) return;
            // Log 0 leaves the dropper's hands on the tick after the trigger and turns public REVEAL_TICKS later.
            this.start = t + 1 + o.reveal + o.lead;
            ctx.log('start', { tick: t, logZeroDue: this.start });
        }
        this.phase('dropping');
        let state = this.s!;
        let lastDropTick = state.tick;
        while (!ctx.signal.aborted) {
            const r = await waitUntil(ctx.sdk, st => st.tick > state.tick, { maxTicks: 50 });
            if (!r.ok || !r.state) throw new Error('no state from the client for 50 ticks');
            state = r.state;
            await this.observe(state);
            if (this.cursor >= this.own.length) {
                if (this.progress.lit > this.own.at(-1)! || state.tick - lastDropTick > o.lingerTicks) break;
                continue;
            }
            if (await this.step(state)) lastDropTick = state.tick;
        }
        ctx.log('fm-row: finished', { dropped: this.dropped.size, lit: this.progress.lit, lost: [...this.lost], early: this.early });
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
        if (chebyshev(pos(st), frontier) > 14) locs = await this.ctx.sdk.scanNearbyLocs(o.scanRadius).catch(() => st.nearbyLocs);
        const burning = (t: Tile) => locs.some(l => l.x === t.x && l.z === t.z && FIRE.test(l.name));
        // Another part's logs are not seen while private; their fires are the only sign, so they always count.
        const mayCount = (i: number) => inventoryOf(i) % o.parts !== o.part || this.dropped.has(i);
        const next = advance(p, this.plan, burning, mayCount, st.tick);
        if (next !== p) {
            this.progress = next;
            if (Math.floor(next.lit / 10) > Math.floor(p.lit / 10) || next.lit >= this.plan.length) this.ctx.log('progress', { lit: next.lit, tick: st.tick });
        }
        for (const [i, t] of this.dropped) {
            if (i < this.progress.lit || this.lost.has(i) || t < 0) continue;
            const l = this.plan[i]!;
            if (chebyshev(pos(st), l.tile) > 14 || burning(l.tile)) continue;
            if (!st.groundItems.some(g => g.x === l.tile.x && g.z === l.tile.z && g.name.toLowerCase() === l.tier.name.toLowerCase())) {
                this.lost.add(i);
                this.ctx.log('lost', { i, tier: l.tier.name, droppedAt: t, tick: st.tick });
            }
        }
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
        if (!at(st, log.tile)) {
            await this.walk(log.tile, st.tick);
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
        this.cursor++;
        ctx.log('drop', { i: j, tier: log.tier.name, tick: now, ms: Date.now(), target, need: n, lit: this.progress.lit, ...(early ? { early } : {}) });
        const after = this.own[this.cursor];
        if (after !== undefined && inventoryOf(after) === k) await this.walk(this.plan[after]!.tile, now, true);
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
            await this.goTo(this.plan[this.own[this.cursor]!]!.tile);
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
