// Adult blue dragons from a safe tile: dragon bones (72 base Prayer xp) in Taverley
// dungeon, with magic, taking no damage.
//
//   bun speedrun/helpers/dragons.ts <account>
//   ROLE_OPTIONS='{"train":40,"lawMax":3500}' bun speedrun/helpers/dragons.ts <account>
//
// Steps, chosen afresh from observed state every cycle (decideStep), so the role
// resumes from anywhere: tutorial -> melee on cows (hitpoints and defence for the
// walk in) -> wait at Varrock West for coins -> buy a staff of air and runes -> wind
// spells on cows to Magic 41 -> dusty key (bones.ts, the Jailer killed with wind blast) ->
// down the Taverley ladder, through the dusty-key door and along SAFE_ROUTE -> cast from
// SAFE_TILE, telegrab the bones -> bank at Falador West. From Magic `guild` the runes
// come from the Magic Guild in Yanille, over White Wolf Mountain (off while it is drained).
// Magic trains on the dragons themselves: every cast pays its xp, splash or not
// (player_magic.rs2 pvm_spell_cast), and the tile takes no damage at any level.
//
// Why a tile can be safe (server/engine/src/engine/entity/Npc.ts): every NPC mode
// that has a target first runs validateTarget(), and for an op-trigger NPC that
// fails once the target stands more than maxrange + 1 tiles (Chebyshev, the
// target's SW tile against the NPC's spawn tile) from where the NPC spawned. The
// NPC then drops the target (resetDefaults) before it can path or attack.
// maxrange defaults to wanderrange + 2 (NpcType.postDecode). Adult dragons attack
// only through [ai_opplayer2] (npc/scripts/dragon.rs2); their ap handlers are
// commented out, so a target outside the leash is never breathed on either.
// Docs: docs/speedrun/helpers/dragons.md.
import type { BotWorldState, GroundItem, InventoryItem, NearbyNpc } from '../../sdk/types';
import { TRADE_REQUEST_CHAT_TYPE } from '../../sdk/types';
import { receiveFrom } from '../lib/trade';
import { COW_FIELD, DUSTY_KEY, DUSTY_KEY_DOOR, fetchDustyKey, parseOptions, Run, sameSideOf, TAVERLEY_DUNGEON_BOTTOM, TAVERLEY_DUNGEON_LADDER } from './bones';
import { BANKS, Buyer, type ListLine } from './buyer';
import { accountMatches, ChatCursor, DEFAULT_COURIERS, toRegExps } from './mule';
import { crossFromKandarin, crossToKandarin, type Traveller, westOfTaverley } from '../lib/kandarin';
import { IF_RUN_ON } from '../lib/run-mode';
import type { Role, RoleContext } from './role';
import { runStandalone } from './role';
import { leashHolds, ROOM, type Spawn, TAVERLEY_ROOM_NPCS } from './taverley-dragons';

export interface Tile { x: number; z: number }

// The room's spawns, bounds and leash rule live in taverley-dragons.ts, shared with bones.ts.
export { leashHolds, ROOM, TAVERLEY_ADULTS, TAVERLEY_BABIES, TAVERLEY_ROOM_NPCS, type Spawn } from './taverley-dragons';

/**
 * The one tile in the room outside every adult's and every baby's leash, with line of
 * sight to most of the adults' wander area within 10 tiles (spell range, longbows).
 */
export const SAFE_TILE: Tile = { x: 2901, z: 9810 };

/** True when no listed NPC can keep `p` as a target, so none of them can ever hit it. */
export function outsideEveryLeash(p: Tile, spawns: Spawn[] = TAVERLEY_ROOM_NPCS): boolean {
    return spawns.every(s => !leashHolds(s, p));
}

/** CoordGrid.distanceTo between a 1x1 tile and a size x size footprint at `sw`: 0 when underneath. */
export function footprintDistance(p: Tile, sw: Tile, size: number): number {
    const dx = p.x < sw.x ? sw.x - p.x : p.x > sw.x + size - 1 ? p.x - (sw.x + size - 1) : 0;
    const dz = p.z < sw.z ? sw.z - p.z : p.z > sw.z + size - 1 ? p.z - (sw.z + size - 1) : 0;
    return Math.max(dx, dz);
}

export type LineOfSight = (from: Tile, sw: Tile, size: number) => boolean;

/** Whether an attack of `range` from `p` reaches the footprint without the player stepping off `p`. */
export function inReach(p: Tile, sw: Tile, size: number, range: number, los: LineOfSight): boolean {
    const d = footprintDistance(p, sw, size);
    return d >= 1 && d <= range && los(p, sw, size);
}

/** Telekinetic Grab reach: the player's default apRange (PathingEntity.apRange = 10) with line of sight to the tile. */
export function dropGrabbable(p: Tile, tile: Tile, los: LineOfSight): boolean {
    return footprintDistance(p, tile, 1) <= 10 && los(p, tile, 1);
}

export interface DragonView { sw: Tile; size: number; hp: number | null }
export type CastDecision = 'cast' | 'hold' | 'out_of_reach';

/**
 * Whether to cast at a dragon from `p`. A dragon drops on its SW tile (obj_add at npc_coord in
 * blue_dragon.rs2), the corner farthest from the safe tile and often behind rocks. While its
 * hitpoints are within one hit, a dragon whose drop could not be telegrabbed is held: it
 * wanders (1 move in 8 ticks) and is finished once it stands where the bones can be grabbed.
 */
export function castDecision(p: Tile, d: DragonView, maxHit: number, range: number, los: LineOfSight): CastDecision {
    if (!inReach(p, d.sw, d.size, range, los)) return 'out_of_reach';
    if (d.hp !== null && d.hp <= maxHit && !dropGrabbable(p, d.sw, los)) return 'hold';
    return 'cast';
}

/** Level-0 box the projectile blockers are rebuilt for: the dragon room and its approaches. */
export const ROOM_BOX = { x1: 2876, z1: 9780, x2: 2930, z2: 9825 };

const LOC = 0x100;
const LOC_PROJ_BLOCKER = 0x20000;
const WALLS = 0xff;
const WALL_PROJ_SHIFT = 9; // WALL_*_PROJ_BLOCKER = WALL_* << 9 (rsmod CollisionFlag)

/**
 * Flags with the projectile blockers a loc or wall would add in the engine. The SDK's
 * collision-data.json carries no projectile-blocker bits at all, while every loc and wall
 * blocks projectiles unless its config says blockrange=no (LocType defaults it on). So a
 * blocking tile is treated as a projectile blocker: conservative, since a blockrange=no loc
 * (pile_of_skulls_grubby in this room) only costs a shot we could have taken.
 */
export function withProjectileBlockers(flags: number): number {
    let out = flags;
    if (flags & LOC) out |= LOC_PROJ_BLOCKER;
    out |= (flags & WALLS) << WALL_PROJ_SHIFT;
    return out;
}

const FLAG_BITS = Array.from({ length: 31 }, (_, i) => 2 ** i);

/**
 * Offline line of sight matching the engine's isApproached (GameMap.ts: rsmod hasLineOfSight),
 * on the SDK's collision map with projectile blockers rebuilt inside ROOM_BOX.
 */
export async function collisionLineOfSight(): Promise<LineOfSight> {
    const { initPathfinding } = await import('../../sdk/pathfinding');
    const rsmod = await import('../../server/vendor/rsmod-pathfinder');
    initPathfinding();
    for (let x = ROOM_BOX.x1; x <= ROOM_BOX.x2; x++) {
        for (let z = ROOM_BOX.z1; z <= ROOM_BOX.z2; z++) {
            const flags = FLAG_BITS.reduce((a, b) => (rsmod.isFlagged(x, z, 0, b) ? a | b : a), 0) >>> 0;
            const next = withProjectileBlockers(flags);
            if (next !== flags) rsmod.__set(x, z, 0, next);
        }
    }
    return (from, sw, size) => rsmod.hasLineOfSight(0, from.x, from.z, sw.x, sw.z, 1, 1, size, size, 0);
}

// ===========================================================================
// The role: pure decisions first (dragons.test.ts), then the live session.
// ===========================================================================

export const DOOR_INSIDE: Tile = { x: DUSTY_KEY_DOOR.x - 1, z: DUSTY_KEY_DOOR.z };
export const DOOR_OUTSIDE: Tile = { x: DUSTY_KEY_DOOR.x + 1, z: DUSTY_KEY_DOOR.z };

/**
 * DOOR_INSIDE to SAFE_TILE, one king move per tile, never inside an adult's leash: only
 * baby leash ground, and babies have no dragonfire. The pathfinder's own route cuts through
 * adult leash ground at (2903-2908, 9806-9809), and even a two-tile click along z 9810 has an
 * equal-length alternative through z 9809, so the role clicks one tile at a time. Reverse to leave.
 */
export const SAFE_ROUTE: Tile[] = [
    [2923, 9803], [2922, 9803], [2921, 9803], [2920, 9803], [2919, 9803], [2918, 9803], [2917, 9803],
    [2916, 9804], [2915, 9805], [2914, 9806], [2913, 9807], [2912, 9808], [2911, 9809], [2910, 9810],
    [2909, 9810], [2908, 9810], [2907, 9810], [2906, 9810], [2905, 9810], [2904, 9810], [2903, 9810],
    [2902, 9810], [2901, 9810]
].map(([x, z]) => ({ x: x!, z: z! }));

/**
 * Magic Guild, Yanille (server/content/maps/m40_48.jm2). The east double door (magicguild_door_l/r at
 * x 2597, z 3087-3088) faces the bank and opens only for Magic 66 going in (magic_guild.rs2); the
 * store is upstairs: stairs at (2590, 3089) on level 0, stairstop at (2590, 3090) on level 1.
 */
export const GUILD = {
    door: { x: 2597, z: 3088 },
    outside: { x: 2598, z: 3088 },
    inside: { x: 2596, z: 3088 },
    stairsUp: { x: 2590, z: 3089 },
    stairsDown: { x: 2590, z: 3090 },
    /** The ground floor between the west (x 2584) and east doors. */
    box: { x1: 2585, z1: 3080, x2: 2596, z2: 3096 }
};

/** Runes the role buys. Air is not among them: the staff of air supplies every air rune. */
export interface Runes { mind: number; chaos: number; death: number; law: number }
export interface Spell extends Runes { name: string; id: number; level: number; maxHit: number }

/**
 * Combat spells by level, as cast with a staff of air (skill_combat/configs/magic/
 * magic_combat_spells.dbrow; ids from interface.pack). The wind spells need nothing but air beside
 * one mind, chaos or death rune, so the exchange's empty air market (a 109k buy wall at 11 gp, no
 * sellers) and Aubury's ~180 air a visit never cut a trip short. Wind blast hits 13 against fire
 * bolt's 12.
 */
export const SPELLS: Spell[] = [
    { name: 'wind_strike', id: 1152, level: 1, maxHit: 2, mind: 1, chaos: 0, death: 0, law: 0 },
    { name: 'wind_bolt', id: 1160, level: 17, maxHit: 9, mind: 0, chaos: 1, death: 0, law: 0 },
    { name: 'wind_blast', id: 1172, level: 41, maxHit: 13, mind: 0, chaos: 0, death: 1, law: 0 }
];
const WIND_BOLT_LEVEL = 17;
/** Telekinetic grab: one air (from the staff) and one law. */
export const TELEGRAB = { id: 1168, level: 33, law: 1 };

/** Spells worth casting at a level: wind strike (max 2, no use on a dragon) only until wind bolt, wind blast only with `blast`. */
const usable = (s: Spell, magic: number, blast: boolean): boolean =>
    s.level <= magic && (blast || s.name !== 'wind_blast') && (s.name !== 'wind_strike' || magic < WIND_BOLT_LEVEL);

/** Best combat spell for a Magic level. */
export function spellFor(magic: number, blast = true): Spell {
    return SPELLS.filter(s => usable(s, magic, blast)).at(-1)!;
}

export interface DragonOptions {
    /** Attack, Strength and Defence on cows first: hitpoints and defence for the walk in. */
    train: number;
    /**
     * Magic trained on cows (minutes at 25x) before the dusty key: the Jailer (level 47, 40 Defence,
     * platemail) is then killed with wind blast (41) rather than a staff.
     */
    keyMagic: number;
    /** Casts of runes per trip, and telegrabs (law runes) per trip. */
    tripCasts: number;
    tripLaws: number;
    /** Food carried for the walk in (the tile itself takes no damage). */
    tripFood: number;
    /**
     * Fewest food a pack walks the dungeon with. The Jailer and the route's scorpions, dwarves and
     * skeletons take a 30-hitpoint account from full to nothing, and the eat guard can only eat
     * what is carried: below this the account banks first.
     */
    minFood: number;
    food: string;
    /** Fewest casts carried that is still worth walking in with. */
    minCasts: number;
    /**
     * Trips of runes to buy per shopping run (capped by coins). 1: the role drains the rune shops
     * other players use too, so it buys only what the next trip uses.
     */
    buyTrips: number;
    /** Wind blast from Magic 41 (one death rune a cast); off, wind bolt (one chaos) is the best spell. */
    blast: boolean;
    /** Telegrab dragonhide as well as bones (no GE market for it on 2026-10-21). */
    hides: boolean;
    /** Price caps: also the budget estimate per trip. */
    prices: { staff: number; mind: number; chaos: number; death: number; law: number; food: number };
    /** Accounts whose trade requests are accepted as funding. */
    funders: RegExp[];
    /**
     * Magic level from which a shopping run that Aubury and Betty left short of a trip's chaos and
     * death crosses White Wolf Mountain to the Magic Guild for them (its door wants 66; about 500
     * ticks each way). Only chaos and death: on 2026-10-21 other players had drained its 40-gp laws
     * to 1 and its air to none. 100 turns it off.
     */
    guild: number;
    /**
     * What a trip's runes cost on average (shop price = base x (1 + 1.25% per unit below stock):
     * Zaff's staff 1,000; chaos 20 and death 30 base, so the 3x caps in `prices` stop 160 below
     * stock at about 2x on average). tripCost prices a trip with these; the caps bound each buy.
     * Pricing at the caps left accounts waiting for funding with coins for a whole trip.
     */
    shopPrices: { staff: number; mind: number; chaos: number; death: number };
}

/**
 * What the role telegrabs, by item name. Not the room's blue dragon scales: none of their five
 * spawns is in line of sight from SAFE_TILE (dragons.md, measured on the demo).
 */
export function lootPattern(o: Pick<DragonOptions, 'hides'>): RegExp {
    return o.hides ? /^(dragon bones|dragonhide)$/i : /^dragon bones$/i;
}

export function dragonOptions(o: Record<string, unknown>): DragonOptions {
    const num = (k: string, d: number) => (typeof o[k] === 'number' ? (o[k] as number) : d);
    const p = (o.prices ?? {}) as Record<string, number>;
    return {
        train: num('train', 20),
        keyMagic: num('keyMagic', 41),
        tripCasts: num('tripCasts', 500),
        tripLaws: num('tripLaws', 25),
        tripFood: num('tripFood', 4),
        minFood: num('minFood', 2),
        food: typeof o.food === 'string' ? o.food : 'Shark',
        minCasts: num('minCasts', 60),
        buyTrips: num('buyTrips', 1),
        blast: o.blast !== false,
        hides: o.hides === true,
        prices: {
            staff: p.staff ?? 3000, mind: p.mind ?? 10, chaos: p.chaos ?? 60, death: p.death ?? 90, law: num('lawMax', p.law ?? 3500), food: p.food ?? 900
        },
        funders: toRegExps(o.funders ?? DEFAULT_COURIERS),
        guild: num('guild', 66),
        shopPrices: { staff: 1500, mind: 8, chaos: 40, death: 60, ...((o.shopPrices ?? {}) as Record<string, number>) }
    };
}

/** What a trip carries (or what is held), by kind. */
export interface Kit extends Runes { food: number; staff: number; key: number }
export const EMPTY_KIT: Kit = { mind: 0, chaos: 0, death: 0, law: 0, food: 0, staff: 0, key: 0 };

/**
 * One trip's supplies at this Magic level: the runes of every spell usable now or within 5 levels.
 * Once wind blast is cast, its deaths are the trip and chaos for wind bolt is a half-trip fallback
 * (a shop's price climbs as its stock drains, so a visit buys more casts of two runes than of one).
 */
export function tripKit(magic: number, o: Pick<DragonOptions, 'tripCasts' | 'tripLaws' | 'tripFood' | 'blast'>): Kit {
    const allowed = SPELLS.filter(x => usable(x, magic, o.blast) || usable(x, magic + 5, o.blast));
    const per = (k: 'mind' | 'chaos' | 'death') => Math.max(0, ...allowed.map(x => x[k])) * o.tripCasts;
    const blasting = spellFor(magic, o.blast).death > 0;
    const laws = magic >= TELEGRAB.level ? o.tripLaws : 0;
    return { mind: per('mind'), chaos: blasting ? Math.ceil(per('chaos') / 2) : per('chaos'), death: per('death'), law: laws, food: o.tripFood, staff: 1, key: 1 };
}

/** Casts of `spell` the carried runes pay for (the staff of air must be owned). */
export function castsCarried(k: Kit, spell: Spell): number {
    if (k.staff < 1) return 0;
    const n = (have: number, need: number) => (need > 0 ? Math.floor(have / need) : Infinity);
    return Math.min(n(k.mind, spell.mind), n(k.chaos, spell.chaos), n(k.death, spell.death));
}

/** The strongest spell the level allows that the kit can pay for, or null. */
export function castable(magic: number, k: Kit, blast = true): Spell | null {
    return [...SPELLS].reverse().find(s => usable(s, magic, blast) && castsCarried(k, s) >= 1) ?? null;
}

/**
 * Casts the kit pays for as farm() spends it: the best spell it can afford until that spell's rune
 * runs out, then the next (wind blast, then wind bolt on the chaos).
 */
export function castsAvailable(magic: number, k: Kit, blast = true): number {
    let left = { ...k };
    let total = 0;
    for (let s = castable(magic, left, blast); s; s = castable(magic, left, blast)) {
        const n = castsCarried(left, s);
        total += n;
        left = { ...left, mind: left.mind - n * s.mind, chaos: left.chaos - n * s.chaos, death: left.death - n * s.death };
    }
    return total;
}

export type Where = 'surface' | 'dungeon' | 'room';
export interface View {
    tutorial: boolean;
    melee: number;
    magic: number;
    where: Where;
    freeSlots: number;
    carried: Kit;
    /** Bank contents by kind, null until the first bank visit. */
    banked: Kit | null;
    /** Coins carried plus banked. */
    coins: number;
    /** Bones carried. */
    loot: number;
}
export type Step = 'tutorial' | 'train' | 'trainMagic' | 'farm' | 'leave' | 'look' | 'bank' | 'buy' | 'fund' | 'key' | 'enter';

const sum = (a: Kit, b: Kit | null): Kit => {
    const out = { ...a };
    if (b) for (const k of Object.keys(out) as (keyof Kit)[]) out[k] += b[k];
    return out;
};

/**
 * Coins, at the expected prices (shopPrices; laws at their cap), for what one trip's
 * kit needs beyond `held` (pack plus bank), the staff included if none is held. `laws` replaces the
 * trip's law runes (a partial trip).
 */
export function tripCost(magic: number, o: DragonOptions, held: Kit, laws?: number): number {
    const k = tripKit(magic, o);
    const p = o.prices;
    const r = o.shopPrices;
    const short = (want: number, have: number) => Math.max(0, want - have);
    return short(k.mind, held.mind) * r.mind + short(k.chaos, held.chaos) * r.chaos + short(k.death, held.death) * r.death
        + short(laws ?? k.law, held.law) * p.law + short(k.food, held.food) * p.food + (held.staff >= 1 ? 0 : o.shopPrices.staff);
}

/** Whether this Magic level may top chaos and death up at the Magic Guild. */
export const atGuild = (magic: number, o: DragonOptions): boolean => magic >= o.guild;

/** Fewest law runes a trip is worth walking in with (decideStep's ready test). */
export function minTripLaws(magic: number, o: DragonOptions): number {
    return Math.min(5, tripKit(magic, o).law);
}

/**
 * Law runes one trip can carry (those held plus those `coins` buy once the rest of the kit beyond
 * `held` is paid for), at most a full trip's. Laws dominate a trip's cost on the exchange (25 of
 * them are about 75,000 gp), so funding short of a full trip still buys a trip with fewer telegrabs.
 */
export function affordableLaws(coins: number, magic: number, o: DragonOptions, held: Kit): number {
    const want = tripKit(magic, o).law;
    if (want === 0) return 0;
    const bought = Math.max(0, Math.floor((coins - tripCost(magic, o, held, 0)) / o.prices.law));
    return Math.min(want, held.law + bought);
}

/** Staff, casts and (from telegrab's level) laws enough to walk in with; food is `fed`'s question. */
function armed(k: Kit, magic: number, o: DragonOptions): boolean {
    const needLaw = magic >= TELEGRAB.level;
    return k.staff >= 1 && castsAvailable(magic, k, o.blast) >= Math.min(o.minCasts, o.tripCasts) && (!needLaw || k.law >= minTripLaws(magic, o));
}

const fed = (k: Kit, o: DragonOptions): boolean => k.food >= Math.min(o.minFood, o.tripFood);

/**
 * Whether only food stands between the account and a trip: runes, staff and laws are held (pack
 * plus bank) but food falls short. Such a shop is sharks on the exchange alone, never a rune trip.
 */
export function foodOnly(v: View, o: DragonOptions): boolean {
    const all = sum(v.carried, v.banked);
    return armed(all, v.magic, o) && !fed(all, o);
}

/** Shopping list topping food up to a trip's (foodOnly's shop). */
export function foodPlan(held: Kit, o: DragonOptions): { trips: number; lines: ListLine[] } {
    if (held.food >= o.tripFood) return { trips: 0, lines: [] };
    return { trips: 0, lines: [{ item: o.food, quantity: o.tripFood, source: 'ge', maxPrice: o.prices.food }] };
}

/**
 * The next step from what the account holds and where it stands. In the room it farms until the
 * pack is full or a cast or a telegrab can no longer be paid for. Elsewhere: carry a trip's kit
 * and at least minFood food (from the bank if it is there), buy food alone when only food is
 * short, buy a kit when bank and pack fall short and the coins allow, otherwise wait for funding.
 */
export function decideStep(v: View, o: DragonOptions): Step {
    if (v.tutorial) return 'tutorial';
    const needLaw = v.magic >= TELEGRAB.level;
    if (v.where === 'room') {
        const spell = castable(v.magic, v.carried, o.blast);
        const canGrab = !needLaw || v.carried.law >= TELEGRAB.law;
        if (v.freeSlots === 0 || !spell || !canGrab) return 'leave';
        return 'farm';
    }
    if (v.melee < o.train) return 'train';
    if (v.banked === null) return 'look';
    // Bones bank before anything else: the run order counts banked bones, and a death drops them.
    if (v.loot > 0) return 'bank';
    // Spells on cows up to keyMagic whenever the pack can pay for them (laws are not needed there).
    if (v.magic < o.keyMagic && v.carried.key < 1 && v.carried.staff >= 1 && castsAvailable(v.magic, v.carried, o.blast) >= 1) return 'trainMagic';
    const ready = (k: Kit) => armed(k, v.magic, o) && fed(k, o);
    if (ready(v.carried) && v.freeSlots >= 5) return v.carried.key >= 1 ? 'enter' : 'key';
    const all = sum(v.carried, v.banked);
    // A kit waiting in the bank, or a pack too full to carry one: one bank visit settles both.
    if (ready(all) || (v.loot > 0 && v.freeSlots < 5)) return 'bank';
    if (foodOnly(v, o)) return v.coins >= (o.tripFood - all.food) * o.prices.food ? 'buy' : 'fund';
    if (v.coins >= tripCost(v.magic, o, all, minTripLaws(v.magic, o))) return 'buy';
    return 'fund';
}

/**
 * Shopping list for as many trips as the coins pay for (at most buyTrips); quantities are target
 * holdings. Coins short of one full trip buy one trip with the laws they cover (affordableLaws).
 */
export function purchasePlan(coins: number, magic: number, held: Kit, o: DragonOptions): { trips: number; lines: ListLine[] } {
    const staffOwned = held.staff >= 1;
    const per = { ...tripKit(magic, o) };
    const perTrip = tripCost(magic, o, { ...EMPTY_KIT, staff: 1 });
    const budget = coins - (staffOwned ? 0 : o.shopPrices.staff);
    let trips = Math.min(o.buyTrips, Math.floor(budget / Math.max(1, perTrip)));
    if (trips < 1) {
        // decideStep's buy test: the same shortfall, so a 'buy' never meets an empty plan.
        if (coins < tripCost(magic, o, held, minTripLaws(magic, o))) return { trips: 0, lines: [] };
        trips = 1;
        per.law = affordableLaws(coins, magic, o, held);
    }
    const p = o.prices;
    const lines: ListLine[] = [];
    const target = (k: keyof Runes | 'food') => held[k] + Math.max(0, trips * per[k] - held[k]);
    // Laws first: the estimate can fall short of what the runes cost, and a trip without laws
    // telegrabs nothing, while one with fewer casts still farms.
    if (per.law) lines.push({ item: 'Law rune', quantity: target('law'), source: 'ge', maxPrice: p.law });
    if (!staffOwned) lines.push({ item: STAFF_NAME, quantity: 1, source: 'shop', shop: 'zaff', maxPrice: p.staff, maxWaitTicks: 30 });
    if (per.mind) lines.push({ item: 'Mind rune', quantity: target('mind'), source: 'shop', shop: 'aubury', maxPrice: p.mind, maxWaitTicks: 60 });
    if (per.chaos) lines.push({ item: 'Chaos rune', quantity: target('chaos'), source: 'shop', shop: 'aubury', maxPrice: p.chaos, maxWaitTicks: 60 });
    if (per.death) lines.push({ item: 'Death rune', quantity: target('death'), source: 'shop', shop: 'aubury', maxPrice: p.death, maxWaitTicks: 60 });
    // Betty (Port Sarim) stocks the same 1,000 chaos and death, restocking as slowly (1 per 100 and
    // 150 ticks; port_sarim.inv magicshop): her lines buy only what Aubury's price cap left short.
    if (per.chaos) lines.push({ item: 'Chaos rune', quantity: target('chaos'), source: 'shop', shop: 'betty', maxPrice: p.chaos, maxWaitTicks: 20 });
    if (per.death) lines.push({ item: 'Death rune', quantity: target('death'), source: 'shop', shop: 'betty', maxPrice: p.death, maxWaitTicks: 20 });
    // The guild last, for chaos and death only: buy() crosses the mountain for these lines only
    // when Aubury and Betty left the trip short.
    if (atGuild(magic, o)) {
        if (per.chaos) lines.push({ item: 'Chaos rune', quantity: target('chaos'), source: 'shop', shop: 'magicGuild', maxPrice: p.chaos, maxWaitTicks: 20 });
        if (per.death) lines.push({ item: 'Death rune', quantity: target('death'), source: 'shop', shop: 'magicGuild', maxPrice: p.death, maxWaitTicks: 20 });
    }
    if (per.food) lines.push({ item: o.food, quantity: target('food'), source: 'ge', maxPrice: p.food });
    return { trips, lines };
}

// ---------------------------------------------------------------------------
// Live session
// ---------------------------------------------------------------------------

const UNDERGROUND_Z = 6400;
const FOOD = /^(shark|manta ray|sea turtle|swordfish|lobster|monkfish|bass|tuna|salmon|trout|cod|pike|herring|mackerel|sardine|anchovies|shrimps|cake|2\/3 cake|slice of cake|meat pie|stew|kebab|bread)$/i;
/** Zaff (2 in stock) and the Magic Guild sell it; it stands in for every air rune. */
const STAFF_NAME = 'Staff of air';
const STAFF = /^staff of air$/i;
const JAIL_KEY = /^jail key$/i;
/** Where the Jailer walks (bones.ts JAILER). */
const JAILER: Tile = { x: 2933, z: 9693 };
const RUNE_NAMES: Record<keyof Runes, string> = { mind: 'Mind rune', chaos: 'Chaos rune', death: 'Death rune', law: 'Law rune' };
const dist = (a: Tile, b: Tile) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
const exact = (name: string) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Count a kit in a list of items (inventory, bank, or the inventory plus worn equipment). */
export function kitIn(items: { name: string; count: number }[], foodName: string): Kit {
    const n = (re: RegExp) => items.filter(i => re.test(i.name)).reduce((a, i) => a + i.count, 0);
    const k: Kit = { ...EMPTY_KIT };
    for (const r of Object.keys(RUNE_NAMES) as (keyof Runes)[]) k[r] = n(exact(RUNE_NAMES[r]));
    k.food = n(exact(foodName)) || n(FOOD);
    k.staff = n(STAFF);
    k.key = n(DUSTY_KEY);
    return k;
}

class Dragons {
    readonly run: Run;
    readonly sdk: RoleContext['sdk'];
    readonly bot: RoleContext['bot'];
    los: LineOfSight | null = null;
    bank: Map<string, number> | null = null;
    private readonly requests: ChatCursor;
    private step: Step | null = null;
    private lastCastTick = -99;
    private lastCast: { sw: Tile; [k: string]: unknown } | null = null;
    private lastGuardTick = -1;
    private lastHp: number | null = null;
    private controlsSet = false;
    /** Target SW tiles a cast at which walked the player off the tile (the engine's sight or range disagreed). */
    private readonly badSw = new Set<string>();
    private lastWaitLog = 0;
    private readonly loot: RegExp;
    readonly stats = { kills: 0, casts: 0, grabs: 0, grabFails: 0, bones: 0, hides: 0, trips: 0, banked: 0, deaths: 0, damage: 0, damageOnTile: 0, offTileTicks: 0, startedAt: Date.now() };
    private readonly killedAt = new Map<number, number>();
    private readonly mine = new Set<number>();

    constructor(readonly ctx: RoleContext, readonly o: DragonOptions) {
        this.sdk = ctx.sdk;
        this.bot = ctx.bot;
        this.run = new Run(ctx, parseOptions({ spot: 'baby_blue', fish: false, train: o.train, eatAt: 0.5, fleeAt: 0.3 }));
        this.requests = new ChatCursor(ctx.sdk, [TRADE_REQUEST_CHAT_TYPE]);
        this.loot = lootPattern(o);
    }

    traveller(): Traveller {
        return { bot: this.bot, sdk: this.sdk, log: this.ctx.log, checkSignal: () => { if (this.ctx.signal.aborted) throw new Error('stopped'); } };
    }

    state(): BotWorldState { return this.run.state(); }
    pos(): Tile { return this.run.pos(); }
    magic(): number { return this.run.level('Magic'); }
    freeSlots(): number { return 28 - this.state().inventory.length; }
    carried(): Kit { return kitIn([...this.state().inventory, ...this.sdk.getEquipment()], this.o.food); }
    bankKit(): Kit | null { return this.bank ? kitIn([...this.bank].map(([name, count]) => ({ name, count })), this.o.food) : null; }
    coins(): number {
        return this.state().inventory.filter(i => i.name === 'Coins').reduce((a, i) => a + i.count, 0) + (this.bank?.get('Coins') ?? 0);
    }

    where(): Where {
        const p = this.pos();
        if (p.z < UNDERGROUND_Z) return 'surface';
        const inBox = p.x >= ROOM.x1 && p.x <= ROOM.x2 && p.z >= ROOM.z1 && p.z <= ROOM.z2;
        return inBox && sameSideOf(DUSTY_KEY_DOOR, p, SAFE_TILE) ? 'room' : 'dungeon';
    }

    view(): View {
        const s = this.state();
        const p = s.player!;
        const lv = (k: string) => this.run.level(k);
        return {
            tutorial: s.modalInterface === 3559 || (p.level === 0 && p.worldX >= 3050 && p.worldX <= 3160 && p.worldZ >= 3050 && p.worldZ <= 3135),
            melee: Math.min(lv('Attack'), lv('Strength'), lv('Defence')),
            magic: this.magic(),
            where: this.where(),
            freeSlots: this.freeSlots(),
            carried: this.carried(),
            banked: this.bankKit(),
            coins: this.coins(),
            loot: s.inventory.filter(i => this.loot.test(i.name)).length
        };
    }

    summary(): Record<string, unknown> {
        const h = (Date.now() - this.stats.startedAt) / 3_600_000;
        return { ...this.stats, hours: +h.toFixed(3), bonesPerHour: h > 0 ? Math.round(this.stats.bones / h) : 0, magic: this.magic(), hp: this.run.level('Hitpoints') };
    }

    /** Count kills of dragons we cast on, from published hitpoints (a dead NPC shows hp 0 for a few ticks). */
    watch(s: BotWorldState): void {
        const p = s.player;
        if (!p) return;
        const onTile = p.worldX === SAFE_TILE.x && p.worldZ === SAFE_TILE.z;
        // Hitpoints lost anywhere, and on the tile in particular (the claim is that it is zero).
        const hp = s.skills.find(k => k.name === 'Hitpoints')?.level ?? null;
        if (hp !== null && this.lastHp !== null && hp < this.lastHp && hp > 0) {
            this.stats.damage += this.lastHp - hp;
            if (onTile) this.stats.damageOnTile += this.lastHp - hp;
            this.ctx.log('damage', { tick: s.tick, lost: this.lastHp - hp, hp, at: { x: p.worldX, z: p.worldZ }, step: this.step });
        }
        this.lastHp = hp;
        // Farming: the moment the player stands off the tile, walk straight back (a walk also clears
        // whatever interaction moved it). Two tiles south is already inside an adult's leash.
        if (this.step === 'farm' && !onTile && dist({ x: p.worldX, z: p.worldZ }, SAFE_TILE) <= 3 && p.worldZ > UNDERGROUND_Z) {
            this.stats.offTileTicks++;
            if (this.lastGuardTick !== s.tick) {
                const sw = this.lastCast?.sw;
                if (sw && s.tick - this.lastCastTick <= 3) this.badSw.add(`${sw.x},${sw.z}`);
                if (this.lastGuardTick < s.tick - 1) this.ctx.log('drift', { tick: s.tick, at: { x: p.worldX, z: p.worldZ }, sinceCast: s.tick - this.lastCastTick, lastCast: this.lastCast, anim: p.animId });
                this.lastGuardTick = s.tick;
                void this.sdk.sendWalk(SAFE_TILE.x, SAFE_TILE.z, false);
            }
        }
        for (const n of s.nearbyNpcs ?? []) {
            if (!/^blue dragon$/i.test(n.name) || n.hp !== 0 || !this.mine.has(n.index)) continue;
            if ((this.killedAt.get(n.index) ?? -999) > s.tick - 40) continue;
            this.killedAt.set(n.index, s.tick);
            this.mine.delete(n.index);
            this.stats.kills++;
            if (this.stats.kills % 10 === 0) this.ctx.log('progress', this.summary());
        }
    }

    async cycle(): Promise<void> {
        await this.bot.dismissBlockingUI();
        const s = this.state();
        if (this.sdk.isBankOpen() || s.shop?.isOpen) await this.bot.closeInterface();
        const deathsBefore = (this.run.summary().deaths as number) ?? 0;
        this.run.noteRespawn();
        this.stats.deaths = (this.run.summary().deaths as number) ?? deathsBefore;
        await this.run.dropSpareKeys();
        const v = this.view();
        const step = decideStep(v, this.o);
        // Every step but buy starts outside the guild (a restart mid-visit lands here).
        if (step !== 'buy' && this.inGuild() && !(await this.leaveGuild())) return;
        if (step !== this.step) {
            if (step === 'farm') this.controlsSet = false;
            // Run energy is infinite on the demo; only the tile wants walking (see farm()).
            else await this.sdk.sendClickComponent(IF_RUN_ON);
            this.ctx.log('step', { from: this.step, to: step, where: v.where, magic: v.magic, melee: v.melee, coins: v.coins, carried: v.carried, banked: v.banked });
            this.step = step;
        }
        switch (step) {
            case 'tutorial': {
                const r = await this.bot.skipTutorial();
                this.ctx.log('tutorial skipped', { ok: r.success });
                await this.sdk.waitForTicks(3);
                return;
            }
            case 'train':
                await this.run.equipUpgrades();
                await this.run.surfaceFight({ npc: /^cow$/i, area: COW_FIELD, centre: { x: 3253, z: 3282 }, loot: null });
                return;
            case 'farm': return this.farm();
            case 'leave': return this.leave();
            case 'look':
            case 'bank': return this.bankVisit(step);
            case 'buy': return this.buy();
            case 'fund': return this.fund();
            case 'trainMagic': return this.trainMagic();
            case 'key':
                if (!this.sdk.getEquipment().some(e => STAFF.test(e.name))) await this.bot.equipItem(STAFF);
                if (await this.jailerBySpell()) return;
                await fetchDustyKey(this.run);
                return;
            case 'enter': return this.enter();
        }
    }

    // ---- magic before the key ----

    /** Cast the best affordable spell at `npc` and wait for its xp (or a few ticks). */
    async castAt(npc: NearbyNpc): Promise<void> {
        const spell = castable(this.magic(), this.carried(), this.o.blast);
        if (!spell) return;
        const xp = () => this.sdk.getSkill('Magic')?.experience ?? 0;
        const before = xp();
        await this.sdk.sendSpellOnNpc(npc.index, spell.id);
        this.stats.casts++;
        await this.run.waitFor(() => xp() > before, 8);
        await this.sdk.waitForTicks(4);
    }

    async trainMagic(): Promise<void> {
        if (!this.sdk.getEquipment().some(e => STAFF.test(e.name))) { await this.bot.equipItem(STAFF); return; }
        if (this.pos().z > UNDERGROUND_Z && !(await this.surface())) return;
        const inField = (t: Tile) => t.x >= COW_FIELD.x1 && t.x <= COW_FIELD.x2 && t.z >= COW_FIELD.z1 && t.z <= COW_FIELD.z2;
        if (!inField(this.pos())) { await this.run.walk(3253, 3282, 4, 400_000); return; }
        const cow = this.state().nearbyNpcs.filter(n => /^cow$/i.test(n.name) && (n.hp ?? 1) > 0 && inField({ x: n.x, z: n.z }) && !n.inCombat)
            .sort((a, b) => dist(a, this.pos()) - dist(b, this.pos()))[0];
        if (!cow) { await this.sdk.waitForTicks(3); return; }
        await this.castAt(cow);
    }

    /**
     * The Jailer by spells (wind blast, wind bolt once the deaths run out), then his jail key off the
     * floor; fetchDustyKey does the rest (it skips the fight once a jail key is carried). False when
     * this is not the moment (not at the jail, or a key already carried).
     */
    async jailerBySpell(): Promise<boolean> {
        const inv = this.state().inventory;
        if (this.pos().z < UNDERGROUND_Z || inv.some(i => DUSTY_KEY.test(i.name) || JAIL_KEY.test(i.name))) return false;
        if (dist(this.pos(), JAILER) > 8 || !castable(this.magic(), this.carried(), this.o.blast)) return false;
        const key = (this.state().groundItems ?? []).find(g => JAIL_KEY.test(g.name));
        if (key) {
            await this.bot.pickupItem(key);
            await this.run.waitFor(st => st.inventory.some(i => JAIL_KEY.test(i.name)), 6);
            this.ctx.log('jail key', { got: this.state().inventory.some(i => JAIL_KEY.test(i.name)), magic: this.magic() });
            return true;
        }
        const jailer = this.state().nearbyNpcs.find(n => /^jailer$/i.test(n.name) && (n.hp ?? 1) > 0);
        if (!jailer) { await this.sdk.waitForTicks(3); return true; }
        await this.castAt(jailer);
        return true;
    }

    // ---- getting about ----

    /** Climb out of the Taverley dungeon (from outside the room). */
    async surface(): Promise<boolean> {
        if (this.pos().z < UNDERGROUND_Z) return true;
        if (!(await this.run.walk(TAVERLEY_DUNGEON_BOTTOM.x, TAVERLEY_DUNGEON_BOTTOM.z, 2, 180_000))) return false;
        return this.run.climb(/ladder/i, /climb-up/i, false, TAVERLEY_DUNGEON_BOTTOM);
    }

    /** Step along SAFE_ROUTE one tile per click, towards the tile (`inward`) or the door. */
    async walkRoute(inward: boolean): Promise<boolean> {
        const route = inward ? SAFE_ROUTE : [...SAFE_ROUTE].reverse();
        let i = route.reduce((best, t, j) => (dist(t, this.pos()) < dist(route[best]!, this.pos()) ? j : best), 0);
        for (; i < route.length; i++) {
            const t = route[i]!;
            for (let attempt = 0; attempt < 3 && dist(this.pos(), t) > 0; attempt++) {
                if (this.ctx.signal.aborted) return false;
                await this.sdk.sendWalk(t.x, t.z, false);
                await this.run.waitFor(st => st.player?.worldX === t.x && st.player?.worldZ === t.z, 4);
            }
            if (dist(this.pos(), t) > 0) {
                this.ctx.log('route step failed', { to: t, at: this.pos(), inward });
                return false;
            }
        }
        return true;
    }

    async useDoor(entering: boolean): Promise<boolean> {
        const through = (st: BotWorldState) => ((st.player?.worldX ?? 0) < DUSTY_KEY_DOOR.x) === entering;
        for (let attempt = 0; attempt < 4; attempt++) {
            if (through(this.state())) return true;
            const door = (await this.sdk.scanNearbyLocs(4)).find(l => /door|gate/i.test(l.name) && l.x === DUSTY_KEY_DOOR.x && l.z === DUSTY_KEY_DOOR.z);
            if (!door) { await this.sdk.waitForTicks(2); continue; }
            if (entering) await this.bot.useItemOnLoc(DUSTY_KEY, door);
            else await this.bot.interactLoc(door, /open/i);
            if (await this.run.waitFor(through, 10)) return true;
        }
        return through(this.state());
    }

    async enter(): Promise<void> {
        if (this.pos().z < UNDERGROUND_Z) {
            if (!(await this.run.walk(TAVERLEY_DUNGEON_LADDER.x, TAVERLEY_DUNGEON_LADDER.z + 1, 2, 400_000))) return;
            await this.run.climb(/ladder/i, /climb-down/i, true, TAVERLEY_DUNGEON_LADDER);
            return;
        }
        if (this.where() !== 'room') {
            if (dist(this.pos(), DOOR_OUTSIDE) > 0 && !(await this.run.walk(DOOR_OUTSIDE.x, DOOR_OUTSIDE.z, 0, 180_000))) return;
            if (!(await this.useDoor(true))) this.ctx.log('dusty-key door did not open', { at: this.pos() });
            return;
        }
        await this.walkRoute(true);
    }

    async leave(): Promise<void> {
        // A bolt in flight makes its dragon retaliate when it lands (npc_retaliate); stay on the
        // tile, outside every leash, until it has.
        const wait = this.lastCastTick + 5 - this.state().tick;
        if (wait > 0) await this.sdk.waitForTicks(wait);
        this.stats.trips++;
        this.ctx.log('leaving', { why: this.freeSlots() === 0 ? 'full' : 'supplies', carried: this.carried(), ...this.summary() });
        if (!(await this.walkRoute(false))) return;
        await this.useDoor(false);
    }

    /** To `prefer`, or a nearer bank when `prefer` is 60+ tiles farther, unless `only`. */
    async toBank(prefer: Tile, only = false): Promise<boolean> {
        if (!(await this.surface())) return false;
        if (westOfTaverley(this.pos())) await crossFromKandarin(this.traveller(), BANKS.faladorWest, 'Falador West bank');
        const p = this.pos();
        const bank = [prefer, BANKS.faladorWest, BANKS.varrockWest, BANKS.draynor].sort((a, b) => dist(a, p) - dist(b, p))[0]!;
        const target = only || dist(prefer, p) < dist(bank, p) + 60 ? prefer : bank;
        return this.run.walk(target.x, target.z, 3, 400_000);
    }

    /** Upstairs in the guild, or on its ground floor. */
    inGuild(): boolean {
        const p = this.state().player;
        if (!p) return false;
        const b = GUILD.box;
        const near = p.worldX >= b.x1 && p.worldX <= b.x2 && p.worldZ >= b.z1 && p.worldZ <= b.z2;
        return near && (p.level === 0 || p.level === 1);
    }

    /** Take the stairs at `at` to `level` (Climb-up or Climb-down by direction). */
    async climbTo(level: number, at: Tile): Promise<boolean> {
        const onLevel = () => this.state().player?.level === level;
        for (let attempt = 0; attempt < 4 && !onLevel(); attempt++) {
            const option = level > (this.state().player?.level ?? 0) ? /climb-up/i : /climb-down/i;
            if (dist(this.pos(), at) > 2) await this.run.walk(at.x, at.z, 1, 60_000);
            const loc = (await this.sdk.scanNearbyLocs(6))
                .filter(l => /stair/i.test(l.name) && l.optionsWithIndex.some(o => option.test(o.text)))
                .sort((a, b) => dist(a, at) - dist(b, at))[0];
            if (!loc) {
                this.ctx.log('guild: no stairs', { at: this.pos(), level: this.state().player?.level });
                await this.sdk.waitForTicks(2);
                continue;
            }
            await this.bot.interactLoc(loc, option);
            await this.run.waitFor(st => st.player?.level === level, 10);
        }
        return onLevel();
    }

    /** Through the east door and up to the store. */
    async enterGuild(): Promise<boolean> {
        const p = () => this.state().player!;
        if (p().level === 1 && this.inGuild()) return true;
        if (!this.inGuild()) {
            if (!(await this.run.walk(GUILD.outside.x, GUILD.outside.z, 0, 400_000))) return false;
            for (let attempt = 0; attempt < 4 && !this.inGuild(); attempt++) {
                const door = (await this.sdk.scanNearbyLocs(3)).find(l => /door/i.test(l.name) && l.x === GUILD.door.x && Math.abs(l.z - GUILD.door.z) <= 1);
                if (door) await this.bot.interactLoc(door, /open/i);
                if (await this.run.waitFor(() => this.inGuild(), 6)) break;
                // An open door leaves the walk to us.
                await this.sdk.sendWalk(GUILD.inside.x, GUILD.inside.z, false);
                await this.run.waitFor(() => this.inGuild(), 4);
            }
            if (!this.inGuild()) {
                this.ctx.log('guild: door did not let us in', { at: this.pos(), magic: this.magic() });
                return false;
            }
        }
        return this.climbTo(1, GUILD.stairsUp);
    }

    /** Down the stairs and out of the east door. */
    async leaveGuild(): Promise<boolean> {
        if (this.state().player?.level === 1 && !(await this.climbTo(0, GUILD.stairsDown))) return false;
        for (let attempt = 0; attempt < 4 && this.inGuild(); attempt++) {
            if (dist(this.pos(), GUILD.inside) > 0) await this.run.walk(GUILD.inside.x, GUILD.inside.z, 0, 60_000);
            const door = (await this.sdk.scanNearbyLocs(3)).find(l => /door/i.test(l.name) && l.x === GUILD.door.x && Math.abs(l.z - GUILD.door.z) <= 1);
            if (door) await this.bot.interactLoc(door, /open/i);
            if (await this.run.waitFor(() => !this.inGuild(), 6)) break;
            await this.sdk.sendWalk(GUILD.outside.x, GUILD.outside.z, false);
            await this.run.waitFor(() => !this.inGuild(), 4);
        }
        if (this.inGuild()) this.ctx.log('guild: could not leave', { at: this.pos() });
        return !this.inGuild();
    }

    // ---- the bank ----

    /** Deposit everything but the kit, then top the kit up to a trip's worth. */
    async bankVisit(why: string): Promise<void> {
        if (!(await this.toBank(BANKS.faladorWest))) return;
        const open = await this.bot.openBank();
        if (!open.success) { this.ctx.log('bank: open failed', { why, reason: open.message }); return; }
        const bones = this.state().inventory.filter(i => /^dragon bones$/i.test(i.name)).length;
        const keep = (name: string) => STAFF.test(name) || DUSTY_KEY.test(name) || Object.values(RUNE_NAMES).some(r => sameName(r, name)) || sameName(name, this.o.food);
        for (const name of [...new Set(this.state().inventory.map(i => i.name))].filter(n => !keep(n))) await this.bot.depositItem(exact(name), -1);
        const want = tripKit(this.magic(), this.o);
        const have = this.carried();
        const take = async (name: string, n: number) => {
            const item = this.sdk.getBankItems().find(b => sameName(b.name, name));
            if (item && n > 0) await this.bot.withdrawItem(item, Math.min(item.count, n));
        };
        for (const r of Object.keys(RUNE_NAMES) as (keyof Runes)[]) await take(RUNE_NAMES[r], want[r] - have[r]);
        await take(this.o.food, want.food - have.food);
        if (have.staff < 1) await take(STAFF_NAME, 1);
        if (have.key < 1) await take('Dusty key', 1);
        const items = this.sdk.getBankItems().map(b => ({ id: b.id, name: b.name, count: b.count }));
        this.bank = new Map(items.map(i => [i.name, i.count]));
        this.ctx.reportBank({ items });
        this.stats.banked += bones;
        this.ctx.log('banked', { why, bones, stock: this.bank.get('Dragon bones') ?? 0, carried: this.carried(), ...this.summary() });
        await this.bot.closeBank();
    }

    // ---- coins and shopping ----

    async fund(): Promise<void> {
        // Funders meet at Varrock West (bidder.ts fund) wherever this account stands, so never the
        // nearest bank: after a death's Lumbridge respawn that is Draynor, out of a funder's sight.
        if (!(await this.toBank(BANKS.varrockWest, true))) return;
        const senders = [...new Set(this.requests.next().map(m => m.sender))].filter(n => this.o.funders.some(p => accountMatches(n, p)));
        for (const from of senders) {
            const before = this.coins();
            const r = await receiveFrom(this.sdk, from, { openTimeoutMs: 20_000 });
            this.ctx.log('funded', { from, ok: r.ok, reason: r.reason, gained: this.coins() - before, coins: this.coins() });
        }
        if (Date.now() - this.lastWaitLog > 5 * 60_000) {
            this.lastWaitLog = Date.now();
            this.ctx.log('waiting for funding', { coins: this.coins(), need: tripCost(this.magic(), this.o, sum(this.carried(), this.bankKit()), minTripLaws(this.magic(), this.o)), at: this.pos() });
        }
        await this.sdk.waitForTicks(10);
    }

    async buy(): Promise<void> {
        // Out of the dungeon first, as every other step does: a kit that runs short mid-dungeon (a
        // few casts at the Jailer) turns the step into buy there, and the Buyer's walk cannot path
        // up a ladder, so the account stood at the jail until the Jailer killed it.
        if (!(await this.surface())) return;
        // A restart can leave the account in the guild or Kandarin: every run starts from Varrock.
        if (this.inGuild() && !(await this.leaveGuild())) return;
        const t = this.traveller();
        if (westOfTaverley(this.pos())) await crossFromKandarin(t, BANKS.faladorWest, 'Falador West bank');
        const hungry = foodOnly(this.view(), this.o);
        const buyer = new Buyer(this.ctx);
        await buyer.prepare();
        let coins = 0;
        await buyer.atBank(BANKS.varrockWest, async () => {
            const items = this.sdk.getBankItems();
            this.bank = new Map(items.map(i => [i.name, i.count]));
            coins = await buyer.setCoins(this.coins());
        });
        const held = sum(this.carried(), this.bankKit());
        const plan = hungry ? foodPlan(held, this.o) : purchasePlan(coins, this.magic(), held, this.o);
        this.ctx.log('shopping', { coins, trips: plan.trips, lines: plan.lines });
        let spent = 0;
        const buyLines = async (lines: ListLine[]) => {
            for (const line of lines) {
                if (this.ctx.signal.aborted) return;
                try {
                    const rep = line.source === 'ge' ? await buyer.buyAtGE(line) : await buyer.buyAtShop(line);
                    spent += rep.spent;
                    this.ctx.log('bought', { ...rep });
                } catch (e) {
                    this.ctx.log('buy failed', { item: line.item, error: String(e) });
                }
            }
        };
        await buyLines(plan.lines.filter(l => l.shop !== 'magicGuild'));
        // The guild only when Aubury and Betty left the trip short of its casts.
        const guildLines = plan.lines.filter(l => l.shop === 'magicGuild');
        const kit = tripKit(this.magic(), this.o);
        const castsWanted = castsAvailable(this.magic(), { ...kit, staff: 1 }, this.o.blast);
        let home = BANKS.varrockWest;
        if (guildLines.length && castsAvailable(this.magic(), sum(this.carried(), this.bankKit()), this.o.blast) < castsWanted) {
            await crossToKandarin(t, GUILD.outside, 'Magic Guild');
            // Coins stay carried if the door or stairs fail; the next cycle's buy retries.
            if (!(await this.enterGuild())) return;
            await buyLines(guildLines);
            if (this.state().shop?.isOpen) await this.bot.closeShop();
            if (!(await this.leaveGuild())) return;
            await crossFromKandarin(t, BANKS.faladorWest, 'Falador West bank');
            home = BANKS.faladorWest;
        }
        // Bank the coins and the surplus; the next cycle's bank visit takes a trip's kit.
        await buyer.atBank(home, async () => {
            await buyer.depositAllBut([]);
            await this.sdk.waitForTicks(2);
            // Read while the bank is open: a closed bank publishes no items.
            this.bank = new Map(this.sdk.getBankItems().map(i => [i.name, i.count]));
        });
        this.ctx.log('shopping done', { spent, coinsLeft: this.coins() });
    }

    // ---- the tile ----

    reach(n: NearbyNpc, spell: Spell): 'cast' | 'hold' | 'out_of_reach' {
        const grab = this.magic() >= TELEGRAB.level;
        return castDecision(SAFE_TILE, { sw: { x: n.tileX ?? n.x, z: n.tileZ ?? n.z }, size: n.size ?? 4, hp: n.hp }, grab ? spell.maxHit : -1, 9, this.los!);
    }

    async farm(): Promise<void> {
        const p = this.pos();
        if (p.x !== SAFE_TILE.x || p.z !== SAFE_TILE.z) {
            // Off the tile inside the room: the route back, or one click if a cast nudged us a tile.
            if (dist(p, SAFE_TILE) <= 1) {
                await this.sdk.sendWalk(SAFE_TILE.x, SAFE_TILE.z, false);
                await this.run.waitFor(st => st.player?.worldX === SAFE_TILE.x && st.player?.worldZ === SAFE_TILE.z, 3);
            } else {
                this.ctx.log('off the tile', { at: p });
                await this.walkRoute(true);
            }
            return;
        }
        if (!this.sdk.getEquipment().some(e => STAFF.test(e.name))) {
            await this.bot.equipItem(STAFF);
            return;
        }
        if (!this.controlsSet) {
            // controls:com_3 sets auto-retaliate off, com_4 sets running off (player_controls.rs2;
            // both set, neither toggles): nothing may walk the player off the tile, and if anything
            // does, it goes one tile per tick so the guard in watch() catches it.
            await this.sdk.sendClickComponent(151);
            await this.sdk.sendClickComponent(152);
            this.controlsSet = true;
        }
        this.los ??= await collisionLineOfSight();
        const s = this.state();
        const los = this.los;
        if (this.magic() >= TELEGRAB.level && this.freeSlots() > 0) {
            const g = (s.groundItems ?? []).find((i: GroundItem) => this.loot.test(i.name) && footprintDistance(SAFE_TILE, i, 1) >= 1 && dropGrabbable(SAFE_TILE, i, los));
            if (g) {
                const before = s.inventory.filter(i => this.loot.test(i.name)).length;
                await this.sdk.sendSpellOnGroundItem(g.x, g.z, g.id, TELEGRAB.id);
                const ok = await this.run.waitFor(st => st.inventory.filter(i => this.loot.test(i.name)).length > before, 8);
                if (ok) { this.stats.grabs++; if (/bones/i.test(g.name)) this.stats.bones++; else this.stats.hides++; } else this.stats.grabFails++;
                // Kills are counted only when a dragon's hitpoints show 0, which the published state
                // often misses; a telegrabbed drop is the rate that matters.
                if (ok) this.ctx.log('progress', this.summary());
                return;
            }
        }
        const spell = castable(this.magic(), this.carried(), this.o.blast);
        if (!spell) return;
        const target = s.nearbyNpcs.filter(n => /^blue dragon$/i.test(n.name) && (n.hp ?? 1) > 0 && !this.badSw.has(`${n.tileX ?? n.x},${n.tileZ ?? n.z}`) && this.reach(n, spell) === 'cast')
            .sort((a, b) => (a.hp ?? 999) - (b.hp ?? 999))[0];
        if (!target) { await this.sdk.waitForTicks(1); return; }
        const xp = () => this.sdk.getSkill('Magic')?.experience ?? 0;
        const before = xp();
        this.mine.add(target.index);
        const sw = { x: target.tileX ?? target.x, z: target.tileZ ?? target.z };
        this.lastCast = { tick: s.tick, spell: spell.name, npc: target.index, sw, hp: target.hp, d: footprintDistance(SAFE_TILE, sw, 4) };
        await this.sdk.sendSpellOnNpc(target.index, spell.id);
        this.stats.casts++;
        this.lastCastTick = s.tick;
        await this.run.waitFor(() => xp() > before, 6);
        await this.sdk.waitForTicks(4);
    }
}

/** Eat while walking: bones.ts eats only inside a fight, and the route in passes aggressive monsters. */
function eatGuard(ctx: RoleContext): () => void {
    let last = -99;
    return ctx.sdk.onStateUpdate(s => {
        const hp = s.skills.find(k => k.name === 'Hitpoints');
        if (!hp || hp.level <= 0 || hp.level >= hp.baseLevel * 0.5 || s.tick - last < 3 || s.bank?.isOpen) return;
        const food = s.inventory.find((i: InventoryItem) => FOOD.test(i.name));
        const eat = food?.optionsWithIndex.find(o => /^eat$/i.test(o.text));
        if (!food || !eat) return;
        last = s.tick;
        void ctx.sdk.sendUseItem(food.slot, eat.opIndex);
    });
}

export const role: Role = {
    name: 'dragons',
    produces: [/^dragon bones$/i],
    async run(ctx: RoleContext): Promise<void> {
        const o = dragonOptions(ctx.options);
        await ctx.sdk.waitForReady(60_000);
        const d = new Dragons(ctx, o);
        const unwatch = ctx.sdk.onStateUpdate(s => d.watch(s));
        const unguard = eatGuard(ctx);
        ctx.log('start', { options: { ...o, funders: o.funders.map(String) }, ...d.summary() });
        let errors = 0;
        try {
            while (!ctx.signal.aborted) {
                try {
                    await d.cycle();
                    errors = 0;
                } catch (e) {
                    errors++;
                    ctx.log('cycle error', { error: String(e), errors });
                    await new Promise(r => setTimeout(r, Math.min(30_000, 1000 * errors)));
                }
            }
        } finally {
            unwatch();
            unguard();
            ctx.log('stopped', d.summary());
        }
    }
};

if (import.meta.main) await runStandalone(role);
