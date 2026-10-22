import { describe, expect, test } from 'bun:test';
import type { BotWorldState, GameMessage, GroundItem, NearbyLoc } from '../../sdk/types';
import { baseState, FakeSdk, flush } from '../lib/fake-sdk';
import { TickLog } from '../lib/ticks';
import { levelForXp, XP_RATE, xpForLevel } from '../lib/xp';
import type { StepContext } from '../runner/step';
import {
    BANDS, bandFor, BACKSTOP_TICKS, DEFAULT_ID, Lighter, lightRow, modelledLine, parseTiles, precheck, RESEND_AFTER, resolveOptions, routeLogs, skill, steps,
    summarizeBands, tierFor, tierOf, TIERS, type LightEvent, type Tile
} from './firemaking';

const SPAWN: Tile = [3222, 3222];
const ROW = '3222-3218@3219;3218-3236@3218;3236-3223@3219';

function skills(level: number, xp = xpForLevel(level)) {
    return [{ name: 'Firemaking', level, baseLevel: level, experience: xp }];
}

function ground(x: number, z: number, name: string, id = 1511): GroundItem {
    return { id, name, count: 1, x, z, distance: 0 };
}

function fire(x: number, z: number): NearbyLoc {
    return { id: 26185, name: 'Fire', x, z, level: 0, distance: 0, optionsWithIndex: [] } as unknown as NearbyLoc;
}

let obs = 0;
function msg(text: string, tick: number): GameMessage {
    return { type: 0, text, sender: '', tick, fromSelf: false, observationId: ++obs };
}

function state(o: { tick?: number; at?: Tile; level?: number; xp?: number; ground?: GroundItem[]; fires?: Tile[]; msgs?: GameMessage[]; anim?: number; inv?: string[] } = {}): BotWorldState {
    const at = o.at ?? SPAWN;
    const level = o.level ?? (o.xp !== undefined ? levelForXp(o.xp) : 1);
    return baseState({
        tick: o.tick ?? 1000,
        player: { worldX: at[0], worldZ: at[1], animId: o.anim ?? -1 } as BotWorldState['player'],
        skills: skills(level, o.xp),
        inventory: (o.inv ?? ['Tinderbox']).map((name, slot) => ({ slot, id: 590, name, count: 1, optionsWithIndex: [] })),
        groundItems: o.ground ?? [],
        nearbyLocs: (o.fires ?? []).map(([x, z]) => fire(x, z)),
        gameMessages: o.msgs ?? []
    });
}

describe('firemaking: logs, bands and the route (firemaking.obj, read)', () => {
    test('1 to 99 takes the 157 logs fm-row drops: 2 normal, 4 oak, 7 willow, 13 maple, 24 yew, 107 magic', () => {
        const route = routeLogs(0);
        expect(route.length).toBe(157);
        const by: Record<string, number> = {};
        for (const t of route) by[t.obj] = (by[t.obj] ?? 0) + 1;
        expect(by).toEqual({ logs: 2, oak_logs: 4, willow_logs: 7, maple_logs: 13, yew_logs: 24, magic_logs: 107 });
        // every log is lightable when its turn comes, and the last one reaches 99
        let xp = 0;
        for (const t of route) {
            expect(levelForXp(xp)).toBeGreaterThanOrEqual(t.level);
            xp += t.base * XP_RATE;
        }
        expect(levelForXp(xp)).toBe(99);
    });

    test('from a mid start, the route is the remainder; at the target it is empty', () => {
        expect(routeLogs(xpForLevel(99))).toEqual([]);
        expect(routeLogs(0, 30).every(t => t.level < 30)).toBe(true);
        expect(routeLogs(xpForLevel(75)).every(t => t.obj === 'magic_logs')).toBe(true);
    });

    test('bands are the six tiers, named fm-01-15 ... fm-75-99', () => {
        expect(BANDS.map(b => b.id)).toEqual(['fm-01-15', 'fm-15-30', 'fm-30-45', 'fm-45-60', 'fm-60-75', 'fm-75-99']);
        expect([1, 14, 15, 44, 45, 74, 75, 98, 99].map(l => bandFor(l).id)).toEqual(['fm-01-15', 'fm-01-15', 'fm-15-30', 'fm-30-45', 'fm-45-60', 'fm-60-75', 'fm-75-99', 'fm-75-99', 'fm-75-99']);
    });

    test('the best log a level may light, and names as the state shows them', () => {
        expect([1, 14, 15, 29, 30, 45, 60, 74, 75, 99].map(l => tierFor(l).obj)).toEqual(['logs', 'logs', 'oak_logs', 'oak_logs', 'willow_logs', 'maple_logs', 'yew_logs', 'yew_logs', 'magic_logs', 'magic_logs']);
        expect(tierOf('magic logs')?.level).toBe(75);
        expect(tierOf('Logs')?.level).toBe(1);
        expect(tierOf('Ashes')).toBeUndefined();
        expect(TIERS).toHaveLength(6);
    });

    test('the modelled line: 3 to the first roll, 4 per roll after, the success 1 tick after its roll', () => {
        expect(modelledLine(157, 0)).toBe(3 + 4 * 156 + 1);
        expect(modelledLine(157, 8)).toBe(3 + 4 * 164 + 1);
        expect(modelledLine(0, 0)).toBe(0);
    });
});

describe('firemaking: tiles and options', () => {
    test('segments run in either direction; tiles, JSON and objects are accepted', () => {
        expect(parseTiles('3222-3220@3219')).toEqual([[3222, 3219], [3221, 3219], [3220, 3219]]);
        expect(parseTiles('3218-3220@3218 3240,3219')).toEqual([[3218, 3218], [3219, 3218], [3220, 3218], [3240, 3219]]);
        expect(parseTiles('3236@3218-3219')).toEqual([[3236, 3218], [3236, 3219]]);
        expect(parseTiles('3218@3217')).toEqual([[3218, 3217]]);
        expect(parseTiles('[[1,2],[3,4]]')).toEqual([[1, 2], [3, 4]]);
        expect(parseTiles([{ x: 5, z: 6 }])).toEqual([[5, 6]]);
        expect(parseTiles(undefined)).toEqual([]);
        expect(parseTiles(ROW)).toHaveLength(5 + 19 + 14);
    });

    test('bad tiles are refused when the steps are built', () => {
        expect(() => parseTiles('3222-3218')).toThrow(/segment/);
        expect(() => parseTiles('a-b@3219')).toThrow(/bad x/);
        expect(() => parseTiles([[1, 2, 3]])).toThrow(/tile 0/);
        expect(() => steps({ tiles: '1-2@3-4' })).toThrow(/x0-x1@z, x@z0-z1 or x@z/);
    });

    test('defaults, toLevel, and option strings from --skill-opt', () => {
        const d = resolveOptions();
        expect(d).toMatchObject({ id: DEFAULT_ID, toLevel: 99, supply: 'row', tiles: [], entry: null, waitForRow: 150, maxGap: 120, lookahead: 6 });
        expect(resolveOptions({ toLevel: '30' }).toLevel).toBe(30);
        expect(resolveOptions({ tiles: ROW }).entry).toEqual([3222, 3219]);
        expect(resolveOptions({ tiles: ROW, entry: '3221,3219' }).entry).toEqual([3221, 3219]);
        expect(() => resolveOptions({ toLevel: 100 })).toThrow(/toLevel/);
        expect(() => resolveOptions({ supply: 'mule' as never })).toThrow(/supply/);
        expect(() => resolveOptions({ waitForRow: 'soon' })).toThrow(/waitForRow/);
    });
});

describe('firemaking: the step (one Step; bands are measure rows)', () => {
    test('the module convention: skill, one logout-safe step named S03 firemaking or by id, done at the target level', () => {
        expect(skill).toBe('firemaking');
        const all = steps({ tiles: ROW });
        expect(all).toHaveLength(1);
        const s = all[0]!;
        expect(s.name).toBe('S03 firemaking');
        expect(steps({ id: 'firemaking:1-99' })[0]!.name).toBe('firemaking:1-99');
        expect(s.logoutSafe).toBe(true);
        expect(s.done!({ state: state({ level: 98 }), probed: {} }, {} as never)).toBe(false);
        expect(s.done!({ state: state({ level: 99 }), probed: {} }, {} as never)).toBe(true);
        expect(steps({ toLevel: 30 })[0]!.done!({ state: state({ level: 30 }), probed: {} }, {} as never)).toBe(true);
        expect(s.inProgress!({ state: state({ level: 50 }), probed: {} }, {} as never)).toBe(true);
        expect(s.inProgress!({ state: state({ level: 1 }), probed: {} }, {} as never)).toBe(false);
        expect(s.postconditions(state({ level: 98 }), {} as never)).toBe('Firemaking 98, below 99');
    });

    test('unbuilt supplies refuse in preconditions with a reason, never by throwing', () => {
        for (const supply of ['trade', 'bank'] as const) {
            const s = steps({ supply, tiles: ROW })[0]!;
            expect(() => s.preconditions(state(), {} as never)).not.toThrow();
            expect(s.preconditions(state(), {} as never)).toBe(`supply '${supply}' not built`);
        }
    });

    test('preconditions: a tinderbox, the planned tiles, and the row\'s entry within reach', () => {
        const pre = (s: BotWorldState, o = {}) => steps({ tiles: ROW, ...o })[0]!.preconditions(s, {} as never);
        expect(pre(state())).toBe(true);
        expect(pre(state({ inv: ['Bronze axe'] }))).toBe('no tinderbox');
        expect(steps()[0]!.preconditions(state(), {} as never)).toBe('no planned tiles (the tiles option)');
        expect(pre(state({ at: [3260, 3222] }))).toBe("not within 15 tiles of the row's entry 3222,3219 (38 away)");
        // already at the target: nothing to do, whatever the inventory
        expect(pre(state({ level: 99, inv: [] }))).toBe(true);
        expect(precheck(state({ level: 30, inv: [] }), resolveOptions({ toLevel: 30 }))).toBe(true);
    });
});

describe('firemaking: the lighting engine', () => {
    const tiles = parseTiles('3222-3218@3219');
    const opts = { lookahead: 6, entry: tiles[0]! };

    test('lights the nearest planned log first, then the next tile on the success message itself', () => {
        const start = state({ tick: 100, ground: [ground(3222, 3219, 'Logs', 1), ground(3221, 3219, 'Logs', 2)] });
        const L = new Lighter(tiles, start, opts);
        expect(L.onTick(start).light).toEqual({ x: 3222, z: 3219, itemId: 1 });
        expect(L.onTick(state({ tick: 101, at: [3222, 3220], ground: [ground(3222, 3219, 'Logs', 1), ground(3221, 3219, 'Logs', 2)] })).light).toBeUndefined();
        const atRow = { at: [3222, 3219] as Tile };
        L.onTick(state({ tick: 102, ...atRow, msgs: [msg('You attempt to light the logs.', 102)], ground: [ground(3222, 3219, 'Logs', 1), ground(3221, 3219, 'Logs', 2)] }));
        const ok = state({ tick: 106, at: [3221, 3219], msgs: [msg('The fire catches and the logs begin to burn.', 106)], ground: [ground(3221, 3219, 'Logs', 2)], fires: [[3222, 3219]] });
        const d = L.onTick(ok);
        expect(d.light).toEqual({ x: 3221, z: 3219, itemId: 2 });
        const f = L.events.find(e => e.kind === 'fire')!;
        expect(f).toMatchObject({ kind: 'fire', n: 0, tile: [3222, 3219], tier: 'Logs', gap: null, fresh: true, failures: 0, slip: 0 });
        expect(L.firstAttemptTick).toBe(102);
        expect(L.cursor).toBe(1);
    });

    test('never resends a light while there is any sign it took; resends after RESEND_AFTER quiet ticks', () => {
        const g = [ground(3222, 3219, 'Logs', 1)];
        const at: Tile = [3222, 3219];
        const L = new Lighter(tiles, state({ tick: 0, at, ground: g }), opts);
        expect(L.onTick(state({ tick: 0, at, ground: g })).light).toBeDefined();
        // animating from tick 2 on: rolling and failing, silently
        for (let t = 1; t <= 12; t++) expect(L.onTick(state({ tick: t, at, ground: g, anim: t >= 2 ? 733 : -1 })).light).toBeUndefined();
        expect(L.resends).toBe(0);

        const Q = new Lighter(tiles, state({ tick: 0, at, ground: g }), opts);
        Q.onTick(state({ tick: 0, at, ground: g }));
        for (let t = 1; t < RESEND_AFTER; t++) expect(Q.onTick(state({ tick: t, at, ground: g })).light).toBeUndefined();
        expect(Q.onTick(state({ tick: RESEND_AFTER, at, ground: g })).light).toEqual({ x: 3222, z: 3219, itemId: 1 });
        expect(Q.events.at(-1)).toMatchObject({ kind: 'resend', backstop: false });
        expect(Q.resends).toBe(1);
    });

    test('a light with signs of life but no attempt message is resent only at the backstop', () => {
        const g = [ground(3222, 3219, 'Logs', 1)];
        const at: Tile = [3222, 3219];
        const L = new Lighter(tiles, state({ tick: 0, at, ground: g }), opts);
        L.onTick(state({ tick: 0, at, ground: g }));
        let sends = 0;
        for (let t = 1; t <= BACKSTOP_TICKS; t++) if (L.onTick(state({ tick: t, at, ground: g, anim: 733 })).light) sends++;
        expect(sends).toBe(1);
        expect(L.events.at(-1)).toMatchObject({ kind: 'resend', backstop: true, tick: BACKSTOP_TICKS });
    });

    test('skips a planned tile holding a fire and follows the log to the next free one', () => {
        const at: Tile = [3221, 3219];
        const L = new Lighter(tiles, state({ tick: 0, at }), opts);
        L.cursor = 1;
        (L as unknown as { fires: number }).fires = 1;
        const d = L.onTick(state({ tick: 1, at, ground: [ground(3221, 3219, 'Logs', 7), ground(3220, 3219, 'Logs', 8)], fires: [[3221, 3219]] }));
        expect(d.light).toEqual({ x: 3220, z: 3219, itemId: 8 });
        expect(L.events).toEqual([{ kind: 'skip', tick: 1, tile: [3221, 3219], reason: 'fire' }]);
        expect(L.cursor).toBe(2);
    });

    test('a refused tile is passed and never planned again; a log above the level is left', () => {
        const at: Tile = [3222, 3219];
        const g = [ground(3222, 3219, 'Logs', 1), ground(3221, 3219, 'Oak logs', 2), ground(3220, 3219, 'Logs', 3)];
        const L = new Lighter(tiles, state({ tick: 0, at, ground: g }), opts);
        L.onTick(state({ tick: 0, at, ground: g }));
        const d = L.onTick(state({ tick: 1, at, ground: g, msgs: [msg("You can't light a fire here.", 1)] }));
        expect(L.events[0]).toEqual({ kind: 'refused', tick: 1, tile: [3222, 3219], reason: 'tile' });
        // oak needs 15: the loop goes past it to the normal log
        expect(d.light).toEqual({ x: 3220, z: 3219, itemId: 3 });
    });

    test('"I can\'t reach that!" passes the tile for good instead of resending (a wall the collision map lacks)', () => {
        const at: Tile = [3217, 3219];
        const g = [ground(3216, 3219, 'Logs', 1), ground(3215, 3219, 'Logs', 2)];
        const L = new Lighter(parseTiles('3222-3214@3219'), state({ tick: 0, at, ground: g }), opts);
        L.cursor = 6;
        (L as unknown as { fires: number }).fires = 5;
        expect(L.onTick(state({ tick: 0, at, ground: g })).light).toEqual({ x: 3216, z: 3219, itemId: 1 });
        const d = L.onTick(state({ tick: 1, at, ground: g, msgs: [msg("I can't reach that!", 1)] }));
        expect(L.events.at(-1)).toEqual({ kind: 'refused', tick: 1, tile: [3216, 3219], reason: 'unreachable' });
        expect(d.light).toEqual({ x: 3215, z: 3219, itemId: 2 });
        expect(L.resends).toBe(0);
    });

    test('a log taken off the tile before it is lit is logged lost and the next one is lit', () => {
        const at: Tile = [3222, 3219];
        const both = [ground(3222, 3219, 'Logs', 1), ground(3221, 3219, 'Logs', 2)];
        const L = new Lighter(tiles, state({ tick: 0, at, ground: both }), opts);
        L.onTick(state({ tick: 0, at, ground: both }));
        const rest = [ground(3221, 3219, 'Logs', 2)];
        expect(L.onTick(state({ tick: 1, at, ground: rest, anim: 733 })).light).toBeUndefined();
        const d = L.onTick(state({ tick: 2, at, ground: rest }));
        expect(L.events[0]).toEqual({ kind: 'lost', tick: 2, tile: [3222, 3219], tier: 'Logs' });
        expect(d.light).toEqual({ x: 3221, z: 3219, itemId: 2 });
    });

    test('with nothing to light it walks to the entry once, and the wait is logged when a log shows', () => {
        const L = new Lighter(tiles, state({ tick: 0 }), opts);
        expect(L.onTick(state({ tick: 0 })).walk).toEqual([3222, 3219]);
        expect(L.onTick(state({ tick: 1 })).walk).toBeUndefined();
        expect(L.waiting(5)).toBe(5);
        L.onTick(state({ tick: 30, at: [3222, 3219], ground: [ground(3222, 3219, 'Logs', 1)] }));
        expect(L.events[0]).toEqual({ kind: 'nolog', tick: 30, from: 0, ticks: 30, first: true });
        expect(L.waiting(31)).toBe(0);
    });

    test('a level-up page is dismissed in the same tick as the next light', () => {
        const g = [ground(3221, 3219, 'Logs', 2)];
        const L = new Lighter(tiles, state({ tick: 0, level: 14, at: [3222, 3219], ground: [ground(3222, 3219, 'Logs', 1), ...g] }), opts);
        L.onTick(state({ tick: 0, level: 14, at: [3222, 3219], ground: [ground(3222, 3219, 'Logs', 1), ...g] }));
        const up = { ...state({ tick: 4, level: 15, at: [3221, 3219], ground: g, msgs: [msg('The fire catches and the logs begin to burn.', 4)] }), dialog: { isOpen: true, options: [], isWaiting: false, pageId: 'lvl15' } } as BotWorldState;
        const d = L.onTick(up);
        expect(d.dismiss).toBe(true);
        expect(d.light).toEqual({ x: 3221, z: 3219, itemId: 2 });
    });
});

// ------------------------------------------------------------------ end to end against a small server

/**
 * The server side of firemaking.rs2 as the loop sees it: an op lands the tick after it is sent;
 * a fresh light says "You attempt" and rolls 3 ticks later, a light landing while the clock still
 * runs is queued onto it; every roll re-arms the clock by 4; a success pushes the player west at
 * the roll and, a tick later, prints the message, adds the fire, removes the log and pays the xp.
 */
class Server {
    readonly sdk: FakeSdk;
    private op: { x: number; z: number; itemId: number; land: number } | null = null;
    private target: { x: number; z: number; itemId: number } | null = null;
    private clock = -100;
    private successAt: number | null = null;
    readonly lands: number[] = [];
    readonly rolls: boolean[];

    constructor(o: { xp: number; logs: Array<[number, number, string]>; at: Tile; rolls?: boolean[] }) {
        this.rolls = [...(o.rolls ?? [])];
        this.sdk = new FakeSdk(state({ tick: 1000, xp: o.xp, at: o.at, ground: o.logs.map(([x, z, name], i) => ground(x, z, name, 2000 + i)) }));
        this.sdk.onSend = a => {
            const act = a as unknown as { type?: string; x: number; z: number; itemId: number; optionIndex: number; method?: string };
            if (act.type === 'interactGroundItem' && act.optionIndex === 4) this.op = { x: act.x, z: act.z, itemId: act.itemId, land: this.sdk.state!.tick + 1 };
            if (act.method === 'sendClickDialog') this.sdk.state = { ...this.sdk.state!, dialog: { isOpen: false, options: [], isWaiting: false } };
        };
    }

    advance(): void {
        const s = this.sdk.state!;
        const t = s.tick + 1;
        const msgs: GameMessage[] = [];
        let player = s.player!;
        let { groundItems, nearbyLocs, skills: sk, dialog } = s;
        if (this.op && this.op.land <= t) {
            this.lands.push(t);
            this.target = { x: this.op.x, z: this.op.z, itemId: this.op.itemId };
            player = { ...player, worldX: this.op.x, worldZ: this.op.z };
            if (this.clock < t) {
                msgs.push(msg('You attempt to light the logs.', t));
                this.clock = t + 3;
            }
            this.op = null;
        }
        if (this.target && this.clock === t && this.successAt === null) {
            this.clock = t + 4;
            if (this.rolls.shift() ?? true) {
                this.successAt = t + 1;
                player = { ...player, worldX: player.worldX - 1 };
            }
        }
        if (this.successAt === t && this.target) {
            const tg = this.target;
            const log = groundItems.find(g => g.id === tg.itemId)!;
            groundItems = groundItems.filter(g => g !== log);
            nearbyLocs = [...nearbyLocs, fire(tg.x, tg.z)];
            const f = sk[0]!;
            const xp = f.experience + tierOf(log.name)!.base * XP_RATE;
            const level = levelForXp(xp);
            if (level > f.baseLevel) dialog = { isOpen: true, options: [], isWaiting: false, pageId: `lvl${level}` } as BotWorldState['dialog'];
            sk = [{ ...f, experience: xp, level, baseLevel: level }];
            msgs.push(msg('The fire catches and the logs begin to burn.', t));
            this.target = null;
            this.successAt = null;
        }
        this.sdk.push({ tick: t, player, groundItems, nearbyLocs, skills: sk, dialog, gameMessages: [...s.gameMessages, ...msgs].slice(-20) });
    }
}

async function runRow(server: Server, opts: Parameters<typeof resolveOptions>[0], maxTicks = 200) {
    const log = TickLog.memory('t');
    const ctx = { session: { sdk: server.sdk, bot: {}, name: 'cairn_test', sessionId: 1 }, sdk: server.sdk, bot: {}, c: {}, log } as unknown as StepContext<any>;
    let finished = false;
    let error: unknown;
    const p = lightRow(ctx, resolveOptions(opts)).then(r => r, e => { error = e; return null; }).finally(() => (finished = true));
    for (let i = 0; i < maxTicks && !finished; i++) {
        await flush();
        server.advance();
    }
    await flush();
    const r = await p;
    if (error) throw error;
    return { r: r!, log, sent: server.sdk.sent };
}

const MAGIC = 303.8 * XP_RATE;
const row3 = (name: string): Array<[number, number, string]> => [[3222, 3219, name], [3221, 3219, name], [3220, 3219, name]];

describe('firemaking: lightRow end to end', () => {
    test('chains 4-tick fires, stops the tick 99 is seen, and logs fire, band and summary rows', async () => {
        const server = new Server({ xp: xpForLevel(99) - 2 * MAGIC + 1, logs: row3('Magic logs'), at: [3222, 3220] });
        const { r, log, sent } = await runRow(server, { tiles: '3222-3218@3219' });
        expect(r.fires).toBe(2);
        const fires = r.events.filter((e): e is Extract<LightEvent, { kind: 'fire' }> => e.kind === 'fire');
        expect(fires.map(f => [f.gap, f.fresh, f.send, f.failures, f.slip])).toEqual([[null, true, null, 0, 0], [4, false, 0, 0, 0]]);
        // two lights, no resends, and nothing sent for the third log after 99
        expect(sent.filter(a => (a as unknown as { type?: string }).type === 'interactGroundItem')).toHaveLength(2);
        // 99's own level-up page is left open: the step ends that tick and the harness logs out
        expect(sent.some(a => a.method === 'sendClickDialog')).toBe(false);
        const steps = log.rows.map(row => row.step);
        expect(steps.filter(x => x === 'S03 firemaking fire')).toHaveLength(2);
        expect(steps).toContain('S03 firemaking fm-75-99');
        const sum = log.rows.find(row => row.step === 'S03 firemaking summary')!;
        expect(sum.kind).toBe('program');
        expect(sum.meta).toMatchObject({ fires: 2, failures: 0, line: modelledLine(2, 0), slips: 0, resends: 0, lost: 0, endLevel: 99 });
        expect(sum.meta!.overhead).toBe(sum.ticks - modelledLine(2, 0));
        expect(sum.meta!.fixedTicks).toBe(1); // the op lands the tick after the send, and its attempt is seen then
    });

    test('a failed roll costs 4 ticks and is inferred, and a band boundary is crossed without a pause', async () => {
        const xp14 = xpForLevel(14);
        const afterLog = levelForXp(xp14 + 40 * XP_RATE); // one normal log takes 14 past 15
        expect(afterLog).toBeGreaterThanOrEqual(15);
        const server = new Server({ xp: xp14, logs: [[3222, 3219, 'Logs'], [3221, 3219, 'Oak logs'], [3220, 3219, 'Oak logs']], at: [3222, 3219], rolls: [true, false, true, true] });
        const { r, log, sent } = await runRow(server, { tiles: '3222-3218@3219', toLevel: afterLog + 1 });
        const fires = r.events.filter((e): e is Extract<LightEvent, { kind: 'fire' }> => e.kind === 'fire');
        expect(fires.map(f => [f.tier, f.level, f.gap, f.failures, f.fresh])).toEqual([['Logs', 14, null, 0, true], ['Oak logs', afterLog, 8, 1, false]]);
        // the level-15 page was dismissed and the oak still chained onto the clock
        expect(sent.filter(a => a.method === 'sendClickDialog')).toHaveLength(1);
        const bands = summarizeBands(r.events);
        expect(bands.map(b => [b.band, b.fires, b.failures])).toEqual([['fm-01-15', 1, 0], ['fm-15-30', 1, 1]]);
        expect(log.rows.some(row => row.step === 'S03 firemaking fm-01-15')).toBe(true);
    });

    test('waiting for the row past waitForRow gives up with a reason, and still writes its summary', async () => {
        const server = new Server({ xp: 0, logs: [], at: [3222, 3219] });
        const log = TickLog.memory('t');
        const ctx = { session: { sdk: server.sdk, bot: {}, name: 'cairn_test', sessionId: 1 }, sdk: server.sdk, bot: {}, c: {}, log } as unknown as StepContext<any>;
        let error: unknown;
        const p = lightRow(ctx, resolveOptions({ tiles: '3222-3218@3219', waitForRow: 10 })).catch(e => (error = e));
        for (let i = 0; i < 40 && error === undefined; i++) {
            await flush();
            server.advance();
        }
        await p;
        expect(String(error)).toMatch(/no lightable log on the row within 10 ticks/);
        const sum = log.rows.find(row => row.step === 'S03 firemaking summary')!;
        expect(sum.meta).toMatchObject({ ended: 'firemaking: no lightable log on the row within 10 ticks', fires: 0 });
    });

    test('a gap past maxGap mid-row gives up after the fires it made, with the summary', async () => {
        const server = new Server({ xp: xpForLevel(80), logs: row3('Magic logs').slice(0, 2), at: [3222, 3219] });
        const log = TickLog.memory('t');
        const ctx = { session: { sdk: server.sdk, bot: {}, name: 'cairn_test', sessionId: 1 }, sdk: server.sdk, bot: {}, c: {}, log } as unknown as StepContext<any>;
        let error: unknown;
        const p = lightRow(ctx, resolveOptions({ tiles: '3222-3218@3219', maxGap: 6 })).catch(e => (error = e));
        for (let i = 0; i < 60 && error === undefined; i++) {
            await flush();
            server.advance();
        }
        await p;
        expect(String(error)).toMatch(/nothing to light for 7 ticks after 2 fires/);
        expect(log.rows.find(row => row.step === 'S03 firemaking summary')!.meta).toMatchObject({ fires: 2, slips: 0, line: modelledLine(2, 0) });
    });
});
