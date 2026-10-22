// Climbing out of the Dwarven Mine and the Mining Guild cellar to the surface.
//
// An underground map lies 6400 tiles north of the surface above it and joins it only by
// ladders and stairs, which the SDK pathfinder cannot route through. Asked for a surface
// tile from the Dwarven Mine, walkTo walks to the underground tile nearest it instead (the
// south edge of the guild cellar, 3047,9732) and reports the destination unreachable. A
// walk that may start underground climbs out first, by the plan here; toll-gate.ts
// travelTo does so for every role that travels with it.
//
// Measured with the SDK pathfinder over sdk/collision-data.json (findLongPath, sampled
// every 3 tiles): the Dwarven Mine is one area, x 2963-3059 and z 9759-9852 reachable
// from the adamantite rocks at 3039,9766, holding the Ice Mountain ladder and the Falador
// stairs. The Mining Guild cellar (x 3017-3053, z 9732-9756) joins it only through the
// guild door. The pathfinder treats that door as open, but it is `miningguilddoor`
// (mining_guild.rs2): Mining 60, and open_and_close_door walks the player through and
// shuts it again. So the door is a step of its own here, judged by the side the player
// ends on. The door is a wall on its own tile (3046,9756), and that tile is the cellar
// side: an exit from the mine ends on it.
//
// The ladders (server/content/maps m47_152, m47_153): `ladder_from_cellar` (1755) climbs
// straight up from where the player stands (coord - 6400). The cellar's is four locs
// around 3019,9739 and comes up in the guild beside Falador east bank; the Ice Mountain
// one is at 3019,9850, in the hut north of Falador. The Falador stairs (3060,9776) are not
// used: the ladders cover the whole mine, and they are the route the smelter runs live.

import type { BotWorldState } from '../../sdk/types';
import type { Tile, TollGateBot, TollGateSdk } from './toll-gate';
import { waitUntil } from './wait';

export const UNDERGROUND_Z = 6400;
export const isUnderground = (t: Tile): boolean => t.z > UNDERGROUND_Z;

/** An inclusive rectangle of tiles. */
export interface Box {
    x0: number;
    x1: number;
    z0: number;
    z1: number;
}
export const inBox = (b: Box, t: Tile): boolean => t.x >= b.x0 && t.x <= b.x1 && t.z >= b.z0 && t.z <= b.z1;

/** The Mining Guild cellar, the door's own row (z 9756) included. */
export const GUILD_CELLAR: Box = { x0: 3014, x1: 3058, z0: 9728, z1: 9756 };
/** The Dwarven Mine outside the guild: the measured area with a margin of 3. */
export const DWARVEN_MINE: Box = { x0: 2960, x1: 3062, z0: 9757, z1: 9855 };

/**
 * Taverley Dungeon: every tile from which the SDK pathfinder (doors open) reaches the ladder to
 * Taverley, sampled on a 1-tile by 3-tile grid over x 2800-2990, z 9640-9910: a main box and a
 * strip east of x 2959 (z 9771-9797) beside the Dwarven Mine, which never shares a tile with it.
 * The blue dragon room behind the dusty key door is inside; walking out of it needs the key.
 */
export const TAVERLEY_DUNGEON: readonly Box[] = [
    { x0: 2815, x1: 2959, z0: 9669, z1: 9858 },
    { x0: 2960, x1: 2969, z0: 9771, z1: 9797 }
];
export const TAVERLEY_LADDER: Ladder = { id: 1755, at: { x: 2884, z: 9797 }, stand: { x: 2884, z: 9798 }, label: 'Taverley Dungeon ladder' };

/** The guild's south door, the only way between the mine and the cellar. */
export const GUILD_DOOR = { id: 2112, at: { x: 3046, z: 9756 }, mineSide: { x: 3046, z: 9757 }, mining: 60 } as const;

export interface Ladder {
    id: number;
    /** The ladder (for the cellar, the middle of its four locs). */
    at: Tile;
    /** Where to stand to climb it. */
    stand: Tile;
    label: string;
}
export const GUILD_LADDER: Ladder = { id: 1755, at: { x: 3019, z: 9739 }, stand: { x: 3020, z: 9740 }, label: 'guild cellar ladder' };
export const ICE_LADDER: Ladder = { id: 1755, at: { x: 3019, z: 9850 }, stand: { x: 3019, z: 9849 }, label: 'Ice Mountain ladder' };

/** South of this the guild door is nearer than the Ice Mountain ladder. */
const DOOR_SIDE_Z = 9800;

export type SurfaceStep = { kind: 'walk'; to: Tile; tol: number } | { kind: 'door' } | { kind: 'climb'; ladder: Ladder };

export function stepLabel(s: SurfaceStep): string {
    if (s.kind === 'walk') return `walk to ${s.to.x},${s.to.z}`;
    if (s.kind === 'door') return 'guild door into the cellar';
    return `climb the ${s.ladder.label}`;
}

/**
 * The way up from `from`, for an account whose current Mining level is `mining`: [] on the
 * surface, null underground somewhere this module does not know. From the cellar, its
 * ladder. From the south of the mine with Mining 60, the guild door and the cellar ladder;
 * anywhere else in the mine, the Ice Mountain ladder. From Taverley Dungeon, its ladder.
 */
export function surfacePlan(from: Tile, mining: number): SurfaceStep[] | null {
    if (!isUnderground(from)) return [];
    const up = (l: Ladder): SurfaceStep[] => [{ kind: 'walk', to: l.stand, tol: 2 }, { kind: 'climb', ladder: l }];
    if (inBox(GUILD_CELLAR, from)) return up(GUILD_LADDER);
    if (TAVERLEY_DUNGEON.some(b => inBox(b, from))) return up(TAVERLEY_LADDER);
    if (!inBox(DWARVEN_MINE, from)) return null;
    if (mining >= GUILD_DOOR.mining && from.z < DOOR_SIDE_Z) return [{ kind: 'walk', to: GUILD_DOOR.mineSide, tol: 1 }, { kind: 'door' }, ...up(GUILD_LADDER)];
    return up(ICE_LADDER);
}

/** The Mining level the door checks: the current one (`stat`), not the base. */
export function miningLevel(s: BotWorldState | null): number {
    return s?.skills.find(k => /^mining$/i.test(k.name))?.level ?? 1;
}

/** The reason a climb reports underground somewhere surfacePlan has no plan for. */
export const NO_WAY_UP = 'underground: no known way up';

export interface SurfaceResult {
    /** The player stands on the surface. */
    ok: boolean;
    /** Why not: NO_WAY_UP from (x, z), 'underground: <step> failed at (x, z)', 'aborted', 'no player state'. */
    reason?: string;
}

export interface SurfaceOptions {
    log?: (m: string, d?: Record<string, unknown>) => void;
    signal?: AbortSignal;
}

const cheb = (a: Tile, b: Tile) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
const REFUSED = /mining level of 60/i;

/** Climb out along surfacePlan. Each step is judged by where the player stands after it, never by the click. */
export async function climbToSurface(bot: TollGateBot, sdk: TollGateSdk, opts: SurfaceOptions = {}): Promise<SurfaceResult> {
    const log = opts.log ?? (() => {});
    const here = (): Tile | null => {
        const p = sdk.getState()?.player;
        return p ? { x: p.worldX, z: p.worldZ } : null;
    };
    const from = here();
    if (!from) return { ok: false, reason: 'no player state' };
    const plan = surfacePlan(from, miningLevel(sdk.getState()));
    if (plan === null) return { ok: false, reason: `${NO_WAY_UP} from (${from.x}, ${from.z})` };
    if (plan.length === 0) return { ok: true };
    log('underground: climbing out', { from, plan: plan.map(stepLabel) });

    const ticks = (pred: (t: Tile, s: BotWorldState) => boolean, n: number) =>
        waitUntil(sdk, s => !!s.player && pred({ x: s.player.worldX, z: s.player.worldZ }, s), { maxTicks: n }).then(r => r.ok);

    const walk = async (to: Tile, tol: number): Promise<boolean> => {
        for (let attempt = 0; attempt < 4; attempt++) {
            const p = here();
            if (!p || cheb(p, to) <= tol + 1) break;
            if (opts.signal?.aborted) return false;
            const r = await bot.walkTo(to.x, to.z, tol);
            if (!r.success) log('underground: walk failed', { to, at: here(), result: r.message });
        }
        const p = here();
        return p !== null && cheb(p, to) <= tol + 1;
    };

    const door = async (): Promise<boolean> => {
        const through = () => {
            const p = here();
            return p !== null && inBox(GUILD_CELLAR, p);
        };
        for (let attempt = 0; attempt < 4 && !through(); attempt++) {
            if (opts.signal?.aborted) return false;
            if (cheb(here()!, GUILD_DOOR.mineSide) > 1) await walk(GUILD_DOOR.mineSide, 1);
            const loc = sdk.getState()!.nearbyLocs.find(l => l.id === GUILD_DOOR.id && l.x === GUILD_DOOR.at.x && l.z === GUILD_DOOR.at.z);
            if (!loc) {
                log('underground: guild door not in view', { at: here() });
                await ticks(() => false, 2);
                continue;
            }
            const open = loc.optionsWithIndex.find(o => /open/i.test(o.text));
            await sdk.sendInteractLoc(loc.x, loc.z, loc.id, open?.opIndex ?? 1);
            await ticks((t, s) => inBox(GUILD_CELLAR, t) || (s.dialog.isOpen && REFUSED.test(s.dialog.text ?? '')), 8);
            const s = sdk.getState()!;
            if (s.dialog.isOpen && REFUSED.test(s.dialog.text ?? '')) {
                await closeDialog(sdk);
                log('underground: the guild door needs Mining 60', { mining: miningLevel(s) });
                return false;
            }
        }
        return through();
    };

    const climb = async (l: Ladder): Promise<boolean> => {
        const up = () => {
            const p = here();
            return p !== null && !isUnderground(p);
        };
        for (let attempt = 0; attempt < 4 && !up(); attempt++) {
            if (opts.signal?.aborted) return false;
            if (cheb(here()!, l.stand) > 3) await walk(l.stand, 2);
            const p = here()!;
            const loc = sdk.getState()!.nearbyLocs
                .filter(n => n.id === l.id && cheb(n, l.at) <= 2 && n.optionsWithIndex.some(o => /climb-up/i.test(o.text)))
                .sort((a, b) => cheb(a, p) - cheb(b, p))[0];
            if (!loc) {
                log('underground: ladder not in view', { ladder: l.label, at: p });
                await ticks(() => false, 2);
                continue;
            }
            await sdk.sendInteractLoc(loc.x, loc.z, loc.id, loc.optionsWithIndex.find(o => /climb-up/i.test(o.text))!.opIndex);
            await ticks(t => !isUnderground(t), 10);
        }
        return up();
    };

    for (const step of plan) {
        if (opts.signal?.aborted) return { ok: false, reason: 'aborted' };
        const ok = step.kind === 'walk' ? await walk(step.to, step.tol) : step.kind === 'door' ? await door() : await climb(step.ladder);
        if (!ok) {
            const at = here();
            return { ok: false, reason: opts.signal?.aborted ? 'aborted' : `underground: ${stepLabel(step)} failed at (${at?.x}, ${at?.z})` };
        }
    }
    log('underground: on the surface', { at: here() });
    return { ok: true };
}

async function closeDialog(sdk: TollGateSdk): Promise<void> {
    for (let i = 0; i < 10 && sdk.getState()!.dialog.isOpen; i++) {
        await sdk.sendClickDialog(0);
        await waitUntil(sdk, () => false, { maxTicks: 1 });
    }
}
