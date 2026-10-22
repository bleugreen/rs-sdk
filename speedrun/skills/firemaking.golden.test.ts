// The row supply's decisions, pinned. rs/228's lab figures (two 1-99 runs, 157/157 lit, 0 slips)
// were gated on the `row` path of firemaking.ts, so that path must stay byte-for-byte the same
// while other supplies are added beside it. This drives the Lighter through a long, deterministic
// scripted row (failed rolls, level-ups, a refused and an unreachable tile, a log taken off the
// row, a fire left on a planned tile, gaps in the row, lost sends and the resends they cause, and
// a lap of the tile list) and compares every decision and event, tick by tick, with the golden
// file recorded from the module as rs/228 left it (snapshot rs/244, #205).
//
// Re-record only for a deliberate change to the row path: FM_GOLDEN=write bun test firemaking.golden

import { describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BotWorldState, GameMessage, GroundItem, NearbyLoc } from '../../sdk/types';
import { baseState } from '../lib/fake-sdk';
import { levelForXp, XP_RATE, xpForLevel } from '../lib/xp';
import { Lighter, parseTiles, routeLogs, tierOf, type Tile } from './firemaking';

const GOLDEN = join(import.meta.dir, 'firemaking.row-golden.json');

/** A small deterministic PRNG (mulberry32), so the rolls are the same on every run. */
function prng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const chance = (l: number) => Math.min(1, (Math.floor((64 * (99 - l)) / 98) + Math.floor((512 * (l - 1)) / 98) + 1) / 256);

interface Scenario {
    tiles: string;
    startXp: number;
    logs: number;
    at: Tile;
    seed: number;
    /** Log i turns visible at reveal(i) (a paced dropper's row). */
    reveal: (i: number) => number;
    /** Planned-tile indexes whose light is refused ("can't light a fire here"). */
    refused: number[];
    /** Planned-tile indexes behind a wall the collision map lacks. */
    unreachable: number[];
    /** Log index -> tick it is taken off the row by someone else. */
    taken: Record<number, number>;
    /** Logs taken by someone else the tick after the Lighter first sends their light. */
    takeWhenTargeted: number[];
    /** Planned-tile indexes with a burning fire on them from the start. */
    fireOn: number[];
    /** 1-based light sends that are lost on the way (never land). */
    lostSends: number[];
    /** A fire burns fireLife + random(fireLife) ticks (the game's 100 + random(100)). */
    fireLife: number;
    maxTicks: number;
}

/** Run the Lighter against a scripted server and return its trace. */
function trace(sc: Scenario) {
    const tiles = parseTiles(sc.tiles);
    const route = routeLogs(sc.startXp).slice(0, sc.logs);
    // Log i lies on planned tile slot[i]. A tile with a fire takes no log; a refused or unreachable
    // one does (the dropper cannot know), and that log is left where it lies.
    const skipTile = new Set(sc.fireOn);
    const blocked = new Set([...sc.refused, ...sc.unreachable]);
    const slots: number[] = [];
    for (let s = 0; slots.length < route.length; s++) if (!skipTile.has(s % tiles.length) || s >= tiles.length) slots.push(s);
    const stranded = route.filter((_, i) => blocked.has(slots[i]! % tiles.length)).length;
    const tileOfSlot = (s: number) => tiles[s % tiles.length]!;
    const rand = prng(sc.seed);
    let obs = 0;
    let tick = 5000;
    let pos: Tile = sc.at;
    let xp = sc.startXp;
    let dialog: BotWorldState['dialog'] = { isOpen: false, options: [], isWaiting: false };
    let anim = -1;
    const fires: Array<{ x: number; z: number; until: number }> = sc.fireOn.map(i => ({ x: tiles[i]![0], z: tiles[i]![1], until: 1e9 }));
    const msgs: GameMessage[] = [];
    const say = (text: string) => msgs.push({ type: 0, text, sender: '', tick, fromSelf: false, observationId: ++obs });
    const lit = new Set<number>();
    const gone = new Set<number>();
    let op: { x: number; z: number; itemId: number; land: number } | null = null;
    let walk: { to: Tile; land: number } | null = null;
    let target: { x: number; z: number; itemId: number } | null = null;
    let clock = -100;
    let successAt: number | null = null;
    let sends = 0;

    const ground = (): GroundItem[] =>
        route.flatMap((t, i) => {
            if (lit.has(i) || gone.has(i) || tick < sc.reveal(i)) return [];
            const [x, z] = tileOfSlot(slots[i]!);
            return [{ id: 3000 + i, name: t.name, count: 1, x, z, distance: 0 }];
        });
    const state = (): BotWorldState => {
        const level = levelForXp(xp);
        return baseState({
            tick,
            player: { worldX: pos[0], worldZ: pos[1], animId: anim } as BotWorldState['player'],
            skills: [{ name: 'Firemaking', level, baseLevel: level, experience: xp }],
            inventory: [{ slot: 0, id: 590, name: 'Tinderbox', count: 1, optionsWithIndex: [] }],
            groundItems: ground(),
            nearbyLocs: fires.filter(f => f.until > tick).map(f => ({ id: 26185, name: 'Fire', x: f.x, z: f.z, level: 0, distance: 0, optionsWithIndex: [] }) as unknown as NearbyLoc),
            gameMessages: msgs.slice(-20),
            dialog
        });
    };

    const L = new Lighter(tiles, state(), { lookahead: 6, entry: tiles[0]! });
    const rows: unknown[] = [];
    for (let n = 0; n < sc.maxTicks && lit.size + gone.size + stranded < route.length; n++) {
        const d = L.onTick(state());
        if (d.dismiss || d.light || d.walk) rows.push({ t: tick, ...d });
        if (d.dismiss) dialog = { isOpen: false, options: [], isWaiting: false };
        if (d.walk) walk = { to: d.walk, land: tick + 2 };
        if (d.light) {
            sends++;
            const li = d.light.itemId - 3000;
            if (sc.takeWhenTargeted.includes(li) && sc.taken[li] === undefined) sc.taken[li] = tick + 1;
            if (!sc.lostSends.includes(sends)) op = { ...d.light, land: tick + 1 };
        }
        // ---- the next tick, server side
        tick++;
        anim = -1;
        for (const [i, at] of Object.entries(sc.taken)) if (at === tick && !lit.has(Number(i))) gone.add(Number(i));
        if (walk && walk.land <= tick) {
            pos = walk.to;
            walk = null;
        }
        if (op && op.land <= tick) {
            const slot = tiles.findIndex(t => t[0] === op!.x && t[1] === op!.z);
            if (sc.refused.includes(slot)) say("You can't light a fire here.");
            else if (sc.unreachable.includes(slot)) say("I can't reach that!");
            else {
                target = { x: op.x, z: op.z, itemId: op.itemId };
                pos = [op.x, op.z];
                if (clock < tick) {
                    say('You attempt to light the logs.');
                    clock = tick + 3;
                }
            }
            op = null;
        }
        if (target && clock === tick && successAt === null) {
            clock = tick + 4;
            const i = target.itemId - 3000;
            if (gone.has(i)) target = null;
            else if (rand() < chance(levelForXp(xp))) {
                successAt = tick + 1;
                pos = [pos[0] - 1, pos[1]];
            } else anim = 733;
        }
        if (successAt === tick && target) {
            const i = target.itemId - 3000;
            lit.add(i);
            fires.push({ x: target.x, z: target.z, until: tick + sc.fireLife + Math.floor(rand() * sc.fireLife) });
            const before = levelForXp(xp);
            xp += tierOf(route[i]!.name)!.base * XP_RATE;
            if (levelForXp(xp) > before) dialog = { isOpen: true, options: [], isWaiting: false, pageId: `lvl${levelForXp(xp)}` } as BotWorldState['dialog'];
            say('The fire catches and the logs begin to burn.');
            target = null;
            successAt = null;
        }
    }
    // The last success is seen on the next state, as lightRow's final onTick sees it.
    const last = L.onTick(state());
    if (last.dismiss || last.light || last.walk) rows.push({ t: tick, ...last });
    return {
        decisions: rows,
        events: L.events,
        sim: { logs: route.length, lit: lit.size, gone: gone.size, stranded },
        counters: { cursor: L.cursor, fires: L.fires, resends: L.resends, dismissed: L.dismissed, startTick: L.startTick, firstAttemptTick: L.firstAttemptTick, firstSuccessTick: L.firstSuccessTick, lastSuccessTick: L.lastSuccessTick, endTick: tick }
    };
}

// Built fresh per run: trace() records takeWhenTargeted's ticks into `taken`.
const SCENARIOS: Record<string, Scenario> = {
    // 1-99's first 37 logs on rs/228's spawn row: every tier boundary up to yew, the failing low rolls,
    // a log taken, a fire on a planned tile, lost sends. (A log stranded on a refused tile here would
    // leave the account short of the next tier's level, which is why droppers leave such tiles out.)
    lowLevels: {
        tiles: '3222-3218@3219;3218-3236@3218;3236-3223@3219', startXp: 0, logs: 37, at: [3222, 3222], seed: 7,
        reveal: i => 5000 + 30 + 2 * i, refused: [], unreachable: [], taken: { 33: 5080 }, takeWhenTargeted: [35], fireOn: [12], lostSends: [2, 15, 16], fireLife: 100, maxTicks: 900
    },
    // Magic at 80+: a paced row that sometimes runs late (nolog waits), a refused and a wall tile, and
    // laps of a short list whose fires have burnt out.
    pacedMagic: {
        tiles: '3222-3212@3219', startXp: xpForLevel(80), logs: 30, at: [3222, 3220], seed: 11,
        reveal: i => 5000 + 4 * i + (i % 7 === 6 ? 9 : 0), refused: [3], unreachable: [6], taken: {}, takeWhenTargeted: [], fireOn: [], lostSends: [4], fireLife: 10, maxTicks: 700
    }
};

describe('firemaking: the row supply is unchanged (golden trace from snapshot rs/244)', () => {
    const now = Object.fromEntries(Object.entries(SCENARIOS).map(([k, sc]) => [k, trace(sc)]));
    if (process.env.FM_GOLDEN === 'write') writeFileSync(GOLDEN, JSON.stringify(now, null, 1) + '\n');
    const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as typeof now;
    for (const k of Object.keys(SCENARIOS)) {
        test(`${k}: every decision and event matches`, () => {
            expect(JSON.parse(JSON.stringify(now[k]))).toEqual(golden[k]!);
        });
    }
    test('the scenarios exercise what they claim', () => {
        const kinds = (k: string) => new Set(now[k]!.events.map(e => e.kind));
        for (const kind of ['fire', 'lost', 'resend', 'skip', 'nolog'] as const) expect(kinds('lowLevels').has(kind)).toBe(true);
        expect(now.lowLevels!.events.some(e => e.kind === 'fire' && e.failures > 0)).toBe(true);
        expect(now.lowLevels!.events.some(e => e.kind === 'skip' && e.reason === 'fire')).toBe(true);
        for (const k of Object.keys(SCENARIOS)) {
            const { sim, counters } = now[k]!;
            expect(counters.fires).toBe(sim.lit);
        }
        expect(now.lowLevels!.sim).toEqual({ logs: 37, lit: 35, gone: 2, stranded: 0 });
        // On the lapping list one log lies on a tile whose fire was still burning when the cursor
        // passed it, and the Lighter never goes back for it: pinned here as the row path's behaviour.
        expect(now.pacedMagic!.sim).toEqual({ logs: 30, lit: 23, gone: 0, stranded: 6 });
        expect(now.lowLevels!.counters.dismissed).toBeGreaterThan(10);
        for (const kind of ['fire', 'refused', 'resend', 'skip', 'nolog'] as const) expect(kinds('pacedMagic').has(kind)).toBe(true);
        expect(now.pacedMagic!.events.some(e => e.kind === 'refused' && e.reason === 'tile')).toBe(true);
        expect(now.pacedMagic!.events.some(e => e.kind === 'refused' && e.reason === 'unreachable')).toBe(true);
        expect(now.pacedMagic!.events.filter(e => e.kind === 'nolog').length).toBeGreaterThan(1);
        expect(now.pacedMagic!.sim.stranded).toBeGreaterThan(0); // logs left on the refused and the wall tile, lap by lap
        expect(now.pacedMagic!.counters.cursor).toBeGreaterThan(11); // it lapped the 11-tile list
    });
});
