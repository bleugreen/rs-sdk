import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BotWorldState, InventoryItem, NearbyLoc, PlayerState } from '../../sdk/types';
import { cueAddresses, nameHash, readCue, writeStatus, type CueScope } from '../helpers/altar-cue';
import { baseState, drive, FakeSdk, type SentAction } from '../lib/fake-sdk';
import type { RelogResult, Session } from '../lib/session';
import { scoredRelogStep } from '../runner/scored-relog';
import { ProgramError, rcCueFields, type ProgramStatus } from '../lib/programs';
import { TickLog } from '../lib/ticks';
import { DROPPED_TICKS } from '../lib/trade';
import { levelForXp } from '../lib/xp';
import { Observation, resolveResume } from '../runner/resume';
import { runSteps, type RunnerSession, type StepContext } from '../runner/step';
import {
    altarStep,
    bands,
    classifyFault,
    craftXp,
    S06_LOAD,
    CueRelay,
    defaultDeps,
    feedKey,
    FeedSender,
    giverFeed,
    giverSchedule,
    GiverWaitError,
    handBackGiver,
    handBackPending,
    holdsHandBack,
    loginSpanMs,
    preconditions,
    preLoginStep,
    preLoginWaitMs,
    S21_HAND_BACK,
    rcShared,
    ScheduleAdapter,
    steps,
    xpAfterCrafts,
    type Band,
    type CueFields,
    type CueSink,
    type GiverEntry,
    type GiverStatusView,
    type LauncherView,
    type RcTurnResult,
    type RunecraftDeps,
    type RunecraftOptions,
    type Tile
} from './runecraft';

const prevTick = process.env.SPEEDRUN_TICK_MS;
beforeAll(() => {
    process.env.SPEEDRUN_TICK_MS = '5';
});
afterAll(() => {
    if (prevTick === undefined) delete process.env.SPEEDRUN_TICK_MS;
    else process.env.SPEEDRUN_TICK_MS = prevTick;
});

// ------------------------------------------------------------------ world

const SCORED = 'lab_scored';
const AIR_ALTAR: Tile = { x: 2843, z: 4833 }; // stand (2844,4832)
const NATURE_ALTAR: Tile = { x: 2399, z: 4840 }; // stand (2400,4839)

function altarLoc(at: Tile, distance = 1): NearbyLoc {
    return { id: 34768, name: 'Altar', x: at.x, z: at.z, level: 0, distance, optionsWithIndex: [{ text: 'Craft-rune', opIndex: 1 }], options: ['Craft-rune'] } as unknown as NearbyLoc;
}

function item(slot: number, name: string, count = 1): InventoryItem {
    return { slot, id: 1000 + slot, name, count, optionsWithIndex: [] };
}

function essence(n: number, from = 0): InventoryItem[] {
    return Array.from({ length: n }, (_, i) => item(from + i, 'Rune essence'));
}

function world(o: { altar?: Tile | null; level?: number; xp?: number; at?: Tile; inventory?: InventoryItem[]; tick?: number; distance?: number }): Partial<BotWorldState> {
    const altar = o.altar === undefined ? NATURE_ALTAR : o.altar;
    const at = o.at ?? (altar ? { x: altar.x + 1, z: altar.z - 1 } : { x: 3222, z: 3222 });
    const level = o.level ?? 44;
    return {
        tick: o.tick ?? 100,
        inGame: true,
        player: { name: SCORED, x: at.x, z: at.z, worldX: at.x, worldZ: at.z, level: 0 } as PlayerState,
        skills: [{ name: 'Runecraft', level, baseLevel: level, experience: o.xp ?? level * 1000 }],
        nearbyLocs: altar ? [altarLoc(altar, o.distance ?? 1)] : [],
        inventory: o.inventory ?? []
    };
}

class TestSdk extends FakeSdk {
    /** Drops the server ignores (sent during a delay) before the next one lands. */
    ignoreDrops = 0;
    sendDropItem(slot: number) {
        const r = this.sendAction({ method: 'sendDropItem', args: [slot] });
        if (this.ignoreDrops > 0) this.ignoreDrops--;
        else this.push(s => ({ inventory: s.inventory.filter(i => i.slot !== slot) }));
        return r;
    }
    sendInteractLoc(x: number, z: number, locId: number, option = 1) {
        return this.sendAction({ method: 'sendInteractLoc', args: [x, z, locId, option] });
    }
    sendInteractPlayer(index: number, option = 2) {
        return this.sendAction({ method: 'sendInteractPlayer', args: [index, option] });
    }
    sends(method: string): SentAction[] {
        return this.sent.filter(a => a.method === method);
    }
}

// ------------------------------------------------------------------ page and files

function status(p: Partial<ProgramStatus>): ProgramStatus {
    const frames = { n: 0, p50: 0, p90: 0, max: 0, underHalfT: 0, overSevenSixthsT: 0, catchUps: 0, catchUpsLastMinute: 0, catchUpsPerMinute: 0, T: 300, TSource: 'driver' as const };
    return { runId: 1, name: 'rc-cycle', phase: 'running', params: {}, startedTick: 100, tick: 100, progressTick: 100, counters: {}, gauges: {}, marks: {}, packets: 0, deferred: 0, skippedTicks: 0, maxTickMs: 0, frames, publish: frames, react: { n: 0, p50: 0, p90: 0, max: 0 }, loops: { last: 0, p10Last10s: 0, min: 0 }, ...p };
}

interface SharedPatch {
    turns?: { giver: string; T: number; schedule: 'tuned' | 'robust' }[];
    results?: RcTurnResult[];
    waiting?: 'giver' | null;
    stop?: true;
    schedule?: 'tuned' | 'robust';
}

interface RunCtl {
    runId: number;
    params: Record<string, unknown>;
    /** Advance a tick (with a state patch) and publish a running status. */
    step(p?: SharedPatch, state?: Partial<BotWorldState>): ProgramStatus;
    /** A final status of this run (not published through onProgress). */
    end(phase: ProgramStatus['phase'], p?: SharedPatch, extra?: Partial<ProgramStatus>): ProgramStatus;
    stopped(): boolean;
}

type Script = (ctl: RunCtl) => Promise<ProgramStatus>;

class Harness {
    readonly sdk: TestSdk;
    readonly log = TickLog.memory('test');
    statuses: GiverStatusView[] = [];
    launcher: LauncherView | null = null;
    now = 10_000;
    readonly cues: { session: string; receiver: string; scope: CueScope; fields: CueFields }[] = [];
    readonly starts: Record<string, unknown>[] = [];
    readonly inputs: { givers: GiverEntry[] }[] = [];
    readonly scripts: Script[] = [];
    readonly walks: Tile[] = [];
    stops = 0;
    private runId = 0;
    private sessions = 0;
    receive: RunecraftDeps['receiveFrom'] = async () => ({ ok: false, reason: 'no giver scripted' });

    constructor(state: Partial<BotWorldState>) {
        this.sdk = new TestSdk(baseState(state));
    }

    giver(name: string, o: Partial<GiverStatusView> = {}): GiverStatusView {
        return { account: name, phase: 'ready', loggedInAt: 500, essence: 27, inRoom: true, readyAt: 900, ms: this.now, ...o };
    }

    launcherWith(accounts: { account: string; loggedInAt: number | null }[], o: Partial<LauncherView> = {}): LauncherView {
        return { helpersReady: true, accounts: accounts.map(a => ({ ...a, receiver: false })), ms: this.now, ...o };
    }

    deps(): Partial<RunecraftDeps> {
        return {
            startProgram: async (_sdk, _name, params) => {
                this.starts.push(params);
                this.runId++;
                return status({ runId: this.runId, params, startedTick: this.sdk.state!.tick, tick: this.sdk.state!.tick });
            },
            awaitProgram: async (_sdk, runId, opts) => {
                const script = this.scripts.shift();
                if (!script) throw new Error('no program script left');
                const stopsBefore = this.stops;
                const shared = (p: SharedPatch = {}) => ({
                    v: 1,
                    open: 5,
                    schedule: p.schedule ?? 'robust',
                    beacons: [{ tick: this.sdk.state!.tick, ms: this.now }],
                    turns: p.turns ?? [],
                    results: p.results ?? [],
                    queue: [],
                    waiting: p.waiting ?? null,
                    ...(p.stop ? { stop: true } : {})
                });
                const params = this.starts[this.starts.length - 1]!;
                return script({
                    runId,
                    params,
                    step: (p, state) => {
                        this.sdk.tick(state ?? {});
                        const st = status({ runId, params, tick: this.sdk.state!.tick, shared: shared(p) } as Partial<ProgramStatus>);
                        opts.onProgress?.(st);
                        return st;
                    },
                    end: (phase, p, extra) => status({ runId, params, phase, tick: this.sdk.state!.tick, endedTick: this.sdk.state!.tick, shared: shared({ stop: true, ...p }), ...extra } as Partial<ProgramStatus>),
                    stopped: () => this.stops > stopsBefore
                });
            },
            stopProgram: async () => {
                this.stops++;
                return null;
            },
            sendProgramInput: async (_sdk, data) => {
                this.inputs.push(data as { givers: GiverEntry[] });
                return {};
            },
            rcCueFields,
            openCue: (_dir, receiver, scope): CueSink => {
                const session = `s${++this.sessions}`;
                return { session, write: fields => void this.cues.push({ session, receiver, scope, fields: structuredClone(fields) }) };
            },
            readStatuses: () => this.statuses,
            readLauncher: () => this.launcher,
            cueDir: () => '/nonexistent/rc-cue',
            receiveFrom: (...a) => this.receive(...a),
            now: () => this.now
        };
    }

    session(): RunnerSession {
        const sdk = this.sdk;
        const bot = {
            walkTo: async (x: number, z: number) => {
                this.walks.push({ x, z });
                sdk.tick(s => ({ player: { ...s.player!, x, z, worldX: x, worldZ: z } }));
                return { success: true, message: 'ok' };
            }
        };
        return { sdk, bot, name: SCORED, sessionId: 1, launchedAt: 1_000 } as unknown as RunnerSession;
    }

    ctx(): StepContext<any> {
        const session = this.session();
        return { session, sdk: session.sdk, bot: session.bot, c: {}, log: this.log };
    }

    opts(o: RunecraftOptions = {}): RunecraftOptions {
        return { dismissLevelUp: false, ...o, deps: { ...this.deps(), ...o.deps } };
    }

    programRows() {
        return this.log.rows.filter(r => r.kind === 'program');
    }
}

const nature44: Band = { id: 'S21', altar: 'nature', from: 44, untilLevel: 45 };

const summary = (crafts: number) => ({ crafts, ticksPerCycle: 7, gaps: { 7: crafts - 1 }, outcomes: { gave: crafts, missed: 0, late: 0, 'no-giver': 0 }, orders: { 'giver-first': crafts, 'scored-first': 0 }, salvaged: 0, reanchors: 0 });

// ------------------------------------------------------------------ schedule choice

describe('giverSchedule', () => {
    const now = 50_000;
    const launcher = (o: Partial<LauncherView> = {}): LauncherView => ({ helpersReady: true, accounts: [{ account: 'Lab G1', receiver: false, loggedInAt: 1_000 }], ms: now - 1_000, ...o });

    test('forced schedules ignore the launcher', () => {
        expect(giverSchedule('tuned', null, 'lab_g1', null, now).schedule).toBe('tuned');
        expect(giverSchedule('robust', launcher(), 'lab_g1', 2_000, now).schedule).toBe('robust');
    });

    test('auto is tuned only for a giver the fresh, ready launcher saw log in before SCORED', () => {
        expect(giverSchedule('auto', launcher(), 'lab_g1', 2_000, now)).toEqual({ schedule: 'tuned', why: 'giver logged in first' });
        const robust = (l: LauncherView | null, scored: number | null, giver = 'lab_g1') => giverSchedule('auto', l, giver, scored, now);
        expect(robust(null, 2_000).why).toBe('no launcher.json');
        expect(robust(launcher({ ms: now - 11_000 }), 2_000).why).toMatch(/11 s old/);
        expect(robust(launcher({ helpersReady: false }), 2_000).why).toBe('helpers not ready');
        expect(robust(launcher(), 900).why).toBe('giver logged in after SCORED');
        expect(robust(launcher(), 1_000).why).toBe('giver logged in after SCORED');
        expect(robust(launcher(), null).why).toBe("SCORED's login time unknown");
        expect(robust(launcher(), 2_000, 'lab_g9').why).toBe('giver not in launcher.json');
        expect(robust(launcher({ accounts: [{ account: 'lab_g1', receiver: false, loggedInAt: null }] }), 2_000).why).toBe('giver login time unknown');
        for (const r of [robust(null, 2_000), robust(launcher(), 900)]) expect(r.schedule).toBe('robust');
    });
});

describe('ScheduleAdapter', () => {
    const r = (giver: string, T: number, outcome: RcTurnResult['outcome'], o: Partial<RcTurnResult> = {}): RcTurnResult => ({ giver, T, schedule: 'tuned', outcome, tick: T + 7, ...o });

    test('two tuned misses in a row demote that giver only', () => {
        const a = new ScheduleAdapter();
        expect(a.observe([r('g1', 100, 'missed')])).toEqual([]);
        expect(a.observe([r('g1', 100, 'missed'), r('g2', 107, 'missed'), r('g1', 114, 'late')])).toEqual(['g1']);
        expect(a.isDemoted('G1')).toBe(true);
        expect(a.isDemoted('g2')).toBe(false);
    });

    test('the observed order decides after the first guess; a demotion outranks it', () => {
        const a = new ScheduleAdapter();
        const guess = { schedule: 'robust' as const, why: 'giver logged in after SCORED' };
        expect(a.choose('g1', guess)).toEqual(guess);
        // a lower IP bucket: logged in after SCORED, handled first anyway
        a.observe([r('g1', 100, 'gave', { schedule: 'robust', order: 'giver-first' })]);
        expect(a.choose('g1', guess)).toEqual({ schedule: 'tuned', why: 'observed giver-first' });
        // a relog put it behind SCORED: the tuned turn salvaged to 8, and it drops to robust
        a.observe([r('g1', 107, 'gave', { salvaged: true, order: 'scored-first' })]);
        expect(a.choose('g1', { schedule: 'tuned', why: 'giver logged in first' })).toEqual({ schedule: 'robust', why: 'observed scored-first' });
        a.observe([r('g2', 100, 'gave', { order: 'giver-first' }), r('g2', 107, 'missed'), r('g2', 114, 'missed')]);
        expect(a.choose('g2', guess)).toEqual({ schedule: 'robust', why: 'two tuned turns failed' });
    });

    test('a turn that gave, salvaged ones included, breaks the run; no-giver and robust turns do not count', () => {
        const a = new ScheduleAdapter();
        a.observe([r('g1', 100, 'missed'), r('g1', 107, 'gave', { salvaged: true, order: 'scored-first' }), r('g1', 114, 'missed')]);
        expect(a.isDemoted('g1')).toBe(false);
        a.observe([r('g2', 100, 'no-giver'), r('g2', 107, 'no-giver'), r('g3', 100, 'missed', { schedule: 'robust' }), r('g3', 108, 'missed', { schedule: 'robust' })]);
        expect(a.demoted).toEqual([]);
    });
});

// ------------------------------------------------------------------ giver feed

describe('giver feed', () => {
    const now = 50_000;
    const st = (account: string, o: Partial<GiverStatusView> = {}): GiverStatusView => ({ account, phase: 'ready', loggedInAt: 1, essence: 27, inRoom: true, readyAt: 100, ms: now - 1_000, ...o });

    test('only loaded, fresh, in-room givers that are ready or armed, oldest ready first', () => {
        const feed = giverFeed(
            [
                st('late', { readyAt: 300 }),
                st('armed', { phase: 'armed', readyAt: 200 }),
                st('restocking', { phase: 'restock' }),
                st('outside', { inRoom: false }),
                st('stale', { ms: now - 5_001 }),
                st('short', { essence: 26 }),
                st('first', { readyAt: 100 }),
                st('unknown', { readyAt: null })
            ],
            now,
            g => (g === 'first' ? 'tuned' : 'robust')
        );
        expect(feed).toEqual([
            { name: 'first', schedule: 'tuned', readyAt: 100 },
            { name: 'armed', schedule: 'robust', readyAt: 200 },
            { name: 'late', schedule: 'robust', readyAt: 300 },
            { name: 'unknown', schedule: 'robust' }
        ]);
    });

    test('a band with a smaller load feeds givers loaded with that many', () => {
        const statuses = [st('short', { essence: 26, readyAt: 100 }), st('full', { readyAt: 200 })];
        expect(giverFeed(statuses, now, () => 'tuned').map(e => e.name)).toEqual(['full']);
        expect(giverFeed(statuses, now, () => 'tuned', 26).map(e => e.name)).toEqual(['short', 'full']);
    });

    test('FeedSender sends only a changed feed, one at a time, and retries after a refusal', async () => {
        const sent: GiverEntry[][] = [];
        let refuse = false;
        const a: GiverEntry[] = [{ name: 'g1', schedule: 'tuned', readyAt: 1 }];
        const s = new FeedSender(async e => {
            if (refuse) throw new Error('program input refused');
            sent.push(e);
        }, a);
        s.offer([...a]);
        await s.drain();
        expect(sent).toEqual([]);
        const b = [...a, { name: 'g2', schedule: 'robust' as const, readyAt: 2 }];
        s.offer(b);
        s.offer([...b]);
        await s.drain();
        expect(sent).toEqual([b]);
        refuse = true;
        s.offer(a);
        await s.drain();
        expect(s.lastError).toMatch(/refused/);
        refuse = false;
        s.offer(a);
        await s.drain();
        expect(sent).toEqual([b, a]);
        expect(feedKey(a)).not.toBe(feedKey(b));
    });
});

// ------------------------------------------------------------------ cue relay

describe('CueRelay', () => {
    const sharedStatus = (runId: number, turns: { giver: string; T: number; schedule: 'tuned' | 'robust' }[], o: { stop?: true; tick?: number; beacons?: boolean } = {}) =>
        status({ runId, tick: o.tick ?? 100, shared: { v: 1, open: 5, schedule: 'robust', beacons: o.beacons === false ? [] : [{ tick: o.tick ?? 100, ms: 1 }], turns, results: [], queue: [], waiting: null, ...(o.stop ? { stop: true } : {}) } } as Partial<ProgramStatus>);

    function relay() {
        const writes: { session: string; fields: CueFields }[] = [];
        let n = 0;
        const r = new CueRelay(
            () => {
                const session = `s${++n}`;
                return { session, write: f => void writes.push({ session, fields: f }) };
            },
            rcCueFields
        );
        return { r, writes };
    }

    test('rewrites the cue only when the turns change, not for new beacons alone', () => {
        const { r, writes } = relay();
        r.update(sharedStatus(1, [], { beacons: false }));
        expect(writes).toEqual([]);
        r.update(sharedStatus(1, [], { tick: 101 }));
        r.update(sharedStatus(1, [], { tick: 102 }));
        const t1 = [{ giver: 'g1', T: 110, schedule: 'tuned' as const }];
        r.update(sharedStatus(1, t1, { tick: 103 }));
        r.update(sharedStatus(1, t1, { tick: 104 }));
        expect(writes.map(w => [w.session, w.fields.turns.length, w.fields.beacons[0]!.tick])).toEqual([
            ['s1', 0, 101],
            ['s1', 1, 103]
        ]);
    });

    test('a new program run is a new cue session, and the old one is stopped first', () => {
        const { r, writes } = relay();
        const t1 = [{ giver: 'g1', T: 110, schedule: 'tuned' as const }];
        r.update(sharedStatus(1, t1));
        r.update(sharedStatus(2, [], { tick: 120 }));
        expect(writes.map(w => [w.session, !!w.fields.stop])).toEqual([
            ['s1', false],
            ['s1', true],
            ['s2', false]
        ]);
        expect(writes[1]!.fields.turns).toEqual(t1);
    });

    test('stop takes the final status when it carries stop, and writes one from the last fields otherwise', () => {
        const done = relay();
        done.r.update(sharedStatus(1, []));
        done.r.stop(sharedStatus(1, [], { stop: true, tick: 130 }));
        done.r.stop();
        expect(done.writes.map(w => [w.fields.stop ?? false, w.fields.beacons[0]!.tick])).toEqual([
            [false, 100],
            [true, 130]
        ]);
        const dropped = relay();
        dropped.r.update(sharedStatus(1, []));
        dropped.r.stop(null);
        dropped.r.stop(sharedStatus(7, [], { stop: true }));
        expect(dropped.writes.map(w => [w.session, w.fields.stop ?? false])).toEqual([
            ['s1', false],
            ['s1', true]
        ]);
        const never = relay();
        never.r.stop(null);
        expect(never.writes).toEqual([]);
    });
});

// ------------------------------------------------------------------ steps, preconditions, resume

describe('steps and preconditions', () => {
    test('S06 air 1-44 then S21 44-99, capped by untilLevel, S21 at body on request', () => {
        expect(steps().map(s => s.name)).toEqual(['S06 runecraft', 'S21 runecraft']);
        expect(bands()).toEqual([
            { id: 'S06', altar: 'air', from: 1, untilLevel: 44, load: 26 },
            { id: 'S21', altar: 'nature', from: 44, untilLevel: 99, handBack: S21_HAND_BACK }
        ]);
        expect(bands({ untilLevel: 30 })).toEqual([{ id: 'S06', altar: 'air', from: 1, untilLevel: 30, load: 26 }]);
        expect(bands({ s21Altar: 'body', untilLevel: 60, s21HandBack: false })[1]).toEqual({ id: 'S21', altar: 'body', from: 44, untilLevel: 60 });
        expect(steps().every(s => s.logoutSafe && !!s.done && !!s.inProgress && !!s.resume)).toBe(true);
    });

    test('reasons for the level, the room, the altar and the inventory', () => {
        const s = (o: Parameters<typeof world>[0]) => baseState(world(o));
        const [s06, s21] = bands();
        expect(preconditions(s({}), s21!)).toBe(true);
        expect(preconditions(s({ level: 43 }), s21!)).toBe('Runecraft 43 is below 44 for the nature altar');
        expect(preconditions(s({ altar: null }), s21!)).toBe('not in the nature altar room (at 3222,3222)');
        expect(preconditions(s({ altar: AIR_ALTAR }), s21!)).toBe('not in the nature altar room (at 2844,4832)');
        // in the nature room with another altar loc in view (a misread loc list)
        expect(preconditions(s({ altar: AIR_ALTAR, at: { x: 2400, z: 4839 } }), s21!)).toBe('the altar in sight (2843,4833) is not the nature altar');
        // right after a login the position is published before the scene's locs
        expect(preconditions(baseState({ ...world({}), nearbyLocs: [] }), s21!)).toBe(true);
        expect(preconditions(s({ altar: AIR_ALTAR, level: 1, inventory: [item(0, 'Air talisman'), item(1, 'Air rune', 300)] }), s06!)).toBe(true);
        // S06's air runes still held at S21: 26 free slots, every trade would fail
        expect(preconditions(s({ inventory: [item(0, 'Nature talisman'), item(1, 'Air rune', 300), item(2, 'Nature rune', 50)] }), s21!)).toBe('1 other items (Air rune): need 27 free slots');
        expect(preconditions(s({ inventory: [item(0, 'Bronze axe'), item(1, 'Tinderbox')] }), s21!)).toBe('2 other items (Bronze axe, Tinderbox): need 27 free slots');
        // S06 as the route reaches the air altar (rs/196's census): H4's kits, the teleport and starter runes, Doric's coins, the tinderbox
        const census = [item(0, 'Air talisman'), item(1, 'Air rune', 24), item(2, 'Water rune', 7), item(3, 'Earth rune', 4), item(4, 'Law rune', 2), item(5, 'Coins', 180), item(6, 'Tinderbox'), item(7, 'Rune axe'), item(8, 'Rune pickaxe'), item(9, 'Knife'), ...[10, 11, 12, 13, 14, 15].map(i => item(i, 'Logs'))];
        expect(preconditions(s({ altar: AIR_ALTAR, level: 1, inventory: census }), s06!)).toBe('14 other items (Water rune, Earth rune, Law rune, Coins, Tinderbox, Rune axe, Rune pickaxe, Knife, Logs): need 26 free slots');
        // S06's load of 26 leaves room for T06-07's law runes beside the air runes, and for nothing else
        expect(preconditions(s({ altar: AIR_ALTAR, level: 1, inventory: [item(0, 'Air talisman'), item(1, 'Air rune', 24), item(2, 'Law rune', 2)] }), s06!)).toBe(true);
        expect(preconditions(s({ altar: AIR_ALTAR, level: 1, inventory: [item(0, 'Air talisman'), item(1, 'Air rune', 24), item(2, 'Law rune', 2), item(3, 'Coins', 180)] }), s06!)).toBe('2 other items (Law rune, Coins): need 26 free slots');
        // a full load of 27 leaves none
        expect(preconditions(s({ altar: AIR_ALTAR, level: 1, inventory: [item(0, 'Air talisman'), item(2, 'Law rune', 2)] }), { ...s06!, load: 27 })).toBe('1 other items (Law rune): need 27 free slots');
        // a passed band is a no-op wherever the account stands
        expect(preconditions(s({ level: 50, altar: null }), s06!)).toBe(true);
        expect(preconditions(baseState({ inGame: false }), s21!)).toBe('not in game');
    });

    test('the body altar takes its stand tile from the altar loc', () => {
        const body: Band = { id: 'S21', altar: 'body', from: 44, untilLevel: 99 };
        expect(preconditions(baseState(world({ altar: { x: 2520, z: 4840 } })), body)).toBe(true);
    });

    test('the resume walk: run at a band start, resume mid-band in the room, finished at 99', async () => {
        const walk = async (o: Parameters<typeof world>[0]) => {
            const p = await resolveResume(steps(), new Observation(baseState(world(o))), {});
            return [p.step, p.mode];
        };
        expect(await walk({ altar: AIR_ALTAR, level: 1 })).toEqual(['S06 runecraft', 'run']);
        expect(await walk({ altar: AIR_ALTAR, level: 30 })).toEqual(['S06 runecraft', 'resume']);
        expect(await walk({ level: 44 })).toEqual(['S21 runecraft', 'run']);
        // logged out between cycles, with and without the next load already traded in
        expect(await walk({ level: 60 })).toEqual(['S21 runecraft', 'resume']);
        expect(await walk({ level: 60, inventory: essence(27) })).toEqual(['S21 runecraft', 'resume']);
        // the first state after a relog: in the room by position, no locs published yet
        const relog = await resolveResume(steps(), new Observation(baseState({ ...world({ level: 60 }), nearbyLocs: [] })), {});
        expect([relog.step, relog.mode]).toEqual(['S21 runecraft', 'resume']);
        // mid-band but out of the room: not in progress, and its preconditions say why
        await expect(walk({ level: 60, altar: null })).rejects.toThrow(/not in the nature altar room/);
        expect(await walk({ level: 99, altar: null })).toEqual([null, 'finished']);
    });
});

// ------------------------------------------------------------------ the driver

describe('the step driving rc-cycle', () => {
    test('auto: per-giver schedules, input only on a changed feed, the cue relayed and stopped, one program row', async () => {
        const h = new Harness(world({ inventory: [item(0, 'Nature talisman')] }));
        h.launcher = h.launcherWith([
            { account: 'lab_g1', loggedInAt: 500 },
            { account: 'lab_g2', loggedInAt: 1_500 }
        ]);
        h.statuses = [h.giver('lab_g1', { readyAt: 900 }), h.giver('lab_g2', { readyAt: 950, loggedInAt: 1_500 })];
        h.scripts.push(async run => {
            run.step();
            run.step({ turns: [{ giver: 'lab_g1', T: 110, schedule: 'tuned' }] });
            run.step({ turns: [{ giver: 'lab_g1', T: 110, schedule: 'tuned' }] });
            h.statuses = [h.giver('lab_g2', { readyAt: 950, loggedInAt: 1_500 }), h.giver('lab_g1', { readyAt: 1_200, phase: 'armed' })];
            run.step({ turns: [{ giver: 'lab_g1', T: 110, schedule: 'tuned' }] });
            run.step({ turns: [{ giver: 'lab_g2', T: 117, schedule: 'robust' }] });
            return run.end('done', { turns: [{ giver: 'lab_g2', T: 117, schedule: 'robust' }] }, { result: summary(2) });
        });
        await altarStep(nature44, h.opts()).run(h.ctx());

        expect(h.starts).toHaveLength(1);
        expect(h.starts[0]).toMatchObject({
            untilLevel: 45,
            schedule: 'robust',
            givers: [
                { name: 'lab_g1', schedule: 'tuned', readyAt: 900 },
                { name: 'lab_g2', schedule: 'robust', readyAt: 950 }
            ]
        });
        expect(h.inputs).toEqual([
            {
                givers: [
                    { name: 'lab_g2', schedule: 'robust', readyAt: 950 },
                    { name: 'lab_g1', schedule: 'tuned', readyAt: 1_200 }
                ]
            }
        ]);
        // one cue session, the receiver passed only to the writer (which stores its hash), stop at the end
        expect(new Set(h.cues.map(c => c.session))).toEqual(new Set(['s1']));
        expect(new Set(h.cues.map(c => c.receiver))).toEqual(new Set([SCORED]));
        expect(h.cues.map(c => [c.fields.turns.length, c.fields.stop ?? false])).toEqual([
            [0, false],
            [1, false],
            [1, false],
            [1, true]
        ]);
        // the talisman's slot is one of the 27 a trade needs
        expect(h.sdk.sends('sendDropItem').map(a => a.args)).toEqual([[0]]);
        expect(h.walks).toEqual([]);
        const rows = h.programRows();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ kind: 'program', step: 'S21 runecraft', ok: true, account: SCORED });
        expect(rows[0]!.meta).toMatchObject({ program: 'rc-cycle', phase: 'done', rung: 'program', mode: 'auto', schedules: { lab_g1: 'tuned', lab_g2: 'robust' }, why: { lab_g2: 'giver logged in after SCORED' }, summary: summary(2), cueSessions: ['s1'] });
    });

    test('an ignored talisman drop is re-sent before the program starts', async () => {
        const h = new Harness(world({ inventory: [item(0, 'Nature talisman')] }));
        h.sdk.ignoreDrops = 1;
        h.statuses = [h.giver('lab_g1')];
        h.scripts.push(async run => run.end('done', {}, { result: summary(1) }));
        await altarStep(nature44, h.opts({ schedule: 'robust' })).run(h.ctx());
        expect(h.sdk.sends('sendDropItem').map(a => a.args)).toEqual([[0], [0]]);
        expect(h.sdk.state!.inventory).toEqual([]);
        expect(h.starts).toHaveLength(1);
        expect(h.programRows()[0]!.meta).toMatchObject({ talismanDrops: 2 });
    });

    test('a talisman that will not drop stops the step before any program run, with the reason', async () => {
        const h = new Harness(world({ inventory: [item(0, 'Nature talisman')] }));
        h.sdk.ignoreDrops = Infinity;
        h.statuses = [h.giver('lab_g1')];
        await expect(altarStep(nature44, h.opts({ schedule: 'robust' })).run(h.ctx())).rejects.toThrow('the nature talisman is still held after 3 drops (slot 0: sent; slot 0: sent; slot 0: sent; no dialog; no interface); a trade of 27 essence needs its slot');
        expect(h.sdk.sends('sendDropItem')).toHaveLength(3);
        expect(h.starts).toEqual([]);
    });

    test('waits for the altar loc when the scene is not in yet, then starts', async () => {
        const h = new Harness({ ...world({}), nearbyLocs: [] });
        h.scripts.push(async run => run.end('done', {}, { result: summary(1) }));
        setTimeout(() => h.sdk.tick({ nearbyLocs: [altarLoc(NATURE_ALTAR)] }), 2);
        await altarStep(nature44, h.opts()).run(h.ctx());
        expect(h.starts).toHaveLength(1);
    });

    test('walks the last tiles onto the stand tile first', async () => {
        const h = new Harness(world({ at: { x: 2401, z: 4838 } }));
        h.scripts.push(async run => run.end('done', {}, { result: summary(1) }));
        await altarStep(nature44, h.opts()).run(h.ctx());
        expect(h.walks).toEqual([{ x: 2400, z: 4839 }]);
    });

    test('two tuned misses demote the giver in the next feed', async () => {
        const h = new Harness(world({}));
        h.launcher = h.launcherWith([{ account: 'lab_g1', loggedInAt: 500 }]);
        h.statuses = [h.giver('lab_g1')];
        const miss = (T: number): RcTurnResult => ({ giver: 'lab_g1', T, schedule: 'tuned', outcome: 'missed', tick: T + 7 });
        h.scripts.push(async run => {
            run.step({ results: [miss(110)] });
            run.step({ results: [miss(110), miss(117)] });
            run.step({ results: [miss(110), miss(117)] });
            return run.end('done', {}, { result: summary(3) });
        });
        await altarStep(nature44, h.opts()).run(h.ctx());
        expect(h.starts[0]!.givers).toEqual([{ name: 'lab_g1', schedule: 'tuned', readyAt: 900 }]);
        expect(h.inputs).toEqual([{ givers: [{ name: 'lab_g1', schedule: 'robust', readyAt: 900 }] }]);
        expect(h.programRows()[0]!.meta).toMatchObject({ demoted: ['lab_g1'], why: { lab_g1: 'two tuned turns failed' } });
    });

    test('auto promotes a robust giver to tuned once the page reads it was handled first', async () => {
        const h = new Harness(world({}));
        h.statuses = [h.giver('lab_g1')];
        h.scripts.push(async run => {
            run.step({ results: [{ giver: 'lab_g1', T: 110, schedule: 'robust', outcome: 'gave', tick: 118, order: 'giver-first' }] });
            return run.end('done', {}, { result: summary(2) });
        });
        await altarStep(nature44, h.opts()).run(h.ctx());
        expect(h.starts[0]!.givers).toEqual([{ name: 'lab_g1', schedule: 'robust', readyAt: 900 }]);
        expect(h.inputs).toEqual([{ givers: [{ name: 'lab_g1', schedule: 'tuned', readyAt: 900 }] }]);
        expect(h.programRows()[0]!.meta).toMatchObject({ why: { lab_g1: 'observed giver-first' } });
    });

    const turnsFailed = (run: RunCtl, schedule: 'tuned' | 'robust') => {
        run.step({ turns: [{ giver: 'lab_g1', T: 110, schedule }] });
        throw new ProgramError('program rc-cycle faulted: 6 turns in a row failed', run.end('fault', {}, { fault: '6 turns in a row failed', faultDetail: { crafts: 3 } }));
    };

    test('a fault with a giver on tuned restarts once with every giver robust', async () => {
        const h = new Harness(world({}));
        h.launcher = h.launcherWith([{ account: 'lab_g1', loggedInAt: 500 }]);
        h.statuses = [h.giver('lab_g1')];
        h.scripts.push(async run => turnsFailed(run, 'tuned'));
        h.scripts.push(async run => {
            run.step();
            return run.end('done', {}, { result: summary(5) });
        });
        await altarStep(nature44, h.opts()).run(h.ctx());
        expect(h.starts.map(p => [p.schedule, (p.givers as GiverEntry[]).map(g => g.schedule)])).toEqual([
            ['robust', ['tuned']],
            ['robust', ['robust']]
        ]);
        // each run its own cue session, each ended with stop
        const last = (s: string) => h.cues.filter(c => c.session === s).at(-1)!;
        expect([last('s1').fields.stop, last('s2').fields.stop]).toEqual([true, true]);
        const rows = h.programRows();
        expect(rows.map(r => [r.ok, r.meta!.rung, r.meta!.phase])).toEqual([
            [false, 'program', 'fault'],
            [true, 'robust-restart', 'done']
        ]);
        expect(rows[0]!.meta!.summary).toEqual({ crafts: 3 });
    });

    test('a robust fault goes to the stock reacting cycle, which writes a stock turn and a stop', async () => {
        const h = new Harness(world({ xp: 44_000 }));
        h.statuses = [h.giver('lab_g1')];
        h.scripts.push(async run => turnsFailed(run, 'robust'));
        const receiveOpts: unknown[] = [];
        h.receive = async (_sdk, _partner, opts) => {
            receiveOpts.push(opts);
            h.sdk.tick({ inventory: essence(27) });
            return { ok: true };
        };
        h.sdk.onSend = (a, sdk) => {
            if (a.method !== 'sendInteractLoc') return;
            setTimeout(() => sdk.tick(s => ({ inventory: [], skills: [{ name: 'Runecraft', level: 45, baseLevel: 45, experience: s.skills[0]!.experience + 243 * 25 }] })), 1);
        };
        await altarStep(nature44, h.opts({ schedule: 'robust' })).run(h.ctx());
        expect(h.starts).toHaveLength(1);
        // every session, the stock rung's included, is addressed to the band's step
        expect(new Set(h.cues.map(c => JSON.stringify(c.scope)))).toEqual(new Set([JSON.stringify({ step: 'S21', family: 'altar' })]));
        const stock = h.cues.filter(c => c.session === 's2');
        expect(stock.map(c => [c.fields.turns.map(t => t.schedule), c.fields.stop ?? false])).toEqual([
            [['stock'], false],
            [['stock'], true]
        ]);
        expect(h.sdk.sends('sendInteractLoc').map(a => a.args)).toEqual([[2399, 4840, 34768, 1]]);
        const rows = h.programRows();
        expect(rows.map(r => r.meta!.program)).toEqual(['rc-cycle', 'stock']);
        expect(rows[1]).toMatchObject({ ok: true, meta: { crafts: 1, trades: 1, rungs: ['program', 'stock'] } });
        // SCORED stands beside the giver, so a dropped request is re-sent after DROPPED_TICKS (rs/267: 9 a cycle, not ~31),
        // and the open is bounded in observed ticks rather than wall-clock.
        expect(receiveOpts).toEqual([{ want: [{ item: expect.anything(), amount: 27 }], maxTicks: 30, openMaxTicks: 30, noReplyTicks: DROPPED_TICKS }]);
    });

    test("without the stock fallback a robust fault throws the program's fault", async () => {
        const h = new Harness(world({}));
        h.statuses = [h.giver('lab_g1')];
        h.scripts.push(async run => turnsFailed(run, 'robust'));
        await expect(altarStep(nature44, h.opts({ schedule: 'robust', fallback: 'none' })).run(h.ctx())).rejects.toThrow(/6 turns in a row failed/);
        expect(classifyFault(new ProgramError('program rc-cycle faulted: 6 turns in a row failed', null))).toBe('turns-failed');
    });

    test('a reloaded page is rethrown for the resumable runner, after a stop cue', async () => {
        const h = new Harness(world({}));
        h.statuses = [h.giver('lab_g1')];
        h.scripts.push(async run => {
            run.step({ turns: [{ giver: 'lab_g1', T: 110, schedule: 'robust' }] });
            throw new ProgramError(`program run ${run.runId} is not in the page's state (page reloaded?)`, null);
        });
        await expect(altarStep(nature44, h.opts()).run(h.ctx())).rejects.toThrow(/page reloaded/);
        expect(h.starts).toHaveLength(1);
        expect(h.cues.at(-1)!.fields).toMatchObject({ stop: true, turns: [{ giver: 'lab_g1', T: 110 }] });
        expect(h.programRows()[0]).toMatchObject({ ok: false, error: expect.stringMatching(/page reloaded/) });
        expect(classifyFault(new ProgramError('tick went back from 900 to 3 (page reloaded?); program run 2 is gone', null))).toBe('dropped');
        expect(classifyFault(new ProgramError('no state for 6000 ms while program run 2 was running (tab wedged?)', null))).toBe('dropped');
    });

    test('no altar in sight re-enters once, then throws', async () => {
        const h = new Harness(world({}));
        h.statuses = [h.giver('lab_g1')];
        const noAltar = async (run: RunCtl): Promise<ProgramStatus> => {
            throw new ProgramError('program rc-cycle faulted: no altar in sight', run.end('fault', {}, { fault: 'no altar in sight' }));
        };
        h.scripts.push(noAltar, async run => run.end('done', {}, { result: summary(1) }));
        await altarStep(nature44, h.opts()).run(h.ctx());
        expect(h.starts).toHaveLength(2);
        h.scripts.push(noAltar, noAltar);
        await expect(altarStep(nature44, h.opts()).run(h.ctx())).rejects.toThrow(/no altar in sight/);
    });

    test('waiting for a giver past the bound stops the program and says why', async () => {
        const h = new Harness(world({}));
        h.scripts.push(async run => {
            for (let i = 0; i < 10 && !run.stopped(); i++) run.step({ waiting: 'giver' });
            return run.end('stopped');
        });
        const err = await altarStep(nature44, h.opts({ giverWaitTicks: 3 }))
            .run(h.ctx())
            .catch(e => e);
        expect(err).toBeInstanceOf(GiverWaitError);
        expect(h.stops).toBe(1);
        expect(h.programRows()[0]).toMatchObject({ ok: false, meta: { phase: 'stopped' } });
    });

    test('waiting for a giver within the bound is progress', async () => {
        const h = new Harness(world({}));
        h.scripts.push(async run => {
            for (let i = 0; i < 3; i++) run.step({ waiting: 'giver' });
            run.step();
            for (let i = 0; i < 3; i++) run.step({ waiting: 'giver' });
            return run.end('done', {}, { result: summary(1) });
        });
        await altarStep(nature44, h.opts({ giverWaitTicks: 3 })).run(h.ctx());
        expect(h.stops).toBe(0);
    });

    test('the last craft\'s level-up dialog is dismissed after the program ends', async () => {
        const h = new Harness(world({}));
        h.scripts.push(async run => {
            run.step();
            const lvl45 = { skills: [{ name: 'Runecraft', level: 45, baseLevel: 45, experience: 61_512 }] };
            const end = run.end('done', {}, { result: summary(1) });
            h.sdk.tick(lvl45);
            // the dialog opens when the craft's delay ends; ticks keep coming
            let n = 0;
            const timer = setInterval(() => {
                n++;
                const dialog = n === 3 ? { isOpen: true, options: [], isWaiting: false, pageId: 'levelup' } : h.sdk.state!.dialog;
                h.sdk.tick({ dialog });
                if (n > 12) clearInterval(timer);
            }, 2);
            return end;
        });
        h.sdk.onSend = (a, sdk) => {
            if (a.method === 'sendClickDialog') setTimeout(() => sdk.tick({ dialog: { isOpen: false, options: [], isWaiting: false } }), 1);
        };
        await altarStep(nature44, h.opts({ dismissLevelUp: true })).run(h.ctx());
        expect(h.sdk.sends('sendClickDialog')).toHaveLength(1);
    });

    test('runSteps over steps(): a band already passed is a no-op, the next one runs the program', async () => {
        const h = new Harness(world({ level: 44 }));
        h.statuses = [h.giver('lab_g1')];
        h.scripts.push(async run => {
            run.step();
            return run.end('done', {}, { result: summary(1) });
        });
        h.sdk.onSend = () => {};
        const session = h.session();
        const bump = h.scripts.pop()!;
        h.scripts.push(async run => {
            const end = await bump(run);
            h.sdk.tick({ skills: [{ name: 'Runecraft', level: 45, baseLevel: 45, experience: 61_512 }] });
            return end;
        });
        const r = await runSteps(session, steps({ ...h.opts(), untilLevel: 45, s21HandBack: false }), { log: h.log, c: {}, shouldStop: () => false, logout: async () => {} });
        expect(r.completed).toBe(2);
        expect(h.starts).toHaveLength(1);
        expect(h.log.rows.filter(r => !r.kind && r.step === 'S06 runecraft')[0]).toMatchObject({ ok: true, ticks: 0 });
    });
});

// ------------------------------------------------------------------ hand-back

describe('S21 hand-back (SUPPLIES.md H17e)', () => {
    const toLevel45: Band = { id: 'S21', altar: 'nature', from: 44, untilLevel: 45, handBack: S21_HAND_BACK };
    const lvl45 = { skills: [{ name: 'Runecraft', level: 45, baseLevel: 45, experience: 61_512 }] };
    const lumbridge = (from = 1) => [item(from, 'Law rune'), item(from + 1, 'Air rune', 3), item(from + 2, 'Earth rune')];
    const handBackStatus = (h: Harness, name: string, o: Partial<GiverStatusView> = {}) => h.giver(name, { essence: 0, handBack: S21_HAND_BACK.items.map(i => ({ ...i })), ...o });
    const oneCraft = (h: Harness) =>
        h.scripts.push(async run => {
            run.step();
            const end = run.end('done', {}, { result: summary(1) });
            h.sdk.tick(lvl45);
            return end;
        });
    const handBackCues = (h: Harness) => h.cues.filter(c => c.fields.turns.some(t => 'items' in t));

    test('the contract: T21-22 Lumbridge runes, 1 law, 3 air and 1 earth', () => {
        expect(S21_HAND_BACK.items).toEqual([
            { item: 'Law rune', n: 1 },
            { item: 'Air rune', n: 3 },
            { item: 'Earth rune', n: 1 }
        ]);
        expect(bands()[0]!.handBack).toBeUndefined();
        const own = { items: [{ item: 'Law rune', n: 2 }], giver: 'lab_hb' };
        expect(bands({ s21HandBack: own })[1]!.handBack).toBe(own);
    });

    test('the hand-back giver: ready, fresh, in the room and listing at least the items; a named giver needs no list', () => {
        const h = new Harness(world({}));
        const now = h.now;
        const statuses = [
            h.giver('lab_g1'),
            handBackStatus(h, 'lab_short', { handBack: [{ item: 'law rune', n: 1 }, { item: 'air rune', n: 2 }, { item: 'earth rune', n: 1 }] }),
            handBackStatus(h, 'lab_stale', { ms: now - 6_000 }),
            handBackStatus(h, 'lab_out', { inRoom: false }),
            handBackStatus(h, 'lab_restock', { phase: 'restock' }),
            handBackStatus(h, 'lab_late', { readyAt: 950 }),
            handBackStatus(h, 'lab_hb', { readyAt: 920 })
        ];
        expect(handBackGiver(statuses, now, S21_HAND_BACK)).toBe('lab_hb');
        expect(handBackGiver(statuses.slice(0, 5), now, S21_HAND_BACK)).toBeUndefined();
        expect(handBackGiver(statuses, now, { ...S21_HAND_BACK, giver: 'LAB G1' })).toBe('lab_g1');
        // holding no essence, it is never offered to rc-cycle
        expect(giverFeed(statuses, now, () => 'tuned').map(e => e.name)).toEqual(['lab_g1']);
    });

    test('done, inProgress and the resume walk: owed in the room resumes into the hand-back; out of the room it is done', async () => {
        const s = (o: Parameters<typeof world>[0]) => baseState(world(o));
        expect(holdsHandBack(s({ inventory: lumbridge() }), S21_HAND_BACK)).toBe(true);
        expect(holdsHandBack(s({ inventory: lumbridge().slice(0, 2) }), S21_HAND_BACK)).toBe(false);
        expect(handBackPending(s({ level: 45 }), toLevel45)).toBe(true);
        expect(handBackPending(s({ level: 44 }), toLevel45)).toBe(false);
        expect(handBackPending(s({ level: 45, inventory: lumbridge() }), toLevel45)).toBe(false);
        expect(handBackPending(s({ level: 45, altar: null }), toLevel45)).toBe(false);
        const step = altarStep(toLevel45);
        expect(step.postconditions!(s({ level: 45 }), {})).toBe('the hand-back (1 Law rune, 3 Air rune, 1 Earth rune) is not held');
        expect(step.postconditions!(s({ level: 45, inventory: lumbridge() }), {})).toBe(true);
        const walk = async (o: Parameters<typeof world>[0]) => {
            const p = await resolveResume(steps(), new Observation(s(o)), {});
            return [p.step, p.mode];
        };
        expect(await walk({ level: 99 })).toEqual(['S21 runecraft', 'resume']);
        expect(await walk({ level: 99, inventory: lumbridge() })).toEqual([null, 'finished']);
        // T21-22 has spent the runes and left the room
        expect(await walk({ level: 99, altar: null })).toEqual([null, 'finished']);
    });

    test('after the last craft: a stock turn with the items names the hand-back giver, and the receive wants exactly them', async () => {
        const h = new Harness(world({}));
        h.statuses = [h.giver('lab_g1'), handBackStatus(h, 'lab_hb')];
        oneCraft(h);
        const received: { partner: string; opts: Parameters<RunecraftDeps['receiveFrom']>[2] }[] = [];
        h.receive = async (_sdk, partner, opts) => {
            received.push({ partner, opts });
            h.sdk.tick(s => ({ inventory: [...s.inventory, ...lumbridge(5)] }));
            return { ok: true, ticks: 4 };
        };
        await altarStep(toLevel45, h.opts()).run(h.ctx());
        // the program was fed the essence giver only
        expect((h.starts[0]!.givers as GiverEntry[]).map(g => g.name)).toEqual(['lab_g1']);
        const cues = handBackCues(h);
        expect(new Set(cues.map(c => c.session)).size).toBe(1);
        expect(cues.map(c => [c.fields.turns, c.fields.stop ?? false])).toEqual([
            [[{ giver: 'lab_hb', T: 105, schedule: 'stock', items: [...S21_HAND_BACK.items] }], false],
            [[{ giver: 'lab_hb', T: 105, schedule: 'stock', items: [...S21_HAND_BACK.items] }], true]
        ]);
        expect(cues[0]!.receiver).toBe(SCORED);
        // the hand-back session is scoped like the program's: S21, altar
        expect(h.cues.every(c => c.scope.step === 'S21' && c.scope.family === 'altar')).toBe(true);
        expect(received).toHaveLength(1);
        const { partner, opts } = received[0]!;
        expect(partner).toBe('lab_hb');
        expect(opts).toMatchObject({ maxTicks: 30, openMaxTicks: 30, noReplyTicks: DROPPED_TICKS });
        expect(opts.want!.map(w => [(w.item as RegExp).test(w === opts.want![0] ? 'Law rune' : w === opts.want![1] ? 'Air rune' : 'Earth rune'), w.amount])).toEqual([
            [true, 1],
            [true, 3],
            [true, 1]
        ]);
        expect((opts.want![1]!.item as RegExp).test('Air runes')).toBe(false);
        const row = h.log.rows.find(r => r.step === 'runecraft:hand-back');
        expect(row).toMatchObject({ ok: true, ticks: 0, startTick: 102, endTick: 103, meta: { kind: 'rc-hand-back', band: 'S21', stepTicks: 1, attempts: [{ giver: 'lab_hb', turn: 102, ticks: 4 }] } });
    });

    test('a failed hand-back is retried in the same cue session; the third failure throws with every reason and stops the cue', async () => {
        const h = new Harness(world({}));
        h.statuses = [handBackStatus(h, 'lab_hb')];
        oneCraft(h);
        const replies = [
            { ok: true, ticks: 6 }, // traded, but nothing arrived
            { ok: false, reason: 'declined' },
            { ok: false, reason: 'no trade opened in 30 ticks' }
        ];
        h.receive = async () => {
            h.sdk.tick({});
            return replies.shift()!;
        };
        await expect(altarStep(toLevel45, h.opts()).run(h.ctx())).rejects.toThrow('S21 runecraft: the hand-back failed 3 times (lab_hb: traded, but the items are not all held; lab_hb: declined; lab_hb: no trade opened in 30 ticks)');
        const cues = handBackCues(h);
        expect(new Set(cues.map(c => c.session)).size).toBe(1);
        expect(cues.at(-1)!.fields).toMatchObject({ stop: true });
        expect(cues.at(-1)!.fields.turns.map(t => t.T)).toEqual([105, 106, 107]);
        expect(h.log.rows.find(r => r.step === 'runecraft:hand-back')).toMatchObject({ ok: false, meta: { attempts: [{}, {}, {}] } });
        // a retry that lands is enough
        const h2 = new Harness(world({}));
        h2.statuses = [handBackStatus(h2, 'lab_hb')];
        oneCraft(h2);
        let n = 0;
        h2.receive = async () => {
            if (n++ === 0) return { ok: false, reason: 'declined' };
            h2.sdk.tick(s => ({ inventory: [...s.inventory, ...lumbridge(5)] }));
            return { ok: true, ticks: 4 };
        };
        await altarStep(toLevel45, h2.opts()).run(h2.ctx());
        expect(handBackCues(h2).at(-1)!.fields.turns).toHaveLength(2);
    });

    test('a resume at the target in the room runs only the hand-back; holding the items already, nothing', async () => {
        const h = new Harness(world({ level: 45 }));
        h.statuses = [handBackStatus(h, 'lab_hb')];
        h.receive = async () => {
            h.sdk.tick(s => ({ inventory: [...s.inventory, ...lumbridge(5)] }));
            return { ok: true, ticks: 4 };
        };
        await altarStep(toLevel45, h.opts()).resume!(h.ctx());
        expect(h.starts).toHaveLength(0);
        expect(h.sdk.sends('sendDropItem')).toHaveLength(0);
        expect(handBackCues(h)).toHaveLength(2);
        const held = new Harness(world({ level: 45, inventory: lumbridge() }));
        await altarStep(toLevel45, held.opts()).resume!(held.ctx());
        expect(held.cues).toHaveLength(0);
        expect(held.log.rows.filter(r => r.step === 'runecraft:hand-back')).toHaveLength(0);
    });

    test('the hand-back trade closes the level-up dialog, so nothing is clicked after it', async () => {
        const h = new Harness(world({}));
        h.statuses = [handBackStatus(h, 'lab_hb')];
        h.scripts.push(async run => {
            run.step();
            const end = run.end('done', {}, { result: summary(1) });
            h.sdk.tick({ ...lvl45, dialog: { isOpen: true, options: [], isWaiting: false, pageId: 'levelup' } as BotWorldState['dialog'] });
            return end;
        });
        h.receive = async () => {
            h.sdk.tick(s => ({ inventory: [...s.inventory, ...lumbridge(5)], dialog: { isOpen: false, options: [], isWaiting: false } as BotWorldState['dialog'] }));
            return { ok: true, ticks: 4 };
        };
        await altarStep(toLevel45, h.opts({ dismissLevelUp: true })).run(h.ctx());
        expect(h.sdk.sends('sendClickDialog')).toHaveLength(0);
    });
});

// ------------------------------------------------------------------ xp targets

describe("S21's pre-login, SCORED's relog, then the first trade (rs/186)", () => {
    const opts = (h: Harness, o: RunecraftOptions = {}) => h.opts({ untilLevel: 45, s21Altar: 'nature', s21Givers: ['lab_g1', 'lab_g2'], preLoginTicks: 40, ...o });

    test("the bound: the launcher limiter's queue for the roster, one login and a refusal pause; 340 s for 22 givers", () => {
        // 3 back to back 4 s apart, then one every 10 s: the 22nd login's slot is 190 s after the first.
        expect([loginSpanMs(1), loginSpanMs(3), loginSpanMs(5), loginSpanMs(22)]).toEqual([0, 8_000, 20_000, 190_000]);
        expect(preLoginWaitMs(22)).toBe(340_000);
        expect(Math.ceil(preLoginWaitMs(22) / 400)).toBe(850); // observed ticks at the demo's 400 ms
    });

    test('opens {S21, altar} with no turns and no stop, and resolves once every roster giver reports ready, not before', async () => {
        const h = new Harness(world({ inventory: [item(0, 'Nature talisman')] }));
        const pre = preLoginStep(opts(h));
        expect([pre.name, pre.logoutSafe]).toEqual(['S21 runecraft:pre-login', true]);
        const t0 = h.sdk.state!.tick;
        await drive(h.sdk, pre.run(h.ctx()), 200, s => {
            if (s.tick === t0 + 10) h.statuses = [h.giver('lab_g1')];
            // logged in but still restocking: not ready
            if (s.tick === t0 + 20) h.statuses = [h.giver('lab_g1'), h.giver('lab_g2', { phase: 'restock', essence: 0 })];
            if (s.tick === t0 + 30) h.statuses = [h.giver('lab_g1'), h.giver('lab_g2')];
            return {};
        });
        expect(h.cues.map(c => [c.session, c.scope, c.fields.turns, c.fields.stop ?? false])).toEqual([['s1', { step: 'S21', family: 'altar' }, [], false]]);
        expect(h.cues[0]!.fields.beacons.length).toBeGreaterThanOrEqual(4);
        expect(h.cues[0]!.receiver).toBe(SCORED);
        const row = h.log.rows.find(r => r.step === 'S21 runecraft:pre-login')!;
        expect(row).toMatchObject({ kind: 'note', ok: true, meta: { kind: 'rc-pre-login', band: 'S21', want: 2, ready: 2, missing: [], boundTicks: 40, cueSession: 's1' } });
        expect(row.meta!.waitedTicks as number).toBeGreaterThanOrEqual(29);
    });

    test('a giver not ready within the bound fails the step, naming it; a counted roster counts the ready givers', async () => {
        const h = new Harness(world({ inventory: [item(0, 'Nature talisman')] }));
        h.statuses = [h.giver('lab_g1'), h.giver('lab_g2', { ms: h.now - 6_000 })];
        const err = await drive(h.sdk, preLoginStep(opts(h)).run(h.ctx()).catch((e: Error) => e), 200);
        expect(String(err)).toContain('S21 runecraft:pre-login: 1 of 2 givers ready after 40 ticks (not ready: lab_g2)');
        expect(h.log.rows.find(r => r.step === 'S21 runecraft:pre-login')).toMatchObject({ ok: false, meta: { ready: 1, missing: ['lab_g2'] } });
        await drive(h.sdk, preLoginStep(opts(h, { s21Givers: 1 })).run(h.ctx()), 200);
        await expect(drive(h.sdk, preLoginStep(opts(h, { s21Givers: 2, preLoginTicks: 5 })).run(h.ctx()), 200)).rejects.toThrow('1 of 2 givers ready after 5 ticks;');
    });

    test('every giver ready, then the relog, then the first trade: the givers in before the relog are fed tuned, one after it robust', async () => {
        const h = new Harness(world({ inventory: [item(0, 'Nature talisman')] }));
        const events: string[] = [];
        // The launcher logged lab_g1 and lab_g2 in on the cue's open; lab_g3 (relaunched) comes in after SCORED's relog.
        h.launcher = h.launcherWith([{ account: 'lab_g1', loggedInAt: 2_000 }, { account: 'lab_g2', loggedInAt: 2_500 }, { account: 'lab_g3', loggedInAt: 4_000 }]);
        h.statuses = [h.giver('lab_g1', { readyAt: 800, loggedInAt: 2_000 }), h.giver('lab_g2', { readyAt: 900, loggedInAt: 2_500 })];
        const base = h.deps();
        const o = opts(h, {
            deps: {
                startProgram: async (sdk, name, params) => {
                    events.push('first trade');
                    return base.startProgram!(sdk, name, params);
                },
            },
        });
        const ready = () => giverFeed(h.statuses, h.now, () => 'robust').map(g => g.name).join(',');
        const relog = scoredRelogStep({
            deps: {
                relog: async (s: Session) => {
                    events.push(`relog (ready: ${ready()})`);
                    s.launchedAt = 3_000;
                    h.statuses = [...h.statuses, h.giver('lab_g3', { readyAt: 3_500, loggedInAt: 4_000 })];
                    return { logout: { ok: true }, loginTick: 120, tickBase: 0, via: 'page', loginWallMs: 1_000, attempts: 1 } as RelogResult;
                },
                replyCode: async () => null,
            },
        });
        h.scripts.push(async run => {
            run.step({ turns: [{ giver: 'lab_g1', T: 110, schedule: 'tuned' }] });
            return run.end('done', { turns: [{ giver: 'lab_g1', T: 110, schedule: 'tuned' }] }, { result: summary(1) });
        });
        const ctx = h.ctx();
        expect((ctx.session as Partial<Session>).launchedAt).toBe(1_000); // SCORED's first login, before every giver's
        await drive(h.sdk, preLoginStep(o).run(ctx));
        events.push(`pre-login done (ready: ${ready()})`);
        await relog.run(ctx);
        await altarStep(nature44, o).run(ctx);
        expect(events).toEqual(['pre-login done (ready: lab_g1,lab_g2)', 'relog (ready: lab_g1,lab_g2)', 'first trade']);
        expect(h.starts[0]!.givers).toEqual([
            { name: 'lab_g1', schedule: 'tuned', readyAt: 800 },
            { name: 'lab_g2', schedule: 'tuned', readyAt: 900 },
            { name: 'lab_g3', schedule: 'robust', readyAt: 3_500 },
        ]);
        expect(h.programRows()[0]!.meta).toMatchObject({ why: { lab_g1: 'giver logged in first', lab_g2: 'giver logged in first', lab_g3: 'giver logged in after SCORED' } });
        // The pre-login's session is never stopped; the band's program writes its own.
        expect(h.cues.filter(c => c.session === 's1').every(c => !c.fields.stop)).toBe(true);
        expect(new Set(h.cues.map(c => `${c.scope.step}/${c.scope.family}`))).toEqual(new Set(['S21/altar']));
    });

    test('without the relog, SCORED logged in before every giver: all of them are fed robust', async () => {
        const h = new Harness(world({ inventory: [item(0, 'Nature talisman')] }));
        h.launcher = h.launcherWith([{ account: 'lab_g1', loggedInAt: 2_000 }, { account: 'lab_g2', loggedInAt: 2_500 }]);
        h.statuses = [h.giver('lab_g1', { readyAt: 800, loggedInAt: 2_000 }), h.giver('lab_g2', { readyAt: 900, loggedInAt: 2_500 })];
        h.scripts.push(async run => run.end('done', {}, { result: summary(1) }));
        const ctx = h.ctx();
        await drive(h.sdk, preLoginStep(opts(h)).run(ctx));
        await altarStep(nature44, opts(h)).run(ctx);
        expect((h.starts[0]!.givers as GiverEntry[]).map(g => g.schedule)).toEqual(['robust', 'robust']);
    });
});

describe('xpAfterCrafts', () => {
    test('a full load is 27 essence at the altar base xp, times the server xp rate', () => {
        expect(craftXp('air')).toBe(27 * 5 * 25);
        expect(craftXp('air', S06_LOAD)).toBe(26 * 5 * 25);
        // S06 keeps its 7 crafts at 26 a load: 6 leave Runecraft 42, 7 reach 44
        expect(levelForXp(6 * craftXp('air', S06_LOAD))).toBe(42);
        expect(levelForXp(7 * craftXp('air', S06_LOAD))).toBe(44);
        expect(craftXp('nature')).toBe(27 * 9 * 25);
    });

    test('the target sits half a load short of the last craft', () => {
        const xp0 = 1_000;
        const target = xpAfterCrafts('air', xp0, 20);
        expect(target).toBeGreaterThan(xp0 + 19 * craftXp('air'));
        expect(target).toBeLessThan(xp0 + 20 * craftXp('air'));
    });
});

// ------------------------------------------------------------------ default deps

describe('defaultDeps: the real cue and status files', () => {
    let dir = '';
    beforeAll(() => {
        dir = mkdtempSync(join(tmpdir(), 'rc-cue-test-'));
    });
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    test('a relayed program run writes a cue.json the givers read, naming SCORED only by a hash', () => {
        const relay = new CueRelay(() => defaultDeps.openCue(dir, 'Lab Scored', { step: 'S06', family: 'altar' }), defaultDeps.rcCueFields);
        const turns = [{ giver: 'lab_g1', T: 110, schedule: 'tuned' as const }];
        relay.update(status({ runId: 7, shared: { v: 1, open: 5, schedule: 'robust', beacons: [{ tick: 100, ms: 1 }], turns, results: [], queue: [], waiting: null } } as Partial<ProgramStatus>));
        expect(readCue(dir)).toMatchObject({ receiver: { sha256: nameHash('lab_scored') }, schedule: 'robust', open: 5, turns, seq: 1 });
        expect(readFileSync(join(dir, 'cue.json'), 'utf8').toLowerCase()).not.toContain('scored');
        relay.stop();
        expect(readCue(dir)).toMatchObject({ stop: true, seq: 2, turns });
    });

    test("S06's stop cue addresses S06's altar givers only: an S07 bone or S18 courier reader never sees it", async () => {
        const sub = mkdtempSync(join(tmpdir(), 'rc-scope-'));
        try {
            const h = new Harness(world({ altar: AIR_ALTAR, level: 43 }));
            h.statuses = [h.giver('lab_g1', { essence: 26 })];
            h.scripts.push(async run => {
                run.step({ turns: [{ giver: 'lab_g1', T: 110, schedule: 'tuned' }] });
                return run.end('done', { turns: [{ giver: 'lab_g1', T: 110, schedule: 'tuned' }] }, { result: summary(1) });
            });
            const band: Band = bands()[0]!;
            await altarStep(band, h.opts({ deps: { openCue: defaultDeps.openCue, rcCueFields: defaultDeps.rcCueFields } , cueDir: sub })).run(h.ctx());
            const cue = readCue(sub)!;
            expect(cue).toMatchObject({ stop: true, scope: { step: 'S06', family: 'altar' } });
            expect(cueAddresses(cue, 'S06', 'altar')).toBe(true);
            expect(cueAddresses(cue, 'S07', 'bone')).toBe(false);
            expect(cueAddresses(cue, 'S18', 'courier')).toBe(false);
            expect(cueAddresses(cue, 'S21', 'altar')).toBe(false);
        } finally {
            rmSync(sub, { recursive: true, force: true });
        }
    });

    test("readStatuses reads the givers' status files", () => {
        writeStatus(dir, { v: 1, account: 'lab_g1', phase: 'ready', loggedInAt: 1, essence: 27, tile: null, inRoom: true, readyAt: 5, gave: 0, ms: 10 });
        expect(defaultDeps.readStatuses(dir).map(s => [s.account, s.phase, s.essence])).toEqual([['lab_g1', 'ready', 27]]);
    });

    test('cueDir follows RC_CUE_DIR', () => {
        const prev = process.env.RC_CUE_DIR;
        process.env.RC_CUE_DIR = dir;
        try {
            expect(defaultDeps.cueDir()).toBe(dir);
        } finally {
            if (prev === undefined) delete process.env.RC_CUE_DIR;
            else process.env.RC_CUE_DIR = prev;
        }
    });
});
