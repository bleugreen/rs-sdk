/**
 * GET /playerpositions: every player in the world loop with tile x, z and level. Names come back in display
 * form (capitalised, `_` shown as a space); compare them through playerNameKey.
 */
import { playerNameKey } from '../../speedrun/lib/demo-status.ts';
import type { Gentle } from './demo.ts';

export { playerNameKey };

export interface Position {
    name: string;
    x: number;
    z: number;
    level: number;
}

export interface Zone {
    name: string;
    x: [number, number];
    z: [number, number];
    level: number;
}

/**
 * Where holding accounts and the swarms that could feed them stand. Varrock west bank holds the GE table (the
 * soko accounts, banker and the market-making bots); the rest are the sources of the leaders' stacks: big-net and
 * harpoon fishing (bass, oysters, sharks), and rune essence and the air altar (air runes). Boxes are approximate.
 */
export const ZONES: Zone[] = [
    { name: 'Varrock west bank (GE)', x: [3180, 3191], z: [3433, 3449], level: 0 },
    { name: "Seers' Village bank", x: [2721, 2730], z: [3487, 3497], level: 0 },
    { name: 'Catherby bank', x: [2806, 2812], z: [3438, 3445], level: 0 },
    { name: 'Catherby fishing shore', x: [2833, 2864], z: [3419, 3437], level: 0 },
    { name: 'Fishing Guild', x: [2580, 2625], z: [3390, 3432], level: 0 },
    { name: 'Rune essence mine', x: [2870, 2950], z: [4790, 4870], level: 0 },
    { name: 'Air altar room', x: [2830, 2856], z: [4820, 4846], level: 0 },
    { name: 'Air altar ruins', x: [2978, 2992], z: [3284, 3298], level: 0 }
];

/** Names standing in each zone, for every zone with anyone in it. */
export function zoneRoster(positions: Position[], zones: Zone[] = ZONES): Record<string, string[]> {
    const roster: Record<string, string[]> = {};
    for (const p of positions) {
        const z = zoneOf(p, zones);
        if (z) (roster[z] ??= []).push(p.name);
    }
    for (const names of Object.values(roster)) names.sort();
    return roster;
}

export function zoneOf(p: Pick<Position, 'x' | 'z' | 'level'>, zones: Zone[] = ZONES): string | null {
    return zones.find(z => p.level === z.level && p.x >= z.x[0] && p.x <= z.x[1] && p.z >= z.z[0] && p.z <= z.z[1])?.name ?? null;
}

/** Accepts the bare array the demo serves and the `{ players }` wrapper some builds use. */
export function parsePositions(body: unknown): Position[] {
    const list: unknown = Array.isArray(body) ? body : (body as { players?: unknown } | null)?.players;
    if (!Array.isArray(list)) throw new Error('playerpositions: no player list in reply');
    return list.filter((p): p is Position => typeof p?.name === 'string' && Number.isFinite(p?.x) && Number.isFinite(p?.z) && Number.isFinite(p?.level));
}

export const readPositions = async (g: Gentle): Promise<Position[]> => parsePositions(await g.json<unknown>('/playerpositions'));
