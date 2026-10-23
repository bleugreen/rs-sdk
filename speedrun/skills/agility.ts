// Agility step module (docs/speedrun/STEP-MANIFEST.md entry 1, rs/103's branch):
// the Gnome Stronghold course to 52, then the Wilderness course to `to`, with the
// in-page `agility` program (server/webclient/src/bot/programs/agility.ts).
//
// Steps, in order, each a no-op when its band is passed or the account is
// already where it goes, so the module runs from any start level:
//   agility:walk-gnome        Lumbridge to the Gnome course start (a fresh account)
//   agility:gnome             1 -> min(to, 52)
//   agility:walk-wilderness   the Ardougne lever, the Deserted Keep web, the ridge gate
//   agility:wilderness        52 -> to, then the run's final clean logout
// The run's S11a is `steps({to: 22})` (the first two); S17 arrives inside the
// Wilderness course by leg T27-17, so only the last step does anything there.
//
// The Barbarian course is not used below 52: its laps are faster from 35, but
// the walk out of the Gnome Stronghold to it and from it to the lever costs more
// than it saves (docs/speedrun/rehearsals/agility.md, "Route").
//
// Wilderness policy (rs/155 plan section 3, as ruled by rs/147):
// - nothing worth a kill is carried, and we never attack anyone;
// - every player seen is logged; `pauseFor` decides whether one pauses the band
//   (default 'none'): 'threat' pauses only for a player who can attack us at
//   this Wilderness level and is targeting a player beside us or walking toward
//   us from off the lap path, 'any' for anyone within `playerRadius`;
// - a pause logs out at once and throws; the operator resumes with
//   `--from=agility:wilderness` after a clear /playerpositions read. More than
//   `maxPauses` in one band refuses to resume until the coordinator answers;
// - a player attack ends the band: eat at `eatBelow`, step away, log out the
//   first tick the 16-tick combat window allows, and throw (a forced retreat);
// - a death logs out at the Lumbridge respawn at once and throws;
// - out of food at `eatBelow` logs out and throws (no death risk taken).

import { readFileSync } from 'fs';
import type { BotWorldState } from '../../sdk/types';
import { advance } from '../lib/dialogue';
import { gateSide, GNOME_STRONGHOLD_GATE, passGate, type Gate } from '../lib/travel';
import { withLevelUpDismissal } from '../lib/levelup';
import { ProgramError, runProgram, type ProgramStatus } from '../lib/programs';
import { logoutClean, type Session } from '../lib/session';
import { receiveFrom, type ReceiveResult, type WantSpec } from '../lib/trade';
import { parseLog, type TickLog, type TickRow } from '../lib/ticks';
import { nextTick, tickMs, waitUntil } from '../lib/wait';
import type { RunnerSession, Step, StepContext } from '../runner/step';

export const skill = 'agility';

/** What counts as food unless `food` is given: the program's list plus the starter kit's shrimps and bread. */
export const DEFAULT_FOOD = '^(shark|lobster|swordfish|monkfish|tuna|salmon|trout|shrimps|bread|cake|2/3 cake|slice of cake)$';

export type Box = [number, number, number, number];
const inBox = (b: Box, x: number, z: number) => x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3];
const cheb = (ax: number, az: number, bx: number, bz: number) => Math.max(Math.abs(ax - bx), Math.abs(az - bz));

/** The Gnome course's first obstacle (agility-courses.ts). */
export const GNOME_START: [number, number] = [2474, 3436];
/** Within this many tiles of GNOME_START the walk is skipped (the run's S11a arrives by the spirit tree). */
export const GNOME_NEAR = 30;
/**
 * The Wilderness course north of its gate row (z 3931), and its pit
 * (wilderness_course.rs2). The ridge and the wolf pit south of the gate are outside.
 */
export const WILD_AREA: Box = [2990, 3931, 3012, 3965];
export const WILD_PIT: Box = [2985, 10330, 3025, 10390];
/** The pipe's start tile: outside the armed skeletons' spawn + wander + hunt reach (x <= 3002) and the wolves' (z <= 3931). */
export const SAFE_TILE: [number, number] = [3004, 3937];
/**
 * The ridge gate (loc 2309), entered from its south side. Its only op, Open, is the ridge itself: it
 * forcemoves the player north up the corridor into the course, or drops them in the wolf pit.
 * Walks end on `stage`, never beside the gate: the SDK's walkTo counts a door beside its path's
 * last tile as one to open, so a walk to `approach` clicks Open on the ridge mid-walk and keeps
 * walking from inside the course (the lab: 100 ticks for 9 tiles; rs/310 left in the corridor).
 */
export const RIDGE_GATE = { id: 2309, x: 2998, z: 3917, approach: [2998, 3916] as [number, number], stage: [2998, 3914] as [number, number] };
/** The one-tile corridor between the ridge gate and the course gate, where the ridge's forcemoves run. */
export const RIDGE_CORRIDOR: Box = [2998, 3917, 2998, 3930];
/** North of the ridge gate's line and outside the course: the corridor, and the wolf pit and ridge beside it. */
export const RIDGE_NORTH: Box = [2985, 3917, 3015, 3930];
/** Within this many tiles of RIDGE_GATE.stage, south of the gate's line, the gate is clicked from where the player stands. */
export const RIDGE_CLICK_RANGE = 2;
/** The course gate's right half (loc 2307, m46_61.jm2): from inside it leads over the ridge to RIDGE_GATE.approach. */
export const COURSE_GATE = { id: 2307, x: 2998, z: 3931 };
/** The Deserted Keep's only exit, the web in its north wall (mage_arena.md). */
export const KEEP_WEB: [number, number] = [3158, 3951];
/** The post-combat logout block (logout.rs2 p_preventlogout 16). */
export const COMBAT_WINDOW = 16;

/**
 * Walking routes, sampled every 40-50 tiles from the SDK pathfinder's route
 * (sdk/pathfinding.ts findLongPath, doors open). Each leg is walked with
 * bot.walkTo from the route point nearest the player.
 */
export const ROUTES = {
    // 1,011 tiles: Draynor, Falador, Taverley, White Wolf Mountain, Catherby, Ardougne's north, the Gnome gate
    spawnToGnome: [
        [3201, 3237], [3150, 3256], [3098, 3271], [3052, 3278], [3000, 3287], [2939, 3311], [2912, 3371], [2874, 3414], [2861, 3464],
        [2846, 3508], [2844, 3460], [2804, 3436], [2753, 3442], [2702, 3427], [2650, 3403], [2589, 3393], [2539, 3398], [2489, 3389],
        [2461, 3382], [2461, 3386], [2464, 3434], GNOME_START
    ],
    // 59 tiles to the gate, 142 on to the lever
    gnomeToLever: [[2464, 3434], [2461, 3386], [2461, 3380], [2495, 3359], [2539, 3351], [2561, 3311]],
    // the keep web to the ridge gate's stage tile, 3 south of it: 165 tiles
    keepToRidge: [[3158, 3953], [3111, 3955], [3057, 3949], [3006, 3911], RIDGE_GATE.stage]
} satisfies Record<string, Array<[number, number] | readonly [number, number]>>;

// ------------------------------------------------------------------ options

export type PauseRule = 'none' | 'threat' | 'any';

export interface AgilityOptions {
    /** Target level (default 99). */
    to: number;
    /** 'auto' and 'knife' mean the in-page reaction ('react'); 'plain' is for measurement only. */
    technique: 'react' | 'plain';
    /** Food name pattern for the program (default its own list: fish and cakes). */
    food?: string;
    /** Eat at or below this HP; default ceil(0.6 x max HP) on the Wilderness course (6 at 10 HP, 60 at 99), 0 on the Gnome course. */
    eatBelow?: number;
    /**
     * When a due eat goes out (the program's `eatAt`). 'land' (the default) holds an eat
     * that falls due on the walk to an obstacle, where its inventory click would cancel the
     * obstacle (OpHeldHandler's clearPendingAction), and sends it just before the next click;
     * 'any' eats on the tick it falls due.
     */
    eatAt: 'any' | 'land';
    /** 'final-logout' (default when `to` is 99) waits out the combat window and logs out cleanly after the last level-up. */
    finish: 'stay' | 'final-logout';
    pauseFor: PauseRule;
    playerRadius: number;
    threatTargetRange?: number;
    threatCloseTiles?: number;
    threatCloseTicks?: number;
    /** Pauses allowed in one band before it refuses to resume (rs/147: more than 3, ask the coordinator). */
    maxPauses: number;
    /** Set once the coordinator has answered a pause-limit stop. */
    pauseLimitAck: boolean;
    /**
     * Items to drop before the walk to the Gnome course (a pattern), to make room for
     * food: a rehearsal account's starter kit fills 10+ slots.
     */
    drop?: string;
    /**
     * A mid-band food restock (rehearsal only): when `below` or fewer food items are
     * left, leave the course by its gate, take `want` from `giver` (lib/trade.ts
     * receiveFrom) on the ridge gate's south side, and cross back. A failed trade
     * logs out and throws `no-food`.
     */
    restock?: Restock;
    /**
     * A food top-up at the start, after `drop` (rehearsal only): the harness's kit
     * trade comes before the steps, when a fresh account has 10 free slots, so the
     * rest of the food arrives here.
     */
    topUp?: { giver: string; want: WantSpec[] };
    /** How to leave the world (default logoutClean); tests inject one. */
    logout?: (session: RunnerSession) => Promise<unknown>;
    /** The trade (default receiveFrom); tests inject one. */
    receive?: (sdk: StepContext<unknown>['sdk'], giver: string, want: WantSpec[]) => Promise<ReceiveResult>;
}

export interface Restock {
    giver: string;
    want: WantSpec[];
    below: number;
}

/** `shark:20,lobster:5` (the harness's kit syntax) or a WantSpec list. */
export function parseWant(v: unknown): WantSpec[] {
    if (Array.isArray(v)) return v as WantSpec[];
    if (typeof v !== 'string' || !v) throw new Error('agility: restock want must be like shark:20');
    return v.split(',').map(part => {
        const [name, n] = part.split(/[:=]/);
        const amount = Number(n ?? 1);
        if (!name || !Number.isFinite(amount)) throw new Error(`agility: bad restock want '${part}'`);
        return { item: new RegExp(`^${name.replace(/_/g, ' ')}$`, 'i'), amount };
    });
}

function parseRestock(raw: Record<string, unknown>): Restock | undefined {
    const r = (typeof raw.restock === 'object' && raw.restock ? raw.restock : {}) as Record<string, unknown>;
    const giver = r.giver ?? raw.restockGiver;
    if (giver === undefined || giver === '') return undefined;
    return { giver: String(giver), want: parseWant(r.want ?? raw.restockWant ?? 'shark:20'), below: int(r.below ?? raw.restockBelow, 'restock below') ?? 4 };
}

const int = (v: unknown, name: string): number | undefined => {
    if (v === undefined || v === null || v === '') return undefined;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`agility: ${name} must be a number (got ${String(v)})`);
    return n;
};

function pick<T extends string>(v: unknown, allowed: readonly T[], fallback: T, name: string): T {
    if (v === undefined || v === null || v === '') return fallback;
    if (!allowed.includes(v as T)) throw new Error(`agility: ${name} must be one of ${allowed.join(', ')} (got ${String(v)})`);
    return v as T;
}

/** Parse `steps()` options; the harness passes `--skill-opt` values as strings. */
export function parseOptions(raw: Record<string, unknown> = {}): AgilityOptions {
    const to = int(raw.to, 'to') ?? 99;
    if (to < 2 || to > 99) throw new Error(`agility: to must be 2..99 (got ${to})`);
    const technique = pick(raw.technique, ['auto', 'knife', 'react', 'plain'] as const, 'auto', 'technique');
    const eatBelow = int(raw.eatBelow, 'eatBelow');
    return {
        to,
        technique: technique === 'plain' ? 'plain' : 'react',
        ...(typeof raw.food === 'string' && raw.food ? { food: raw.food } : {}),
        ...(typeof raw.drop === 'string' && raw.drop ? { drop: raw.drop } : {}),
        ...(eatBelow !== undefined ? { eatBelow } : {}),
        eatAt: pick(raw.eatAt, ['any', 'land'] as const, 'land', 'eatAt'),
        finish: pick(raw.finish, ['stay', 'final-logout'] as const, to === 99 ? 'final-logout' : 'stay', 'finish'),
        pauseFor: pick(raw.pauseFor, ['none', 'threat', 'any'] as const, 'none', 'pauseFor'),
        playerRadius: int(raw.playerRadius, 'playerRadius') ?? 15,
        ...(int(raw.threatTargetRange, 'threatTargetRange') !== undefined ? { threatTargetRange: int(raw.threatTargetRange, 'threatTargetRange') } : {}),
        ...(int(raw.threatCloseTiles, 'threatCloseTiles') !== undefined ? { threatCloseTiles: int(raw.threatCloseTiles, 'threatCloseTiles') } : {}),
        ...(int(raw.threatCloseTicks, 'threatCloseTicks') !== undefined ? { threatCloseTicks: int(raw.threatCloseTicks, 'threatCloseTicks') } : {}),
        maxPauses: int(raw.maxPauses, 'maxPauses') ?? 3,
        pauseLimitAck: raw.pauseLimitAck === true || raw.pauseLimitAck === 'true',
        ...(parseRestock(raw) ? { restock: parseRestock(raw)! } : {}),
        ...(raw.topUpGiver ? { topUp: { giver: String(raw.topUpGiver), want: parseWant(raw.topUpWant ?? 'shark:16') } } : {}),
        ...(typeof raw.logout === 'function' ? { logout: raw.logout as AgilityOptions['logout'] } : {}),
        ...(typeof raw.receive === 'function' ? { receive: raw.receive as AgilityOptions['receive'] } : {})
    };
}

export interface Band {
    course: 'gnome' | 'wilderness';
    /** The level the band's method needs (the ridge gate checks 52). */
    from: number;
    to: number;
}

/** The bands for a target level: Gnome to min(to, 52), then the Wilderness course to `to`. */
export function planBands(to: number): Band[] {
    const bands: Band[] = [{ course: 'gnome', from: 1, to: Math.min(to, 52) }];
    if (to > 52) bands.push({ course: 'wilderness', from: 52, to });
    return bands;
}

export function defaultEatBelow(course: Band['course'], maxHp: number): number {
    return course === 'gnome' ? 0 : Math.ceil(0.6 * maxHp);
}

// ------------------------------------------------------------------ state readers

export function agilityLevel(s: BotWorldState | null | undefined): number {
    return s?.skills?.find(k => k.name.toLowerCase() === 'agility')?.baseLevel ?? 0;
}

export function nearGnome(s: BotWorldState | null | undefined): boolean {
    const p = s?.player;
    return !!p && p.level === 0 && cheb(p.worldX, p.worldZ, GNOME_START[0], GNOME_START[1]) <= GNOME_NEAR;
}

export function inWildCourse(s: BotWorldState | null | undefined): boolean {
    const p = s?.player;
    return !!p && (inBox(WILD_AREA, p.worldX, p.worldZ) || inBox(WILD_PIT, p.worldX, p.worldZ));
}

const atCourse = (course: Band['course'], s: BotWorldState | null | undefined) => (course === 'gnome' ? nearGnome(s) : inWildCourse(s));

/**
 * Where the player stands against the ridge gate: in the course; in the corridor (a gate click
 * from there crosses too: the server steps the player onto the gate tile and runs the ridge);
 * elsewhere north of the gate's line (the wolf pit), where only a walk round to the stage leads
 * back; at the gate (south of its line, within RIDGE_CLICK_RANGE of the stage); or away from it.
 */
export type RidgeSide = 'course' | 'corridor' | 'north' | 'gate' | 'away';

export function ridgeSide(s: BotWorldState | null | undefined): RidgeSide {
    const p = s?.player;
    if (!p) return 'away';
    if (inWildCourse(s)) return 'course';
    if (p.level !== 0) return 'away';
    if (inBox(RIDGE_CORRIDOR, p.worldX, p.worldZ)) return 'corridor';
    if (inBox(RIDGE_NORTH, p.worldX, p.worldZ)) return 'north';
    if (p.worldZ < RIDGE_GATE.z && cheb(p.worldX, p.worldZ, RIDGE_GATE.stage[0], RIDGE_GATE.stage[1]) <= RIDGE_CLICK_RANGE) return 'gate';
    return 'away';
}

/** Index of the route point to walk to first: the one after the point nearest the player (or that point, when it is the last). */
export function routeStart(route: ReadonlyArray<readonly [number, number]>, x: number, z: number): number {
    let best = 0;
    let bestD = Infinity;
    route.forEach(([rx, rz], i) => {
        const d = cheb(rx, rz, x, z);
        if (d < bestD) {
            bestD = d;
            best = i;
        }
    });
    return bestD <= 3 ? Math.min(best + 1, route.length - 1) : best;
}

/** Hit within the combat window, in combat, or an NPC beside us targeting a player: logging out now would be refused. */
export function engaged(s: BotWorldState): boolean {
    const c = s.player?.combat;
    if (c?.inCombat) return true;
    if (c && c.lastDamageTick >= 0 && s.tick - c.lastDamageTick <= COMBAT_WINDOW) return true;
    return (s.nearbyNpcs ?? []).some(n => n.distance <= 2 && n.targetIndex >= 32768);
}

// ------------------------------------------------------------------ pause bookkeeping

export const PAUSE_STEP = 'agility:pause';

/** Pauses already taken in `band`: this process's rows, plus earlier launches' rows in the same log file. */
export function pausesTaken(log: Pick<TickLog, 'rows'> & { path?: string | null }, band: string): number {
    const ours = log.rows.filter(r => r.step === PAUSE_STEP && r.meta?.band === band);
    let earlier: TickRow[] = [];
    if (log.path) {
        try {
            const seen = new Set(ours.map(r => r.at));
            earlier = parseLog(readFileSync(log.path, 'utf8')).filter(r => r.step === PAUSE_STEP && r.meta?.band === band && !seen.has(r.at));
        } catch {
            earlier = [];
        }
    }
    return ours.length + earlier.length;
}

export class AgilityStop extends Error {
    constructor(readonly kind: 'paused-for-player' | 'pause-limit' | 'retreat' | 'died' | 'no-food' | 'program', message: string) {
        super(`${kind}: ${message}`);
        this.name = 'AgilityStop';
    }
}

// ------------------------------------------------------------------ steps

interface AgilityResult {
    ended?: 'laps' | 'maxTicks' | 'level' | 'player' | 'attacked' | 'no-food' | 'low-food' | 'died';
    laps: number;
    ticksPerLap: number;
    lapTicks: number[];
    fails: Record<string, number>;
    eats: number;
    level: number;
    levelTicks: Record<string, number>;
    fallDamage: number;
    npcDamage: number;
    playerDamage: number;
    wouldPause: { any: number; threat: number };
    sightings: Array<Record<string, unknown>>;
    player?: { name: string; combatLevel: number; distance: number; why: string };
    attacker?: { name: string; combatLevel: number; distance: number; x: number; z: number } | null;
}

function row(ctx: StepContext<unknown>, step: string, tick: number, meta: Record<string, unknown>, ok = true): void {
    ctx.log.append({
        v: 1, runId: ctx.log.runId, account: ctx.session.name, sessionId: ctx.session.sessionId, step,
        startTick: tick, endTick: tick, ticks: 0, wallMs: 0, ok, meta, tickMs: tickMs(), at: new Date().toISOString()
    });
}

const stateOf = (ctx: StepContext<unknown>): BotWorldState => {
    const s = ctx.sdk.getState();
    if (!s?.player) throw new Error('no player state');
    return s;
};

/**
 * Log out. An unconfirmed logout is reported, not thrown: logoutClean cannot yet
 * confirm a browser tab (the gateway keeps its last inGame state; rs/164), and
 * docs/speedrun/rehearsals/HOST.md's teardown confirms the tab with tab-logout.ts.
 */
async function leave(ctx: StepContext<unknown>, o: AgilityOptions): Promise<void> {
    if (o.logout) {
        await o.logout(ctx.session);
        return;
    }
    const r = await logoutClean(ctx.session as Session);
    if (!r.ok) console.warn(`[agility] logout click on tick ${r.clickTick} not confirmed: ${r.reason}`);
}

function foodSlot(s: BotWorldState, food: string | undefined): { slot: number; op: number } | null {
    const re = new RegExp(food ?? DEFAULT_FOOD, 'i');
    const it = s.inventory.find(i => re.test(i.name));
    if (!it) return null;
    return { slot: it.slot, op: it.optionsWithIndex?.find(x => /^eat$/i.test(x.text))?.opIndex ?? 1 };
}

/**
 * After a player's hit: never fight back; eat at `eatBelow`; step away from the
 * attacker inside the course; return the first tick the combat window allows a
 * logout (or 'died'). Bounded at 300 ticks.
 */
export async function retreat(
    sdk: StepContext<unknown>['sdk'],
    o: Pick<AgilityOptions, 'food'> & { eatBelow: number },
    attacker: { x: number; z: number } | null
): Promise<'clear' | 'died' | 'timeout'> {
    const s0 = sdk.getState()!;
    const life = s0.player!.lifeId;
    let lastEat = -Infinity;
    let lastWalk = -Infinity;
    for (let k = 0; k < 300; k++) {
        const s = sdk.getState()!;
        const p = s.player!;
        if (p.isDead || p.lifeId !== life) return 'died';
        if (!engaged(s)) return 'clear';
        if (p.hp <= o.eatBelow && s.tick - lastEat >= 3) {
            const f = foodSlot(s, o.food);
            if (f) {
                void sdk.sendUseItem(f.slot, f.op);
                lastEat = s.tick;
            }
        }
        const from = (s.nearbyPlayers ?? []).find(q => attacker && cheb(q.x, q.z, attacker.x, attacker.z) <= 3) ?? attacker;
        if (from && s.tick - lastWalk >= 4) {
            const dx = Math.sign(p.worldX - from.x) || 1;
            const dz = Math.sign(p.worldZ - from.z) || -1;
            const tx = Math.min(WILD_AREA[2] - 2, Math.max(WILD_AREA[0] + 2, p.worldX + 6 * dx));
            const tz = Math.min(3960, Math.max(3934, p.worldZ + 6 * dz));
            void sdk.sendWalk(tx, tz, true);
            lastWalk = s.tick;
        }
        await nextTick(sdk, s.tick);
    }
    return 'timeout';
}

/** The run's last action: out of any fight's reach, the 16-tick window waited out, a clean logout. */
export async function finalLogout(ctx: StepContext<unknown>, o: AgilityOptions): Promise<{ waited: number; moved: boolean }> {
    const sdk = ctx.sdk;
    // the level-up chain closes within a tick or two (the watcher is still on)
    await waitUntil(sdk, s => !s.dialog?.isOpen, { maxTicks: 6 });
    const s0 = stateOf(ctx);
    let moved = false;
    if (engaged(s0)) {
        moved = true;
        void sdk.sendWalk(SAFE_TILE[0], SAFE_TILE[1], true);
        await waitUntil(sdk, s => !!s.player && cheb(s.player.worldX, s.player.worldZ, SAFE_TILE[0], SAFE_TILE[1]) <= 1, { maxTicks: 30 });
        await waitUntil(sdk, s => !engaged(s), { maxTicks: 60 });
    }
    const waited = (sdk.getState()?.tick ?? s0.tick) - s0.tick;
    await leave(ctx, o);
    return { waited, moved };
}

/** Logs whose band already took its one restock (a second would be a coordinator's call). */
const restocked = new WeakSet<object>();

/** Out through the course gate, the courier's trade on the ridge's south side, and back over the ridge. */
export async function restockAt(ctx: StepContext<unknown>, o: AgilityOptions, band: string): Promise<void> {
    const rs = o.restock!;
    const sdk = ctx.sdk;
    const t0 = sdk.getState()?.tick ?? -1;
    void sdk.sendInteractLoc(COURSE_GATE.x, COURSE_GATE.z, COURSE_GATE.id, 1);
    const out = await waitUntil(sdk, s => !!s.player && s.player.worldZ <= RIDGE_GATE.approach[1] + 1, { maxTicks: 60 });
    if (!out.ok) {
        await leave(ctx, o);
        throw new AgilityStop('no-food', `could not leave the course for the restock in ${band}; logged out`);
    }
    const receive = o.receive ?? ((s, giver, want) => receiveFrom(s, giver, { want }));
    const r = await receive(sdk, rs.giver, rs.want);
    const t1 = sdk.getState()?.tick ?? -1;
    row(ctx, 'agility:restock', t1, { band, giver: rs.giver, ok: r.ok, tradeTicks: r.ticks, outTicks: out.tick - t0, received: r.received, ...(r.reason ? { reason: r.reason } : {}) }, r.ok);
    if (!r.ok) {
        await leave(ctx, o);
        throw new AgilityStop('no-food', `the restock from ${rs.giver} failed (${r.reason}) in ${band}; logged out. Tell the coordinator`);
    }
    restocked.add(ctx.log);
    await crossRidge(ctx);
}

async function bandProgram(ctx: StepContext<unknown>, band: Band, o: AgilityOptions, name: string): Promise<AgilityResult> {
    const s = stateOf(ctx);
    const eatBelow = o.eatBelow ?? defaultEatBelow(band.course, s.player!.maxHp);
    const params: Record<string, unknown> = {
        course: band.course,
        untilLevel: band.to,
        technique: o.technique,
        startStep: 'auto',
        // the longest obstacle takes 18 ticks; a dropped click (the lab saw one at the rocks) costs this much
        stepTimeout: 40,
        eatBelow,
        // the program's in-any-phase eating (eatGap) and this module's food list (the starter kit's shrimps and bread)
        eatGap: 3,
        eatAt: o.eatAt,
        food: o.food ?? DEFAULT_FOOD,
        ...(band.course === 'wilderness'
            ? {
                  ...(o.restock && !restocked.has(ctx.log) ? { restockBelow: o.restock.below } : {}),
                  pauseFor: o.pauseFor,
                  playerRadius: o.playerRadius,
                  ...(o.threatTargetRange !== undefined ? { threatTargetRange: o.threatTargetRange } : {}),
                  ...(o.threatCloseTiles !== undefined ? { threatCloseTiles: o.threatCloseTiles } : {}),
                  ...(o.threatCloseTicks !== undefined ? { threatCloseTicks: o.threatCloseTicks } : {})
              }
            : {})
    };
    let end: ProgramStatus;
    try {
        end = await runProgram(ctx.sdk, 'agility', params);
    } catch (e) {
        const st = e instanceof ProgramError ? e.status : null;
        if (st?.fault === 'died') {
            const r = (st.faultDetail ?? {}) as AgilityResult;
            await leave(ctx, o);
            row(ctx, 'agility:death', st.endedTick ?? -1, { band: name, result: compact(r) }, false);
            throw new AgilityStop('died', `in ${name} at tick ${st.endedTick}; logged out at the respawn. Ask the coordinator before resuming (a re-kit and the trip back cost about 800 ticks)`);
        }
        throw e;
    }
    // rehearse.ts logs the program's final status as a (program) row and each level as a (reach) row
    if (end.phase !== 'done') throw new AgilityStop('program', `the agility program was ${end.phase} in ${name}`);
    return end.result as AgilityResult;
}

/** The program result without its per-lap arrays, for a ledger row. */
function compact(r: AgilityResult): Record<string, unknown> {
    return {
        ended: r.ended, laps: r.laps, ticksPerLap: r.ticksPerLap, fails: r.fails, eats: r.eats, level: r.level,
        fallDamage: r.fallDamage, npcDamage: r.npcDamage, playerDamage: r.playerDamage, wouldPause: r.wouldPause,
        sightings: r.sightings, ...(r.player ? { player: r.player } : {}), ...(r.attacker !== undefined ? { attacker: r.attacker } : {})
    };
}

function bandStep(band: Band, o: AgilityOptions, last: boolean): Step {
    const name = `agility:${band.course}`;
    let loggedOut = false;
    const run = async (ctx: StepContext<unknown>) =>
        withLevelUpDismissal(ctx.sdk, async () => {
            if (agilityLevel(ctx.sdk.getState()) >= band.to) return;
            if (band.course === 'wilderness' && !o.pauseLimitAck && pausesTaken(ctx.log, name) > o.maxPauses) {
                throw new AgilityStop('pause-limit', `${pausesTaken(ctx.log, name)} pauses in ${name} (limit ${o.maxPauses}); message the coordinator, then resume with --skill-opt=pauseLimitAck=true`);
            }
            for (let attempt = 1; ; attempt++) {
                if (attempt > 6) throw new AgilityStop('program', `${name}: the program ended 6 times below level ${band.to}`);
                const r = await bandProgram(ctx, band, o, name);
                if (r.ended === 'low-food' && o.restock) {
                    await restockAt(ctx, o, name);
                    continue;
                }
                if (r.ended === 'player') {
                    await leave(ctx, o);
                    const n = pausesTaken(ctx.log, name) + 1;
                    row(ctx, PAUSE_STEP, ctx.sdk.getState()?.tick ?? -1, { band: name, n, player: r.player });
                    const p = r.player!;
                    throw new AgilityStop('paused-for-player', `${p.name} (combat ${p.combatLevel}, ${p.why}, ${p.distance} tiles) in ${name}; pause ${n} of ${o.maxPauses}. Resume with --from=${name} after at least 3 minutes offline and a clear /playerpositions`);
                }
                if (r.ended === 'attacked') {
                    const st = stateOf(ctx);
                    const eatBelow = o.eatBelow ?? defaultEatBelow(band.course, st.player!.maxHp);
                    const out = await retreat(ctx.sdk, { ...(o.food ? { food: o.food } : {}), eatBelow }, r.attacker ? { x: r.attacker.x, z: r.attacker.z } : null);
                    const lifeChanged = out === 'died';
                    await leave(ctx, o);
                    row(ctx, lifeChanged ? 'agility:death' : 'agility:retreat', ctx.sdk.getState()?.tick ?? -1, { band: name, attacker: r.attacker, out }, false);
                    throw new AgilityStop(lifeChanged ? 'died' : 'retreat', `attacked by ${r.attacker?.name ?? 'a player'} in ${name}; ${lifeChanged ? 'died, ' : ''}logged out. Report it to the coordinator before resuming`);
                }
                if (r.ended === 'no-food') {
                    await leave(ctx, o);
                    throw new AgilityStop('no-food', `out of food at HP at or below the eat line in ${name}; logged out. Bring more food and resume with --from=${name}`);
                }
                if (agilityLevel(ctx.sdk.getState()) >= band.to) break;
            }
            if (last && o.finish === 'final-logout' && band.to >= o.to) {
                const f = await finalLogout(ctx, o);
                loggedOut = true;
                row(ctx, 'agility:final-logout', ctx.sdk.getState()?.tick ?? -1, f);
            }
        });
    return {
        name,
        preconditions: s => (agilityLevel(s) >= band.to || atCourse(band.course, s) ? true : `not at the ${band.course} course`),
        run,
        postconditions: s => (agilityLevel(s) >= band.to || loggedOut ? true : `agility ${agilityLevel(s)} < ${band.to}`),
        done: o2 => agilityLevel(o2.state) >= band.to,
        inProgress: o2 => agilityLevel(o2.state) < band.to && atCourse(band.course, o2.state),
        logoutSafe: true
    };
}

/**
 * Eat at the line while a walk runs: a 10 HP account crosses White Wolf Mountain
 * and the Wilderness on foot (the lab lost one to the wolves without it).
 */
function eatWhileWalking(sdk: StepContext<unknown>['sdk'], o: AgilityOptions): () => void {
    let lastEat = -Infinity;
    return sdk.onStateUpdate(s => {
        const p = s.player;
        if (!p || s.tick - lastEat < 3) return;
        if (p.hp > (o.eatBelow ?? defaultEatBelow('wilderness', p.maxHp))) return;
        const f = foodSlot(s, o.food);
        if (!f) return;
        lastEat = s.tick;
        void sdk.sendUseItem(f.slot, f.op);
    });
}

/**
 * When the failed leg ends across the Gnome Stronghold gate from the player, go through it with
 * the shared helper (lib/travel.ts passGate, which clears Femi's first-visit scene and confirms the
 * far side), and say so; otherwise there is no gate to pass, and the caller just retries the walk.
 * A failed leg on one side of the gate (inside the Stronghold, on the course) never passes it.
 */
async function throughGate(ctx: StepContext<unknown>, x: number, z: number, first: string): Promise<string> {
    const p = stateOf(ctx).player!;
    const here = gateSide(GNOME_STRONGHOLD_GATE, { x: p.worldX, z: p.worldZ, level: p.level });
    const there = gateSide(GNOME_STRONGHOLD_GATE, { x, z });
    if (!here || !there || here === there) return 'no gate between';
    const sides: Gate['sides'] = GNOME_STRONGHOLD_GATE.sides;
    const g = await passGate(ctx.sdk as never, GNOME_STRONGHOLD_GATE, sides[there]!);
    row(ctx, 'agility:gate', ctx.sdk.getState()?.tick ?? -1, { to: there, ok: g.ok, ticks: g.ticks, clicks: g.clicks, dialogues: g.dialogues, ...(g.reason ? { reason: g.reason } : {}) }, g.ok);
    if (!g.ok) throw new Error(`walk to (${x},${z}): ${first}; the ${GNOME_STRONGHOLD_GATE.label}: ${g.reason}`);
    return `went through the gate to its ${there} side`;
}

async function walkRoute(ctx: StepContext<unknown>, route: ReadonlyArray<readonly [number, number]>, o: AgilityOptions): Promise<void> {
    const s = stateOf(ctx);
    const stopEating = eatWhileWalking(ctx.sdk, o);
    try {
        let i = routeStart(route, s.player!.worldX, s.player!.worldZ);
        // A resume inside the Stronghold can tie routeStart's nearest point with the one across the
        // gate: never start on the far side of the gate when a later point is on the player's side.
        const side = gateSide(GNOME_STRONGHOLD_GATE, { x: s.player!.worldX, z: s.player!.worldZ, level: s.player!.level });
        const sideOf = (k: number) => gateSide(GNOME_STRONGHOLD_GATE, { x: route[k]![0], z: route[k]![1] });
        if (side) while (i < route.length - 1 && sideOf(i) && sideOf(i) !== side && route.some((_, k) => k > i && sideOf(k) === side)) i++;
        for (; i < route.length; i++) {
            const [x, z] = route[i]!;
            let r = await ctx.bot.walkTo(x, z, 2, { timeout: 300 * tickMs() });
            if (r.success) continue;
            // A closed gate (the Gnome Stronghold's) fails the walk in more than one way: the
            // pathfinder's "no path", or a path walked up to the gate that ends "Stuck at" /
            // "Could not reach" (the demo, rs/295), where bot.walkTo's own door opener may have
            // clicked the gate and opened Femi's scene. Whatever the message, go through the gate
            // when the leg ends across it, then walk the leg once more.
            const first = r.message;
            const gated = await throughGate(ctx, x, z, first);
            r = await ctx.bot.walkTo(x, z, 3, { timeout: 300 * tickMs() });
            if (!r.success) throw new Error(`walk to (${x},${z}): ${r.message} (first try: ${first}; ${gated})`);
        }
    } finally {
        stopEating();
    }
}

const walkGnome = (gnomeEnd: number, o: AgilityOptions): Step => ({
    name: 'agility:walk-gnome',
    preconditions: s => (s.player ? true : 'no player'),
    run: async ctx => {
        const s = stateOf(ctx);
        if (agilityLevel(s) >= gnomeEnd || nearGnome(s)) return;
        if (o.drop) await dropMatching(ctx, o.drop);
        if (o.topUp) {
            const receive = o.receive ?? ((sd, giver, want) => receiveFrom(sd, giver, { want }));
            const r = await receive(ctx.sdk, o.topUp.giver, o.topUp.want);
            row(ctx, 'agility:top-up', ctx.sdk.getState()?.tick ?? -1, { giver: o.topUp.giver, ok: r.ok, tradeTicks: r.ticks, ...(r.reason ? { reason: r.reason } : {}) }, r.ok);
            if (!r.ok) throw new Error(`food top-up from ${o.topUp.giver} failed: ${r.reason}`);
        }
        await walkRoute(ctx, ROUTES.spawnToGnome, o);
    },
    postconditions: s => (agilityLevel(s) >= gnomeEnd || nearGnome(s) ? true : 'not at the Gnome course'),
    logoutSafe: true
});

/** Drop every inventory item matching `pattern` in one burst (5 a tick), confirmed once. */
async function dropMatching(ctx: StepContext<unknown>, pattern: string): Promise<void> {
    const re = new RegExp(pattern, 'i');
    const slots = stateOf(ctx).inventory.filter(i => re.test(i.name)).map(i => i.slot);
    for (const slot of slots) void ctx.sdk.sendDropItem(slot);
    await waitUntil(ctx.sdk, st => !st.inventory.some(i => re.test(i.name)), { maxTicks: Math.ceil(slots.length / 5) + 4 });
}

/** Pull the Ardougne lever (first pull: a warning page and a choice) and wait for the Deserted Keep. */
async function pullLever(ctx: StepContext<unknown>): Promise<void> {
    const lever = ctx.sdk.getState()!.nearbyLocs.find(l => /lever/i.test(l.name) && l.distance <= 10);
    if (!lever) throw new Error('no lever within 10 tiles');
    void ctx.sdk.sendInteractLoc(lever.x, lever.z, lever.id, 1);
    for (let k = 0; k < 6; k++) {
        if ((ctx.sdk.getState()?.player?.worldZ ?? 0) > 3800) break;
        const r = await advance(ctx.sdk, { choose: /^Yes I'm brave\.$/, maxTicks: 6 });
        if (!r.ok) break;
    }
    const ok = await waitUntil(ctx.sdk, s => (s.player?.worldZ ?? 0) > 3800, { maxTicks: 30 });
    if (!ok.ok) throw new Error('the lever did not teleport');
}

/** From inside the Deserted Keep, knife the north web (50% a try) and step through. */
async function leaveKeep(ctx: StepContext<unknown>): Promise<number> {
    const sdk = ctx.sdk;
    let tries = 0;
    const out = () => (sdk.getState()?.player?.worldZ ?? 0) > KEEP_WEB[1];
    for (let k = 0; k < 20 && !out(); k++) {
        const s = sdk.getState()!;
        const p = s.player!;
        if (cheb(p.worldX, p.worldZ, KEEP_WEB[0], KEEP_WEB[1] - 1) > 1) {
            const r = await ctx.bot.walkTo(KEEP_WEB[0], KEEP_WEB[1] - 1, 1, { timeout: 100 * tickMs() });
            if (!r.success) throw new Error(`walk to the keep web: ${r.message}`);
            continue;
        }
        const web = s.nearbyLocs.find(l => /^web$/i.test(l.name) && l.options.includes('Slash') && cheb(l.x, l.z, KEEP_WEB[0], KEEP_WEB[1]) <= 1);
        if (web) {
            const knife = s.inventory.find(i => /^knife$/i.test(i.name));
            if (!knife) throw new Error('no knife for the Deserted Keep web');
            void sdk.sendUseItemOnLoc(knife.slot, web.x, web.z, web.id);
            tries++;
            await waitUntil(sdk, st => st.tick >= s.tick + 2, { maxTicks: 4 });
            continue;
        }
        // slashed (or open): the client's static collision still blocks it, so walk server-side
        void sdk.sendWalk(KEEP_WEB[0], KEEP_WEB[1] + 2, true);
        await waitUntil(sdk, () => out(), { maxTicks: 8 });
    }
    if (!out()) throw new Error(`still inside the Deserted Keep after ${tries} slashes`);
    return tries;
}

/**
 * The ridge gate (52) into the course; a fail drops into the wolf pit beside it, so walk back and
 * retry. The gate is clicked from the corridor or within reach of the stage, and the server walks
 * the last tiles; any other start walks to the stage first (never to a tile beside the gate).
 * Returns the clicks it took: 0 when the player is already in the course.
 */
async function crossRidge(ctx: StepContext<unknown>): Promise<number> {
    const sdk = ctx.sdk;
    for (let tries = 1; tries <= 6; tries++) {
        let s = sdk.getState()!;
        const side = ridgeSide(s);
        if (side === 'course') return tries - 1;
        if (side === 'north' || side === 'away') {
            const r = await ctx.bot.walkTo(RIDGE_GATE.stage[0], RIDGE_GATE.stage[1], RIDGE_CLICK_RANGE, { timeout: 100 * tickMs() });
            s = sdk.getState()!;
            if (!r.success || ridgeSide(s) !== 'gate') throw new Error(`walk to the ridge gate: ${r.message} (at ${s.player?.worldX},${s.player?.worldZ})`);
        }
        void sdk.sendInteractLoc(RIDGE_GATE.x, RIDGE_GATE.z, RIDGE_GATE.id, 1);
        const r = await waitUntil(sdk, st => inWildCourse(st) || st.gameMessages.some(m => /wolf pit/i.test(m.text) && m.tick > s.tick), { maxTicks: 30 });
        if (r.ok && inWildCourse(r.state)) return tries;
        await waitUntil(sdk, st => st.tick >= (r.state?.tick ?? s.tick) + 3, { maxTicks: 6 });
    }
    throw new Error('could not cross the ridge in 6 tries');
}

const walkWilderness = (o: AgilityOptions): Step => ({
    name: 'agility:walk-wilderness',
    preconditions: s => (inWildCourse(s) || agilityLevel(s) >= o.to || agilityLevel(s) >= 52 ? true : `agility ${agilityLevel(s)} is below the ridge gate's 52`),
    run: async ctx => {
        const s = stateOf(ctx);
        if (agilityLevel(s) >= o.to || inWildCourse(s)) return;
        const t0 = s.tick;
        const p = s.player!;
        if (p.worldZ < 3800) {
            if (p.worldX > 2700) throw new Error(`no route to the Wilderness course from (${p.worldX},${p.worldZ}); walk to the Gnome Stronghold or the Ardougne lever first`);
            await walkRoute(ctx, ROUTES.gnomeToLever, o);
            await pullLever(ctx);
        }
        const inKeep = (ctx.sdk.getState()?.player?.worldX ?? 0) > 3140;
        const slashes = inKeep ? await leaveKeep(ctx) : 0;
        const seen = (ctx.sdk.getState()?.nearbyPlayers ?? []).map(q => ({ name: q.name, combatLevel: q.combatLevel, distance: q.distance }));
        // At the gate, or north of its line (the corridor, the wolf pit), crossRidge goes from where
        // the player stands: a route leg from there would path through the gate.
        const ridgeFrom = ridgeSide(ctx.sdk.getState());
        if (ridgeFrom === 'away') await walkRoute(ctx, ROUTES.keepToRidge, o);
        const ridge = await crossRidge(ctx);
        row(ctx, 'agility:walk-wilderness:legs', ctx.sdk.getState()?.tick ?? -1, { ticks: (ctx.sdk.getState()?.tick ?? t0) - t0, slashes, ridgeFrom, ridgeTries: ridge, playersAtKeep: seen });
    },
    postconditions: s => (inWildCourse(s) || agilityLevel(s) >= o.to ? true : 'not in the Wilderness course'),
    logoutSafe: true
});

/** The module's steps for a target level (module convention: speedrun/skills/<skill>.ts). */
export function steps(raw: Record<string, unknown> = {}): Step[] {
    const o = parseOptions(raw);
    const bands = planBands(o.to);
    const out: Step[] = [walkGnome(bands[0]!.to, o), bandStep(bands[0]!, o, bands.length === 1)];
    if (bands[1]) out.push(walkWilderness(o), bandStep(bands[1], o, true));
    return out;
}
