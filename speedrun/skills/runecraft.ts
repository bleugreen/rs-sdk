// S06 and S21: Runecraft at the altar inside the room (STEP-MANIFEST.md entry 9;
// docs/speedrun/skills/runecraft.md, "The step module"). SCORED stands beside the
// altar and never leaves; a giver beside it trades a load of rune essence (27; 26 at
// S06, S06_LOAD) per cycle on a
// tick-exact schedule that the page's rc-cycle program runs
// (server/webclient/src/bot/programs/rc-cycle.ts). This module drives that program:
//
//   - giver feed: the givers' status files (giver-<account>.json) are read on every
//     published state and the loaded ones go to the page through the program's input
//     op, each with its own schedule (tuned only for a giver the server handles
//     before SCORED, which logging in first gives);
//   - cue relay: the page cannot write files, so the turns and beacons it shares are
//     copied into cue.json, one cue session per program run, with a stop cue on every
//     end so armed givers stand down;
//   - fault ladder: failed tuned turns restart the program with every giver robust;
//     a further fault falls back to the stock reacting cycle.
//
// Level-ups need nothing while the program runs: the trade request on T+5 closes
// the level-up dialog (runecraft.md section 4; 8 of 8 measured at air 1). A
// Node-side dialog click could land inside the tick-exact schedule, so
// lib/levelup.ts is used only after the program ends, for the last craft's dialog.

import { join } from 'node:path';
import type { BotWorldState, NearbyLoc } from '../../sdk/types';
import { canonName, cueDir, CueWriter, readJson, readStatuses, RUN_DIR, type GiverStatus, type Schedule, type Turn } from '../helpers/altar-cue';
import type { LauncherStatus } from '../helpers/standalone';
import { classifyPage } from '../lib/dialogue';
import { levelUpStep, newWatcherMemory, type WatcherMemory } from '../lib/levelup';
import { ALTARS } from '../lib/runecraft';
import {
    awaitProgram,
    ProgramError,
    rcCueFields,
    sendProgramInput,
    startProgram,
    stopProgram,
    type AwaitOptions,
    type ProgramSdk,
    type ProgramStatus,
    type RcSchedule,
    type RcShared
} from '../lib/programs';
import type { Session } from '../lib/session';
import type { TickLog } from '../lib/ticks';
import { receiveFrom } from '../lib/trade';
import { tickMs, waitUntil } from '../lib/wait';
import type { Observed, RunnerSession, Step, StepContext } from '../runner/step';

export const skill = 'runecraft';

export type AltarName = 'air' | 'nature' | 'body';
export type ScheduleMode = 'tuned' | 'robust' | 'auto';
export type { RcSchedule };

export interface Tile {
    x: number;
    z: number;
}

export interface AltarRoom {
    /** Runecraft level the altar needs (runecraft.dbrow). */
    minLevel: number;
    talisman: RegExp;
    rune: RegExp;
    /** SCORED's tile, measured; null where it has only been derived from the altar loc. */
    stand: Tile | null;
    /** Where the ruins put you in the room (runecraft.dbrow enter_coord, plane 0). */
    enter: Tile;
}

export const ALTAR_ROOMS: Record<AltarName, AltarRoom> = {
    air: { minLevel: 1, talisman: /^air talisman$/i, rune: /^air rune$/i, stand: { x: 2844, z: 4832 }, enter: { x: 2841, z: 4830 } },
    nature: { minLevel: 44, talisman: /^nature talisman$/i, rune: /^nature rune$/i, stand: { x: 2400, z: 4839 }, enter: { x: 2400, z: 4835 } },
    body: { minLevel: 20, talisman: /^body talisman$/i, rune: /^body rune$/i, stand: null, enter: { x: 2523, z: 4838 } }
};

/**
 * Inside the altar's room, from the player's position (altar-room.ts inRoom: within 24 tiles
 * of the entry tile). Position rather than the altar loc: right after a login the published
 * position is current while the nearby locs are still empty, and the resume walk observes
 * that first state.
 */
export function inRoom(s: BotWorldState, altar: AltarName): boolean {
    const p = s.player;
    const e = ALTAR_ROOMS[altar].enter;
    return !!p && p.level === 0 && Math.max(Math.abs(p.worldX - e.x), Math.abs(p.worldZ - e.z)) <= 24;
}

const ALTAR = /^altar$/i;
const ESSENCE = /^rune essence$/i;
const CRAFT = /^craft/i;
/** Essence per trade unless a band says otherwise: the inventory's 28 slots less the rune stack. */
export const LOAD = 27;
/**
 * S06's load. SCORED carries T06-07's Falador teleport law runes through S06 beside the air
 * runes, which leaves 26 free slots. Seven crafts of 26 still reach Runecraft 44 (seven of 27
 * end at 45), so the band keeps its 7 crafts; S06's givers carry `essence: 26` (altar-giver.ts).
 */
export const S06_LOAD = 26;
const TALISMAN_DROPS = 3;
/** Game xp per base xp point (fly.toml NODE_XPRATE; rc-cycle's XP_RATE). */
export const XP_RATE = 25;

/** Game xp of one craft of a full load at `altar` (base xp per essence: speedrun/lib/runecraft.ts ALTARS). */
export function craftXp(altar: AltarName, load = LOAD): number {
    return load * ALTARS[altar]!.xp * XP_RATE;
}

/** An xp target `crafts` full loads past `xp0`, half a load short so rounding never adds or drops a craft. */
export function xpAfterCrafts(altar: AltarName, xp0: number, crafts: number, load = LOAD): number {
    return xp0 + Math.round((crafts - 0.5) * craftXp(altar, load));
}

/** One band of a step: crafting at `altar` from Runecraft `from` until `untilLevel` (or `untilXp`, for a lab run of N cycles). */
export interface Band {
    id: string;
    altar: AltarName;
    from: number;
    untilLevel: number;
    untilXp?: number;
    /** Essence per trade (default LOAD). The band's givers must carry exactly this many (`essence`). */
    load?: number;
}

// ------------------------------------------------------------------ views
// The step reads and writes files whose format rs/41's giver side owns
// (speedrun/helpers/altar-cue.ts, standalone.ts) and drives rc-cycle through
// speedrun/lib/programs.ts. These are the parts of those types it reads, narrowed
// so a scripted test only has to fill in what the step uses.

/** A giver's status file, as far as the feed reads it. */
export type GiverStatusView = Pick<GiverStatus, 'account' | 'phase' | 'loggedInAt' | 'essence' | 'inRoom' | 'readyAt' | 'ms'>;

/** <runDir>/launcher.json, as far as the schedule choice reads it. */
export type LauncherView = Pick<LauncherStatus, 'helpersReady' | 'ms'> & {
    accounts: Pick<LauncherStatus['accounts'][number], 'account' | 'receiver' | 'loggedInAt'>[];
};

/**
 * A cue turn. 'stock' is the reacting turn of the last fallback rung: the giver side
 * on the base does not know it yet (rs/163 adds it), and CueWriter writes the turn
 * through unchanged.
 */
export type CueTurn = Omit<Turn, 'schedule'> & { schedule?: Schedule | 'stock' };

/** What a cue write carries (CueWriter.write's fields). */
export type CueFields = Omit<Parameters<CueWriter['write']>[0], 'turns'> & { turns: CueTurn[] };

/** One cue session (a CueWriter): the receiver is stored as a hash of its name. */
export interface CueSink {
    readonly session: string;
    write(fields: CueFields): unknown;
}

type RcResult = RcShared['results'][number];

/** rc-cycle's turn result, as far as the schedule adaptation reads it. */
export type RcTurnResult = Pick<RcResult, 'giver' | 'T' | 'schedule' | 'outcome' | 'tick' | 'salvaged' | 'order' | 'detail'> & Partial<Pick<RcResult, 'seen'>>;

/** rc-cycle's shared data, as far as the step reads it. */
export type RcSharedView = Pick<RcShared, 'v' | 'waiting' | 'queue' | 'stop'> & { results: RcTurnResult[] };

/** The program's shared data (ProgramStatus.shared). */
export function rcShared(st: ProgramStatus | null | undefined): RcSharedView | undefined {
    const s = (st as { shared?: unknown } | null | undefined)?.shared as RcSharedView | undefined;
    return st?.name === 'rc-cycle' && s?.v === 1 ? s : undefined;
}

export interface GiverEntry {
    name: string;
    schedule: RcSchedule;
    readyAt?: number;
}

type Sdk = RunnerSession['sdk'];

export interface RunecraftDeps {
    startProgram(sdk: ProgramSdk, name: string, params: Record<string, unknown>): Promise<ProgramStatus>;
    awaitProgram(sdk: ProgramSdk, runId: number, opts: AwaitOptions): Promise<ProgramStatus>;
    stopProgram(sdk: ProgramSdk): Promise<ProgramStatus | null>;
    sendProgramInput(sdk: ProgramSdk, data: unknown): Promise<unknown>;
    /** The cue's fields from a status, and a key that changes when they do. */
    rcCueFields(status: ProgramStatus | null | undefined): (CueFields & { key: string }) | null;
    /** A new cue session. */
    openCue(dir: string, receiverName: string): CueSink;
    readStatuses(dir: string): GiverStatusView[];
    readLauncher(runDir: string): LauncherView | null;
    /** RC_CUE_DIR, else run-machine/rc-cue. */
    cueDir(): string;
    receiveFrom(sdk: Sdk, partner: string, opts: { want?: { item: string | RegExp; amount?: number }[]; maxTicks?: number; openTimeoutMs?: number }): Promise<{ ok: boolean; ticks?: number; reason?: string }>;
    now(): number;
}

/** <runDir>/launcher.json (written by standalone.ts), or null when it is missing or malformed. */
export function readLauncherFile(runDir: string): LauncherView | null {
    const v = readJson<LauncherView>(join(runDir, 'launcher.json'));
    return v && typeof v.ms === 'number' && Array.isArray(v.accounts) ? v : null;
}

export const defaultDeps: RunecraftDeps = {
    startProgram,
    awaitProgram,
    stopProgram,
    sendProgramInput,
    rcCueFields,
    openCue: (dir, receiverName) => new CueWriter(dir, receiverName),
    readStatuses,
    readLauncher: readLauncherFile,
    cueDir: () => cueDir(),
    receiveFrom,
    now: () => Date.now()
};

// ------------------------------------------------------------------ state readers

function rcSkill(s: BotWorldState) {
    return s.skills.find(k => k.name.toLowerCase() === 'runecraft');
}

export function rcLevel(s: BotWorldState): number {
    return rcSkill(s)?.baseLevel ?? 0;
}

export function rcXp(s: BotWorldState): number {
    return rcSkill(s)?.experience ?? 0;
}

export function reached(s: BotWorldState, band: Band): boolean {
    if (band.untilXp !== undefined) return rcXp(s) >= band.untilXp;
    return rcLevel(s) >= band.untilLevel;
}

export function findAltar(s: BotWorldState): NearbyLoc | undefined {
    return s.nearbyLocs.filter(l => ALTAR.test(l.name)).sort((a, b) => a.distance - b.distance)[0];
}

/** SCORED's tile: south of the 3x3 altar's middle, the altar's south-west corner + (1,-1) (altar-room.ts roomTiles). */
export function standTile(altar: Tile): Tile {
    return { x: altar.x + 1, z: altar.z - 1 };
}

export function essenceHeld(s: BotWorldState): number {
    return s.inventory.filter(i => ESSENCE.test(i.name)).reduce((n, i) => n + i.count, 0);
}

/** Inventory items that are not this altar's talisman, rune essence or this altar's rune: each takes a slot a trade of 27 needs. */
export function otherItems(s: BotWorldState, altar: AltarName): string[] {
    const room = ALTAR_ROOMS[altar];
    return s.inventory.filter(i => !room.talisman.test(i.name) && !ESSENCE.test(i.name) && !room.rune.test(i.name)).map(i => i.name);
}

// ------------------------------------------------------------------ schedule choice

export const LAUNCHER_FRESH_MS = 10_000;
export const STATUS_FRESH_MS = 5_000;

/**
 * The first guess at one giver's schedule, before the page has observed its processing
 * order (ScheduleAdapter.choose). Tuned needs the giver handled before SCORED in each
 * server tick, which a login before SCORED's gives within one IP bucket (runecraft.md
 * section 4); the guess grants it only on the launcher's word: launcher.json fresh, every helper
 * online, and this giver's login before SCORED's. `scoredLoggedInAt` is the
 * session's last client launch, never later than its login, so the test only
 * errs toward robust.
 */
export function giverSchedule(mode: ScheduleMode, launcher: LauncherView | null, giver: string, scoredLoggedInAt: number | null, now: number): { schedule: RcSchedule; why: string } {
    if (mode !== 'auto') return { schedule: mode, why: `forced ${mode}` };
    if (!launcher) return { schedule: 'robust', why: 'no launcher.json' };
    if (now - launcher.ms > LAUNCHER_FRESH_MS) return { schedule: 'robust', why: `launcher.json is ${Math.round((now - launcher.ms) / 1000)} s old` };
    if (!launcher.helpersReady) return { schedule: 'robust', why: 'helpers not ready' };
    if (scoredLoggedInAt === null) return { schedule: 'robust', why: "SCORED's login time unknown" };
    const a = launcher.accounts.find(x => canonName(x.account) === canonName(giver));
    if (!a) return { schedule: 'robust', why: 'giver not in launcher.json' };
    if (a.loggedInAt === null) return { schedule: 'robust', why: 'giver login time unknown' };
    if (!(a.loggedInAt < scoredLoggedInAt)) return { schedule: 'robust', why: 'giver logged in after SCORED' };
    return { schedule: 'tuned', why: 'giver logged in first' };
}

/**
 * Per-giver demotion to robust: a giver whose tuned turns fail twice in a row is
 * fed robust for the rest of the step. A turn that gave counts as a success, a
 * salvaged one included (it already cost robust's 8). no-giver says nothing about
 * the schedule and is skipped.
 */
export class ScheduleAdapter {
    private readonly seen = new Set<string>();
    private readonly streak = new Map<string, number>();
    /** The processing order rc-cycle read off the trade screens on each giver's latest turn that showed one. */
    private readonly order = new Map<string, 'giver-first' | 'scored-first'>();
    /** Demoted givers: name key -> the name as the results gave it. */
    private readonly out = new Map<string, string>();

    constructor(readonly misses = 2) {}

    /** Fold in a status's results (re-sent results are ignored); returns the givers demoted by them. */
    observe(results: readonly RcTurnResult[] | undefined): string[] {
        const demoted: string[] = [];
        for (const r of results ?? []) {
            const id = `${canonName(r.giver)}:${r.T}:${r.tick}:${r.outcome}`;
            if (this.seen.has(id)) continue;
            this.seen.add(id);
            const k = canonName(r.giver);
            if (r.order) this.order.set(k, r.order);
            if (r.schedule !== 'tuned' || r.outcome === 'no-giver') continue;
            if (r.outcome === 'gave') {
                this.streak.set(k, 0);
                continue;
            }
            const n = (this.streak.get(k) ?? 0) + 1;
            this.streak.set(k, n);
            if (n >= this.misses && !this.out.has(k)) {
                this.out.set(k, r.giver);
                demoted.push(r.giver);
            }
        }
        return demoted;
    }

    isDemoted(giver: string): boolean {
        return this.out.has(canonName(giver));
    }

    /**
     * The `auto` schedule for a giver whose launcher-based guess is `guess`. The order the
     * page observed decides once there is one: it covers login order, the engine's IP buckets
     * (a giver on a lower bucket is handled first even when it logged in later) and a relog
     * mid-session, which a login time only predicts. Two failed tuned turns demote for good.
     */
    choose(giver: string, guess: { schedule: RcSchedule; why: string }): { schedule: RcSchedule; why: string } {
        const k = canonName(giver);
        if (this.out.has(k)) return { schedule: 'robust', why: 'two tuned turns failed' };
        const o = this.order.get(k);
        if (o === 'giver-first') return { schedule: 'tuned', why: 'observed giver-first' };
        if (o === 'scored-first') return { schedule: 'robust', why: 'observed scored-first' };
        return guess;
    }

    get demoted(): string[] {
        return [...this.out.values()];
    }
}

// ------------------------------------------------------------------ giver feed

/**
 * The givers to offer the page, oldest-ready first: loaded (`load` essence), in the
 * room, ready or armed, with a status written in the last 5 s (a giver rewrites it
 * at least every 2 s).
 */
export function giverFeed(statuses: readonly GiverStatusView[], now: number, scheduleOf: (giver: string) => RcSchedule, load = LOAD): GiverEntry[] {
    return statuses
        .filter(s => (s.phase === 'ready' || s.phase === 'armed') && s.inRoom && now - s.ms <= STATUS_FRESH_MS && s.essence >= load)
        .sort((a, b) => (a.readyAt ?? Infinity) - (b.readyAt ?? Infinity))
        .map(s => ({ name: s.account, schedule: scheduleOf(s.account), ...(s.readyAt !== null ? { readyAt: s.readyAt } : {}) }));
}

export function feedKey(entries: readonly GiverEntry[]): string {
    return JSON.stringify(entries.map(e => [e.name, e.schedule, e.readyAt ?? null]));
}

/** Sends the feed to the page only when it changes, one input at a time. */
export class FeedSender {
    /** The newest feed sent or queued: what the page holds once the sends land. */
    private latest: string | null;
    private pending: GiverEntry[] | null = null;
    private inflight: Promise<void> | null = null;
    sends = 0;
    lastError: string | null = null;

    constructor(
        private readonly send: (entries: GiverEntry[]) => Promise<unknown>,
        initial: readonly GiverEntry[] = []
    ) {
        this.latest = feedKey(initial);
    }

    offer(entries: GiverEntry[]): void {
        const key = feedKey(entries);
        if (key === this.latest) return;
        this.latest = key;
        this.pending = entries;
        this.pump();
    }

    private pump(): void {
        if (this.inflight || !this.pending) return;
        const entries = this.pending;
        this.pending = null;
        const key = feedKey(entries);
        this.sends++;
        this.inflight = this.send(entries)
            .then(
                () => {},
                (e: unknown) => {
                    // the program may have ended between the read and the send; the next offer retries
                    this.lastError = e instanceof Error ? e.message : String(e);
                    if (this.latest === key) this.latest = null;
                }
            )
            .finally(() => {
                this.inflight = null;
                this.pump();
            });
    }

    async drain(): Promise<void> {
        while (this.inflight) await this.inflight;
    }
}

// ------------------------------------------------------------------ cue relay

/**
 * Copies what the page shares into cue.json: a new cue session for every program
 * run, a write only when the turns, schedule, open or stop change, and a stop
 * cue at every end (the page sets stop on done and on its own faults; a dropped
 * page or a stop from this side gets one from the last fields seen).
 */
export class CueRelay {
    private sink: CueSink | null = null;
    private runId = -1;
    private key: string | null = null;
    private last: CueFields | null = null;
    writes = 0;
    sessions: string[] = [];

    constructor(
        private readonly open: () => CueSink,
        private readonly fieldsOf: (st: ProgramStatus) => (CueFields & { key: string }) | null
    ) {}

    update(st: ProgramStatus | null | undefined): void {
        if (!st) return;
        if (st.runId !== this.runId) {
            this.stop();
            this.runId = st.runId;
            this.sink = null;
            this.key = null;
            this.last = null;
        }
        const f = this.fieldsOf(st);
        if (!f) return;
        const { key, ...cue } = f;
        if (key === this.key) return;
        if (!this.sink) {
            this.sink = this.open();
            this.sessions.push(this.sink.session);
        }
        this.sink.write(cue);
        this.writes++;
        this.key = key;
        this.last = cue;
    }

    /** End this run's cue session with a stop cue, taking the final status's fields when it is this run's. */
    stop(final?: ProgramStatus | null): void {
        if (final && final.runId === this.runId) this.update(final);
        if (!this.sink || !this.last || this.last.stop) return;
        const cue: CueFields = { ...this.last, stop: true };
        this.sink.write(cue);
        this.writes++;
        this.last = cue;
    }
}

// ------------------------------------------------------------------ faults

export type FaultKind = 'no-altar' | 'turns-failed' | 'dropped' | 'other';

/** How the ladder treats an error from the program: see Driver.ladder. */
export function classifyFault(e: unknown): FaultKind {
    const msg = e instanceof Error ? e.message : String(e);
    if (/page reloaded|tab wedged|no state for/.test(msg)) return 'dropped';
    if (!(e instanceof ProgramError)) return 'other';
    if (/no altar in sight/.test(msg)) return 'no-altar';
    if (/turns in a row failed/.test(msg)) return 'turns-failed';
    return 'other';
}

export class GiverWaitError extends Error {
    constructor(readonly ticks: number) {
        super(`no loaded giver for ${ticks} ticks (the restock logout is not built; check the givers' status files)`);
        this.name = 'GiverWaitError';
    }
}

// ------------------------------------------------------------------ the step

export interface RunecraftOptions {
    /** S21's altar: nature (the manifest) or body. */
    s21Altar?: 'nature' | 'body';
    /** auto: tuned per giver on the launcher's word (giverSchedule), else robust. */
    schedule?: ScheduleMode;
    /** Caps the last band (a lab run stops early). */
    untilLevel?: number;
    /** Cue directory (default altar-cue.ts cueDir(): RC_CUE_DIR or run-machine/rc-cue). */
    cueDir?: string;
    /** Where launcher.json is (default run-machine/). */
    runDir?: string;
    /** After the robust restart faults too: the stock reacting cycle, or throw. */
    fallback?: 'stock' | 'none';
    /** Wall ms SCORED logged in at, for the schedule choice (default the session's last client launch). */
    scoredLoggedInAt?: (session: RunnerSession) => number | null;
    /** Ticks without a loaded giver before the step gives up (default 300, about 3 restock round trips). */
    giverWaitTicks?: number;
    /** Passed to rc-cycle as is (open, lead, maxGiverDistance, maxFailures, craftOption, stallTicks). */
    programParams?: Record<string, unknown>;
    /** Dismiss the last craft's level-up dialog after the program ends (default true). */
    dismissLevelUp?: boolean;
    deps?: Partial<RunecraftDeps>;
}

export const DEFAULT_GIVER_WAIT_TICKS = 300;

/** The bands of `steps()`: S06 air 1-44, then S21 44-99 at nature (or body), capped by untilLevel. */
export function bands(opts: Pick<RunecraftOptions, 's21Altar' | 'untilLevel'> = {}): Band[] {
    const cap = opts.untilLevel ?? 99;
    const out: Band[] = [{ id: 'S06', altar: 'air', from: 1, untilLevel: Math.min(44, cap), load: S06_LOAD }];
    if (cap > 44) out.push({ id: 'S21', altar: opts.s21Altar ?? 'nature', from: 44, untilLevel: cap });
    return out;
}

export function stepName(band: Band): string {
    return `${band.id} runecraft`;
}

export function preconditions(s: BotWorldState, band: Band): true | string {
    if (!s.inGame || !s.player) return 'not in game';
    if (reached(s, band)) return true; // a band already passed is a no-op
    const lvl = rcLevel(s);
    const need = Math.max(band.from, ALTAR_ROOMS[band.altar].minLevel);
    if (lvl < need) return `Runecraft ${lvl} is below ${need} for the ${band.altar} altar`;
    if (!inRoom(s, band.altar)) return `not in the ${band.altar} altar room (at ${s.player.worldX},${s.player.worldZ})`;
    const altar = findAltar(s);
    const known = ALTAR_ROOMS[band.altar].stand;
    const stand = altar && standTile(altar);
    if (stand && known && (stand.x !== known.x || stand.z !== known.z)) return `the altar in sight (${altar!.x},${altar!.z}) is not the ${band.altar} altar`;
    // A trade of `load` essence needs that many free slots beside the altar's rune stack (28 in all).
    const load = band.load ?? LOAD;
    const other = otherItems(s, band.altar);
    if (other.length > 27 - load) return `${other.length} other items (${[...new Set(other)].join(', ')}): need ${load} free slots`;
    return true;
}

export function altarStep(band: Band, opts: RunecraftOptions = {}): Step<any> {
    const name = stepName(band);
    const entry = (ctx: StepContext<any>) => new Driver(ctx, band, name, opts).run();
    return {
        name,
        preconditions: s => preconditions(s, band),
        run: entry,
        resume: entry,
        postconditions: s => (reached(s, band) ? true : band.untilXp !== undefined ? `Runecraft xp ${rcXp(s)} < ${band.untilXp}` : `Runecraft ${rcLevel(s)} < ${band.untilLevel}`),
        logoutSafe: true,
        done: (o: Observed) => reached(o.state, band),
        inProgress: (o: Observed) => {
            const s = o.state;
            return !!s.player && !reached(s, band) && rcLevel(s) > band.from && inRoom(s, band.altar);
        }
    };
}

/** The step-module convention (`skill`, `steps()`): S06 air 1-44, S21 nature (or body) 44-99. */
export function steps(opts: RunecraftOptions = {}): Step<any>[] {
    return bands(opts).map(b => altarStep(b, opts));
}

// ------------------------------------------------------------------ driver

type Rung = 'program' | 'robust-restart' | 're-enter' | 'stock';

function histogram(gaps: number[]): Record<string, number> {
    const h: Record<string, number> = {};
    for (const g of gaps) h[g] = (h[g] ?? 0) + 1;
    return h;
}

class Driver {
    private readonly deps: RunecraftDeps;
    private readonly mode: ScheduleMode;
    private readonly adapter = new ScheduleAdapter();
    private readonly assigned = new Map<string, { schedule: RcSchedule; why: string }>();
    /** Talisman drops sent on entry (more than 1: the server ignored one). */
    private talismanDrops = 0;
    private readonly rungs: Rung[] = [];
    private cueDirPath: string | null = null;

    constructor(
        private readonly ctx: StepContext<any>,
        private readonly band: Band,
        private readonly name: string,
        private readonly opts: RunecraftOptions
    ) {
        this.deps = { ...defaultDeps, ...opts.deps };
        this.mode = opts.schedule ?? 'auto';
    }

    private get sdk(): Sdk {
        return this.ctx.sdk;
    }

    private state(): BotWorldState {
        const s = this.sdk.getState();
        if (!s) throw new Error('no state');
        return s;
    }

    private get cueDir(): string {
        return (this.cueDirPath ??= this.opts.cueDir ?? this.deps.cueDir());
    }

    private openCue(): CueSink {
        return this.deps.openCue(this.cueDir, this.ctx.session.name);
    }

    private scoredLoggedInAt(): number | null {
        if (this.opts.scoredLoggedInAt) return this.opts.scoredLoggedInAt(this.ctx.session);
        return (this.ctx.session as Partial<Session>).launchedAt || null;
    }

    /** Each loaded giver with its schedule for this segment. */
    private feed(forceRobust: boolean): GiverEntry[] {
        const now = this.deps.now();
        const launcher = this.mode === 'auto' && !forceRobust ? this.deps.readLauncher(this.opts.runDir ?? RUN_DIR) : null;
        const scored = this.scoredLoggedInAt();
        return giverFeed(this.deps.readStatuses(this.cueDir), now, g => {
            const choice = forceRobust
                ? { schedule: 'robust' as const, why: this.mode === 'robust' ? 'forced robust' : 'robust restart' }
                : this.mode === 'auto'
                  ? this.adapter.choose(g, giverSchedule('auto', launcher, g, scored, now))
                  : this.adapter.isDemoted(g)
                    ? { schedule: 'robust' as const, why: 'two tuned turns failed' }
                    : giverSchedule(this.mode, launcher, g, scored, now);
            this.assigned.set(g, choice);
            return choice.schedule;
        }, this.band.load ?? LOAD);
    }

    async run(): Promise<void> {
        if (reached(this.state(), this.band)) return;
        await this.enter();
        await this.dropTalisman();
        await this.ladder();
    }

    /** Step onto the stand tile (0-2 tiles from where the room puts you). */
    private async enter(): Promise<void> {
        // after a login the scene, and so the altar loc, arrives a few frames after the position
        const seen = await waitUntil(this.sdk, st => !!findAltar(st), { maxTicks: 10 });
        const s = seen.ok ? seen.state : this.state();
        const altar = findAltar(s);
        if (!altar) throw new Error(`no altar in sight: SCORED must be inside the ${this.band.altar} altar room`);
        const tile = standTile(altar);
        const on = (st: BotWorldState) => st.player?.worldX === tile.x && st.player?.worldZ === tile.z;
        if (on(s)) return;
        await this.ctx.bot.walkTo(tile.x, tile.z, 0);
        const w = await waitUntil(this.sdk, on, { maxTicks: 6 });
        if (!w.ok) throw new Error(`could not stand on ${tile.x},${tile.z} beside the altar`);
    }

    /**
     * SCORED drops the talisman after entering (runecraft.md section 7): its slot is one of the 27
     * a trade needs. The server ignores a drop sent during a delay without a message, and a
     * talisman left in the inventory fails every trade after the first craft (the rune stack takes
     * the 28th slot), so the drop is checked and re-sent.
     */
    private async dropTalisman(): Promise<void> {
        const talisman = ALTAR_ROOMS[this.band.altar].talisman;
        const held = (s: BotWorldState) => s.inventory.find(i => talisman.test(i.name));
        const replies: string[] = [];
        for (let attempt = 0; attempt < TALISMAN_DROPS; attempt++) {
            const t = held(this.state());
            if (!t) return;
            this.talismanDrops++;
            const r = await this.sdk.sendDropItem(t.slot);
            replies.push(`slot ${t.slot}: ${r?.success === false ? `refused (${r.message})` : 'sent'}`);
            if ((await waitUntil(this.sdk, s => !held(s), { maxTicks: 3 })).ok) return;
        }
        const s = this.state();
        const dialog = s.dialog?.isOpen ? `dialog open (${(s.dialog.text ?? '').slice(0, 60)})` : 'no dialog';
        const modal = s.interface?.isOpen ? `interface ${s.interface.interfaceId} open` : 'no interface';
        throw new Error(`the ${this.band.altar} talisman is still held after ${TALISMAN_DROPS} drops (${replies.join('; ')}; ${dialog}; ${modal}); a trade of ${this.band.load ?? LOAD} essence needs its slot. The server ignores inventory ops while the inventory tab is hidden, as on a new account that never left the tutorial state (S00's skip opens the tabs)`);
    }

    /**
     * The fault ladder. The program faults after maxFailures failed turns in a row: if any
     * giver was on tuned, restart once with every giver robust; a further fault goes to the
     * stock reacting cycle (fallback 'stock') or throws. 'no altar in sight' re-enters the
     * stand tile once. A dropped page is rethrown for runResumable, whose resume restarts
     * the program (it re-derives its anchor from the inventory and trade screen).
     */
    private async ladder(): Promise<void> {
        let forceRobust = this.mode === 'robust';
        let reentered = false;
        this.rungs.push('program');
        for (;;) {
            let usedTuned = false;
            try {
                usedTuned = await this.programSegment(forceRobust);
                break;
            } catch (e) {
                usedTuned ||= e instanceof SegmentError && e.usedTuned;
                const cause = e instanceof SegmentError ? e.cause : e;
                const kind = classifyFault(cause);
                if (kind === 'no-altar' && !reentered) {
                    reentered = true;
                    this.rungs.push('re-enter');
                    await this.enter();
                    continue;
                }
                if (kind === 'turns-failed' && !forceRobust && usedTuned) {
                    forceRobust = true;
                    this.rungs.push('robust-restart');
                    continue;
                }
                if (kind === 'turns-failed' && (this.opts.fallback ?? 'stock') === 'stock') {
                    this.rungs.push('stock');
                    await this.stockSegment();
                    break;
                }
                throw cause;
            }
        }
        if (this.opts.dismissLevelUp ?? true) await this.dismissLevelUp();
    }

    private lastRunning: BotWorldState | null = null;

    /** One rc-cycle run to the target. Resolves with whether any giver was on tuned. */
    private async programSegment(forceRobust: boolean): Promise<boolean> {
        const { sdk, deps } = this;
        const t0 = Date.now();
        this.assigned.clear();
        const initial = this.feed(forceRobust);
        const base: RcSchedule = forceRobust ? 'robust' : this.mode === 'tuned' ? 'tuned' : 'robust';
        const target = this.band.untilXp !== undefined ? { untilXp: this.band.untilXp } : { untilLevel: this.band.untilLevel };
        const params = { ...this.opts.programParams, ...target, schedule: base, givers: initial };
        const relay = new CueRelay(
            () => this.openCue(),
            st => deps.rcCueFields(st)
        );
        const sender = new FeedSender(e => deps.sendProgramInput(sdk, { givers: e }), initial);
        const waitBound = this.opts.giverWaitTicks ?? DEFAULT_GIVER_WAIT_TICKS;
        let waitingSince: number | null = null;
        let stopping: GiverWaitError | null = null;
        let last: ProgramStatus | null = null;
        let final: ProgramStatus | null = null;
        let error: unknown = null;
        const usedTuned = () => base === 'tuned' || [...this.assigned.values()].some(a => a.schedule === 'tuned');

        const started = await deps.startProgram(sdk, 'rc-cycle', params);
        last = started;
        try {
            relay.update(started);
            final = await deps.awaitProgram(sdk, started.runId, {
                onProgress: st => {
                    last = st;
                    this.lastRunning = sdk.getState();
                    relay.update(st);
                    const shared = rcShared(st);
                    this.adapter.observe(shared?.results);
                    if (stopping) return;
                    sender.offer(this.feed(forceRobust));
                    if (shared?.waiting === 'giver') {
                        waitingSince ??= st.tick;
                        if (st.tick - waitingSince > waitBound) {
                            stopping = new GiverWaitError(st.tick - waitingSince);
                            void deps.stopProgram(sdk).catch(() => {});
                        }
                    } else {
                        waitingSince = null;
                    }
                }
            });
            if (final.phase !== 'done') {
                if (stopping) throw stopping;
                throw new Error(`rc-cycle run ${started.runId} ended ${final.phase} (another program was started?)`);
            }
            return usedTuned();
        } catch (e) {
            error = e;
            if (e instanceof ProgramError && e.status && e.status.runId === started.runId) final = e.status;
            throw new SegmentError(e, usedTuned());
        } finally {
            relay.stop(final);
            await sender.drain();
            this.programRow(final ?? last, error, forceRobust, relay, t0);
        }
    }

    /** One `kind: 'program'` row per program end, with its counters and the schedules used. */
    private programRow(st: ProgramStatus | null, error: unknown, forceRobust: boolean, relay: CueRelay, t0: number): void {
        const { log, session } = this.ctx;
        const tick = this.sdk.getState()?.tick ?? -1;
        const startTick = st?.startedTick ?? tick;
        const endTick = st?.endedTick ?? st?.tick ?? tick;
        const summary = (st?.phase === 'done' ? st.result : st?.faultDetail) as Record<string, unknown> | undefined;
        const shared = rcShared(st);
        log.append({
            v: 1,
            kind: 'program',
            runId: log.runId,
            account: session.name,
            sessionId: session.sessionId,
            step: this.name,
            startTick,
            endTick,
            ticks: Math.max(0, endTick - startTick),
            wallMs: Date.now() - t0,
            ok: st?.phase === 'done' && !error,
            ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}),
            meta: {
                program: 'rc-cycle',
                runId: st?.runId ?? null,
                phase: st?.phase ?? null,
                rung: forceRobust && this.mode !== 'robust' ? 'robust-restart' : 'program',
                mode: this.mode,
                ...(summary ? { summary } : {}),
                counters: st?.counters ?? {},
                // the session's first trade: ticks from the program's start to its first craft
                ...(st?.marks?.crafts && st.marks.crafts.count === st.marks.crafts.ticks.length && st.marks.crafts.ticks.length ? { firstCraftAfter: st.marks.crafts.ticks[0]! - startTick } : {}),
                schedules: Object.fromEntries([...this.assigned].map(([g, a]) => [g, a.schedule])),
                why: Object.fromEntries([...this.assigned].map(([g, a]) => [g, a.why])),
                demoted: this.adapter.demoted,
                orders: (shared?.results ?? []).reduce<Record<string, number>>((h, r) => (r.order ? ((h[r.order] = (h[r.order] ?? 0) + 1), h) : h), {}),
                // the last failed turns as the page judged them, for the lab's diagnosis
                failed: (shared?.results ?? [])
                    .filter(r => r.outcome !== 'gave')
                    .slice(-6)
                    .map(r => ({ giver: r.giver, T: r.T, schedule: r.schedule, outcome: r.outcome, ...(r.detail ? { detail: r.detail } : {}), ...(r.seen ? { seen: r.seen } : {}) })),
                cueSessions: relay.sessions,
                cueWrites: relay.writes,
                talismanDrops: this.talismanDrops
            },
            tickMs: tickMs(),
            at: new Date().toISOString()
        });
    }

    /**
     * The stock reacting cycle (runecraft.md: 15 ticks, measured): a `stock` turn in the
     * cue, then a reacting receive through lib/trade.ts and an altar click, until the
     * target. The giver side needs a reacting `stock` turn kind for it (requested of rs/41).
     */
    private async stockSegment(): Promise<void> {
        const { sdk, deps } = this;
        const t0 = Date.now();
        const startTick = this.state().tick;
        const beacons: { tick: number; ms: number }[] = [];
        const onState = (s: BotWorldState) => {
            const last = beacons[beacons.length - 1];
            if (last && s.tick <= last.tick) return;
            beacons.push({ tick: s.tick, ms: deps.now() });
            if (beacons.length > 8) beacons.splice(0, beacons.length - 8);
        };
        onState(this.state());
        const unsubscribe = sdk.onStateUpdate(onState);
        const sink = this.openCue();
        const turns: CueTurn[] = [];
        const open = Number(this.opts.programParams?.open ?? 5);
        const lead = Number(this.opts.programParams?.lead ?? 3);
        const maxFailures = Number(this.opts.programParams?.maxFailures ?? 6);
        const craftTicks: number[] = [];
        /** Per cycle: the tick the turn was written, the receive's own ticks, the tick it returned, the craft's tick. */
        const timeline: { turn: number; receive: number; received: number; craft?: number; reason?: string }[] = [];
        let failures = 0;
        let trades = 0;
        let error: unknown = null;
        try {
            while (!reached(this.state(), this.band)) {
                if (failures >= maxFailures) throw new Error(`stock cycle: ${failures} cycles in a row failed`);
                if (essenceHeld(this.state()) === 0) {
                    const giver = await this.waitForGiver();
                    const turn = this.state().tick;
                    turns.push({ giver: giver.name, T: turn + lead, schedule: 'stock' });
                    sink.write({ beacons: [...beacons], turns: [...turns], schedule: 'robust', open });
                    const r = await deps.receiveFrom(sdk, giver.name, { want: [{ item: ESSENCE, amount: this.band.load ?? LOAD }], maxTicks: 30, openTimeoutMs: 30 * tickMs() });
                    trades++;
                    timeline.push({ turn, receive: r.ticks ?? -1, received: this.state().tick, ...(r.ok ? {} : { reason: r.reason }) });
                    if (!r.ok) {
                        failures++;
                        continue;
                    }
                }
                const landed = await this.craftOnce();
                const cycle = timeline[timeline.length - 1];
                if (cycle && landed !== null) cycle.craft = landed;
                if (landed === null) failures++;
                else {
                    failures = 0;
                    craftTicks.push(landed);
                }
            }
        } catch (e) {
            error = e;
            throw e;
        } finally {
            unsubscribe();
            if (beacons.length) sink.write({ beacons: [...beacons], turns: [...turns], schedule: 'robust', open, stop: true });
            const endTick = this.sdk.getState()?.tick ?? startTick;
            const gaps = craftTicks.slice(1).map((t, i) => t - craftTicks[i]!);
            this.ctx.log.append({
                v: 1,
                kind: 'program',
                runId: this.ctx.log.runId,
                account: this.ctx.session.name,
                sessionId: this.ctx.session.sessionId,
                step: this.name,
                startTick,
                endTick,
                ticks: Math.max(0, endTick - startTick),
                wallMs: Date.now() - t0,
                ok: !error,
                ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}),
                meta: {
                    program: 'stock',
                    rung: 'stock',
                    crafts: craftTicks.length,
                    trades,
                    gaps: histogram(gaps),
                    ticksPerCycle: gaps.length ? Math.round((gaps.reduce((a, b) => a + b, 0) / gaps.length) * 100) / 100 : null,
                    cueSession: sink.session,
                    timeline: timeline.slice(-12),
                    rungs: [...this.rungs]
                },
                tickMs: tickMs(),
                at: new Date().toISOString()
            });
        }
    }

    private async waitForGiver(): Promise<GiverEntry> {
        let found: GiverEntry | undefined;
        const pick = () => (found = this.feed(true)[0]) !== undefined;
        if (pick()) return found!;
        const bound = this.opts.giverWaitTicks ?? DEFAULT_GIVER_WAIT_TICKS;
        const w = await waitUntil(this.sdk, pick, { maxTicks: bound });
        if (!w.ok || !found) throw new GiverWaitError(bound);
        return found;
    }

    /** Click the altar and wait for the craft's xp; the tick it showed on, or null. */
    private async craftOnce(): Promise<number | null> {
        const s = this.state();
        const altar = findAltar(s);
        if (!altar) throw new ProgramError('stock cycle: no altar in sight', null);
        const op = altar.optionsWithIndex.find(o => CRAFT.test(o.text))?.opIndex ?? 1;
        const xp0 = rcXp(s);
        this.lastRunning = s;
        void this.sdk.sendInteractLoc(altar.x, altar.z, altar.id, op);
        const w = await waitUntil(this.sdk, st => rcXp(st) > xp0, { maxTicks: 5, after: s.tick });
        return w.ok ? w.tick : null;
    }

    /**
     * The last craft's level-up dialog opens when its delay ends, 4 ticks after the craft;
     * no trade request follows to close it, so it is answered here (lib/levelup.ts), on the
     * frame it shows.
     */
    private async dismissLevelUp(): Promise<void> {
        const before = this.lastRunning;
        const now = this.sdk.getState();
        if (!before || !now || rcLevel(now) <= rcLevel(before)) return;
        let mem: WatcherMemory = { ...newWatcherMemory(), base: new Map(before.skills.map(k => [k.name, k.baseLevel])) };
        let clicked = 0;
        await waitUntil(
            this.sdk,
            s => {
                const r = levelUpStep(mem, s);
                mem = r.mem;
                if (r.click) {
                    clicked++;
                    void this.sdk.sendClickDialog(0);
                    return false;
                }
                return clicked > 0 && classifyPage(s.dialog) !== 'continue';
            },
            { maxTicks: 7 }
        );
    }
}

/** A program segment's error, with whether any of its givers was on tuned (the ladder's robust-restart test). */
class SegmentError extends Error {
    constructor(
        override readonly cause: unknown,
        readonly usedTuned: boolean
    ) {
        super(cause instanceof Error ? cause.message : String(cause));
        this.name = 'SegmentError';
    }
}
