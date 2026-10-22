// Test fixtures for the Dwarven Mine, the Mining Guild cellar and Taverley Dungeon
// (underground.ts): the guild door and the ladders as the server runs them, and a walkTo
// that, like the SDK pathfinder, never leaves the map it starts on.

import type { BotWorldState, NearbyLoc } from '../../sdk/types';
import type { FakeSdk, SentAction } from './fake-sdk';
import type { Tile, TollGateBot } from './toll-gate';
import { DWARVEN_MINE, EDGEVILLE_DUNGEON, EDGEVILLE_LADDER, GUILD_CELLAR, GUILD_DOOR, GUILD_LADDER, ICE_LADDER, inBox, isUnderground, TAVERLEY_DUNGEON, TAVERLEY_LADDER, UNDERGROUND_Z } from './underground';

const loc = (id: number, name: string, x: number, z: number, op: string): NearbyLoc =>
    ({ id, name, x, z, level: 0, distance: 1, optionsWithIndex: [{ text: op, opIndex: 1 }], options: [op] }) as NearbyLoc;

export const doorLoc = loc(GUILD_DOOR.id, 'Door', GUILD_DOOR.at.x, GUILD_DOOR.at.z, 'Open');
/** The cellar's ladder is four locs around one tile (map m47_152). */
export const guildLadderLocs = [[-1, 0], [0, -1], [0, 1], [1, 0]].map(([dx, dz]) => loc(GUILD_LADDER.id, 'Ladder', GUILD_LADDER.at.x + dx!, GUILD_LADDER.at.z + dz!, 'Climb-up'));
export const iceLadderLoc = loc(ICE_LADDER.id, 'Ladder', ICE_LADDER.at.x, ICE_LADDER.at.z, 'Climb-up');
export const taverleyLadderLoc = loc(TAVERLEY_LADDER.id, 'Ladder', TAVERLEY_LADDER.at.x, TAVERLEY_LADDER.at.z, 'Climb-up');
export const edgevilleLadderLoc = loc(EDGEVILLE_LADDER.id, 'Ladder', EDGEVILLE_LADDER.at.x, EDGEVILLE_LADDER.at.z, 'Climb-up');
const MINE_LOCS = new Set([doorLoc, ...guildLadderLocs, iceLadderLoc, taverleyLadderLoc, edgevilleLadderLoc]);

const at = (s: BotWorldState): Tile => ({ x: s.player!.worldX, z: s.player!.worldZ });
const moveTo = (s: BotWorldState, t: Tile) => ({ player: { ...s.player!, worldX: t.x, worldZ: t.z } });

/**
 * The door, the ladders and a Mining level. The locs are in view while the player is
 * underground. The door walks the player across (refusing below Mining 60), a ladder
 * moves them 6400 north to south. Chains any onSend already set (a border guard).
 */
export function mineWorld(fake: FakeSdk, mining: number): { climbs: Tile[] } {
    const climbs: Tile[] = [];
    fake.push(s => ({ skills: [{ name: 'Mining', level: mining, baseLevel: mining, experience: 0 }], nearbyLocs: [...s.nearbyLocs, ...MINE_LOCS] }));
    const before = fake.onSend;
    fake.onSend = (a: SentAction, sdk) => {
        before(a, sdk);
        if (a.method === 'sendClickDialog' && sdk.state!.dialog.text?.includes('Mining level')) {
            sdk.push({ dialog: { isOpen: false, isWaiting: false, options: [] } });
            return;
        }
        if (a.method !== 'sendInteractLoc') return;
        const [x, z, id] = a.args as [number, number, number];
        const s = sdk.state!;
        if (id === GUILD_DOOR.id && x === GUILD_DOOR.at.x && z === GUILD_DOOR.at.z) {
            if (mining < GUILD_DOOR.mining) {
                sdk.push({ dialog: { isOpen: true, isWaiting: false, options: [], text: 'You need a Mining level of 60 to access the Mining Guild.' } });
                return;
            }
            sdk.push(moveTo(s, inBox(GUILD_CELLAR, at(s)) ? GUILD_DOOR.mineSide : GUILD_DOOR.at));
        } else if (id === GUILD_LADDER.id && isUnderground(at(s))) {
            climbs.push({ x, z });
            sdk.push({ ...moveTo(s, { x: s.player!.worldX, z: s.player!.worldZ - UNDERGROUND_Z }), nearbyLocs: s.nearbyLocs.filter(l => !MINE_LOCS.has(l)) });
        }
    };
    return { climbs };
}

/**
 * A walkTo with the SDK pathfinder's limits underground: it arrives anywhere in the same
 * area (the mine, or the cellar), and a destination on another map ends at the nearest
 * tile it can reach, as rs/197 saw (3047,9732). Surface walks go to `surface` when given.
 * `calls` records each request and whether it was made underground.
 */
export function minePathfinder(fake: FakeSdk, surface?: TollGateBot): { bot: TollGateBot; calls: { to: [number, number]; underground: boolean }[] } {
    const calls: { to: [number, number]; underground: boolean }[] = [];
    const area = (t: Tile) =>
        inBox(GUILD_CELLAR, t) ? 'cellar' : TAVERLEY_DUNGEON.some(b => inBox(b, t)) ? 'taverley' : inBox(EDGEVILLE_DUNGEON, t) ? 'edgeville' : inBox(DWARVEN_MINE, t) ? 'mine' : isUnderground(t) ? 'elsewhere' : 'surface';
    const bot: TollGateBot = {
        walkTo: async (x: number, z: number, tol?: number) => {
            const s = fake.state!;
            const from = at(s);
            calls.push({ to: [x, z], underground: isUnderground(from) });
            if (area(from) === 'surface' && area({ x, z }) === 'surface' && surface) return surface.walkTo(x, z, tol);
            if (area(from) !== area({ x, z })) {
                if (isUnderground(from)) fake.push(moveTo(s, { x: 3047, z: 9732 }));
                return { success: false, message: `Destination (${x}, ${z}) is unreachable` };
            }
            fake.push(moveTo(s, { x, z }));
            return { success: true, message: 'ok' };
        }
    };
    return { bot, calls };
}
