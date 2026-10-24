// Bone collector: kills monsters for their bones (the scored account buries them for
// Prayer), loots coins and small valuables, banks, reports. Food is bought at the Grand
// Exchange or caught and cooked by the helper itself.
//
//   bun speedrun/helpers/bones.ts <account>
//   ROLE_OPTIONS='{"spot":"hill_giants","train":50}' bun speedrun/helpers/bones.ts <account>
//   ROLE_OPTIONS='{"spot":"baby_blue","coinsFrom":"^cairn_h6\\d$"}' bun speedrun/helpers/bones.ts <account>
//
// Stages, chosen afresh from observed state at the top of every cycle (so the role
// resumes from anywhere: mid-fight, mid-walk, full inventory, after a relog or a death):
//   1. tutorial      skip it.
//   2. train         Lumbridge cows until Attack, Strength and Defence reach `train`.
//   3. fishing kit   (food: 'fish' only) Draynor net fishing to Fishing 20, a fly fishing
//                    rod from Gerrant (Port Sarim, 5 gp), feathers from the Lumbridge chickens.
//   4. food          'ge': sharks bought in bulk at the Varrock west Grand Exchange, banked,
//                    `foodPerTrip` carried out per trip; 'fish': fly fish trout/salmon at
//                    Barbarian Village and cook on its fire.
//   5. bones         work the spot (Edgeville dungeon hill giants by default; the brass
//                    key from the dungeon floor opens the short route), bank at Varrock West.
// Throughout, an EatGuard eats below `eatAt` whatever the role is doing (walks included).
// With no food at all (food: 'none') the helper rests at the bank.
// docs/speedrun/helpers/bones.md has the method comparison and the measured rates.
import type { BotActions } from '../../sdk/actions';
import type { BotSDK } from '../../sdk/index';
import type { BotWorldState, GroundItem, InventoryItem, NearbyNpc } from '../../sdk/types';
import { TRADE_REQUEST_CHAT_TYPE } from '../../sdk/types';
import type { Role, RoleContext } from './role';
import { runStandalone } from './role';
import { findLongPath, getDoorAt } from '../../sdk/pathfinding';
import { openTrade } from '../lib/trade';
import { Buyer } from './buyer';
import { EatGuard } from './eat-guard';
import { waitForFreshState } from '../lib/fresh-state';
import { accountMatches, playerPattern } from './mule';
import { isEastOfTollGate, TOLL_GP, travelTo } from '../lib/toll-gate';
import { leashHolds, ROOM, TAVERLEY_ADULTS } from './taverley-dragons';

interface Box { x1: number; z1: number; x2: number; z2: number }
interface Tile { x: number; z: number }

const UNDERGROUND_Z = 6400;
const inBox = (b: Box, x: number, z: number) => x >= b.x1 && x <= b.x2 && z >= b.z1 && z <= b.z2;
const dist = (a: Tile, b: Tile) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
const exact = (name: string) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');

// ---------------------------------------------------------------------------
// Places
// ---------------------------------------------------------------------------

const VARROCK_WEST_BANK: Tile = { x: 3185, z: 3436 };
const EDGEVILLE_BANK: Tile = { x: 3094, z: 3491 };
const DRAYNOR_BANK: Tile = { x: 3092, z: 3243 };
const FALADOR_WEST_BANK: Tile = { x: 2946, z: 3368 };
/** Shantay's chest, north of the pass: a bank (shantay_chest.rs2), opened from the north. */
const SHANTAY_CHEST: Tile = { x: 3309, z: 3121 };
const BANKS = [VARROCK_WEST_BANK, EDGEVILLE_BANK, DRAYNOR_BANK, FALADOR_WEST_BANK, SHANTAY_CHEST];

const EDGEVILLE_TRAPDOOR: Tile = { x: 3097, z: 3468 };
const EDGEVILLE_LADDER_BOTTOM: Tile = { x: 3096, z: 9867 };
/** Brass-key house north-west of Varrock: door on its south wall, ladder down into the hill giants' room. */
const BRASS_DOOR: Tile = { x: 3115, z: 3450 };
const BRASS_DOOR_OUTSIDE: Tile = { x: 3115, z: 3449 };
const BRASS_LADDER_TOP: Tile = { x: 3116, z: 3452 };
const BRASS_LADDER_BOTTOM: Tile = { x: 3116, z: 9853 };
/** Ground spawn of the brass key, 15 tiles from the giants. */
const BRASS_KEY_SPAWN: Tile = { x: 3131, z: 9862 };
const BRASS_KEY = /^brass key$/i;
const inBrassHouse = (p: Tile) => inBox({ x1: 3113, z1: 3450, x2: 3117, z2: 3453 }, p.x, p.z);

/** Lumbridge cows east of the river: they never hurt, so any account can train combat here. */
export const COW_FIELD: Box = { x1: 3242, z1: 3255, x2: 3265, z2: 3298 };
export const COW_CENTRE: Tile = { x: 3253, z: 3282 };
const CHICKEN_COOP: Box = { x1: 3222, z1: 3293, x2: 3238, z2: 3303 };
const DRAYNOR_NET: Tile = { x: 3087, z: 3229 };
const GERRANT: Tile = { x: 3014, z: 3224 };
const BARBARIAN_FISH: Tile = { x: 3106, z: 3431 };
/** The Barbarian Village fire burns inside the longhall; cook from the tile south of it (entrance on the south side). */
const BARBARIAN_FIRE: Tile = { x: 3079, z: 3444 };
const LONGHALL: Box = { x1: 3076, z1: 3441, x2: 3081, z2: 3445 };

export interface Spot {
    id: string;
    npc: RegExp;
    /** The spot's product, always looted: its bones, or herbs for the herb gatherer's spots. */
    bones: RegExp;
    /** Where the monsters live; targets outside it are ignored so the helper stays put. */
    area: Box;
    centre: Tile;
    /** Get from wherever the player is to the centre of the area. */
    enter(r: Run): Promise<boolean>;
    /** Get from inside or near the area to a bank booth (any of BANKS). */
    leave(r: Run): Promise<boolean>;
    /** Item that must be carried to work this spot (a key). */
    requires?: RegExp;
    /** Optional upkeep run while standing in the area (e.g. fetching a key). */
    upkeep?(r: Run): Promise<void>;
    /** Whether the player is at the spot (default: inside `area`). */
    inside?(r: Run): boolean;
    /** Obtain `requires` when neither the inventory nor the bank has it; one step per call, true when done. */
    acquire?(r: Run): Promise<boolean>;
    /** Where food comes from when the options do not say (default 'fish'). */
    food?: FoodSource;
    /** Spawns too spread out to see from one tile: with no target in view, walk this loop. */
    patrol?: Tile[];
    /** Carried items a bank visit leaves in the inventory (consumables the spot needs, like passes). */
    keep?: RegExp;
    /** Item that must be worn to work this spot, matched by id; the helper never walks in without it. */
    worn?: WornItem;
    /** Crowding gate: with more than `maxPlayers` (this one included) where `holds`, the helper waits on `wait`. */
    room?: RoomGate;
    /** Attack, Strength and Defence trained on cows before the first trip when the options do not say (default 50). */
    train?: number;
    /** Bank visits take out melee gear better than what is worn (gearRank), which the next cycle wields. */
    wieldBanked?: boolean;
}

export interface WornItem { id: number; name: RegExp; slot: string }
export interface RoomGate { maxPlayers: number; holds(p: Tile): boolean; wait: Tile }

/** Whether a room gate is full: this player plus the other players it holds exceed maxPlayers. */
export function roomFull(gate: RoomGate, others: readonly { x: number; z: number; worldX?: number; worldZ?: number }[]): boolean {
    return 1 + others.filter(p => gate.holds({ x: p.worldX ?? p.x, z: p.worldZ ?? p.z })).length > gate.maxPlayers;
}

/** Edgeville dungeon hill giants: 12 spawns around (3096-3120, 9816-9850), level 28, 35 hp, big bones. */
const HILL_GIANTS: Spot = {
    id: 'hill_giants',
    npc: /^giant$/i,
    bones: /^big bones$/i,
    area: { x1: 3088, z1: 9812, x2: 3126, z2: 9858 },
    centre: { x: 3108, z: 9836 },
    async enter(r) {
        if (!(await r.routeToSpot(this))) return false;
        if (!r.underground()) {
            if (r.carrying(BRASS_KEY)) {
                if (!(await r.throughBrassDoor(true))) return false;
                if (!(await r.climb(/ladder/i, /climb-down/i, true, BRASS_LADDER_TOP))) return false;
            } else {
                if (!(await r.walk(EDGEVILLE_TRAPDOOR.x, EDGEVILLE_TRAPDOOR.z + 1, 1, 300_000))) return false;
                if (!(await r.climb(/trapdoor/i, /climb-down|open/i, true, EDGEVILLE_TRAPDOOR))) return false;
            }
        }
        return r.walk(this.centre.x, this.centre.z, 4, 120_000);
    },
    async leave(r) {
        if (r.underground()) {
            if (r.carrying(BRASS_KEY)) {
                if (!(await r.walk(BRASS_LADDER_BOTTOM.x, BRASS_LADDER_BOTTOM.z, 1, 90_000))) return false;
                if (!(await r.climb(/ladder/i, /climb-up/i, false, BRASS_LADDER_BOTTOM))) return false;
            } else {
                if (!(await r.walk(EDGEVILLE_LADDER_BOTTOM.x, EDGEVILLE_LADDER_BOTTOM.z + 1, 2, 120_000))) return false;
                if (!(await r.climb(/ladder/i, /climb-up/i, false, EDGEVILLE_LADDER_BOTTOM))) return false;
                return r.walk(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z, 3, 120_000);
            }
        }
        if (inBox({ x1: 3113, z1: 3450, x2: 3117, z2: 3453 }, r.pos().x, r.pos().z)) {
            if (!(await r.throughBrassDoor(false))) return false;
        }
        return r.walk(VARROCK_WEST_BANK.x, VARROCK_WEST_BANK.z, 3, 300_000);
    },
    async upkeep(r) {
        if (r.carrying(BRASS_KEY) || r.banked(BRASS_KEY) > 0) return;
        if (Date.now() < r.nextKeyLook) return;
        r.nextKeyLook = Date.now() + 5 * 60_000;
        if (!(await r.walk(BRASS_KEY_SPAWN.x, BRASS_KEY_SPAWN.z, 2, 60_000))) return;
        const key = (await r.sdk.scanGroundItems(6)).find(g => BRASS_KEY.test(g.name));
        if (!key) {
            r.ctx.log('brass key not on the floor; will look again');
            return;
        }
        await r.bot.pickupItem(key);
        if (r.carrying(BRASS_KEY)) r.ctx.log('picked up the brass key');
    }
};

export const TAVERLEY_DUNGEON_LADDER: Tile = { x: 2884, z: 3397 };
export const TAVERLEY_DUNGEON_BOTTOM: Tile = { x: 2884, z: 9798 };
export const DUSTY_KEY_DOOR: Tile = { x: 2924, z: 9803 };
export const DUSTY_KEY = /^dusty key$/i;
const JAIL_KEY = /^jail key$/i;
/** Taverley dungeon jail: the Jailer walks the corridor; Velrak's cell is south of the door at (2931, 9690) and opens from inside without a key. */
const JAILER: Tile = { x: 2933, z: 9693 };
const JAIL_AREA: Box = { x1: 2922, z1: 9686, x2: 2945, z2: 9705 };
const VELRAK_CELL_DOOR: Tile = { x: 2931, z: 9690 };
const inVelrakCell = (t: Tile) => t.z < VELRAK_CELL_DOOR.z && t.z > 9675 && Math.abs(t.x - VELRAK_CELL_DOOR.x) <= 4;

/**
 * Get a dusty key: kill the Jailer (the jail key always drops; it lies for 1 minute), unlock
 * Velrak's cell with it, and accept his key (velrak_the_explorer.rs2 gives one to anyone not
 * carrying one). One step per call; returns true once the key is carried and the cell is left.
 */
export async function fetchDustyKey(r: Run): Promise<boolean> {
    if (!(await r.routeToSpot(BABY_BLUE))) return false;
    if (!r.underground()) {
        if (!(await r.walk(TAVERLEY_DUNGEON_LADDER.x, TAVERLEY_DUNGEON_LADDER.z + 1, 2, 300_000))) return false;
        await r.climb(/ladder/i, /climb-down/i, true, TAVERLEY_DUNGEON_LADDER);
        return false;
    }
    const cellDoor = async () => (await r.sdk.scanNearbyLocs(6)).find(l => /door/i.test(l.name) && l.x === VELRAK_CELL_DOOR.x && l.z === VELRAK_CELL_DOOR.z);
    if (!r.carrying(DUSTY_KEY)) {
        if (!inVelrakCell(r.pos())) {
            if (!r.carrying(JAIL_KEY)) {
                if (dist(r.pos(), JAILER) > 6) {
                    await r.walk(JAILER.x, JAILER.z, 3, 180_000);
                    return false;
                }
                const out = await r.fight({ npc: /^jailer$/i, area: JAIL_AREA, centre: JAILER, loot: JAIL_KEY });
                if (out === 'none') await r.sdk.waitForTicks(5);
                if (r.carrying(JAIL_KEY)) r.ctx.log('dusty key: got the jail key');
                return false;
            }
            await r.walk(VELRAK_CELL_DOOR.x, VELRAK_CELL_DOOR.z + 1, 0, 60_000);
            const door = await cellDoor();
            if (!door) { r.ctx.log('dusty key: no cell door', { at: [r.pos().x, r.pos().z] }); return false; }
            await r.bot.useItemOnLoc(JAIL_KEY, door);
            await r.waitFor(s => inVelrakCell({ x: s.player?.worldX ?? 0, z: s.player?.worldZ ?? 0 }), 8);
            return false;
        }
        await r.bot.talkTo(/^velrak/i);
        for (let page = 0; page < 15 && !r.carrying(DUSTY_KEY); page++) {
            const d = r.sdk.getDialog();
            if (!d?.isOpen) { await r.sdk.waitForTicks(1); continue; }
            const pick = d.options.find(o => /anywhere good to explore|yes please/i.test(o.text));
            if (pick) await r.sdk.clickDialogByText(pick.text);
            else await r.sdk.sendClickDialog(0);
            await r.sdk.waitForTicks(1);
        }
        await r.bot.dismissBlockingUI();
        r.ctx.log('dusty key', { got: r.carrying(DUSTY_KEY) });
        if (!r.carrying(DUSTY_KEY)) return false;
    }
    if (inVelrakCell(r.pos())) {
        const door = await cellDoor();
        if (door) await r.bot.interactLoc(door, /open/i);
        await r.waitFor(s => (s.player?.worldZ ?? 0) > VELRAK_CELL_DOOR.z, 8);
        return !inVelrakCell(r.pos());
    }
    return true;
}

/**
 * True when (x, z) on level 0 reaches `to` with the door at `door` shut, i.e. the two are on the
 * same side of it. Uses the SDK's offline collision map (already loaded for walkTo).
 */
export function sameSideOf(door: Tile, from: Tile, to: Tile): boolean {
    const d = getDoorAt(0, door.x, door.z);
    const path = findLongPath(0, from.x, from.z, to.x, to.z, 500, d ? [d] : []);
    const end = path.at(-1) ?? from;
    return dist(end, to) <= 1;
}

/**
 * Whether an underground tile is inside the baby blue room, west of the dusty-key gate. The gate
 * tile itself counts as outside: a helper can stop on it (seen 2026-10-21 09:26 UTC, cairn_h51
 * at (2924, 9803) with "The gate locks shut behind you"), and from there the way on is east.
 */
export function inBabyBlueRoom(p: Tile): boolean {
    return p.x < DUSTY_KEY_DOOR.x && sameSideOf(DUSTY_KEY_DOOR, p, BABY_BLUE_CENTRE);
}
const BABY_BLUE_CENTRE: Tile = { x: 2898, z: 9775 };

/**
 * Taverley dungeon baby blue dragons: 9 spawns at (2892-2909, 9763-9806), level 48, 50 hp,
 * no dragonfire, cowardly, babydragon bones (30 base). Four blue dragons share the room
 * (cowardly too; the role ignores them). The ladder bottom is walled off from the room: the
 * way in loops north and east and comes back west through the dusty-key door (2924, 9803),
 * entered from (2925, 9803) with the key; it opens from inside without one.
 */
/**
 * Into the Taverley dragon room (see BABY_BLUE): down the ladder, round to the dusty-key door,
 * through it with the key, on to the spot's centre. A spot with a `worn` requirement is refused
 * before the first step while that item is not worn.
 */
async function enterDragonRoom(r: Run, spot: Spot): Promise<boolean> {
    if (spot.worn && !r.wearing(spot.worn)) {
        r.ctx.log(`${spot.id}: not entering without item ${spot.worn.id} worn`, { at: [r.pos().x, r.pos().z] });
        return false;
    }
    if (!(await r.routeToSpot(spot))) return false;
    if (!r.underground()) {
        if (!(await r.walk(TAVERLEY_DUNGEON_LADDER.x, TAVERLEY_DUNGEON_LADDER.z + 1, 2, 300_000))) return false;
        if (!(await r.climb(/ladder/i, /climb-down/i, true, TAVERLEY_DUNGEON_LADDER))) return false;
    }
    if (!inBabyBlueRoom(r.pos())) {
        if (!(await r.walk(DUSTY_KEY_DOOR.x + 1, DUSTY_KEY_DOOR.z, 0, 180_000))) return false;
        const door = (await r.sdk.scanNearbyLocs(4)).find(l => /door|gate/i.test(l.name) && l.x === DUSTY_KEY_DOOR.x && l.z === DUSTY_KEY_DOOR.z);
        if (!door) { r.ctx.log(`${spot.id}: no dusty-key door`, { at: [r.pos().x, r.pos().z] }); return false; }
        await r.bot.useItemOnLoc(DUSTY_KEY, door);
        await r.waitFor(s => (s.player?.worldX ?? 9999) < DUSTY_KEY_DOOR.x, 10);
        if (r.pos().x >= DUSTY_KEY_DOOR.x) return false;
    }
    return r.walk(spot.centre.x, spot.centre.z, 4, 90_000);
}

const BABY_BLUE: Spot = {
    id: 'baby_blue',
    npc: /^baby blue dragon$/i,
    bones: /^babydragon bones$/i,
    area: { x1: 2876, z1: 9740, x2: 2923, z2: 9810 },
    centre: BABY_BLUE_CENTRE,
    food: 'ge',
    requires: DUSTY_KEY,
    acquire: fetchDustyKey,
    inside(r) {
        const p = r.pos();
        return r.underground() && inBox(this.area, p.x, p.z) && inBabyBlueRoom(p);
    },
    enter(r) { return enterDragonRoom(r, this); },
    async leave(r) {
        if (r.underground()) {
            if (inVelrakCell(r.pos())) {
                const door = (await r.sdk.scanNearbyLocs(6)).find(l => l.x === VELRAK_CELL_DOOR.x && l.z === VELRAK_CELL_DOOR.z);
                if (door) await r.bot.interactLoc(door, /open/i);
                if (!(await r.waitFor(s => (s.player?.worldZ ?? 0) > VELRAK_CELL_DOOR.z, 8))) return false;
            }
            if (inBabyBlueRoom(r.pos())) {
                if (!(await r.walk(DUSTY_KEY_DOOR.x - 1, DUSTY_KEY_DOOR.z, 0, 90_000))) return false;
                const door = (await r.sdk.scanNearbyLocs(4)).find(l => /door|gate/i.test(l.name) && l.x === DUSTY_KEY_DOOR.x && l.z === DUSTY_KEY_DOOR.z);
                if (door) await r.bot.interactLoc(door, /open/i);
                await r.waitFor(s => (s.player?.worldX ?? 0) > DUSTY_KEY_DOOR.x, 10);
                if (r.pos().x <= DUSTY_KEY_DOOR.x) return false;
            }
            if (!(await r.walk(TAVERLEY_DUNGEON_BOTTOM.x, TAVERLEY_DUNGEON_BOTTOM.z, 2, 120_000))) return false;
            if (!(await r.climb(/ladder/i, /climb-up/i, false, TAVERLEY_DUNGEON_BOTTOM))) return false;
        }
        return r.walk(FALADOR_WEST_BANK.x, FALADOR_WEST_BANK.z, 3, 300_000);
    }
};

/** Item 1540, the anti-dragon shield. This revision names it "Dragonfire shield" (shields.obj antidragonbreathshield). */
export const ANTI_DRAGON_SHIELD: WornItem = { id: 1540, name: /^dragonfire shield$/i, slot: 'shield' };

/** Tiles an adult blue dragon can fight inside its leash. The magic killers' safe tile and route (dragons.ts) are outside all of them. */
export const inAdultReach = (p: Tile): boolean => TAVERLEY_ADULTS.some(s => leashHolds(s, p));

const mean = (ns: number[]) => ns.reduce((a, b) => a + b, 0) / ns.length;
/** The middle of the three adults' footprints. */
const ADULTS_CENTRE: Tile = {
    x: Math.floor(mean(TAVERLEY_ADULTS.map(s => s.x + (s.size - 1) / 2))),
    z: Math.floor(mean(TAVERLEY_ADULTS.map(s => s.z + (s.size - 1) / 2)))
};

/**
 * Taverley dungeon adult blue dragons in melee: the 3 adults of the baby blues' room
 * (taverley-dragons.ts), level 111, 105 hp, respawn 60 ticks, dragon bones on every kill
 * (blue_dragon.rs2). One attack in four is dragonfire, up to 50 unshielded and 5 with the
 * anti-dragon shield worn (dragon.rs2), so the spot is never entered without it. Babies share
 * the room and are never targets. The magic killers (dragons.ts) work the same adults from
 * outside every leash; the room gate counts only players inside an adult's leash, so it holds
 * the melee helpers to two.
 */
const BLUE_DRAGON: Spot = {
    id: 'blue_dragon',
    npc: /^blue dragon$/i,
    bones: /^dragon bones$/i,
    area: ROOM,
    centre: ADULTS_CENTRE,
    food: 'ge',
    train: 70,
    requires: DUSTY_KEY,
    acquire: fetchDustyKey,
    worn: ANTI_DRAGON_SHIELD,
    room: { maxPlayers: 2, holds: inAdultReach, wait: { x: DUSTY_KEY_DOOR.x - 1, z: DUSTY_KEY_DOOR.z } },
    wieldBanked: true,
    inside(r) {
        const p = r.pos();
        return r.underground() && inBox(this.area, p.x, p.z) && inBabyBlueRoom(p);
    },
    enter(r) { return enterDragonRoom(r, this); },
    leave(r) { return BABY_BLUE.leave(r); }
};

/** Unidentified herbs are all named "Herb" in this revision (one item id per herb). */
const HERB = /^herb$/i;

/**
 * Edgeville dungeon chaos druids: 11 spawns at (3104-3115, 9925-9943), level 13, 20 hp,
 * respawn 50 ticks, magic attackers. Herbs on 57/128 kills (chaos_druid.rs2), vials of water
 * on 10/128. The room is inside Wilderness levels 1-3, so PvP is live there. Herb gatherer.
 */
const CHAOS_DRUIDS: Spot = {
    id: 'chaos_druids',
    npc: /^chaos druid$/i,
    bones: HERB,
    area: { x1: 3098, z1: 9918, x2: 3120, z2: 9950 },
    centre: { x: 3109, z: 9935 },
    async enter(r) {
        if (!(await r.routeToSpot(this))) return false;
        if (!r.underground()) {
            if (!(await r.walk(EDGEVILLE_TRAPDOOR.x, EDGEVILLE_TRAPDOOR.z + 1, 1, 300_000))) return false;
            if (!(await r.climb(/trapdoor/i, /climb-down|open/i, true, EDGEVILLE_TRAPDOOR))) return false;
        }
        return r.walk(this.centre.x, this.centre.z, 4, 120_000);
    },
    async leave(r) {
        if (r.underground()) {
            if (!(await r.walk(EDGEVILLE_LADDER_BOTTOM.x, EDGEVILLE_LADDER_BOTTOM.z + 1, 2, 120_000))) return false;
            if (!(await r.climb(/ladder/i, /climb-up/i, false, EDGEVILLE_LADDER_BOTTOM))) return false;
        }
        return r.walk(EDGEVILLE_BANK.x, EDGEVILLE_BANK.z, 3, 300_000);
    }
};

/** Taverley dungeon chaos druids: 6 spawns at (2929-2937, 9846-9852), north-east of the ladder; not wilderness. Herb gatherer. */
const CHAOS_DRUIDS_TAVERLEY: Spot = {
    id: 'chaos_druids_taverley',
    npc: /^chaos druid$/i,
    bones: HERB,
    area: { x1: 2922, z1: 9840, x2: 2944, z2: 9858 },
    centre: { x: 2933, z: 9849 },
    async enter(r) {
        if (!(await r.routeToSpot(this))) return false;
        if (!r.underground()) {
            if (!(await r.walk(TAVERLEY_DUNGEON_LADDER.x, TAVERLEY_DUNGEON_LADDER.z + 1, 2, 300_000))) return false;
            if (!(await r.climb(/ladder/i, /climb-down/i, true, TAVERLEY_DUNGEON_LADDER))) return false;
        }
        return r.walk(this.centre.x, this.centre.z, 4, 120_000);
    },
    async leave(r) {
        if (r.underground()) {
            if (!(await r.walk(TAVERLEY_DUNGEON_BOTTOM.x, TAVERLEY_DUNGEON_BOTTOM.z, 2, 120_000))) return false;
            if (!(await r.climb(/ladder/i, /climb-up/i, false, TAVERLEY_DUNGEON_BOTTOM))) return false;
        }
        return r.walk(FALADOR_WEST_BANK.x, FALADOR_WEST_BANK.z, 3, 300_000);
    }
};

/**
 * Nature talismans come only from the gem table (`randomjewel`, shared_droptables.rs2), on 4
 * of its 128 rolls and only overground: below UNDERGROUND_Z the same roll gives a chaos
 * talisman. So a talisman spot must be on the surface, and the rate per kill is the NPC's
 * gem-table share times 4/128.
 *
 * Asgarnia's hobgoblin peninsula, south of Falador: 10 overground spawns at (2905-2920,
 * 3266-3295), nine level 28 (29 hp) and one level 42 (49 hp). They are cowardly and respawn
 * in 100 ticks (the engine default). Both kinds roll the gem table on 2/128 (hobgoblin.rs2),
 * so a talisman drops on 1 kill in 2,048. It is a walk from Falador west bank with no door,
 * and they barely hurt a high-Defence helper, so it rests instead of carrying food.
 */
const NATURE_HOBGOBLINS: Spot = {
    id: 'nature_hobgoblins',
    npc: /^hobgoblin$/i,
    bones: /^nature talisman$/i,
    area: { x1: 2898, z1: 3260, x2: 2928, z2: 3300 },
    centre: { x: 2910, z: 3284 },
    food: 'none',
    async enter(r) {
        if (!(await r.routeToSpot(this))) return false;
        return r.walk(this.centre.x, this.centre.z, 4, 300_000);
    },
    async leave(r) {
        return r.walk(FALADOR_WEST_BANK.x, FALADOR_WEST_BANK.z, 3, 300_000);
    }
};

// Kharidian desert, through the Shantay Pass. The gate (shantay_pass_henge_doorway, 4 wide at
// (3302-3305, 3116)) takes a Shantay pass going south (shantay_pass.rs2) and is free going north.
const SHANTAY: Tile = { x: 3304, z: 3123 };
const SHANTAY_GATE_NORTH: Tile = { x: 3303, z: 3118 };
const SHANTAY_GATE_SOUTH: Tile = { x: 3303, z: 3115 };
const SHANTAY_PASS = /^shantay pass$/i;
/** Passes bought per visit to Shantay (5 gp each, stackable, 500 in stock). */
const PASSES_PER_BUY = 40;
const DESERT: Box = { x1: 3184, z1: 3008, x2: 3327, z2: 3116 };
export const inDesert = (p: Tile) => inBox(DESERT, p.x, p.z);

/** The 25 Ugthanki spawns (npc 840 in maps m49_47..m51_48). */
export const UGTHANKI_SPAWNS: Tile[] = [
    [3190, 3054], [3192, 3016], [3208, 3032], [3217, 3064], [3217, 3111], [3222, 3086], [3238, 3015],
    [3238, 3101], [3244, 3080], [3253, 3116], [3255, 3095], [3258, 3063], [3267, 3077], [3268, 3052],
    [3269, 3110], [3275, 3094], [3281, 3056], [3291, 3078], [3291, 3100], [3305, 3089], [3307, 3055],
    [3318, 3020], [3318, 3040], [3318, 3078], [3321, 3104]
].map(([x, z]) => ({ x: x!, z: z! }));

/** Visit every tile once, always going to the nearest one not yet visited (a closed loop when repeated). */
export function patrolTour(start: Tile, tiles: Tile[]): Tile[] {
    const left = tiles.slice();
    const tour: Tile[] = [];
    let at = start;
    while (left.length) {
        let best = 0;
        for (let i = 1; i < left.length; i++) if (dist(at, left[i]!) < dist(at, left[best]!)) best = i;
        at = left.splice(best, 1)[0]!;
        tour.push(at);
    }
    return tour;
}

/** Buy passes from Shantay with the coins carried, fetching coins from the bank first. */
async function buyShantayPasses(r: Run): Promise<boolean> {
    const coins = () => r.carried(/^coins$/i);
    if (coins() < 5) {
        await r.bank('coins for Shantay passes', null, [{ re: /^coins$/i, n: 5 * PASSES_PER_BUY + 50 }]);
        if (coins() < 5) {
            r.ctx.log('ugthanki: no coins for a Shantay pass');
            return false;
        }
    }
    if (!(await r.walk(SHANTAY.x, SHANTAY.z, 3, 600_000))) return false;
    const open = await r.bot.openShop(/^shantay$/i);
    if (!open.success) {
        r.ctx.log('ugthanki: Shantay shop did not open', { reason: open.message });
        return false;
    }
    await r.bot.buyFromShop(SHANTAY_PASS, Math.min(PASSES_PER_BUY, Math.floor(coins() / 5)));
    await r.bot.closeShop();
    r.ctx.log('ugthanki: bought Shantay passes', { passes: r.carried(SHANTAY_PASS), coins: coins() });
    return r.carrying(SHANTAY_PASS);
}

async function shantayGate(r: Run): Promise<boolean> {
    const gate = (await r.sdk.scanNearbyLocs(6)).find(l => /^shantay pass$/i.test(l.name));
    if (!gate) {
        r.ctx.log('ugthanki: no Shantay pass gate', { at: [r.pos().x, r.pos().z] });
        return false;
    }
    await r.bot.interactLoc(gate, /go-through/i);
    return true;
}

/**
 * Ugthanki camels in the Kharidian desert: 25 spawns, level 42, 45 hp, cowardly, respawn
 * 700 ticks; one raw ugthanki meat per kill (ugthanki.rs2). The kebab line's meat.
 * Desert heat (desert_heat.rs2) hurts 1-10 every 50-190 ticks without a waterskin; the eat
 * guard covers it. Banks at Shantay's chest; each entry costs a pass.
 */
const UGTHANKI: Spot = {
    id: 'ugthanki',
    npc: /^ugthanki$/i,
    bones: /^raw ugthanki meat$/i,
    area: DESERT,
    centre: { x: 3275, z: 3094 },
    patrol: patrolTour(SHANTAY_GATE_SOUTH, UGTHANKI_SPAWNS),
    food: 'ge',
    // Coins stay carried for passes and the Al Kharid toll gate.
    keep: /^(shantay pass|coins)$/i,
    async enter(r) {
        if (inDesert(r.pos())) return true;
        if (!(await r.routeToSpot(this))) return false;
        if (!r.carrying(SHANTAY_PASS) && !(await buyShantayPasses(r))) return false;
        if (!(await r.walk(SHANTAY_GATE_NORTH.x, SHANTAY_GATE_NORTH.z, 1, 600_000))) return false;
        if (!(await shantayGate(r))) return false;
        // The guard's dialogue (and the poster, on the first entry) runs before the teleport.
        for (let page = 0; page < 20 && !inDesert(r.pos()); page++) {
            const d = r.sdk.getDialog();
            if (!d?.isOpen) { await r.sdk.waitForTicks(1); continue; }
            const pick = d.options.find(o => /doesn't scare me/i.test(o.text));
            if (pick) await r.sdk.clickDialogByText(pick.text);
            else await r.sdk.sendClickDialog(0);
            await r.sdk.waitForTicks(1);
        }
        await r.bot.dismissBlockingUI();
        return inDesert(r.pos());
    },
    async leave(r) {
        if (inDesert(r.pos())) {
            if (!(await r.walk(SHANTAY_GATE_SOUTH.x, SHANTAY_GATE_SOUTH.z, 1, 300_000))) return false;
            if (!(await shantayGate(r))) return false;
            if (!(await r.waitFor(s => !inDesert({ x: s.player?.worldX ?? 0, z: s.player?.worldZ ?? 0 }), 10))) return false;
        }
        return r.walk(SHANTAY_CHEST.x, SHANTAY_CHEST.z, 2, 120_000);
    }
};

export const SPOTS: Record<string, Spot> = {
    hill_giants: HILL_GIANTS,
    baby_blue: BABY_BLUE,
    blue_dragon: BLUE_DRAGON,
    chaos_druids: CHAOS_DRUIDS,
    chaos_druids_taverley: CHAOS_DRUIDS_TAVERLEY,
    nature_hobgoblins: NATURE_HOBGOBLINS,
    ugthanki: UGTHANKI
};

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

/** Valuables worth a pickup on top of the bones: stackables and small light items. */
const DEFAULT_LOOT = /^(coins|(law|nature|cosmic|death|chaos|blood|soul) rune|grimy .+|limpwurt root|uncut (sapphire|emerald|ruby|diamond|dragonstone)|.+ talisman|brass key|dusty key)$/i;

const FOOD = /^(shark|manta ray|sea turtle|swordfish|lobster|monkfish|bass|tuna|salmon|pike|trout|cod|herring|mackerel|sardine|anchovies|shrimps|cooked chicken|cooked meat|bread|cake|2\/3 cake|slice of cake|chocolate cake|meat pie|stew|kebab|plain pizza|meat pizza)$/i;
/** Hitpoints each food heals (consume.rs2 effects); anything else is taken as 5. */
const HEAL: Record<string, number> = {
    shark: 20, 'manta ray': 22, 'sea turtle': 21, swordfish: 14, lobster: 12, monkfish: 16, bass: 13, tuna: 10,
    salmon: 9, pike: 8, trout: 7, cod: 7, mackerel: 6, herring: 5, sardine: 4, shrimps: 3, anchovies: 1
};
export const healOf = (name: string) => HEAL[name.toLowerCase()] ?? 5;
const edible = (i: InventoryItem) => FOOD.test(i.name) && i.optionsWithIndex.some(o => /^eat$/i.test(o.text));
const RAW_FISH = /^raw (trout|salmon)$/i;
const NET_FISH = /^raw (shrimps|anchovies)$/i;
const NET = /^small fishing net$/i;
/** Cooking level each catch needs (cooking_generic.dbrow); below it the fire answers with a mesbox and cooks nothing. */
const COOK_REQ: Record<string, number> = { 'raw shrimps': 1, 'raw anchovies': 1, 'raw trout': 15, 'raw salmon': 25 };
const ROD = /^fly fishing rod$/i;
const FEATHER = /^feather$/i;

/** Items a bank visit leaves in the inventory: food, the fly fishing kit, keys, and the net and its catch while cooking practice still needs them. */
export function keepOnBank(name: string, lv: { fishing: number; cooking: number }, requires?: RegExp): boolean {
    return FOOD.test(name) || RAW_FISH.test(name) || ROD.test(name) || FEATHER.test(name) || BRASS_KEY.test(name) ||
        (requires?.test(name) ?? false) ||
        (NET.test(name) && (lv.fishing < 20 || lv.cooking < 15)) ||
        (NET_FISH.test(name) && lv.cooking < 15);
}

const COINS = /^coins$/i;

export function skipIdsOption(raw: unknown): ReadonlySet<number> {
    if (raw === undefined) return new Set();
    if (!Array.isArray(raw) || raw.some(x => !Number.isInteger(x) || (x as number) < 0)) throw new Error('bones: skipIds must be a list of obj ids');
    return new Set(raw as number[]);
}

/** A ground item the loot step wants: its name matches and its id is not skipped. */
export function lootWanted(g: { id: number; name: string }, want: RegExp, skipIds: ReadonlySet<number>): boolean {
    return !skipIds.has(g.id) && want.test(g.name);
}

/** Whether the carried product (`product`, a spot's `bones`) has reached `maxCarry`: the bank trigger short of a full pack. */
export function carryReached(inventory: readonly { name: string; count: number }[], product: RegExp, maxCarry: number): boolean {
    return inventory.filter(i => product.test(i.name)).reduce((a, i) => a + i.count, 0) >= maxCarry;
}

/** Edible food past the first `cap` units carried, by id, in inventory order: what a bank visit deposits under `keepFood`. */
export function foodOverCap(inventory: readonly InventoryItem[], cap: number): { id: number; n: number }[] {
    let kept = 0;
    const over = new Map<number, number>();
    for (const i of inventory) {
        if (!edible(i)) continue;
        const stay = Math.max(0, Math.min(i.count, cap - kept));
        kept += stay;
        if (i.count > stay) over.set(i.id, (over.get(i.id) ?? 0) + i.count - stay);
    }
    return [...over].map(([id, n]) => ({ id, n }));
}

/** What a bank visit at `at` takes out so the walk away can pay the Al Kharid toll: 10 gp when east of the gate. */
export function tollWithdraw(at: { x: number; z: number }): { re: RegExp; n: number }[] {
    return isEastOfTollGate(at) ? [{ re: COINS, n: TOLL_GP }] : [];
}

/**
 * Carried items that send the fishing fallback to the bank first: the spot's product, and coins
 * unless the spot keeps them carried. Kept coins survive every bank visit, so counting them
 * banked forever (an ugthanki account, coins kept for Shantay passes, made 979 chest visits in 32 min).
 */
export function fishingHaul(inventory: { name: string }[], spot: Pick<Spot, 'bones' | 'keep'>): boolean {
    return inventory.some(i => spot.bones.test(i.name) || (/^coins$/i.test(i.name) && !(spot.keep?.test(i.name) ?? false)));
}

/** Bootstrap leftovers that only cost loot slots at the spot: raw net fish once Cooking is 15, and anything burnt. */
export function isClutter(name: string, cooking: number): boolean {
    return /^burnt /i.test(name) || (NET_FISH.test(name) && cooking >= 15);
}

const METALS = ['bronze', 'iron', 'steel', 'black', 'mithril', 'adamant', 'rune'];
const METAL_REQ: Record<string, number> = { bronze: 1, iron: 1, steel: 5, black: 10, mithril: 20, adamant: 30, rune: 40 };
const SLOTS: { slot: string; re: RegExp; skill: 'Attack' | 'Defence' }[] = [
    { slot: 'weapon', re: /^(\w+) (sword|longsword|scimitar)$/i, skill: 'Attack' },
    { slot: 'shield', re: /^(\w+) (kiteshield|sq shield)$/i, skill: 'Defence' },
    { slot: 'head', re: /^(\w+) (full helm|med helm)$/i, skill: 'Defence' },
    { slot: 'body', re: /^(\w+) (platebody|chainbody)$/i, skill: 'Defence' },
    { slot: 'legs', re: /^(\w+) (platelegs|plateskirt)$/i, skill: 'Defence' }
];

/** Slot and tier of a melee item we know how to rank, or null. Higher tier is better; within a metal, longswords/scimitars beat swords and full helms beat med helms. */
export function gearRank(name: string): { slot: string; tier: number; metal: string; skill: 'Attack' | 'Defence' } | null {
    if (/^wooden shield$/i.test(name)) return { slot: 'shield', tier: 0, metal: 'bronze', skill: 'Defence' };
    for (const s of SLOTS) {
        const m = s.re.exec(name);
        if (!m) continue;
        const metal = (m[1] ?? '').toLowerCase();
        const i = METALS.indexOf(metal);
        if (i < 0) return null;
        const sub = /longsword|scimitar|full helm|platebody|platelegs|kiteshield/i.test(m[2] ?? '') ? 1 : 0;
        return { slot: s.slot, tier: 2 + i * 2 + sub, metal, skill: s.skill };
    }
    return null;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

type FoodSource = 'ge' | 'fish' | 'none';
const FOOD_SOURCES: FoodSource[] = ['ge', 'fish', 'none'];

interface Options {
    spot: Spot;
    /** Train Attack, Strength and Defence on cows until all reach this. */
    train: number;
    /**
     * Where food comes from: 'ge' buys `foodItem` at the Grand Exchange (falling back to
     * 'fish' for 30 minutes when there are no coins); 'fish' catches and cooks trout/salmon
     * at Barbarian Village; 'none' rests at the bank when hurt.
     */
    food: FoodSource;
    /** GE food: the item bought and eaten. */
    foodItem: string;
    /** GE food: carried out of the bank per trip. */
    foodPerTrip: number;
    /** GE food: bought per exchange visit, coins permitting. */
    buyFood: number;
    /** GE food: never pay more per item (a resting bid at this price is left when the ask is higher). */
    maxFoodPrice: number;
    /** GE food: login-name RegExp of accounts whose coins this account accepts by trade while it waits at Varrock West. */
    coinsFrom: RegExp | null;
    /** GE food: minutes to wait at Varrock West for coins before catching fish instead. */
    coinWaitMin: number;
    /** Raw fish to catch per food run. */
    fishPerTrip: number;
    /** Go for food when fewer than this many are carried. */
    minFood: number;
    /** With a full bag, drop food for a bone while more than minFood + spareFood are carried. */
    spareFood: number;
    /** Feathers to collect from chickens when the stock runs out. */
    feathers: number;
    /** Eat below this fraction of max hitpoints. */
    eatAt: number;
    /** With no food, leave for the bank below this fraction... */
    fleeAt: number;
    /** ...and rest there until hitpoints are back to this fraction. */
    restUntil: number;
    /** Extra loot on top of the spot's bones. */
    loot: RegExp;
    /** Skip a target with more than this many other players adjacent. */
    maxPlayersNearTarget: number;
    /** Stop training a combat skill at this level (the style picker skips it). */
    styleCap: number;
    /**
     * Most food a bank visit leaves carried; the rest is banked (default: all of it). A borrowed
     * account that needs no food (99 Defence at chaos druids) otherwise spends its bag on it.
     */
    keepFood: number;
    /**
     * Bank once this many of the spot's product (its `bones`: bones, or herbs at the druids) are
     * carried, before the pack is full (default: only when full). Caps what a death in the
     * Wilderness can cost.
     */
    maxCarry: number;
    /**
     * Obj ids never picked up (default none). Unidentified herbs are all named 'Herb', so only an
     * id tells a grimy marrentill from a grimy ranarr: a herb gatherer leaves the ones its plan
     * has no use for, which other players' kills leave lying in their dozens.
     */
    skipIds: ReadonlySet<number>;
    /** Log every fight at the spot (outcome, game ticks, position, live targets in view): for measuring kill rates. */
    trace: boolean;
}

export function parseOptions(o: Record<string, unknown>): Options {
    const num = (k: string, d: number) => (typeof o[k] === 'number' ? (o[k] as number) : d);
    const spotId = typeof o.spot === 'string' ? o.spot : 'hill_giants';
    const spot = SPOTS[spotId];
    if (!spot) throw new Error(`bones: unknown spot '${spotId}' (known: ${Object.keys(SPOTS).join(', ')})`);
    const food = (o.food ?? spot.food ?? 'fish') as FoodSource;
    if (!FOOD_SOURCES.includes(food)) throw new Error(`bones: unknown food '${String(o.food)}' (known: ${FOOD_SOURCES.join(', ')})`);
    return {
        spot,
        train: num('train', spot.train ?? 50),
        food,
        foodItem: typeof o.foodItem === 'string' ? o.foodItem : 'Shark',
        foodPerTrip: num('foodPerTrip', 10),
        buyFood: num('buyFood', 150),
        maxFoodPrice: num('maxFoodPrice', 900),
        coinsFrom: typeof o.coinsFrom === 'string' && o.coinsFrom ? new RegExp(o.coinsFrom, 'i') : null,
        coinWaitMin: num('coinWaitMin', 20),
        fishPerTrip: num('fishPerTrip', 10),
        minFood: num('minFood', 2),
        spareFood: num('spareFood', 3),
        feathers: num('feathers', 300),
        eatAt: num('eatAt', 0.55),
        fleeAt: num('fleeAt', 0.35),
        restUntil: num('restUntil', 0.9),
        loot: typeof o.loot === 'string' ? new RegExp(o.loot, 'i') : DEFAULT_LOOT,
        maxPlayersNearTarget: num('maxPlayersNearTarget', 0),
        styleCap: num('styleCap', 99),
        keepFood: num('keepFood', Infinity),
        maxCarry: num('maxCarry', Infinity),
        skipIds: skipIdsOption(o.skipIds),
        trace: o.trace === true
    };
}

// ---------------------------------------------------------------------------
// Run: one account's live session
// ---------------------------------------------------------------------------

interface Target { npc: RegExp; area: Box; centre: Tile; loot: RegExp | null }
type Outcome = 'killed' | 'lost' | 'flee' | 'none' | 'full';

/** One account's live session; the dragons role (dragons.ts) reuses its walking, climbing, fighting and training. */
export class Run {
    readonly bot: BotActions;
    readonly sdk: BotSDK;
    nextKeyLook = 0;
    private acquireSince: number | null = null;
    private requirementBankChecked = false;
    /** The requested spot never changes; a fallback lasts only until the next bank visit. */
    activeSpot: Spot;
    kills = 0;
    private looted: Record<string, number> = {};
    /** Loot picked up, by item id: tells apart items that share a name (every unidentified herb is "Herb"). */
    readonly lootedById: Record<number, number> = {};
    private deaths = 0;
    private readonly startedAt = Date.now();
    private lastRespawnCount: number | null = null;
    /** Bank contents as of the last visit (null until the first one). */
    private bankView: Map<string, number> | null = null;
    private currentPhase = 'start';
    /** Eats below eatAt whatever the role is doing; started and stopped by the role. */
    readonly guard: EatGuard;
    readonly buyer: Buyer;
    /** GE food falls back to catching fish until this time (no food banked and no coins for more). */
    private fishUntil = 0;
    /** Missing fishing equipment must not cause a tight GE/fishing retry loop. */
    private fishingRetryAt = 0;
    /** GE food: no purchase is tried before this time (the last exchange visit bought nothing). */
    private geRetryAt = 0;
    /** When the current wait for coins at Varrock West began (0: not waiting). */
    private coinWaitSince = 0;
    /** Price paid per food item at the last purchase (null: not bought this session). */
    private foodPrice: number | null = null;
    /** The trip in progress: left the bank at `at` with `food` food; `inRoomAt` is the first cycle at the spot. */
    private trip: { at: number; food: number; eats: number; kills: number; inRoomAt: number | null } | null = null;
    /** Ticks from each attack to the target's death, this session. */
    private readonly killTicks: number[] = [];
    /** The bank is looked in again for a missing `worn` item no earlier than this. */
    private wornLookAt = 0;
    /** When the spot's room gate was first found full (0: not full). */
    private roomFullSince = 0;

    /** Log each stage change once: train, kit:net, kit:rod, kit:feathers, food:cook, food:fish, bones:<spot>. */
    phase(to: string): void {
        if (to === this.currentPhase) return;
        this.ctx.log('phase', { from: this.currentPhase, to, levels: this.summary().levels });
        this.currentPhase = to;
    }

    constructor(readonly ctx: RoleContext, readonly opt: Options) {
        this.activeSpot = opt.spot;
        this.bot = ctx.bot;
        this.sdk = ctx.sdk;
        this.guard = new EatGuard(ctx.sdk, { eatAt: opt.eatAt, food: FOOD });
        this.buyer = new Buyer(ctx);
    }

    /** The food source in effect now: GE food can be falling back to fishing. */
    foodSource(): FoodSource {
        return this.opt.food === 'ge' && Date.now() < this.fishUntil ? 'fish' : this.opt.food;
    }
    fishing(): boolean { return this.foodSource() === 'fish'; }
    get foodRe(): RegExp { return exact(this.opt.foodItem); }

    /** A failed temporary fallback must never disable the requested GE source or its receiver. */
    stopFishing(why: string): void {
        this.fishUntil = 0;
        if (this.opt.food === 'ge') {
            this.fishingRetryAt = Date.now() + 30 * 60_000;
            this.coinWaitSince = 0;
            this.ctx.log(`${why}; resuming GE food, fishing retry in 30 minutes`);
        } else {
            this.ctx.log(`${why}; fishing for food disabled`);
            this.opt.food = 'none';
        }
    }

    /** What a bank visit takes back out for the next trip. */
    tripKit(): { re: RegExp; n: number }[] {
        const kit = [{ re: BRASS_KEY, n: 1 }];
        if (this.opt.spot.requires) kit.push({ re: this.opt.spot.requires, n: 1 });
        const worn = this.opt.spot.worn;
        if (worn && !this.wearing(worn)) kit.push({ re: worn.name, n: 1 });
        if (this.opt.food === 'ge') kit.push({ re: this.foodRe, n: this.opt.foodPerTrip });
        if (this.fishing()) kit.push({ re: ROD, n: 1 }, { re: FEATHER, n: 10_000 });
        return kit;
    }

    // ---- state helpers ----

    state(): BotWorldState {
        const s = this.sdk.getState();
        if (!s?.player) throw new Error('no world state');
        return s;
    }
    pos(): Tile & { level: number } {
        const p = this.state().player!;
        return { x: p.worldX, z: p.worldZ, level: p.level };
    }
    underground(): boolean { return this.pos().z > UNDERGROUND_Z; }
    level(skill: string): number { return this.sdk.getSkill(skill)?.baseLevel ?? 1; }
    hpFrac(): number {
        const hp = this.sdk.getSkill('Hitpoints');
        const p = this.state().player!;
        return (hp?.level ?? p.hp) / Math.max(1, hp?.baseLevel ?? p.maxHp ?? 10);
    }
    freeSlots(): number { return 28 - this.state().inventory.length; }
    /** Edible food carried (banknotes excluded). */
    food(): InventoryItem[] { return this.state().inventory.filter(edible); }
    carried(re: RegExp): number { return this.state().inventory.filter(i => re.test(i.name)).reduce((a, i) => a + i.count, 0); }
    carrying(re: RegExp): boolean { return this.carried(re) > 0; }
    banked(re: RegExp): number {
        let n = 0;
        for (const [name, c] of this.bankView ?? []) if (re.test(name)) n += c;
        return n;
    }
    owns(re: RegExp): boolean { return this.carrying(re) || this.banked(re) > 0; }
    /** Whether `w` is equipped, by id (item names differ between revisions). */
    wearing(w: WornItem): boolean { return this.sdk.getEquipment().some(e => e.id === w.id); }
    aborted(): boolean { return this.ctx.signal.aborted; }

    async waitFor(pred: (s: BotWorldState) => boolean, ticks: number): Promise<boolean> {
        for (let i = 0; i < ticks; i++) {
            const s = this.sdk.getState();
            if (s && pred(s)) return true;
            await this.sdk.waitForTicks(1);
        }
        const s = this.sdk.getState();
        return !!s && pred(s);
    }

    /** Exit the dungeon (or the desert) we are actually in, not the spot selected for our next trip. */
    locationSpot(): Spot | null {
        if (inDesert(this.pos())) return UGTHANKI;
        if (!this.underground()) return null;
        return this.pos().x < 3000 ? BABY_BLUE : HILL_GIANTS;
    }

    async routeToSpot(spot: Spot): Promise<boolean> {
        const here = this.locationSpot();
        if (here && (here === UGTHANKI) !== (spot === UGTHANKI)) return here.leave(this);
        if (here && (here.centre.x < 3000) !== (spot.centre.x < 3000)) return here.leave(this);
        if (!here && inBrassHouse(this.pos())) return this.throughBrassDoor(false);
        return true;
    }

    async walk(x: number, z: number, tol: number, timeout: number): Promise<boolean> {
        if (z < UNDERGROUND_Z) {
            const here = this.locationSpot();
            if (here && !inBox(here.area, x, z) && !(await here.leave(this))) return false;
            if (inBrassHouse(this.pos()) && !inBrassHouse({ x, z }) && !(await this.throughBrassDoor(false))) return false;
        }
        for (let attempt = 0; attempt < 3; attempt++) {
            if (this.aborted()) return false;
            if (dist(this.pos(), { x, z }) <= tol) return true;
            const r = await this.walkOnce(x, z, tol, timeout);
            await this.sdk.waitForTicks(1);
            if (dist(this.pos(), { x, z }) <= tol + 1) return true;
            this.ctx.log('walk retry', { to: [x, z], at: [this.pos().x, this.pos().z], reason: r.message });
        }
        return dist(this.pos(), { x, z }) <= tol + 1;
    }

    /**
     * One surface walk. Across the Al Kharid fence it goes through the toll gate (10 gp
     * carried), since walkTo takes the gate for a door and stalls there. The desert is
     * left by the Shantay gate, never by the toll gate.
     */
    private async walkOnce(x: number, z: number, tol: number, timeout: number): Promise<{ message: string }> {
        const from = this.pos();
        const to = { x, z };
        if (z < UNDERGROUND_Z && !inDesert(from) && !inDesert(to) && isEastOfTollGate(from) !== isEastOfTollGate(to)) {
            const r = await travelTo(this.bot, this.sdk, to, { tolerance: tol, signal: this.ctx.signal, log: (m, d) => this.ctx.log(`travel: ${m}`, d) });
            return { message: r.ok ? `travelled, paid ${r.paid}` : (r.reason ?? 'travel failed') };
        }
        return this.bot.walkTo(x, z, tol, { timeout });
    }

    /** Use a ladder or trapdoor near `at`; `down` decides which side of UNDERGROUND_Z counts as done. Opens a closed trapdoor first. */
    async climb(name: RegExp, option: RegExp, down: boolean, at: Tile): Promise<boolean> {
        const done = (s: BotWorldState) => ((s.player?.worldZ ?? 0) > UNDERGROUND_Z) === down;
        for (let attempt = 0; attempt < 5; attempt++) {
            if (done(this.state())) return true;
            if (dist(this.pos(), at) > 4) await this.walk(at.x, at.z, 2, 60_000);
            const loc = (await this.sdk.scanNearbyLocs(10))
                .filter(l => name.test(l.name) && l.optionsWithIndex.some(o => option.test(o.text)))
                .sort((a, b) => dist(a, at) - dist(b, at))[0];
            if (!loc) {
                this.ctx.log('climb: no loc', { name: String(name), at: [this.pos().x, this.pos().z] });
                await this.sdk.waitForTicks(2);
                continue;
            }
            const climbOpt = loc.optionsWithIndex.find(o => /climb/i.test(o.text) && option.test(o.text));
            const openOpt = loc.optionsWithIndex.find(o => /^open$/i.test(o.text));
            await this.bot.interactLoc(loc, (climbOpt ?? openOpt)!.text);
            if (await this.waitFor(done, 8)) return true;
        }
        return done(this.state());
    }

    /** Unlock the brass-key house door with the key, going in (`entering`) or out. */
    async throughBrassDoor(entering: boolean): Promise<boolean> {
        const inside = (s: BotWorldState) => !!s.player && inBrassHouse({ x: s.player.worldX, z: s.player.worldZ });
        for (let attempt = 0; attempt < 4; attempt++) {
            if (inside(this.state()) === entering) return true;
            if (entering && !(await this.walk(BRASS_DOOR_OUTSIDE.x, BRASS_DOOR_OUTSIDE.z, 1, 300_000))) continue;
            const door = (await this.sdk.scanNearbyLocs(6)).find(l => l.x === BRASS_DOOR.x && l.z === BRASS_DOOR.z && /door/i.test(l.name));
            if (!door) {
                await this.sdk.waitForTicks(2);
                continue;
            }
            await this.bot.useItemOnLoc(BRASS_KEY, door);
            if (await this.waitFor(s => inside(s) === entering, 8)) return true;
        }
        return inside(this.state()) === entering;
    }

    // ---- bookkeeping ----

    noteRespawn(): void {
        const p = this.state().player!;
        if (this.lastRespawnCount !== null && p.respawnCount > this.lastRespawnCount) {
            this.deaths += p.respawnCount - this.lastRespawnCount;
            this.ctx.log('died', { deaths: this.deaths, at: [p.worldX, p.worldZ] });
        }
        this.lastRespawnCount = p.respawnCount;
    }

    summary(): Record<string, unknown> {
        const hours = (Date.now() - this.startedAt) / 3_600_000;
        const bones = Object.entries(this.looted).filter(([k]) => /bones/i.test(k)).reduce((a, [, v]) => a + v, 0);
        const product = Object.entries(this.looted).filter(([k]) => this.opt.spot.bones.test(k)).reduce((a, [, v]) => a + v, 0);
        const sorted = [...this.killTicks].sort((a, b) => a - b);
        const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? null;
        return {
            kills: this.kills,
            looted: this.looted,
            eaten: this.guard.eaten,
            deaths: this.deaths,
            hours: Number(hours.toFixed(3)),
            bonesPerHour: hours > 0 ? Math.round(bones / hours) : 0,
            /** The spot's product (bones, herbs, meat) per hour. */
            productPerHour: hours > 0 ? Math.round(product / hours) : 0,
            killTicks: { n: sorted.length, p10: pct(0.1), p50: pct(0.5), p90: pct(0.9) },
            levels: ['Attack', 'Strength', 'Defence', 'Hitpoints', 'Fishing', 'Cooking'].map(s => `${s.slice(0, 2)}${this.level(s)}`).join(' ')
        };
    }

    // ---- equipment and style ----

    async equipUpgrades(): Promise<void> {
        const worn: Record<string, number> = {};
        for (const e of this.sdk.getEquipment()) {
            const r = gearRank(e.name);
            if (r) worn[r.slot] = Math.max(worn[r.slot] ?? -1, r.tier);
        }
        // The slot of the spot's required item (the anti-dragon shield) is never given up.
        const reserved = this.activeSpot.worn?.slot;
        for (const item of this.state().inventory) {
            const r = gearRank(item.name);
            if (!r || r.slot === reserved || r.tier <= (worn[r.slot] ?? -1)) continue;
            if (this.level(r.skill) < (METAL_REQ[r.metal] ?? 99)) continue;
            const res = await this.bot.equipItem(item);
            if (res.success) {
                worn[r.slot] = r.tier;
                this.ctx.log('equipped', { item: item.name });
            }
        }
    }

    async pickStyle(): Promise<void> {
        const cs = this.state().combatStyle;
        if (!cs?.styles?.length) return;
        const skills = (['Attack', 'Strength', 'Defence'] as const).filter(s => this.level(s) < this.opt.styleCap);
        if (!skills.length) return;
        const want = skills.reduce((a, b) => (this.level(b) < this.level(a) ? b : a));
        const style = cs.styles.find(s => s.trainsSkills.length === 1 && s.trainsSkills[0] === want)
            ?? cs.styles.find(s => s.trainsSkills.includes(want));
        if (style && cs.currentStyle !== style.index) {
            await this.sdk.sendSetCombatStyle(style.index);
            await this.waitFor(s => s.combatStyle?.currentStyle === style.index, 3);
        }
    }

    /** Keep one of each key; the jail key is done with once the dusty key is carried. */
    async dropSpareKeys(): Promise<void> {
        const inv = this.state().inventory;
        const seen = new Set<string>();
        for (const item of inv) {
            if (!/ key$/i.test(item.name)) continue;
            const spent = JAIL_KEY.test(item.name) && this.carrying(DUSTY_KEY);
            if (seen.has(item.name) || spent) await this.bot.dropItem(item, 1);
            seen.add(item.name);
        }
    }

    // ---- banking (kept small so it can move to speedrun/lib) ----

    /** Shantay's chest is 6 tiles from the desert side of the gate, which is not near it. */
    nearBank(): boolean { return !this.underground() && !inDesert(this.pos()) && BANKS.some(b => dist(this.pos(), b) <= 8); }

    /**
     * Open the nearest bank (walking out of the spot first if needed), deposit everything
     * except the kit, take out `withdraw`, report, close. `why` names the trigger in the log.
     */
    async bank(why: string, spot: Spot | null, withdraw: { re: RegExp; n: number }[] = []): Promise<boolean> {
        const inv = this.state().inventory;
        const carried = {
            used: inv.length,
            food: inv.filter(edible).length,
            bones: inv.filter(i => /bones$/i.test(i.name)).length
        };
        // The trip so far, measured from the bank it left to the moment it turned back.
        const t = this.trip;
        const trip = t && {
            min: Number(((Date.now() - t.at) / 60_000).toFixed(1)),
            roomMin: t.inRoomAt ? Number(((Date.now() - t.inRoomAt) / 60_000).toFixed(1)) : 0,
            foodOut: t.food,
            foodBack: carried.food,
            eats: this.guard.eats - t.eats,
            kills: this.kills - t.kills
        };
        if (!this.nearBank()) {
            const exit = this.locationSpot();
            const ok = exit ? await exit.leave(this) : await this.walkToNearestBank();
            if (!ok) return false;
        }
        const open = await this.bot.openBank();
        // Only the bank's own state says its contents are loaded. Depositing into, or reading,
        // any other window leaves the bank looking empty to the food stages and the ledger.
        if (!open.success || !(await this.waitFor(s => s.bank.isOpen, 5))) {
            this.ctx.log('bank: open failed', { why, reason: open.success ? 'bank interface not open' : open.message });
            if (this.state().interface.isOpen) await this.bot.closeInterface();
            return false;
        }
        const lv = { fishing: this.level('Fishing'), cooking: this.level('Cooking') };
        // Food is kept for the next trip, but food banknotes (from the exchange) go in to be
        // un-noted, and without fishing the fishing kit and raw fish only cost slots.
        const fishingKit = (n: string) => ROD.test(n) || FEATHER.test(n) || RAW_FISH.test(n) || NET.test(n) || NET_FISH.test(n);
        const fishing = this.fishing();
        // Al Kharid's only way out to the west is the toll gate, which walkOnce pays from carried
        // coins: a bank visit east of it keeps (or takes out) the toll.
        const toll = tollWithdraw(this.pos());
        withdraw = [...withdraw, ...toll];
        const keep = (i: InventoryItem) => (this.opt.spot.keep?.test(i.name) ?? false) || (toll.length > 0 && COINS.test(i.name)) ||
            i.id === this.opt.spot.worn?.id ||
            (keepOnBank(i.name, lv, this.opt.spot.requires) && !(FOOD.test(i.name) && !edible(i)) && (fishing || !fishingKit(i.name)));
        const seen = new Set<number>();
        for (const item of this.state().inventory) {
            if (seen.has(item.id) || keep(item)) continue;
            seen.add(item.id);
            await this.bot.depositItem(item, -1);
        }
        for (const { id, n } of foodOverCap(this.state().inventory, this.opt.keepFood)) {
            const item = this.state().inventory.find(i => i.id === id);
            if (item) await this.bot.depositItem(item, n);
        }
        for (const w of withdraw) {
            const have = this.state().inventory.filter(i => w.re.test(i.name) && (!FOOD.test(i.name) || edible(i))).reduce((a, i) => a + i.count, 0);
            const item = this.sdk.getBankItems().find(b => w.re.test(b.name));
            if (item && have < w.n) await this.bot.withdrawItem(item, Math.min(item.count, w.n - have));
        }
        if (this.opt.spot.wieldBanked) {
            for (const b of this.sdk.getBankItems()) {
                if (this.freeSlots() === 0 || !this.upgrade(b.name)) continue;
                await this.bot.withdrawItem(b, 1);
                await this.waitFor(s => s.inventory.some(i => i.id === b.id), 3);
                this.ctx.log('gear out of the bank', { item: b.name });
            }
        }
        const items = this.sdk.getBankItems().map(b => ({ id: b.id, name: b.name, count: b.count }));
        this.bankView = new Map(items.map(i => [i.name, i.count]));
        this.ctx.reportBank({ items });
        const bones = items.filter(i => /bones/i.test(i.name)).map(i => `${i.name} ${i.count}`).join(', ');
        const food = this.opt.food === 'ge' ? { foodBanked: this.banked(this.foodRe), coinsBanked: this.banked(/^coins$/i) } : {};
        this.ctx.log('banked', { why, carried, trip, ...food, stock: bones || 'no bones', ...this.summary() });
        await this.bot.closeBank();
        if (this.activeSpot !== this.opt.spot) {
            this.logDowngrade('bank trip; retrying preferred spot');
            this.activeSpot = this.opt.spot;
            this.acquireSince = null;
            this.requirementBankChecked = false;
        }
        this.trip = { at: Date.now(), food: this.food().length, eats: this.guard.eats, kills: this.kills, inRoomAt: null };
        return true;
    }

    async walkToNearestBank(): Promise<boolean> {
        const b = BANKS.slice().sort((a, c) => dist(this.pos(), a) - dist(this.pos(), c))[0]!;
        return this.walk(b.x, b.z, 3, 300_000);
    }

    async rest(): Promise<void> {
        this.ctx.log('resting', { hp: Number(this.hpFrac().toFixed(2)) });
        while (!this.aborted() && this.hpFrac() < this.opt.restUntil && this.food().length === 0) {
            await this.sdk.waitForTicks(10);
            await this.bot.dismissBlockingUI();
        }
    }

    // ---- fighting ----

    pickTarget(t: Target): NearbyNpc | null {
        const s = this.state();
        const candidates = s.nearbyNpcs.filter(n =>
            t.npc.test(n.name) && n.hp !== 0 && inBox(t.area, n.x, n.z) &&
            n.optionsWithIndex.some(o => /attack/i.test(o.text)));
        // An NPC already on us comes first (giants aggress); otherwise skip ones in someone else's fight.
        const combat = s.player!.combat;
        const onMe = candidates.filter(n => n.inCombat && combat.inCombat && combat.targetType === 'npc' && combat.targetIndex === n.index);
        if (onMe.length) return onMe.sort((a, b) => a.distance - b.distance)[0] ?? null;
        const crowded = (n: NearbyNpc) => s.nearbyPlayers.filter(p =>
            Math.max(Math.abs((p.worldX ?? p.x) - n.x), Math.abs((p.worldZ ?? p.z) - n.z)) <= 1).length > this.opt.maxPlayersNearTarget;
        return candidates.filter(n => !n.inCombat && !crowded(n)).sort((a, b) => a.distance - b.distance)[0] ?? null;
    }

    async fight(t: Target): Promise<Outcome> {
        const target = this.pickTarget(t);
        if (!target) return 'none';
        await this.pickStyle();
        const atk = await this.bot.attack(target);
        if (!atk.success) {
            await this.sdk.waitForTicks(1);
            return 'lost';
        }
        let last: Tile = { x: target.x, z: target.z };
        const startTick = this.state().tick;
        const deadline = Date.now() + 120_000;
        let idleTicks = 0;
        let eatsSeen = this.guard.eats;
        while (Date.now() < deadline && !this.aborted()) {
            await this.sdk.waitForTicks(1);
            const s = this.state();
            if (s.player!.isDead) return 'lost';
            if (this.hpFrac() < this.opt.fleeAt && this.food().length === 0) return 'flee';
            if (this.guard.eats !== eatsSeen) {
                // The guard ate, which clears the attack (OPHELD clears the interaction); re-engage.
                eatsSeen = this.guard.eats;
                const again = s.nearbyNpcs.find(n => n.index === target.index);
                if (again && again.hp !== 0) await this.bot.attack(again);
            }
            const npc = this.state().nearbyNpcs.find(n => n.index === target.index);
            if (!npc) break; // despawned: dead (or out of view)
            last = { x: npc.x, z: npc.z };
            if (npc.hp === 0) {
                await this.waitFor(st => !st.nearbyNpcs.some(n => n.index === target.index), 6);
                break;
            }
            if (!s.player!.combat.inCombat && !npc.inCombat) {
                if (++idleTicks > 8) return 'lost';
            } else idleTicks = 0;
        }
        this.kills++;
        this.killTicks.push(this.state().tick - startTick);
        if (this.kills % 25 === 0) this.ctx.log('progress', this.summary());
        return t.loot ? this.loot(t.loot, last) : 'killed';
    }

    async loot(want: RegExp, at: Tile): Promise<Outcome> {
        await this.sdk.waitForTicks(1);
        // Keys are needed once; other players' spares lie around the dragon room.
        const wanted = (g: GroundItem) => (lootWanted(g, want, this.opt.skipIds) && !(/ key$/i.test(g.name) && this.carrying(exact(g.name)))) || this.upgrade(g.name);
        const bonesFirst = (g: GroundItem) => Number(/bones/i.test(g.name));
        for (let pass = 0; pass < 6; pass++) {
            const g = (await this.sdk.scanGroundItems(6))
                .filter(i => wanted(i) && dist(i, at) <= 2)
                .sort((a, b) => bonesFirst(b) - bonesFirst(a))[0];
            if (!g) return 'killed';
            const stacks = this.state().inventory.some(i => i.id === g.id) && /^(coins|.+ rune|feather)$/i.test(g.name);
            if (this.freeSlots() === 0 && !stacks) {
                // Make room by eating when the meal would not be wasted, or, for bones, by dropping
                // a self-caught fish the trip will not need (cheap, unlike a bank walk; bought food
                // is never dropped). Otherwise the trip is over.
                const f = this.food()[0];
                const hp = this.sdk.getSkill('Hitpoints');
                const missing = hp ? hp.baseLevel - hp.level : 0;
                if (f && missing >= healOf(f.name) - 2) await this.bot.eatFood(f);
                else if (/bones/i.test(g.name) && this.fishing() && this.food().length > this.opt.minFood + this.opt.spareFood) {
                    const f = this.food()[0]!;
                    await this.bot.dropItem(exact(f.name), 1);
                    await this.waitFor(s => s.inventory.length < 28, 3);
                }
                if (this.freeSlots() === 0) return 'full';
            }
            const before = this.sdk.countInventoryItems(exact(g.name));
            const r = await this.bot.pickupItem(g);
            const after = this.sdk.countInventoryItems(exact(g.name));
            if (after > before) {
                this.looted[g.name] = (this.looted[g.name] ?? 0) + (after - before);
                this.lootedById[g.id] = (this.lootedById[g.id] ?? 0) + (after - before);
            } else if (!r.success) return 'killed';
        }
        return 'killed';
    }

    upgrade(name: string): boolean {
        const r = gearRank(name);
        if (!r || r.slot === this.activeSpot.worn?.slot || this.level(r.skill) < (METAL_REQ[r.metal] ?? 99)) return false;
        let best = -1;
        for (const e of [...this.sdk.getEquipment(), ...this.state().inventory]) {
            const w = gearRank(e.name);
            if (w && w.slot === r.slot) best = Math.max(best, w.tier);
        }
        return r.tier > best;
    }

    /** Kill and loot inside a box on the surface (training, feathers); walks in first. */
    async surfaceFight(t: Target): Promise<void> {
        const p = this.pos();
        if (this.underground() || !inBox(t.area, p.x, p.z)) {
            if (this.underground()) {
                await this.bank('surface', this.opt.spot);
                return;
            }
            await this.walk(t.centre.x, t.centre.z, 4, 300_000);
            return;
        }
        const out = await this.fight(t);
        if (out === 'none') await this.sdk.waitForTicks(3);
    }

    // ---- fishing kit and food ----

    /** Net fish at Draynor until Fishing 20 (fly fishing); the catch is dropped. */
    async netFish(): Promise<void> {
        if (!this.carrying(/^small fishing net$/i)) {
            if (this.banked(/^small fishing net$/i) > 0 || this.bankView === null) {
                await this.bank('fetch net', null, [{ re: /^small fishing net$/i, n: 1 }]);
                if (this.carrying(/^small fishing net$/i)) return;
            }
            this.stopFishing('no small fishing net');
            return;
        }
        if (dist(this.pos(), DRAYNOR_NET) > 8) {
            await this.walk(DRAYNOR_NET.x, DRAYNOR_NET.z, 3, 300_000);
            return;
        }
        await this.fishLoop(/^fishing spot$/i, /^net$/i, NET_FISH, () => this.level('Fishing') >= 20, DRAYNOR_NET);
    }

    /** Net a handful of shrimps at Draynor so the first cooking levels (trout needs 15) come from food that cooks at 1. */
    async netForCooking(spot: Spot): Promise<void> {
        if (!this.carrying(NET)) {
            await this.bank('fetch net', this.underground() ? spot : null, [{ re: NET, n: 1 }]);
            if (!this.carrying(NET)) this.stopFishing('no small fishing net for cooking practice');
            return;
        }
        if (this.underground()) {
            await spot.leave(this);
            return;
        }
        if (dist(this.pos(), DRAYNOR_NET) > 8) {
            await this.walk(DRAYNOR_NET.x, DRAYNOR_NET.z, 3, 300_000);
            return;
        }
        await this.fishLoop(/^fishing spot$/i, /^net$/i, NET_FISH, () => this.carried(NET_FISH) >= 10 || this.freeSlots() === 0, DRAYNOR_NET);
    }

    /** Buy a fly fishing rod (and feathers with spare coins) from Gerrant in Port Sarim. */
    async buyRod(): Promise<void> {
        const coins = () => this.carried(/^coins$/i);
        if (coins() < 5) {
            await this.bank('fetch coins', null, [{ re: /^coins$/i, n: 1_000_000 }]);
            if (coins() < 5) this.stopFishing('no coins for a fly fishing rod');
            return;
        }
        if (dist(this.pos(), GERRANT) > 4) {
            await this.walk(GERRANT.x, GERRANT.z, 2, 300_000);
            return;
        }
        const open = await this.bot.openShop(/gerrant/i);
        if (!open.success) {
            this.ctx.log('gerrant: shop did not open', { reason: open.message });
            await this.sdk.waitForTicks(5);
            return;
        }
        await this.bot.buyFromShop(ROD, 1);
        const spare = coins() - 50;
        if (spare >= 2) await this.bot.buyFromShop(FEATHER, Math.min(500, Math.floor(spare / 2)));
        await this.bot.closeShop();
        this.ctx.log('bought fishing kit', { rod: this.carrying(ROD), feathers: this.carried(FEATHER) });
    }

    /** Fly fish at Barbarian Village until fishPerTrip raw fish or a full inventory. */
    async flyFish(): Promise<void> {
        if (dist(this.pos(), BARBARIAN_FISH) > 12) {
            await this.walk(BARBARIAN_FISH.x, BARBARIAN_FISH.z, 4, 300_000);
            return;
        }
        const target = this.carried(RAW_FISH) + Math.min(this.freeSlots(), this.opt.fishPerTrip - this.carried(RAW_FISH) - this.food().length);
        await this.fishLoop(/^fishing spot$/i, /^lure$/i, RAW_FISH,
            () => this.carried(RAW_FISH) >= target || this.freeSlots() === 0 || !this.carrying(FEATHER), BARBARIAN_FISH);
    }

    async fishLoop(spotName: RegExp, option: RegExp, catchRe: RegExp, done: () => boolean, home: Tile): Promise<void> {
        let idle = 0;
        let lastXp = this.sdk.getSkillXp('Fishing') ?? 0;
        const deadline = Date.now() + 10 * 60_000;
        while (!done() && !this.aborted() && Date.now() < deadline) {
            if (this.state().dialog.isOpen) await this.bot.dismissBlockingUI();
            if (this.freeSlots() === 0 && catchRe === NET_FISH) {
                if (this.level('Cooking') < 15) break; // keep them for cooking practice
                await this.bot.dropItem(NET_FISH, 'all');
                continue;
            }
            const xp = this.sdk.getSkillXp('Fishing') ?? 0;
            if (xp > lastXp) { lastXp = xp; idle = 0; }
            const fishing = (this.state().player!.animId ?? -1) !== -1;
            if (!fishing || idle > 30) {
                const spot = this.state().nearbyNpcs.filter(n => spotName.test(n.name) && n.optionsWithIndex.some(o => option.test(o.text)))
                    .sort((a, b) => a.distance - b.distance)[0];
                if (!spot) {
                    await this.walk(home.x, home.z, 3, 60_000);
                    await this.sdk.waitForTicks(3);
                    continue;
                }
                await this.bot.interactNpc(spot, option);
                idle = 0;
            }
            await this.sdk.waitForTicks(2);
            idle += 2;
        }
        if (catchRe === NET_FISH && this.carrying(NET_FISH) && this.level('Cooking') >= 15) await this.bot.dropItem(NET_FISH, 'all');
    }

    /**
     * Cook every raw catch the Cooking level allows on the Barbarian Village fire, lowest
     * requirement first so shrimps and trout level the cook up for the salmon. Raw fish
     * still above the level afterwards is dropped; so is anything burnt.
     */
    async cook(): Promise<void> {
        if (!inBox(LONGHALL, this.pos().x, this.pos().z)) {
            await this.walk(BARBARIAN_FIRE.x, BARBARIAN_FIRE.z, 0, 300_000);
            return;
        }
        const raw = () => this.state().inventory
            .filter(i => (RAW_FISH.test(i.name) || NET_FISH.test(i.name)) && (COOK_REQ[i.name.toLowerCase()] ?? 99) <= this.level('Cooking'))
            .sort((a, b) => (COOK_REQ[a.name.toLowerCase()] ?? 99) - (COOK_REQ[b.name.toLowerCase()] ?? 99))[0];
        let stuck = 0;
        let item: InventoryItem | undefined;
        while ((item = raw()) && !this.aborted() && stuck < 5) {
            if (this.state().dialog.isOpen) await this.bot.dismissBlockingUI();
            const fire = (await this.sdk.scanNearbyLocs(5)).filter(l => /^fire$/i.test(l.name))
                .sort((a, b) => Number(b.reachable !== false) - Number(a.reachable !== false) || a.distance - b.distance)[0];
            if (!fire) break;
            const before = this.state().inventory.length;
            const slotBefore = item.slot;
            await this.bot.useItemOnLoc(item, fire);
            const changed = await this.waitFor(s => s.inventory.find(i => i.slot === slotBefore)?.name !== item!.name || s.inventory.length !== before, 6);
            stuck = changed ? 0 : stuck + 1;
        }
        if (this.state().dialog.isOpen) await this.bot.dismissBlockingUI();
        const uncookable = this.state().inventory.filter(i => (RAW_FISH.test(i.name) || NET_FISH.test(i.name)) && (COOK_REQ[i.name.toLowerCase()] ?? 99) > this.level('Cooking'));
        for (const name of new Set(uncookable.map(i => i.name))) await this.bot.dropItem(exact(name), 'all');
        if (this.carrying(/^burnt /i)) await this.bot.dropItem(/^burnt /i, 'all');
        this.ctx.log('cooked', { food: this.food().length, stuck, levels: this.summary().levels });
    }

    // ---- food from the Grand Exchange ----

    private askCache: { at: number; ask: number | null } | null = null;

    /** The exchange's current ask for the food (cached 10 minutes), or null when unknown. */
    async foodAsk(): Promise<number | null> {
        if (this.askCache && Date.now() - this.askCache.at < 10 * 60_000) return this.askCache.ask;
        let ask: number | null = null;
        try {
            const { id } = await this.buyer.resolveItem(this.opt.foodItem);
            ask = (await this.sdk.getMarketItem(id)).ask;
        } catch (e) {
            this.ctx.log('market read failed', { item: this.opt.foodItem, error: String(e) });
        }
        this.askCache = { at: Date.now(), ask };
        return ask;
    }

    /**
     * GE food, with fewer than minFood carried. In order: take a trip's worth from the bank
     * when it holds one; buy at the exchange when the coins cover half a trip; take whatever is
     * banked; wait at Varrock West for coins (coinsFrom); and after coinWaitMin catch fish
     * for 30 minutes.
     */
    async geFood(spot: Spot): Promise<void> {
        const stock = this.banked(this.foodRe);
        if (this.bankView === null || stock >= this.opt.foodPerTrip) {
            this.phase('food:bank');
            await this.bank('out of food', spot, this.tripKit());
            return;
        }
        const coins = this.banked(/^coins$/i) + this.carried(/^coins$/i);
        const price = Math.min(this.foodPrice ?? (await this.foodAsk()) ?? this.opt.maxFoodPrice, this.opt.maxFoodPrice);
        // Half a trip's worth is enough to make the exchange visit worth it.
        if (Date.now() >= this.geRetryAt && coins >= price * Math.ceil(this.opt.foodPerTrip / 2)) {
            this.phase('food:buy');
            await this.buyFood(spot);
            return;
        }
        if (stock > 0) {
            this.phase('food:bank');
            await this.bank('out of food, last of the stock', spot, this.tripKit());
            return;
        }
        if (this.offerOpen) {
            // A bid is resting on the exchange with our coins in escrow: look again shortly.
            this.phase('food:offer');
            if (Date.now() >= this.geRetryAt) await this.buyFood(spot);
            else await this.sdk.waitForTicks(10);
            return;
        }
        const fishingUnavailable = Date.now() < this.fishingRetryAt;
        if (this.opt.coinsFrom && (fishingUnavailable || this.coinWaitSince === 0 || Date.now() - this.coinWaitSince < this.opt.coinWaitMin * 60_000)) {
            this.phase('food:coins');
            await this.waitForCoins(spot);
            return;
        }
        if (fishingUnavailable) {
            this.phase('food:wait');
            if (!BANKS.some(bank => dist(this.pos(), bank) <= 4)) await this.bank('fishing unavailable', this.locationSpot());
            await this.sdk.waitForTicks(10);
            return;
        }
        this.ctx.log('no food banked and no coins for more; catching fish for 30 minutes', { coins, price, stock });
        this.coinWaitSince = 0;
        this.fishUntil = Date.now() + 30 * 60_000;
    }

    /** Whether a buy offer for the food was left resting on the exchange at the last visit. */
    private offerOpen = false;

    /**
     * Collect whatever the exchange holds for this account (fills of a resting bid land while
     * it is away). Buyer.buyAtGE does not count uncollected items as held, and a filled offer
     * no longer counts as open, so without this a second visit would buy the whole lot again.
     */
    async collectExchange(): Promise<void> {
        const opened = await this.bot.openGE();
        if (!opened.success) return;
        const offers = this.sdk.getGEState()?.offers ?? [];
        if (offers.some(o => o.items > 0 || o.coins > 0)) {
            const c = await this.bot.collectGE();
            this.ctx.log('exchange collected', { items: c.items, coins: c.coins, result: c.message });
        }
        await this.bot.closeInterface();
    }

    /**
     * Bank the haul, walk to Varrock West, take every coin out, collect earlier fills, buy up to
     * `buyFood` held at the exchange (at the ask, never above maxFoodPrice; above it a bid rests
     * at maxFoodPrice), bank the banknotes and take a trip's worth.
     */
    async buyFood(spot: Spot): Promise<void> {
        if (this.underground() || this.carrying(spot.bones)) {
            await this.bank('out of food', spot);
            return;
        }
        if (dist(this.pos(), VARROCK_WEST_BANK) > 4) {
            await this.walk(VARROCK_WEST_BANK.x, VARROCK_WEST_BANK.z, 3, 600_000);
            return;
        }
        if (!(await this.bank('buy food', null, [{ re: /^coins$/i, n: 2_000_000_000 }]))) return;
        const coins = this.carried(/^coins$/i);
        try {
            await this.collectExchange();
            // The target is what the inventory holds (banknotes included): the bank holds less
            // than a trip, or this visit would not have happened.
            const rep = await this.buyer.buyAtGE({ item: this.opt.foodItem, quantity: this.opt.buyFood, source: 'ge', maxPrice: this.opt.maxFoodPrice });
            if (rep.bought > 0 && rep.spent > 0) this.foodPrice = Math.round(rep.spent / rep.bought);
            this.offerOpen = !!rep.restingOffer;
            // Resting bid: look again in 3 minutes. Nothing bought and nothing resting: 10.
            this.geRetryAt = rep.restingOffer ? Date.now() + 3 * 60_000 : rep.bought > 0 || rep.note === 'already held' ? 0 : Date.now() + 10 * 60_000;
            this.ctx.log('bought food', { ...rep, coinsCarried: coins });
        } catch (e) {
            this.geRetryAt = Date.now() + 10 * 60_000;
            this.ctx.log('buy food failed', { error: String(e) });
            if (this.state().interface.isOpen) await this.bot.closeInterface();
        }
        await this.bank('bought food', null, this.tripKit());
    }

    /** Fresh trade-request messages are read once each; keyed like the mule's chat cursor. */
    private tradeRequestsSeen = -1;

    /**
     * Stand at Varrock West bank, where couriers deliver, and take coins by trade from an
     * account matching coinsFrom. The offer must be coins or the food item (as banknotes or
     * not) and nothing else; this account gives nothing, and a trade with anyone else is declined.
     */
    async waitForCoins(spot: Spot): Promise<void> {
        const from = this.opt.coinsFrom!;
        if (this.underground() || this.carrying(spot.bones)) {
            await this.bank('fetch coins', spot);
            return;
        }
        if (dist(this.pos(), VARROCK_WEST_BANK) > 2) {
            await this.walk(VARROCK_WEST_BANK.x, VARROCK_WEST_BANK.z, 1, 600_000);
            return;
        }
        if (this.coinWaitSince === 0) {
            this.coinWaitSince = Date.now();
            this.ctx.log('waiting for coins', { from: from.source, minutes: this.opt.coinWaitMin, at: [this.pos().x, this.pos().z] });
        }
        const s = this.state();
        const key = (m: { observationId?: number; tick: number }) => m.observationId ?? m.tick;
        const requests = this.sdk.getChat({ types: [TRADE_REQUEST_CHAT_TYPE], limit: 20 });
        const fresh = requests.filter(m => key(m) > this.tradeRequestsSeen && accountMatches(m.sender, from));
        this.tradeRequestsSeen = requests.reduce((a, m) => Math.max(a, key(m)), this.tradeRequestsSeen);
        const openWith = s.trade?.isOpen ? (s.trade.partner ?? '') : null;
        if (openWith !== null && !accountMatches(openWith, from)) {
            await this.bot.declineTrade();
            return;
        }
        const partner = openWith ?? fresh.at(-1)?.sender;
        if (!partner) {
            await this.sdk.waitForTicks(5);
            return;
        }
        const opened = await openTrade(this.sdk, partner, { timeoutMs: 20_000 });
        if (!opened.ok) {
            this.ctx.log('coin trade did not open', { from: partner, reason: opened.reason });
            return;
        }
        const coinsBefore = this.carried(/^coins$/i);
        const foodBefore = this.carried(this.foodRe);
        const r = await this.bot.trade(playerPattern(partner), {
            accept: offer => offer.length > 0 && offer.every(i => /^coins$/i.test(i.name) || this.foodRe.test(i.name)),
            rejectAfterMs: 30_000,
            timeout: 90_000,
            requestTimeout: 5_000
        });
        const coins = this.carried(/^coins$/i) - coinsBefore;
        const food = this.carried(this.foodRe) - foodBefore;
        this.ctx.log('coins received', { from: partner, success: r.success, result: r.message, coins, food });
        if (coins > 0 || food > 0) {
            this.coinWaitSince = 0;
            this.geRetryAt = 0;
            await this.bank('coins received', null);
        }
    }

    logDowngrade(reason: string): void {
        this.ctx.log('phase', {
            to: 'downgrade', from: this.opt.spot.id, fallback: this.activeSpot.id, reason,
            inventory: this.state().inventory.map(i => ({ name: i.name, count: i.count })),
            bank: this.bankView ? Object.fromEntries(this.bankView) : null
        });
    }

    async ensureRequirement(spot: Spot): Promise<boolean> {
        if (!spot.requires) return true;
        if (!this.carrying(spot.requires)) {
            await waitForFreshState(this.sdk, { timeoutMs: 15_000, signal: this.ctx.signal });
        }
        if (this.carrying(spot.requires)) {
            this.acquireSince = null;
            this.requirementBankChecked = false;
            return true;
        }
        // A cached empty bank is not proof of a lost key. Re-open it once per recovery,
        // and never treat a failed bank visit or withdrawal as a missing requirement.
        if (!this.requirementBankChecked || this.banked(spot.requires) > 0) {
            if (await this.bank('fetch requirement', spot, [{ re: spot.requires, n: 1 }, ...this.tripKit()])) {
                this.requirementBankChecked = true;
            }
            return false;
        }
        this.acquireSince ??= Date.now();
        if (spot.acquire && Date.now() - this.acquireSince < 30 * 60_000) {
            this.phase(`acquire:${spot.id}`);
            await spot.acquire(this);
            return false;
        }
        this.activeSpot = HILL_GIANTS;
        this.logDowngrade('requirement recovery exhausted');
        return false;
    }

    /**
     * Wear the spot's `worn` item before any trip: equip it when carried, take it out when banked
     * (the bank visit leaves the dungeon first), and with none owned wait at the bank, looking in
     * it again every 5 minutes. False until it is worn; the spot is never entered without it.
     */
    async ensureWorn(spot: Spot): Promise<boolean> {
        const w = spot.worn;
        if (!w || this.wearing(w)) return true;
        const held = this.state().inventory.find(i => i.id === w.id);
        if (held) {
            await this.bot.equipItem(held);
            await this.waitFor(() => this.wearing(w), 3);
            this.ctx.log('equipped', { item: held.name, worn: this.wearing(w) });
            return this.wearing(w);
        }
        if (this.bankView === null || this.banked(w.name) > 0 || Date.now() >= this.wornLookAt) {
            this.wornLookAt = Date.now() + 5 * 60_000;
            await this.bank(`fetch item ${w.id}`, spot, this.tripKit());
            if (!this.owns(w.name)) this.ctx.log(`${spot.id}: item ${w.id} is not worn, carried or banked; staying out of the spot`);
            return false;
        }
        this.phase(`wait:item ${w.id}`);
        await this.sdk.waitForTicks(10);
        return false;
    }

    /** Next stop on the spot's patrol loop. */
    patrolIndex = 0;

    async patrolStep(route: Tile[]): Promise<void> {
        let t = route[this.patrolIndex % route.length]!;
        if (dist(this.pos(), t) <= 3) t = route[++this.patrolIndex % route.length]!;
        await this.walk(t.x, t.z, 2, 120_000);
    }

    // ---- the cycle ----

    trainingDone(): boolean { return ['Attack', 'Strength', 'Defence'].every(s => this.level(s) >= this.opt.train); }

    inTutorial(): boolean {
        const p = this.state().player!;
        return p.level === 0 && p.worldX >= 3050 && p.worldX <= 3160 && p.worldZ >= 3050 && p.worldZ <= 3135;
    }

    async cycle(): Promise<void> {
        const s = this.state();
        if (s.modalInterface === 3559 || this.inTutorial()) {
            const r = await this.bot.skipTutorial();
            this.ctx.log('tutorial skipped', { ok: r.success, detail: r.message });
            await this.sdk.waitForTicks(3);
            return;
        }
        await this.bot.dismissBlockingUI();
        if (this.sdk.isBankOpen() || s.shop?.isOpen) await this.bot.closeInterface();
        this.noteRespawn();
        await this.equipUpgrades();

        // 2. Train on cows (they never hurt).
        if (!this.trainingDone()) {
            this.phase('train');
            await this.surfaceFight({ npc: /^cow$/i, area: COW_FIELD, centre: COW_CENTRE, loot: null });
            return;
        }

        // 3. Fishing kit. Coins come from the spot's drops if the starting 25 are gone.
        const fishing = this.fishing();
        if (fishing && this.bankView === null && !this.carrying(ROD)) {
            await this.bank('first look', this.locationSpot());
            return;
        }
        if (fishing && !this.owns(ROD)) {
            if (this.level('Fishing') < 20) {
                this.phase('kit:net');
                await this.netFish();
            } else {
                this.phase('kit:rod');
                await this.buyRod();
            }
            return;
        }
        if (fishing && !this.owns(FEATHER) && !this.carrying(RAW_FISH) && this.food().length < this.opt.minFood) {
            this.phase('kit:feathers');
            const feathers: Target = { npc: /^chicken$/i, area: CHICKEN_COOP, centre: { x: 3230, z: 3298 }, loot: FEATHER };
            while (!this.aborted() && this.carried(FEATHER) < this.opt.feathers && this.freeSlots() > 0) {
                await this.surfaceFight(feathers);
                if (this.underground()) return;
            }
            this.ctx.log('collected feathers', { feathers: this.carried(FEATHER) });
            return;
        }

        const spot = this.activeSpot;
        if (fishing && this.level('Cooking') < 15) {
            this.phase('kit:cook');
            if (this.carried(NET_FISH) >= 6 || (this.carrying(NET_FISH) && this.freeSlots() === 0)) {
                if (this.underground()) await spot.leave(this);
                await this.cook();
            } else if (this.carrying(RAW_FISH)) {
                await this.bot.dropItem(RAW_FISH, 'all'); // trout/salmon this cook cannot cook yet
            } else {
                await this.netForCooking(spot);
            }
            return;
        }
        // GE food before the spot's requirement: fetching it (the Jailer, the dungeon walk) needs
        // food too. A fresh helper at 60 combat reached the Jailer with none and fought at half hp.
        if (this.foodSource() === 'ge' && this.food().length < this.opt.minFood) {
            await this.geFood(spot);
            return;
        }
        if (!(await this.ensureRequirement(spot))) return;
        if (!(await this.ensureWorn(spot))) return;

        // 4. Food (GE food was handled above, before the requirement).
        if (fishing && this.carrying(RAW_FISH) && (this.food().length < this.opt.minFood || !this.underground())) {
            this.phase('food:cook');
            if (this.underground()) await spot.leave(this);
            await this.cook();
            return;
        }
        if (fishing && this.food().length < this.opt.minFood) {
            this.phase('food:fish');
            if (fishingHaul(this.state().inventory, spot) || !this.carrying(ROD) || !this.carrying(FEATHER) || this.freeSlots() < 8) {
                await this.bank('out of food', spot, this.tripKit());
                return;
            }
            if (this.underground()) {
                await spot.leave(this);
                return;
            }
            await this.flyFish();
            return;
        }

        // 5. Bones.
        this.phase(`bones:${spot.id}`);
        if (this.hpFrac() < this.opt.fleeAt && this.food().length === 0) {
            await this.bank('low hp, no food', spot);
            await this.rest();
            return;
        }
        for (const name of new Set(this.state().inventory.filter(i => isClutter(i.name, this.level('Cooking'))).map(i => i.name))) {
            await this.bot.dropItem(exact(name), 'all');
        }
        await this.dropSpareKeys();
        if (this.freeSlots() === 0) {
            await this.bank('full', spot, this.tripKit());
            return;
        }
        if (carryReached(this.state().inventory, spot.bones, this.opt.maxCarry)) {
            await this.bank('carry', spot, this.tripKit());
            return;
        }
        const p = this.pos();
        if (!(spot.inside ? spot.inside(this) : inBox(spot.area, p.x, p.z))) {
            if (!(await spot.enter(this))) {
                this.ctx.log('could not reach spot', { spot: spot.id, at: [this.pos().x, this.pos().z] });
                await this.sdk.waitForTicks(5);
            }
            return;
        }
        if (this.trip && this.trip.inRoomAt === null) this.trip.inRoomAt = Date.now();
        if (spot.room && roomFull(spot.room, this.state().nearbyPlayers)) {
            // Full: stand back outside every target's reach and look again after a random pause,
            // so two helpers that back off together do not come back together.
            if (this.roomFullSince === 0) {
                this.roomFullSince = Date.now();
                this.ctx.log('room full; waiting', { spot: spot.id, players: this.state().nearbyPlayers.map(p => p.name) });
            }
            const w = spot.room.wait;
            if (dist(this.pos(), w) > 1) await this.walk(w.x, w.z, 1, 60_000);
            else await this.sdk.waitForTicks(15 + Math.floor(Math.random() * 20));
            return;
        }
        this.roomFullSince = 0;
        await spot.upkeep?.(this);
        const tick0 = this.state().tick;
        const out = await this.fight({ npc: spot.npc, area: spot.area, centre: spot.centre, loot: new RegExp(`${spot.bones.source}|${this.opt.loot.source}`, 'i') });
        if (this.opt.trace) {
            const live = this.state().nearbyNpcs.filter(n => spot.npc.test(n.name) && n.hp !== 0 && inBox(spot.area, n.x, n.z));
            this.ctx.log('fight', {
                out, ticks: this.state().tick - tick0, at: [this.pos().x, this.pos().z], hp: Number(this.hpFrac().toFixed(2)),
                live: live.length, busy: live.filter(n => n.inCombat).length, players: this.state().nearbyPlayers.length
            });
        }
        if (out === 'none') {
            // Everything is dead or taken: walk the patrol, or drift back to the centre and wait for respawns.
            if (spot.patrol?.length) await this.patrolStep(spot.patrol);
            else if (dist(this.pos(), spot.centre) > 6) await this.walk(spot.centre.x, spot.centre.z, 4, 60_000);
            else await this.sdk.waitForTicks(3);
        } else if (out === 'flee') {
            this.ctx.log('fleeing', { hp: Number(this.hpFrac().toFixed(2)) });
            await this.bank('fled', spot);
            if (this.foodSource() === 'none') await this.rest();
        } else if (out === 'full') {
            await this.bank('full', spot, this.tripKit());
        }
    }
}

export const role: Role = {
    name: 'bones',
    produces: [/bones$/i],
    async run(ctx: RoleContext): Promise<void> {
        const opt = parseOptions(ctx.options);
        await ctx.sdk.waitForReady(60_000);
        const run = new Run(ctx, opt);
        ctx.log('start', { spot: opt.spot.id, train: opt.train, food: opt.food, foodPerTrip: opt.foodPerTrip, coinsFrom: opt.coinsFrom?.source ?? null, ...run.summary() });
        run.guard.start();
        let errors = 0;
        try {
            while (!ctx.signal.aborted) {
                try {
                    await run.cycle();
                    errors = 0;
                } catch (e) {
                    errors++;
                    ctx.log('cycle error', { error: String(e), errors });
                    await new Promise(r => setTimeout(r, Math.min(30_000, 1000 * errors)));
                }
            }
        } finally {
            run.guard.stop();
        }
        ctx.log('stopped', run.summary());
    }
};

if (import.meta.main) await runStandalone(role);
