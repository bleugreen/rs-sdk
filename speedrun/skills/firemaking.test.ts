import { describe, expect, test } from 'bun:test';
import type { BotWorldState, GameMessage, GroundItem, NearbyLoc } from '../../sdk/types';
import { baseState, FakeSdk, flush } from '../lib/fake-sdk';
import { TickLog } from '../lib/ticks';
import { levelForXp, XP_RATE, xpForLevel } from '../lib/xp';
import type { StepContext } from '../runner/step';
import {
    BANDS, bandFor, BACKSTOP_TICKS, bestHeld, DEFAULT_ID, defaultCapacity, giverTileFor, HELD_BACKSTOP_TICKS, HELD_WALK_TICKS, Lighter, lightRow, mapReach, modelledLine, parseTiles, precheck, RESEND_AFTER,
    resolveOptions, routeLogs, skill, steps, summarizeBands, tierFor, tierOf, TIERS, tradePlan, type LightEvent, type Tile
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
/** A game message; `observationId` is the publication it first showed in, shared by a tick's lines on the real clients. */
function msg(text: string, tick: number, observationId = ++obs): GameMessage {
    return { type: 0, text, sender: '', tick, fromSelf: false, observationId };
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

    test('the unbuilt bank supply refuses in preconditions with a reason, never by throwing', () => {
        const s = steps({ supply: 'bank', tiles: ROW })[0]!;
        expect(() => s.preconditions(state(), {} as never)).not.toThrow();
        expect(s.preconditions(state(), {} as never)).toBe("supply 'bank' not built");
    });

    test('the trade supply needs a giver and a free slot, then the row\'s own checks', () => {
        const pre = (s: BotWorldState, o = {}) => steps({ supply: 'trade', tiles: ROW, ...o })[0]!.preconditions(s, {} as never);
        expect(pre(state())).toBe("supply 'trade' needs the giver option (the trade giver's name)");
        expect(pre(state(), { giver: 'cairn_giver' })).toBe(true);
        expect(pre(state({ inv: ['Bronze axe'] }), { giver: 'cairn_giver' })).toBe('no tinderbox');
        expect(pre(state({ inv: Array.from({ length: 28 }, (_, i) => (i ? 'Air rune' : 'Tinderbox')) }), { giver: 'cairn_giver' })).toBe('28 other items (Tinderbox, Air rune): need 20 free slots');
        // S03's real start (the tinderbox and seven rune stacks) leaves exactly a refill of 20
        const s03 = ['Tinderbox', 'Air rune', 'Mind rune', 'Water rune', 'Earth rune', 'Body rune', 'Cosmic rune', 'Fire rune'];
        expect(pre(state({ inv: s03 }), { giver: 'cairn_giver' })).toBe(true);
        // the staff of water carried rather than wielded takes the 20th slot
        expect(pre(state({ inv: [...s03, 'Staff of water'] }), { giver: 'cairn_giver' })).toBe('9 other items (Tinderbox, Air rune, Mind rune, Water rune, Earth rune, Body rune, Cosmic rune, Fire rune, Staff of water): need 20 free slots');
        // a smaller configured refill fits; held logs are not counted against it
        expect(pre(state({ inv: [...s03, 'Staff of water'] }), { giver: 'cairn_giver', capacity: 19 })).toBe(true);
        expect(pre(state({ inv: [...s03, ...Array.from({ length: 20 }, () => 'Logs')] }), { giver: 'cairn_giver' })).toBe(true);
        // the row picks nothing up: a full inventory may light it
        expect(steps({ tiles: ROW })[0]!.preconditions(state({ inv: Array.from({ length: 28 }, (_, i) => (i ? 'Air rune' : 'Tinderbox')) }), {} as never)).toBe(true);
        // a full inventory that already holds a lightable log may start
        expect(pre(state({ inv: ['Tinderbox', ...Array.from({ length: 27 }, () => 'Logs')] }), { giver: 'cairn_giver' })).toBe(true);
        expect(resolveOptions({ supply: 'trade', giver: 'g', capacity: '20' })).toMatchObject({ giver: 'g', capacity: 20 });
        expect(() => resolveOptions({ capacity: 28 })).toThrow(/capacity/);
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

    test('reads every line of a publication: a success behind another line of its tick counts, once', () => {
        const both = [ground(3222, 3219, 'Logs', 1), ground(3221, 3219, 'Logs', 2)];
        const at: Tile = [3222, 3219];
        const L = new Lighter(tiles, state({ tick: 0, at, ground: both }), opts);
        L.onTick(state({ tick: 0, at, ground: both }));
        const attempt = msg('You attempt to light the logs.', 1);
        L.onTick(state({ tick: 1, at, ground: both, msgs: [attempt] }));
        // Both clients publish once per tick, so every line first seen in a tick carries one id.
        const pub = ++obs;
        const tick4 = [attempt, msg('Some earlier line of the tick.', 4, pub), msg('The fire catches and the logs begin to burn.', 4, pub)];
        const rest = [ground(3221, 3219, 'Logs', 2)];
        const d = L.onTick(state({ tick: 4, at: [3221, 3219], ground: rest, fires: [at], msgs: tick4 }));
        expect(L.fires).toBe(1);
        expect(d.light).toEqual({ x: 3221, z: 3219, itemId: 2 });
        // the next publication repeats the same lines: nothing new
        L.onTick(state({ tick: 5, at: [3221, 3219], ground: rest, fires: [at], msgs: tick4 }));
        expect(L.fires).toBe(1);
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

    test('a log that turns into a fire with this account\'s xp but no success message is a fire, not lost (rs/269 demo)', () => {
        const at: Tile = [3222, 3219];
        const both = [ground(3222, 3219, 'Logs', 1), ground(3221, 3219, 'Logs', 2)];
        const L = new Lighter(tiles, state({ tick: 0, at, xp: 0, ground: both }), opts);
        L.onTick(state({ tick: 0, at, xp: 0, ground: both }));
        L.onTick(state({ tick: 1, at, xp: 0, ground: both, msgs: [msg('You attempt to light the logs.', 1)] }));
        const rest = [ground(3221, 3219, 'Logs', 2)];
        // tick 4: the log becomes a fire and the xp lands; the message never shows
        expect(L.onTick(state({ tick: 4, at: [3221, 3219], xp: 40, ground: rest, fires: [at] })).light).toBeUndefined();
        const d = L.onTick(state({ tick: 5, at: [3221, 3219], xp: 40, ground: rest, fires: [at] }));
        expect(L.events.filter(e => e.kind === 'lost')).toEqual([]);
        expect(L.events[0]).toMatchObject({ kind: 'fire', n: 0, tick: 4, tile: [3222, 3219], failures: 0, inferred: true });
        expect(L.fires).toBe(1);
        expect(d.light).toEqual({ x: 3221, z: 3219, itemId: 2 });
        // the missed message arriving late does not complete the next log
        L.onTick(state({ tick: 6, at: [3221, 3219], xp: 40, ground: rest, fires: [at], msgs: [msg('The fire catches and the logs begin to burn.', 6)] }));
        expect(L.fires).toBe(1);
        // the next log's own success, 4 ticks on, counts with no failures
        L.onTick(state({ tick: 8, at: [3220, 3219], xp: 80, ground: [], fires: [at, [3221, 3219]], msgs: [msg('The fire catches and the logs begin to burn.', 8)] }));
        expect(L.fires).toBe(2);
        expect(L.events.at(-1)).toMatchObject({ kind: 'fire', n: 1, tile: [3221, 3219], gap: 4, failures: 0 });
        expect(L.events.at(-1)).not.toHaveProperty('inferred');
    });

    test('a log that turns into a fire without this account\'s xp (a stranger lit it) is still lost', () => {
        const at: Tile = [3222, 3219];
        const both = [ground(3222, 3219, 'Logs', 1), ground(3221, 3219, 'Logs', 2)];
        const L = new Lighter(tiles, state({ tick: 0, at, xp: 0, ground: both }), opts);
        L.onTick(state({ tick: 0, at, xp: 0, ground: both }));
        const rest = [ground(3221, 3219, 'Logs', 2)];
        L.onTick(state({ tick: 1, at, xp: 0, ground: rest, fires: [at] }));
        L.onTick(state({ tick: 2, at, xp: 0, ground: rest, fires: [at] }));
        expect(L.events[0]).toEqual({ kind: 'lost', tick: 2, tile: [3222, 3219], tier: 'Logs' });
        expect(L.fires).toBe(0);
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

// ------------------------------------------------------------------ the trade supply

describe('firemaking: the trade supply\'s hand-off as data', () => {
    /** Every step open: the placement rule on its own, without the collision map. */
    const open = () => true;

    test('1 to 99 in refills of 27 is SUPPLIES.md H2\'s six trades', () => {
        const plan = tradePlan(0, 99, 27);
        expect(plan.map(r => r.logs)).toEqual([27, 27, 27, 27, 27, 22]);
        expect(plan.map(r => r.atLit)).toEqual([0, 27, 54, 81, 108, 135]);
        const fmt = (k: number) => plan[k]!.package.map(p => `${p.n} ${p.obj}`).join(' + ');
        expect(fmt(0)).toBe('2 logs + 4 oak_logs + 7 willow_logs + 13 maple_logs + 1 yew_logs');
        expect(fmt(1)).toBe('23 yew_logs + 4 magic_logs');
        expect([2, 3, 4].map(fmt)).toEqual(['27 magic_logs', '27 magic_logs', '27 magic_logs']);
        expect(fmt(5)).toBe('22 magic_logs');
    });

    test('at S03\'s real start (tinderbox and seven rune stacks) a refill holds 20: eight trades', () => {
        const inv = ['Tinderbox', 'Air rune', 'Mind rune', 'Water rune', 'Earth rune', 'Body rune', 'Cosmic rune', 'Fire rune'].map(name => ({ name }));
        expect(defaultCapacity(inv)).toBe(20);
        // held logs are not counted against the refill: they are lit before it
        expect(defaultCapacity([...inv, { name: 'Logs' }, { name: 'Logs' }])).toBe(20);
        const plan = tradePlan(0, 99, 20);
        expect(plan).toHaveLength(8);
        expect(plan.reduce((a, r) => a + r.logs, 0)).toBe(157);
        expect(plan.at(-1)!.logs).toBe(17);
    });

    test('each refill names SCORED\'s tile and a giver tile beside it, off the planned tiles', () => {
        const tiles = parseTiles(ROW);
        const planned = new Set(tiles.map(t => `${t[0]},${t[1]}`));
        const plan = tradePlan(0, 99, 20, tiles, open);
        for (const r of plan) {
            expect(r.scoredTile).toEqual(tiles[r.atLit % tiles.length]!);
            expect(planned.has(`${r.giverTile![0]},${r.giverTile![1]}`)).toBe(false);
            expect(Math.max(Math.abs(r.giverTile![0] - r.scoredTile![0]), Math.abs(r.giverTile![1] - r.scoredTile![1]))).toBe(1);
        }
        // on the two-row snake z=3219/3218, north of 3219 and south of 3218
        expect(giverTileFor(tiles, 0, open)).toEqual([3222, 3220]);
        expect(giverTileFor(tiles, 10, open)).toEqual([3223, 3217]);
        expect(tradePlan(0, 30, 27)[0]!.giverTile).toBeNull();
        expect(() => tradePlan(0, 99, 0)).toThrow(/capacity/);
    });

    test('giver tiles are within reach on the collision map: at the Falador east snake\'s west end the north tile is across a wall edge', () => {
        // fm-row.ts LAB_ROW: row 0 west along z=3362 from 3019, row 1 back east along z=3361
        const snake: Tile[] = [...Array.from({ length: 27 }, (_, k) => [3019 - k, 3362] as const), ...Array.from({ length: 27 }, (_, k) => [2993 + k, 3361] as const)];
        expect(mapReach([2993, 3362], [2993, 3363])).toBe(false);
        expect(mapReach([2999, 3362], [2999, 3363])).toBe(true);
        // the lab's refill 4 (log 80, tile 26): west, not the walled north it was given before
        expect(giverTileFor(snake, 26)).toEqual([2992, 3362]);
        expect(giverTileFor(snake, 26, open)).toEqual([2993, 3363]);
        // north of row 0 and south of row 1 elsewhere, as the lab's refills 1-3 stood
        expect(tradePlan(0, 99, 20, snake).map(r => r.giverTile)).toEqual([
            [3019, 3363], [2999, 3363], [3006, 3360], [3013, 3363], [2992, 3362], [3012, 3360], [3007, 3363], [2998, 3360]
        ]);
    }, 30_000); // the first mapReach loads the SDK's collision data: ~0.25 s, over 5 s on a loaded machine
});

function held(names: string[]): BotWorldState['inventory'] {
    return names.map((name, slot) => ({ slot, id: name === 'Tinderbox' ? 590 : (tierOf(name) ? 1511 + TIERS.indexOf(tierOf(name)!) : 556 + slot), name, count: 1, optionsWithIndex: [] }));
}

describe('firemaking: the Lighter in held mode (trade supply)', () => {
    const tiles = parseTiles('3222-3218@3219');
    const opts = { lookahead: 6, entry: tiles[0]!, source: 'held' as const };
    const at: Tile = [3222, 3219];
    const hs = (o: { tick: number; at?: Tile; inv: string[]; level?: number; xp?: number; msgs?: GameMessage[]; fires?: Tile[]; ground?: GroundItem[]; anim?: number }) =>
        ({ ...state({ tick: o.tick, at: o.at ?? at, level: o.level, xp: o.xp, msgs: o.msgs, fires: o.fires, ground: o.ground, anim: o.anim }), inventory: held(o.inv) }) as BotWorldState;

    test('uses the tinderbox on the best lightable held log, standing on the planned tile', () => {
        const inv = ['Tinderbox', 'Air rune', 'Logs', 'Oak logs', 'Oak logs'];
        const L = new Lighter(tiles, hs({ tick: 0, inv, level: 15 }), opts);
        const d = L.onTick(hs({ tick: 0, inv, level: 15 }));
        expect(d.use).toEqual({ tinderbox: 0, log: 3, itemId: 1512, tile: [3222, 3219] });
        expect(d.light).toBeUndefined();
        expect(bestHeld(hs({ tick: 0, inv }), 14)!.name).toBe('Logs');
        expect(bestHeld(hs({ tick: 0, inv: ['Tinderbox', 'Oak logs'] }), 14)).toBeUndefined();
    });

    test('walks to the planned tile first when SCORED isn\'t on it, and passes it after HELD_WALK_TICKS', () => {
        const inv = ['Tinderbox', 'Logs', 'Logs'];
        const off: Tile = [3222, 3221];
        const L = new Lighter(tiles, hs({ tick: 0, at: off, inv }), opts);
        const d0 = L.onTick(hs({ tick: 0, at: off, inv }));
        expect(d0.walk).toEqual([3222, 3219]);
        expect(d0.use).toBeUndefined();
        expect(L.onTick(hs({ tick: 1, at: off, inv })).walk).toBeUndefined(); // throttled
        expect(L.onTick(hs({ tick: 3, at: off, inv })).walk).toEqual([3222, 3219]);
        for (let t = 4; t <= HELD_WALK_TICKS + 1; t++) L.onTick(hs({ tick: t, at: off, inv }));
        expect(L.events.at(-1)).toEqual({ kind: 'refused', tick: HELD_WALK_TICKS + 1, tile: [3222, 3219], reason: 'unreachable' });
        // standing on the next planned tile, it lights there
        expect(L.onTick(hs({ tick: 20, at: [3221, 3219], inv })).use?.tile).toEqual([3221, 3219]);
    });

    test('never resends once the log has left the inventory; resends while it is still held', () => {
        const two = ['Tinderbox', 'Logs', 'Logs'];
        const one = ['Tinderbox', 'Logs'];
        const L = new Lighter(tiles, hs({ tick: 0, inv: two }), opts);
        expect(L.onTick(hs({ tick: 0, inv: two })).use).toBeDefined();
        // the op ran: one log fewer; then the clock rolls and fails silently for a long time
        for (let t = 1; t <= BACKSTOP_TICKS - 1; t++) expect(L.onTick(hs({ tick: t, inv: one, anim: t % 4 === 0 ? 733 : -1 })).use).toBeUndefined();
        expect(L.resends).toBe(0);

        const Q = new Lighter(tiles, hs({ tick: 0, inv: two }), opts);
        Q.onTick(hs({ tick: 0, inv: two }));
        for (let t = 1; t < RESEND_AFTER; t++) expect(Q.onTick(hs({ tick: t, inv: two })).use).toBeUndefined();
        expect(Q.onTick(hs({ tick: RESEND_AFTER, inv: two })).use).toEqual({ tinderbox: 0, log: 1, itemId: 1511, tile: [3222, 3219] });
        expect(Q.events.at(-1)).toMatchObject({ kind: 'resend', backstop: false });
    });

    test('a dropped log that never rolls is lit where it lies with the ground op at the backstop', () => {
        const L = new Lighter(tiles, hs({ tick: 0, inv: ['Tinderbox', 'Logs'] }), opts);
        L.onTick(hs({ tick: 0, inv: ['Tinderbox', 'Logs'] }));
        const g = [ground(3222, 3219, 'Logs', 1511)];
        for (let t = 1; t < HELD_BACKSTOP_TICKS; t++) expect(L.onTick(hs({ tick: t, inv: ['Tinderbox'], ground: g })).light).toBeUndefined();
        expect(L.onTick(hs({ tick: HELD_BACKSTOP_TICKS, inv: ['Tinderbox'], ground: g })).light).toEqual({ x: 3222, z: 3219, itemId: 1511 });
        expect(L.events.at(-1)).toMatchObject({ kind: 'resend', backstop: true, tick: HELD_BACKSTOP_TICKS });
        // rolled once and stopped (the lab, level 82): relit eight quiet ticks after the last roll
        const Q = new Lighter(tiles, hs({ tick: 0, inv: ['Tinderbox', 'Logs'] }), opts);
        Q.onTick(hs({ tick: 0, inv: ['Tinderbox', 'Logs'] }));
        for (let t = 1; t <= 3; t++) Q.onTick(hs({ tick: t, inv: ['Tinderbox'], ground: g, anim: 733 }));
        for (let t = 4; t < 3 + HELD_BACKSTOP_TICKS; t++) expect(Q.onTick(hs({ tick: t, inv: ['Tinderbox'], ground: g })).light).toBeUndefined();
        expect(Q.onTick(hs({ tick: 3 + HELD_BACKSTOP_TICKS, inv: ['Tinderbox'], ground: g })).light).toBeDefined();
    });

    test('a dropped log still rolling is never relit by the backstop, however many rolls fail (a chained light prints no attempt message)', () => {
        const L = new Lighter(tiles, hs({ tick: 0, inv: ['Tinderbox', 'Logs', 'Logs'] }), opts);
        L.onTick(hs({ tick: 0, inv: ['Tinderbox', 'Logs', 'Logs'] }));
        const g = [ground(3222, 3219, 'Logs', 1511)];
        // the lab's trace: the roll animation on two ticks of every four, ten failed rolls
        for (let t = 1; t <= 40; t++) {
            const d = L.onTick(hs({ tick: t, inv: ['Tinderbox', 'Logs'], ground: g, anim: t % 4 === 1 || t % 4 === 2 ? 733 : -1 }));
            expect(d.light).toBeUndefined();
            expect(d.use).toBeUndefined();
        }
        expect(L.resends).toBe(0);
        L.onTick(hs({ tick: 41, inv: ['Tinderbox', 'Logs'], fires: [[3222, 3219]], xp: 40, msgs: [msg('The fire catches and the logs begin to burn.', 41)] }));
        expect(L.fires).toBe(1);
    });

    test('a held light whose success message never shows is a fire once its log becomes a fire with this account\'s xp (rs/269\'s rule); the late message is ignored', () => {
        const L = new Lighter(tiles, hs({ tick: 0, inv: ['Tinderbox', 'Logs', 'Logs'], xp: 0 }), opts);
        L.onTick(hs({ tick: 0, inv: ['Tinderbox', 'Logs', 'Logs'], xp: 0 }));
        const g = [ground(3222, 3219, 'Logs', 1511)];
        for (let t = 1; t <= 5; t++) L.onTick(hs({ tick: t, inv: ['Tinderbox', 'Logs'], ground: g, xp: 0, anim: t % 4 === 1 ? 733 : -1 }));
        // the log turns into a fire and the xp arrives, but no message
        L.onTick(hs({ tick: 6, inv: ['Tinderbox', 'Logs'], fires: [[3222, 3219]], xp: 40 }));
        expect(L.fires).toBe(0);
        L.onTick(hs({ tick: 7, inv: ['Tinderbox', 'Logs'], fires: [[3222, 3219]], xp: 40 }));
        expect(L.fires).toBe(1);
        expect(L.events.at(-1)).toMatchObject({ kind: 'fire', tick: 6, n: 0, inferred: true });
        L.onTick(hs({ tick: 8, inv: ['Tinderbox', 'Logs'], fires: [[3222, 3219]], xp: 40, msgs: [msg('The fire catches and the logs begin to burn.', 8)] }));
        expect(L.fires).toBe(1);
    });

    test('a dropped held log gone from its tile with no fire is lost, and the Lighter moves on to the next held log', () => {
        const L = new Lighter(tiles, hs({ tick: 0, inv: ['Tinderbox', 'Logs', 'Logs'], xp: 0 }), opts);
        L.onTick(hs({ tick: 0, inv: ['Tinderbox', 'Logs', 'Logs'], xp: 0 }));
        L.onTick(hs({ tick: 1, inv: ['Tinderbox', 'Logs'], ground: [ground(3222, 3219, 'Logs', 1511)], xp: 0 }));
        L.onTick(hs({ tick: 2, inv: ['Tinderbox', 'Logs'], xp: 0 }));
        L.onTick(hs({ tick: 3, inv: ['Tinderbox', 'Logs'], xp: 0 }));
        expect(L.events.at(-1)).toEqual({ kind: 'lost', tick: 3, tile: [3222, 3219], tier: 'Logs' });
        expect(L.busy).toBe(false);
        expect(L.fires).toBe(0);
    });

    test('a refused tile keeps the log in hand and it is lit on the next free tile; a fire tile is skipped', () => {
        const inv = ['Tinderbox', 'Logs', 'Logs'];
        const L = new Lighter(tiles, hs({ tick: 0, inv }), opts);
        L.onTick(hs({ tick: 0, inv }));
        const d = L.onTick(hs({ tick: 1, inv, msgs: [msg("You can't light a fire here.", 1)] }));
        expect(L.events[0]).toEqual({ kind: 'refused', tick: 1, tile: [3222, 3219], reason: 'tile' });
        expect(d.walk).toEqual([3221, 3219]);
        // with a fire on 3221 it goes on to 3220
        const M = new Lighter(tiles, hs({ tick: 0, inv }), opts);
        M.cursor = 1;
        (M as unknown as { fires: number }).fires = 1;
        const e = M.onTick(hs({ tick: 1, at: [3221, 3219], inv, fires: [[3221, 3219]] }));
        expect(e.walk).toEqual([3220, 3219]);
        expect(M.events).toEqual([{ kind: 'skip', tick: 1, tile: [3221, 3219], reason: 'fire' }]);
    });

    test('out of logs means the step must refill; a refill is not counted as a wait for logs', () => {
        const L = new Lighter(tiles, hs({ tick: 0, inv: ['Tinderbox'] }), opts);
        expect(L.onTick(hs({ tick: 0, inv: ['Tinderbox'] })).use).toBeUndefined();
        expect(L.outOfLogs(hs({ tick: 0, inv: ['Tinderbox'] }))).toBe(true);
        expect(L.outOfLogs(hs({ tick: 0, inv: ['Tinderbox', 'Logs'] }))).toBe(false);
        L.refilled();
        expect(L.waiting(10)).toBe(0);
        L.onTick(hs({ tick: 10, inv: ['Tinderbox', 'Logs'] }));
        expect(L.events.some(e => e.kind === 'nolog')).toBe(false);
        // the ground Lighter is never out of logs this way
        expect(new Lighter(tiles, hs({ tick: 0, inv: ['Tinderbox'] })).outOfLogs(hs({ tick: 0, inv: ['Tinderbox'] }))).toBe(false);
    });
});

/**
 * firemaking.rs2's inventory light and the trade scripts as the loop sees them: a use lands the
 * tick after it is sent; it drops the log on SCORED's tile (unless the tile refuses a fire) and runs
 * the 4-tick clock; a success pushes west, and a tick later lights the fire and pays the xp. The
 * giver, standing beside the row, answers SCORED's trade click with the next package on the offer
 * screen (already accepted), and each accept moves the trade on a tick later.
 */
class HeldServer {
    readonly sdk: FakeSdk;
    private op: { slot: number; land: number } | null = null;
    private target: { x: number; z: number; itemId: number } | null = null;
    private clock = -100;
    private successAt: number | null = null;
    private walk: { to: Tile; land: number } | null = null;
    private tradeAt: { step: 'open' | 'confirm' | 'done'; tick: number } | null = null;
    readonly packages: Array<Array<[string, number]>>;
    readonly uses: number[] = [];
    nextObj = 9000;

    constructor(o: { xp: number; at: Tile; inv: string[]; packages: Array<Array<[string, number]>>; rolls?: boolean[] }, private rolls = [...(o.rolls ?? [])]) {
        this.packages = o.packages.map(p => [...p]);
        const s = state({ tick: 1000, xp: o.xp, at: o.at });
        this.sdk = new FakeSdk({
            ...s,
            inventory: held(o.inv),
            nearbyPlayers: [{ index: 7, name: 'cairn_giver', x: o.at[0], z: o.at[1] + 1 } as unknown as BotWorldState['nearbyPlayers'][number]]
        });
        this.sdk.onSend = a => {
            const t = this.sdk.state!.tick;
            const sdkTrade = this.sdk.state!.trade;
            if (a.method === 'sendUseItemOnItem') {
                this.op = { slot: a.args[1] as number, land: t + 1 };
                this.uses.push(t);
            }
            if (a.method === 'sendWalk') this.walk = { to: [a.args[0] as number, a.args[1] as number], land: t + 1 };
            if (a.method === 'sendClickDialog') this.sdk.state = { ...this.sdk.state!, dialog: { isOpen: false, options: [], isWaiting: false } };
            if (a.method === 'sendTradeRequest') this.tradeAt = { step: 'open', tick: t + 1 };
            if (a.method === 'sendAcceptTrade' && sdkTrade?.isOpen) this.tradeAt = { step: sdkTrade.screen === 'offer' ? 'confirm' : 'done', tick: t + 1 };
        };
    }

    advance(): void {
        const s = this.sdk.state!;
        const t = s.tick + 1;
        const msgs: GameMessage[] = [];
        let player = s.player!;
        let { groundItems, nearbyLocs, skills: sk, dialog, inventory, trade } = s;
        if (this.walk && this.walk.land <= t) {
            player = { ...player, worldX: this.walk.to[0], worldZ: this.walk.to[1] };
            this.walk = null;
        }
        if (this.tradeAt && this.tradeAt.tick <= t) {
            const offer = (this.packages[0] ?? []).map(([name, count], i) => ({ slot: i, id: 1511 + TIERS.indexOf(tierOf(name)!), name, count }));
            const base = { partner: 'cairn_giver', myOffer: [], theirOffer: offer, myAccepted: false, partnerAccepted: true };
            if (this.tradeAt.step === 'open') trade = { isOpen: true, screen: 'offer', ...base };
            else if (this.tradeAt.step === 'confirm') trade = { isOpen: true, screen: 'confirm', ...base };
            else {
                trade = { isOpen: false, screen: null, partner: null, myOffer: [], theirOffer: [], myAccepted: false, partnerAccepted: false };
                const names = (this.packages.shift() ?? []).flatMap(([name, n]) => Array.from({ length: n }, () => name));
                const used = new Set(inventory.map(i => i.slot));
                const add = [...inventory];
                for (const name of names) {
                    let slot = 0;
                    while (used.has(slot)) slot++;
                    used.add(slot);
                    add.push({ slot, id: 1511 + TIERS.indexOf(tierOf(name)!), name, count: 1, optionsWithIndex: [] });
                }
                inventory = add;
                msgs.push(msg('Accepted trade.', t));
            }
            this.tradeAt = null;
        }
        if (this.op && this.op.land <= t) {
            const item = inventory.find(i => i.slot === this.op!.slot);
            if (item && tierOf(item.name)) {
                inventory = inventory.filter(i => i !== item);
                const g = { id: item.id, name: item.name, count: 1, x: player.worldX, z: player.worldZ, distance: 0 };
                groundItems = [...groundItems, g];
                this.target = { x: g.x, z: g.z, itemId: g.id };
                if (this.clock < t) {
                    msgs.push(msg('You attempt to light the logs.', t));
                    this.clock = t + 3;
                }
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
            const log = groundItems.find(g => g.x === tg.x && g.z === tg.z && g.id === tg.itemId)!;
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
        this.sdk.push({ tick: t, player, groundItems, nearbyLocs, skills: sk, dialog, inventory, trade, gameMessages: [...s.gameMessages, ...msgs].slice(-20) });
    }
}

describe('firemaking: lightRow with the trade supply, end to end', () => {
    test('refills from the giver by receiveFrom when out, then chains 4-tick fires on the held logs', async () => {
        // 1 -> 30 is 6 logs (2 normal, 4 oak); in refills of 4: [2 logs + 2 oak], [2 oak]
        const plan = tradePlan(0, 30, 4);
        expect(plan.map(r => r.package.map(p => [p.name, p.n]))).toEqual([[['Logs', 2], ['Oak logs', 2]], [['Oak logs', 2]]]);
        const server = new HeldServer({ xp: 0, at: [3222, 3219], inv: ['Tinderbox', 'Air rune', 'Mind rune'], packages: plan.map(r => r.package.map(p => [p.name, p.n] as [string, number])) });
        const log = TickLog.memory('t');
        const ctx = { session: { sdk: server.sdk, bot: {}, name: 'cairn_test', sessionId: 1 }, sdk: server.sdk, bot: {}, c: {}, log } as unknown as StepContext<any>;
        let finished = false;
        let error: unknown;
        const p = lightRow(ctx, resolveOptions({ supply: 'trade', giver: 'cairn_giver', capacity: 4, tiles: '3222-3214@3219', toLevel: 30 })).then(r => r, e => { error = e; return null; }).finally(() => (finished = true));
        for (let i = 0; i < 300 && !finished; i++) {
            await flush();
            server.advance();
            await flush();
        }
        const r = await p;
        if (error) throw error;
        expect(r!.fires).toBe(6);
        const fires = r!.events.filter((e): e is Extract<LightEvent, { kind: 'fire' }> => e.kind === 'fire');
        expect(fires.map(f => f.tier)).toEqual(['Logs', 'Logs', 'Oak logs', 'Oak logs', 'Oak logs', 'Oak logs']);
        // inside a package every gap is the 4-tick chain; the first light after each refill starts afresh
        expect(fires.map(f => [f.gap === 4, f.fresh])).toEqual([[false, true], [true, false], [true, false], [true, false], [false, true], [true, false]]);
        expect(fires.map(f => f.tile)).toEqual([[3222, 3219], [3221, 3219], [3220, 3219], [3219, 3219], [3218, 3219], [3217, 3219]]);
        expect(server.uses).toHaveLength(6); // no resends: one use per log
        expect(r!.events.filter(e => e.kind === 'nolog')).toEqual([]);
        const refills = log.rows.filter(row => row.step === 'S03 firemaking refill');
        expect(refills.map(row => row.meta)).toMatchObject([{ k: 0, ok: true, want: [{ obj: 'logs', n: 2 }, { obj: 'oak_logs', n: 2 }] }, { k: 1, ok: true, want: [{ obj: 'oak_logs', n: 2 }] }]);
        const sum = log.rows.find(row => row.step === 'S03 firemaking summary')!;
        expect(sum.meta).toMatchObject({ ended: 'done', fires: 6, supply: 'trade', capacity: 4, refills: 2, endLevel: 31, endXp: 8000, resends: 0, lost: 0 }); // the sixth log passes 30
        // SCORED's runes never left
        expect(server.sdk.state!.inventory.map(i => i.name)).toEqual(['Tinderbox', 'Air rune', 'Mind rune']);
    });

    test('a refill that fails stops the step with the reason, and the summary is still written', async () => {
        const server = new HeldServer({ xp: 0, at: [3222, 3219], inv: ['Tinderbox'], packages: [] });
        server.sdk.state = { ...server.sdk.state!, nearbyPlayers: [] };
        const log = TickLog.memory('t');
        const ctx = { session: { sdk: server.sdk, bot: {}, name: 'cairn_test', sessionId: 1 }, sdk: server.sdk, bot: {}, c: {}, log } as unknown as StepContext<any>;
        const prevTick = process.env.SPEEDRUN_TICK_MS;
        process.env.SPEEDRUN_TICK_MS = '5';
        let error: unknown;
        try {
            const p = lightRow(ctx, resolveOptions({ supply: 'trade', giver: 'cairn_giver', tiles: '3222-3214@3219', toLevel: 30 })).catch(e => (error = e));
            for (let i = 0; i < 40 && error === undefined; i++) {
                await flush();
                server.advance();
                await new Promise(r => setTimeout(r, 2));
            }
            await p;
        } finally {
            if (prevTick === undefined) delete process.env.SPEEDRUN_TICK_MS;
            else process.env.SPEEDRUN_TICK_MS = prevTick;
        }
        expect(String(error)).toMatch(/refill 0 from the trade giver failed: player_not_found/);
        expect(log.rows.find(row => row.step === 'S03 firemaking summary')!.meta).toMatchObject({ fires: 0, supply: 'trade', refills: 0 });
    }, 20_000);
});
