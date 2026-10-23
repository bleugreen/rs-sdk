// Dragon Slayer (S26, STEP-MANIFEST.md entry 13) as runner Steps, one per segment A-L.
//
// The step starts where T25-26 leaves SCORED, north of the Champions' Guild door (3191,3364), and
// ends at Elvarg's quest-complete teleport (2846,9636) with the reward pages cleared, where T26-27's
// Ardougne teleport leaves. The route is docs/speedrun/quests/dragon_slayer.md's step list, ported
// from the lab scripts quest-dragon-guild.ts, -voyage.ts, -elvarg.ts and -wreck-probe.ts, with four
// changes:
//   - no amulet of glory (rs/123): the guild to Oziach and the dock to Ned are walked;
//   - SCORED buys the rune chainbody and platelegs from Scavvo upstairs in the guild (SUPPLIES.md
//     H22, supply-fallbacks.md section 12), and fights in them with the mithril scimitar and an
//     adamant full helm;
//   - Melzar's Maze is walked room by room (MAZE): six key fights, six coloured doors, four ladders,
//     the chest, and out through the exit room's one-way door;
//   - Elvarg is fought under Protect from Melee with Ultimate Strength and Incredible Reflexes.
//
// Stage observation. %dragonquest is server-only. The quest tab tells not started / started /
// complete; the journal (probe `journal:dragon`) has markers for stages 1, 7, 8 and 9 only
// (quest-stages.ts), so `atLeast` also takes the quest items as evidence: every map item, the maze
// key and the shield exist only from stage 2 on. The Oracle's varp has no evidence at all, so the
// Oracle and the Dwarven Mine chest are one segment (E).
//
// Logout safety. Every Dragon Slayer varp is scope=perm (quest_dragon.varp), so every segment is
// logoutSafe. Each segment's run is a list of moves, each skipped when its effect is already there
// (inside the guild, on the right floor, the item held, already on Crandor), so a segment entered
// again after a drop does not repeat a teleport or a purchase. Positions are judged by
// coordinates (rs/185 addendum 4).
//
// Death. A death keeps only the three priciest items (death.rs2 move_priciest_item_on_hero_to_death:
// the rune platelegs, rune chainbody and adamant helm) and drops the rest for 200 ticks
// (lootdrop.constant), which no return trip beats. The stage stays 9, but sailing reset
// %dragon_ned_hired and the plank count (dragonslayer_ned.rs2), and the Karamja secret wall opens
// from outside only once it was opened from Crandor (crandor.rs2 dragonsecretdoor). So segment L,
// entered anywhere off Crandor at stage 9, returns by the ship: a Dragonfire shield from the Duke,
// the re-supply (weapon, food, planks, nails, hammer) from `resupplyFrom`, Ned re-hired, the hull
// patched again, the voyage. A death inside L's fight takes the same path.
//
// Lab acceptance. Lite (PR #298, bgsrv-mac): 3 fixed and 3 burst A-L chains, burst mean 1,292.
// Browser client (rs/378, the Ashburn twin, local lab engine, burst, bundle built from ff300a82 with
// rs/309's click layer): two A-L chains, 1,424 and 1,299 ticks, and every loc-op-dialogue and
// post-landing segment (B-G, I-L) 3 of 3 from its lab fixture (lab/quests/dragon-slayer.ts). The
// 1,424 holds B's only stall in 5 B runs: 37 ticks (4 in the others) from the welcome page closing
// to the Guild master's dialogue opening; the door and the page were on time.

import type { BotWorldState, NearbyLoc, PrayerName } from '../../sdk/types';
import { measure } from '../lib/ticks';
import * as pathfinding from '../../sdk/pathfinding';
import { act, dropItems, pickup, talkTo, useOn, wield, type ActOptions } from '../lib/act';
import { fight, PRAYER_LEVELS, prayerActive, setPrayer, type FightOptions, type FightResult } from '../lib/combat';
import { converse, levelUpInterrupt, type ConverseResult } from '../lib/converse';
import type { OptionPattern } from '../lib/dialogue';
import type { ItemPattern } from '../lib/items';

import { journalProbeName, questPoints, questStatus, requireQuestStage, type QuestView } from '../lib/quests';
import { receiveFrom, type WantSpec } from '../lib/trade';
import { runTo, spellUse, sumUse, teleport, type Area, type RuneUseTable, type TravelResult } from '../lib/travel';
import { waitTicks, waitUntil, type Pred } from '../lib/wait';
import { chebyshev, configId, findLoc, invCount, invItem, opIndex, pos, waitForNpc, worn, type LocQuery } from '../lib/world';
import type { Step, StepContext } from '../runner/step';
import { allOf, baseLevels, kitSegment, kitWant, questSteps, slotsCover, talkShape, type KitItem, type QuestItem, type QuestOptions, type Segment } from './segments';

export const quest = 'dragon' as const;
export const stepId = 'S26';

export interface Options extends QuestOptions {
    /** Buy the rune chainbody and platelegs from Scavvo (default true). False: go on in whatever is worn. */
    buyArmour?: boolean;
    /** Ticks going on without the rune armour costs (the Elvarg fight's difference), for the stock-0 rule. Default ARMOURLESS_COST. */
    armourlessCost?: number;
    /** Prayers for the Elvarg fight, each used only when the Prayer level allows it. Default ELVARG_PRAYERS; [] for none. */
    elvargPrayers?: readonly PrayerName[];
    /** Eat a shark below this fraction of max hitpoints (default 0.5). */
    eatBelow?: number;
    /** The helper who brings the death re-supply (DEATH_KIT). Without one, a death return stops with what is missing. */
    resupplyFrom?: string;
    /** Deaths the Elvarg segment returns from before it gives up (default 1). */
    maxDeaths?: number;
}

export const ELVARG_PRAYERS: readonly PrayerName[] = ['protect_from_melee', 'ultimate_strength', 'incredible_reflexes'];

// ------------------------------------------------------------------ items

/** Items by display name; the map parts share a name, so they go by config id. */
export const ITEM = {
    coins: /^Coins$/i,
    mindBomb: /^Wizard's mind bomb$/i,
    silk: /^Silk$/i,
    lobsterPot: /^Lobster pot$/i,
    unfiredBowl: /^Unfired bowl$/i,
    plank: /^Plank$/i,
    nails: /^Nails$/i,
    hammer: /^Hammer$/i,
    /** H22's rune scimitar (main, 20:52), or H11's mithril one as the fallback. */
    scimitar: /^(Rune|Mithril) scimitar$/i,
    runeScimitar: /^Rune scimitar$/i,
    /** Any weapon the death re-supply may bring. */
    weapon: /scimitar|longsword|sword|battleaxe|mace/i,
    helm: /^Adamant full helm$/i,
    amulet: /^Amulet of strength$/i,
    shark: /^Shark$/i,
    law: /^Law rune$/i,
    air: /^Air rune$/i,
    earth: /^Earth rune$/i,
    water: /^Water rune$/i,
    chainbody: /^Rune chainbody$/i,
    platelegs: /^Rune platelegs$/i,
    shield: /^Dragonfire shield$/i,
    key: /^Maze key$/i,
    /** The six coloured maze keys, one held at a time: each disintegrates in its door (melzars_maze.rs2). */
    doorKey: /^Key$/i,
    crandorMap: /^Crandor map$/i,
    /** Monkey Madness's amulet, swapped off at H22 for the amulet of strength: dead, dropped in S26 (the inventory ledger). */
    mspeak: /^M'speak amulet$/i,
} as const;

/** The three map parts (all named "Map part") by config id: part 1 Melzar's chest, 2 Wormbrain, 3 the Dwarven Mine chest. */
export function mapPartId(n: 1 | 2 | 3): number {
    return configId('obj', `mappart${n}`);
}

/** Scavvo's prices (champions_guild.npc shop_sell_multiplier 1000: the base cost, chainbodies.obj, platelegs.obj). */
export const SCAVVO = { chainbody: 50_000, platelegs: 64_000 } as const;
/**
 * Scavvo's restock: one unit back on each world tick that is a multiple of the item's rate while it is
 * under its stock of 1 (server/engine/src/engine/World.ts:1377; rates from champions_guild.inv
 * runiteshop: chainbody 15000, platelegs 11500). The client cannot see the world tick's phase, so a
 * wait is priced at its expectation, half the rate.
 */
export const SCAVVO_RESTOCK = { chainbody: 15_000, platelegs: 11_500 } as const;
/**
 * What going on without the rune chainbody and platelegs costs at Elvarg: measured on the lab at
 * 99/97/89 in mithril, n=3 each, the segment took 106.7 ticks without against 107 with (Protect from
 * Melee leaves only her capped dragonfire), with 0.7 more sharks eaten; 5 covers the food.
 */
export const ARMOURLESS_COST = 5;

/** Expected ticks until every missing piece is back in stock: the longest of the missing pieces' half-rates. */
export function restockWait(missing: ReadonlyArray<keyof typeof SCAVVO_RESTOCK>): number {
    return missing.reduce((a, k) => Math.max(a, SCAVVO_RESTOCK[k] / 2), 0);
}

/** At stock 0: wait for the restock only when that is expected to cost less than going on without the armour. */
export function stockZeroChoice(waitTicks: number, armourlessTicks: number): 'wait' | 'go-on' {
    return waitTicks < armourlessTicks ? 'wait' : 'go-on';
}

/** Wormbrain's 10,000 (wormbrain.rs2) and the ship's 2,000 (klarense.rs2). */
export const QUEST_COINS = 12_000;

/**
 * H22 as this step uses it (SUPPLIES.md): the quest items, the planks, nails and hammer, 10 sharks,
 * one Lumbridge and one Falador cast, and the coins. The scimitar (H22's rune one; H11's mithril one
 * as the fallback), adamant helm and amulet are worn or held; KIT_WORN checks them. H22's Ardougne runes are T26-27's;
 * it carries no Varrock set, since nothing from T25-26 to T26-27 casts one (rs/158's ruling).
 */
export function kitItems(opts: Options = {}): KitItem[] {
    const buy = opts.buyArmour ?? true;
    return [
        { item: ITEM.coins, n: QUEST_COINS + (buy ? SCAVVO.chainbody + SCAVVO.platelegs : 0) },
        { item: ITEM.mindBomb }, { item: ITEM.silk }, { item: ITEM.lobsterPot }, { item: ITEM.unfiredBowl },
        { item: ITEM.plank, n: 3 }, { item: ITEM.nails, n: 12 }, { item: ITEM.hammer },
        { item: ITEM.shark, n: 10 },
        { item: ITEM.law, n: 2 }, { item: ITEM.air, n: 6 }, { item: ITEM.earth, n: 1 }, { item: ITEM.water, n: 1 },
    ];
}

/**
 * The step's runes on the route (lib/travel.ts RuneUseTable): Lumbridge at F (to the Duke), Falador at
 * G (to the maze). No staff is worn: H22 takes the staff of fire back.
 */
export const RUNE_USE: RuneUseTable = { F: spellUse('lumbridge'), G: spellUse('falador') };

/** What A's kit (kitItems) wants held: both casts' runes. */
export const RUNE_NEED: RuneUseTable = { A: sumUse(RUNE_USE.F!, RUNE_USE.G!) };

export const KIT_WORN: ReadonlyArray<[string, RegExp]> = [['a rune (or mithril) scimitar', ITEM.scimitar], ['adamant full helm', ITEM.helm], ['amulet of strength', ITEM.amulet]];

/** The death re-supply: a weapon, food, and a second hull patch. The Duke gives the shield again. */
export const DEATH_KIT: KitItem[] = [{ item: ITEM.weapon }, { item: ITEM.shark, n: 8 }, { item: ITEM.plank, n: 3 }, { item: ITEM.nails, n: 12 }, { item: ITEM.hammer }];

/** The step's segment letters, in order. */
export const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'] as const;

/**
 * How long each kit line stays in the pack. `until` is where the line certainly leaves it (slotNeed
 * credits its slots after that), so it is set only on unstackables the content takes one for one. A
 * stack keeps its slot past the step: the kit check is 'at least', so coins (Scavvo's stock-0 'go on'
 * keeps 114,000), nails and earth runes can outlive their last use. The hammer goes on T26-27.
 */
const KIT_HELD = new Map<ItemPattern, Pick<QuestItem, 'until' | 'stackable'>>([
    [ITEM.coins, { stackable: true }],
    [ITEM.mindBomb, { until: 'E' }], [ITEM.silk, { until: 'E' }], [ITEM.lobsterPot, { until: 'E' }], [ITEM.unfiredBowl, { until: 'E' }], // magic_door.rs2 inv_del
    [ITEM.plank, { until: 'I' }], // lady_lumbridge.rs2: one per patch, three patches
    [ITEM.nails, { stackable: true }],
    [ITEM.hammer, {}], [ITEM.shark, {}],
    [ITEM.law, { stackable: true }], [ITEM.air, { stackable: true }], [ITEM.water, { stackable: true }], [ITEM.earth, { stackable: true }],
]);

const label = (p: ItemPattern) => (p instanceof RegExp ? p.source.replace(/^\^|\$$/g, '') : String(p));

/**
 * Everything the step holds, for the free-slot checks (brief addendum 8): H22's kit as segment A
 * receives it, each line until it is handed in, then what the content gives. The need peaks at C
 * (Scavvo's two pieces, bought before they are worn): 2, which is what SCORED arrives with free.
 */
export function questItems(opts: Options = {}): QuestItem[] {
    const kit = kitItems(opts).map(k => {
        const held = KIT_HELD.get(k.item);
        if (!held) throw new Error(`questItems: no hand-in segment for kit line ${String(k.item)}`);
        return { item: k.item, name: label(k.item), ...(k.n ? { n: k.n } : {}), from: 'A', ...held };
    });
    return [
        ...kit,
        ...((opts.buyArmour ?? true) ? [{ item: ITEM.chainbody, name: 'Rune chainbody', from: 'C', until: 'C' }, { item: ITEM.platelegs, name: 'Rune platelegs', from: 'C', until: 'C' }] : []),
        { item: ITEM.key, name: 'Maze key', from: 'D', until: 'L' }, // oziach.rs2; dropped at L's exit
        { item: mapPartId(3), name: 'Map part 3', from: 'E', until: 'H' },
        { item: ITEM.shield, name: 'Dragonfire shield', from: 'F', until: 'F' }, // worn as given
        { item: ITEM.doorKey, name: 'Maze door key', from: 'G', until: 'G' },
        { item: mapPartId(1), name: 'Map part 1', from: 'G', until: 'H' },
        { item: mapPartId(2), name: 'Map part 2', from: 'H', until: 'H' },
        // crandor_map.rs2 joins the three parts into the map in place, so H's peak is the parts and the map counts from I.
        { item: ITEM.crandorMap, name: 'Crandor map', from: 'I', until: 'J' },
    ];
}

// ------------------------------------------------------------------ places

/** A loc by tile and loc.pack id; `op` is its first option, used when the client does not list it (bridged levels). */
interface LocAt {
    x: number;
    z: number;
    id: number;
    name: string;
    op: string;
    level?: number;
}

export const LOCS = {
    guildDoor: { x: 3191, z: 3363, id: 1805, name: 'Door', op: 'Open' },
    guildStairs: { x: 3188, z: 3355, id: 1722, name: 'Staircase', op: 'Climb-up' },
    guildStairsTop: { x: 3188, z: 3355, id: 1723, name: 'Staircase', op: 'Climb-down', level: 1 },
    iceTrapdoor: { x: 3019, z: 3450, id: 1570, name: 'Trapdoor', op: 'Climb-down' },
    magicDoor: { x: 3051, z: 9840, id: 2586, name: 'Magic door', op: 'Open' },
    mineChest: { x: 3057, z: 9841, id: 2587, name: 'Chest', op: 'Open' },
    lumbridgeStairs: { x: 3204, z: 3229, id: 1738, name: 'Staircase', op: 'Climb-up' },
    mazeDoor: { x: 2941, z: 3248, id: 2595, name: 'Door', op: 'Open' },
    mazeChest: { x: 2935, z: 9657, id: 2603, name: 'Chest', op: 'Open' },
    mazeExitLadder: { x: 2939, z: 9657, id: 1755, name: 'Ladder', op: 'Climb-up' },
    gangplankOn: { x: 3047, z: 3205, id: 2593, name: 'Gangplank', op: 'Cross', level: 1 },
    gangplankOff: { x: 3047, z: 3206, id: 2594, name: 'Gangplank', op: 'Cross', level: 1 },
    deckLadder: { x: 3049, z: 3208, id: 2590, name: 'Ladder', op: 'Climb-down', level: 1 },
    shipHole: { x: 3047, z: 9639, id: 2589, name: 'Hole', op: 'Examine', level: 1 },
    holdLadder: { x: 3048, z: 9640, id: 2592, name: 'Ladder', op: 'Climb-up', level: 2 },
    rockOpening: { x: 2833, z: 3255, id: 2609, name: 'Rock opening', op: 'Climb-down' },
    lairGate: { x: 2847, z: 9637, id: 2608, name: 'Gate', op: 'Open' },
} as const satisfies Record<string, LocAt>;

export const TILES = {
    /** Where T25-26 leaves SCORED (RUN-ORDER.md), north of the guild door. */
    arrival: { x: 3191, z: 3364 },
    guildmaster: { x: 3191, z: 3362 },
    scavvo: { x: 3191, z: 3351, level: 1 },
    oziach: { x: 3069, z: 3517 },
    oracle: { x: 3015, z: 3504 },
    magicDoorOutside: { x: 3050, z: 9840 },
    duke: { x: 3212, z: 3220, level: 1 },
    mazeOutside: { x: 2942, z: 3248 },
    wormbrain: { x: 3014, z: 3186 },
    dock: { x: 3047, z: 3203 },
    ned: { x: 3100, z: 3258 },
    rockFoot: { x: 2834, z: 3253 },
    lairGateOutside: { x: 2846, z: 9637 },
    /** quest_dragon.rs2 dragon_complete: p_teleport(0_44_150_30_36). */
    exit: { x: 2846, z: 9636 },
} as const;

type Box = readonly [x0: number, x1: number, z0: number, z1: number, level?: number];
const inBox = (s: BotWorldState, [x0, x1, z0, z1, level]: Box) => {
    const p = pos(s);
    return p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1 && (level === undefined || p.level === level);
};

export const AREAS = {
    /** North of the guild door, where the legs arrive. */
    guildOutside: [3180, 3200, 3363, 3372, 0],
    /** The guild's ground floor (the door's wall is the north edge of z 3362). */
    guildGround: [3183, 3199, 3345, 3362, 0],
    guildUpstairs: [3183, 3199, 3345, 3362, 1],
    dwarvenMine: [2990, 3070, 9800, 9870, 0],
    /** Behind the magic door. */
    oracleRoom: [3051, 3062, 9836, 9846, 0],
    lumbridgeCastle: [3200, 3230, 3200, 3240],
    /** Melzar's Maze, any floor (the front door's wall is the west edge of x 2941). */
    maze: [2918, 2940, 3236, 3262],
    mazeCellar: [2918, 2945, 9635, 9665, 0],
    /** The Lady Lumbridge: the deck (level 1-3 on the dock tiles) and the hold (z ~9640). */
    shipDeck: [3040, 3056, 3205, 3215],
    shipHold: [3040, 3056, 9632, 9648],
    crandorSurface: [2805, 2880, 3215, 3315, 0],
    crandorDungeon: [2820, 2870, 9590, 9670, 0],
    /** quest_dragon.rs2:27, 0_44_150_31_28 to 0_44_150_47_46. */
    lair: [2847, 2863, 9628, 9646, 0],
} as const satisfies Record<string, Box>;

const ELVARG = /^Elvarg$/i;
const NED = /^Ned$/i;

// ------------------------------------------------------------------ evidence

const stateOf = (o: QuestView): BotWorldState => ('probed' in o ? o.state : o);

/** Held or worn. */
export function has(s: BotWorldState, item: ItemPattern): boolean {
    return invItem(s, item) !== null || worn(s, item) !== null;
}

export function hasMapPart(s: BotWorldState, n: 1 | 2 | 3): boolean {
    return invItem(s, mapPartId(n)) !== null;
}

/** Stage 2 or later shown by items: the maze key, a map part, the Crandor map or the shield exist only once Oziach has spoken. */
function itemsShowOziach(s: BotWorldState): boolean {
    return has(s, ITEM.key) || has(s, ITEM.crandorMap) || has(s, ITEM.shield) || ([1, 2, 3] as const).some(n => hasMapPart(s, n));
}

const STAGES = { spoken_to_guildmaster: 1, spoken_to_oziach: 2, bought_ship: 3, repaired_ship: 7, ned_given_map: 8, sailed_to_crandor: 9, complete: 10 } as const;
type Stage = keyof typeof STAGES;

/** The quest is at `stage` or later, from the tab and journal (requireQuestStage), or for stage 2 from the items. */
export function atLeast(o: QuestView, stage: Stage): boolean {
    const s = stateOf(o);
    const status = questStatus(s, quest);
    if (status === 'complete') return true;
    if (status !== 'started') return false;
    if (STAGES[stage] <= 1) return true;
    if (stage === 'spoken_to_oziach' && itemsShowOziach(s)) return true;
    return requireQuestStage(o, quest, stage, { atLeast: true }) === true;
}

export const PROBES = [journalProbeName(quest)] as const;

export function onCrandor(s: BotWorldState): boolean {
    return inBox(s, AREAS.crandorSurface) || inBox(s, AREAS.crandorDungeon);
}

// ------------------------------------------------------------------ checks

const ok = (cond: boolean, why: string): true | string => (cond ? true : why);

/** STEP-MANIFEST.md entry 13's preconditions apart from the kit: 32 QP, the quest not started, gear levels, the arrival tile. */
export function entryCheck(s: BotWorldState): true | string {
    const qp = questPoints(s);
    if (qp === null) return 'quest points not observable';
    if (qp < 32) return `${qp} quest points: the Champions' Guild door needs 32 (champions_guild.rs2:2)`;
    const st = questStatus(s, quest);
    if (st === null) return 'the quest tab is not observable';
    if (st !== 'not_started') return `Dragon Slayer is already ${st}`;
    const lv = baseLevels({ defence: 40, attack: 20, magic: 37 })(s, {});
    if (lv !== true) return `${lv} (rune armour needs Defence 40; Falador teleport Magic 37)`;
    if (!inBox(s, AREAS.guildOutside) && !inBox(s, AREAS.guildGround)) return `not at the Champions' Guild door (at ${pos(s).x},${pos(s).z},${pos(s).level})`;
    return true;
}

/** The kit's worn part: scimitar, helm and amulet each held or worn. */
export function wornKitCheck(s: BotWorldState): true | string {
    const missing = KIT_WORN.filter(([, re]) => !has(s, re)).map(([n]) => n);
    return ok(!missing.length, `missing ${missing.join(', ')} (H11 / H22)`);
}

const holds = (item: ItemPattern, n: number, what: string) => (s: BotWorldState): true | string =>
    ok(invCount(s, item) >= n, `holds ${invCount(s, item)} ${what}, needs ${n}`);

/**
 * State-only (preconditions see no journal): the quest is started and no map item is held, which
 * after segment J means Ned has the map (ned.rs2 give_map_to_ned deletes it).
 */
export function mapWithNed(s: BotWorldState): boolean {
    return questStatus(s, quest) === 'started' && !has(s, ITEM.crandorMap) && !([1, 2, 3] as const).some(n => hasMapPart(s, n));
}

const armourHeld = (s: BotWorldState) => has(s, ITEM.chainbody) && has(s, ITEM.platelegs);

// ------------------------------------------------------------------ moves

type Ctx = StepContext<any>;
type Sdk = Ctx['sdk'];
const INTERRUPTS = () => [levelUpInterrupt()];

function fail(where: string, what: string): never {
    throw new Error(`${stepId}:${where}: ${what}`);
}

function need(where: string, r: { ok: boolean; reason?: string }, what: string, sdk: Sdk): void {
    if (!r.ok) throw new Error(`${stepId}:${where}: ${what} failed${r.reason ? ` (${r.reason})` : ''} at ${JSON.stringify(pos(sdk))}`);
}

async function travelled(where: string, sdk: Sdk, r: Promise<TravelResult>, what: string): Promise<TravelResult> {
    const t = await r;
    if (!t.ok) throw new Error(`${stepId}:${where}: ${what} failed (${t.reason ?? 'no reason'}) at ${JSON.stringify(t.at)}`);
    return t;
}

/** The loc at a tile: from the published or scanned list, else built from its id (the client omits bridged-level locs). */
export async function locAt(sdk: Sdk, l: LocAt): Promise<NearbyLoc> {
    const seen = await findLoc(sdk, { x: l.x, z: l.z, id: l.id });
    if (seen) return seen;
    return { id: l.id, name: l.name, x: l.x, z: l.z, level: l.level ?? pos(sdk).level, distance: 0, options: [l.op], optionsWithIndex: [{ text: l.op, opIndex: 1 }] } as unknown as NearbyLoc;
}

/** Operate a loc's option until `arrived`. */
async function operate(where: string, sdk: Sdk, l: LocAt, op: RegExp, arrived: Pred, opts: ActOptions = {}): Promise<void> {
    const loc = await locAt(sdk, l);
    const o = opIndex(loc, op) ?? 1;
    const r = await act(sdk, () => sdk.sendInteractLoc(loc.x, loc.z, loc.id, o), arrived, { maxTicks: 40, interrupts: INTERRUPTS(), ...opts });
    need(where, r, `${l.name} at ${l.x},${l.z} (${op.source})`, sdk);
}

async function runToArea(where: string, sdk: Sdk, to: Area, what: string, via?: ReadonlyArray<{ x: number; z: number }>): Promise<void> {
    if (chebyshev(pos(sdk), to) <= (to.tol ?? 0) && pos(sdk).level === (to.level ?? 0)) return;
    await travelled(where, sdk, runTo(sdk, to, via ? { via } : {}), `run to ${what}`);
}

/** Talk and answer; fails unless the conversation opened and ended. */
async function talk(where: string, ctx: Ctx, opts: Options, npc: RegExp, choices: OptionPattern[], shape: string, extra: { until?: Pred; maxTicks?: number; near?: { x: number; z: number } } = {}): Promise<ConverseResult> {
    const sdk = ctx.sdk;
    const o = { ...talkShape(opts, shape), interrupts: INTERRUPTS(), unmatched: 'stop' as const, maxTicks: extra.maxTicks ?? 120, ...(extra.until ? { until: extra.until } : {}), ...(extra.near ? { near: extra.near } : {}) };
    let r = await talkTo(sdk, npc, choices, o);
    if (!r.opened) {
        // A talk click is never routed through a closed door: an NPC that wandered to the other side of
        // one (Oziach out of his hut) is walked to first, the walker opening doors on the way.
        const n = await waitForNpc(sdk, npc, 5, extra.near);
        if (n) {
            await runToArea(where, sdk, { x: n.x, z: n.z, level: pos(sdk).level, tol: 1 }, npc.source);
            r = await talkTo(sdk, npc, r.remaining, o);
        }
    }
    if (!r.ok || !r.opened) fail(where, `talking to ${npc.source}: ${r.reason ?? (r.opened ? 'did not finish' : 'no dialogue opened')}; ${r.transcript.slice(-3).join(' / ')}`);
    return r;
}

/** Answer whatever dialogue is open (a mesbox after an item use, a page after a door). */
async function clearDialogue(sdk: Sdk, opts: Options, shape?: string): Promise<void> {
    if (!sdk.getState()?.dialog.isOpen) return;
    await converse(sdk, [], { ...(shape ? talkShape(opts, shape) : {}), interrupts: INTERRUPTS(), unmatched: 'first', openTicks: 2, idle: 2, maxTicks: 40 });
}

/** Wear every listed item that is held and not worn, one click each. */
async function wearAll(where: string, sdk: Sdk, items: readonly RegExp[]): Promise<void> {
    for (const it of items) {
        // A weapon pattern is skipped once a rune scimitar is worn, so the fallback never replaces it.
        if (worn(sdk, it) || !invItem(sdk, it) || (it !== ITEM.runeScimitar && /scimitar|sword|weapon/i.test(it.source) && worn(sdk, ITEM.runeScimitar))) continue;
        need(where, await wield(sdk, it, { maxTicks: 8 }), `wear ${it.source}`, sdk);
    }
}

const GEAR = [ITEM.chainbody, ITEM.platelegs, ITEM.helm, ITEM.runeScimitar, ITEM.scimitar, ITEM.amulet, ITEM.shield];

// ---- the guild

/** From the arrival side of the guild door to inside it, the Guildmaster's welcome page answered. */
async function enterGuild(where: string, ctx: Ctx, opts: Options): Promise<void> {
    const sdk = ctx.sdk;
    if (inBox(sdk.getState()!, AREAS.guildUpstairs)) {
        await operate(where, sdk, LOCS.guildStairsTop, /climb-down/i, s => pos(s).level === 0);
        return;
    }
    if (inBox(sdk.getState()!, AREAS.guildGround)) return;
    await operate(where, sdk, LOCS.guildDoor, /^open$/i, s => inBox(s, AREAS.guildGround), { maxTicks: 30 });
    // champions_guild.rs2: the Guildmaster's welcome page when entering.
    await waitUntil(sdk, s => s.dialog.isOpen, { maxTicks: 2 });
    await clearDialogue(sdk, opts, '1c');
}

async function leaveGuild(where: string, ctx: Ctx): Promise<void> {
    const sdk = ctx.sdk;
    if (inBox(sdk.getState()!, AREAS.guildUpstairs)) await operate(where, sdk, LOCS.guildStairsTop, /climb-down/i, s => pos(s).level === 0);
    if (!inBox(sdk.getState()!, AREAS.guildGround)) return;
    await operate(where, sdk, LOCS.guildDoor, /^open$/i, s => !inBox(s, AREAS.guildGround), { maxTicks: 30 });
}

/**
 * Scavvo's shop: buy what is missing of the chainbody and platelegs, then close it. A piece out of
 * stock (the shop is shared) takes stockZeroChoice: wait for the restock, or go on without the armour.
 * Returns whether SCORED now holds both.
 */
async function buyFromScavvo(where: string, ctx: Ctx, opts: Options): Promise<boolean> {
    const sdk = ctx.sdk;
    const pieces = [['chainbody', ITEM.chainbody], ['platelegs', ITEM.platelegs]] as const;
    const want = () => pieces.filter(([, re]) => !has(sdk.getState()!, re));
    if (!want().length) return true;
    const scavvo = await waitForNpc(sdk, /^Scavvo$/i, 10);
    if (!scavvo) fail(where, 'Scavvo not in sight upstairs');
    const trade = opIndex(scavvo, /^trade$/i) ?? 3;
    need(where, await act(sdk, () => sdk.sendInteractNpc(scavvo.index, trade), s => s.shop.isOpen, { maxTicks: 30 }), 'open Scavvo\'s shop', sdk);
    const line = (re: RegExp) => sdk.getState()!.shop.shopItems.find(i => re.test(i.name));
    const out = want().filter(([, re]) => (line(re)?.count ?? 0) < 1).map(([k]) => k);
    if (out.length) {
        const wait = restockWait(out);
        const choice = stockZeroChoice(wait, opts.armourlessCost ?? ARMOURLESS_COST);
        console.log(`[${stepId}:${where}] Scavvo is out of ${out.join(' and ')}: restock expected in ~${wait} ticks against ~${opts.armourlessCost ?? ARMOURLESS_COST} without the armour; ${choice}`);
        if (choice === 'go-on') {
            await sdk.sendCloseShop();
            await waitUntil(sdk, s => !s.shop.isOpen, { maxTicks: 5 });
            return false;
        }
        const back = await waitUntil(sdk, () => want().every(([, re]) => (line(re)?.count ?? 0) >= 1), { maxTicks: Math.max(...out.map(k => SCAVVO_RESTOCK[k])) + 10 });
        if (!back.ok) fail(where, 'Scavvo never restocked');
    }
    const lines = want().map(([, re]) => line(re)!);
    const cost = lines.reduce((a, l) => a + l.buyPrice, 0);
    if (invCount(sdk, ITEM.coins) < cost) fail(where, `the armour costs ${cost}, holding ${invCount(sdk, ITEM.coins)} coins`);
    const r = await act(sdk, () => Promise.all(lines.filter(l => !invItem(sdk, l.name)).map(l => sdk.sendShopBuy(l.slot, 1))), s => want().length === 0 || pieces.every(([, re]) => has(s, re)), { maxTicks: 10, resendEvery: 3, maxResends: 2 });
    need(where, r, 'buy the rune chainbody and platelegs', sdk);
    await sdk.sendCloseShop();
    await waitUntil(sdk, s => !s.shop.isOpen, { maxTicks: 5 });
    return true;
}

// ---- the map pieces

async function oracleAndChest(where: string, ctx: Ctx, opts: Options): Promise<void> {
    const sdk = ctx.sdk;
    if (hasMapPart(sdk.getState()!, 3) || has(sdk.getState()!, ITEM.crandorMap)) return;
    const underground = (s: BotWorldState) => inBox(s, AREAS.dwarvenMine);
    if (!underground(sdk.getState()!)) {
        await measure(ctx.log, ctx.session, `${stepId}:${where}/walk-oracle`, () => runToArea(where, sdk, { x: TILES.oracle.x + 1, z: TILES.oracle.z - 1, tol: 2 }, 'the Oracle'));
        await talk(where, ctx, opts, /^Oracle$/i, [/seek a piece of the map/i], 'opt, 3c');
        await measure(ctx.log, ctx.session, `${stepId}:${where}/walk-trapdoor`, () => runToArea(where, sdk, { x: LOCS.iceTrapdoor.x, z: LOCS.iceTrapdoor.z + 1, tol: 1 }, 'the Ice Mountain trapdoor'));
        await operate(where, sdk, LOCS.iceTrapdoor, /climb-down/i, underground);
    }
    if (!inBox(sdk.getState()!, AREAS.oracleRoom)) {
        await runToArea(where, sdk, { ...TILES.magicDoorOutside, tol: 0 }, 'the magic door');
        await operate(where, sdk, LOCS.magicDoor, /^open$/i, s => inBox(s, AREAS.oracleRoom), { maxTicks: 20 });
    }
    await searchChest(where, ctx, opts, LOCS.mineChest, 3);
}

/** Open a quest chest (oploc1 on the shut loc), search it (oploc1 on the open loc) and answer the mesbox that adds the part. */
async function searchChest(where: string, ctx: Ctx, opts: Options, chest: LocAt, part: 1 | 3): Promise<void> {
    const sdk = ctx.sdk;
    const got = (s: BotWorldState) => hasMapPart(s, part);
    for (let attempt = 0; attempt < 3 && !got(sdk.getState()!); attempt++) {
        const loc = await findLoc(sdk, { x: chest.x, z: chest.z, name: /chest/i });
        if (!loc) fail(where, `no chest at ${chest.x},${chest.z}`);
        const search = opIndex(loc, /^search$/i);
        if (search === undefined) {
            const open = opIndex(loc, /^open$/i) ?? 1;
            const r = await act(sdk, () => sdk.sendInteractLoc(loc.x, loc.z, loc.id, open), s => s.nearbyLocs.some(l => l.x === chest.x && l.z === chest.z && opIndex(l, /^search$/i) !== undefined), { maxTicks: 20 });
            need(where, r, 'open the chest', sdk);
            continue;
        }
        // The mesbox comes first and the part is added once it is answered (melzars_maze.rs2, magic_door.rs2).
        const r = await act(sdk, () => sdk.sendInteractLoc(loc.x, loc.z, loc.id, search), s => s.dialog.isOpen || got(s), { maxTicks: 20 });
        need(where, r, 'search the chest', sdk);
        await clearDialogue(sdk, opts, '1c');
        await waitUntil(sdk, got, { maxTicks: 3 });
    }
    if (!got(sdk.getState()!)) fail(where, `the chest gave no map part ${part}`);
}

async function duke(where: string, ctx: Ctx, opts: Options): Promise<void> {
    const sdk = ctx.sdk;
    if (!has(sdk.getState()!, ITEM.shield)) {
        if (!inBox(sdk.getState()!, AREAS.lumbridgeCastle)) await travelled(where, sdk, teleport(sdk, 'lumbridge'), 'Lumbridge teleport');
        if (pos(sdk).level === 0) {
            await runToArea(where, sdk, { x: LOCS.lumbridgeStairs.x + 1, z: LOCS.lumbridgeStairs.z - 1, tol: 1 }, 'the castle stairs');
            await operate(where, sdk, LOCS.lumbridgeStairs, /climb-up/i, s => pos(s).level === 1);
        }
        await runToArea(where, sdk, { x: TILES.duke.x - 1, z: TILES.duke.z, level: 1, tol: 2 }, 'the Duke');
        await talk(where, ctx, opts, /^Duke Horacio$/i, [/seek a shield/i], '1c, opt, 3c', { until: s => has(s, ITEM.shield) });
    }
    await wearAll(where, sdk, [ITEM.shield]);
}

/** A maze door or ladder by tile and loc.pack id (melzars_maze.rs2; m45_50 / m45_150). */
const M = (x: number, z: number, id: number, name: string, op: string, level = 0): LocAt => ({ x, z, id, name, op, level });
export const MAZE_LOCS = {
    red: M(2926, 3253, 2596, 'Door', 'Open'),
    ladder1: M(2928, 3256, 1747, 'Ladder', 'Climb-up'),
    orange: M(2931, 3253, 2597, 'Door', 'Open', 1),
    ladder2: M(2934, 3254, 1747, 'Ladder', 'Climb-up', 1),
    yellow: M(2924, 3249, 2598, 'Door', 'Open', 2),
    down2: M(2940, 3240, 1746, 'Ladder', 'Climb-down', 2),
    down1: M(2937, 3240, 1746, 'Ladder', 'Climb-down', 1),
    cellar: M(2932, 3240, 2605, 'Ladder', 'Climb-down'),
    blue: M(2931, 9643, 2599, 'Door', 'Open'),
    magenta: M(2929, 9652, 2600, 'Door', 'Open'),
    green: M(2936, 9655, 2601, 'Door', 'Open'),
    /** The exit room's one-way door: it opens only from the exit room's side (melzars_maze.rs2 oploc1,funexit). */
    exit: M(2938, 3252, 2602, 'Door', 'Open'),
} as const;

/** Every door the maze locks, for the offline room test (the bundled pathfinder treats doors as open). */
const MAZE_DOORS: ReadonlyArray<readonly [number, number, number]> = [
    [0, 2941, 3248], [0, 2926, 3244], [0, 2926, 3248], [0, 2926, 3253], [1, 2931, 3247], [1, 2931, 3250], [1, 2931, 3253], [1, 2931, 3256],
    [2, 2924, 3249], [2, 2928, 3249], [2, 2931, 3249], [2, 2936, 3256], [0, 2931, 9643], [0, 2929, 9652], [0, 2936, 9655], [0, 2938, 3252],
    [0, 2924, 9654], [0, 2927, 9649], [0, 2931, 9640],
];
let mazeBlocks: pathfinding.DoorInfo[] | null = null;

/** True when (x, z) on `level` is in the player's room: reachable with every maze door shut. */
export function sameRoom(s: BotWorldState, x: number, z: number, level = 0): boolean {
    const p = pos(s);
    if (p.level !== level) return false;
    if (p.x === x && p.z === z) return true;
    mazeBlocks ??= MAZE_DOORS.map(([l, dx, dz]) => pathfinding.getDoorAt(l, dx, dz)).filter((d): d is pathfinding.DoorInfo => d !== undefined);
    const w = pathfinding.findLongPath(level, p.x, p.z, x, z, 200, mazeBlocks);
    const end = w[w.length - 1];
    return end !== undefined && end.x === x && end.z === z;
}

/** One move through the maze: where it starts (a tile in its room), and what it does from there. */
interface MazeMove {
    label: string;
    room: { x: number; z: number; level?: number };
    /** Only for this half of the trip (the entrance room is both the first and the last room). */
    withPart?: boolean;
    kill?: { npc: string; key: string };
    loc?: LocAt;
    /** Use this key on `loc` (a coloured door); without it, `loc` is operated. */
    key?: string;
    /** The move's effect. */
    through: Pred;
}

const lvl = (n: number) => (s: BotWorldState) => pos(s).level === n;
export const MAZE: readonly MazeMove[] = [
    { label: 'rat, red door', room: { x: 2930, z: 3252 }, withPart: false, kill: { npc: 'dragonslayer_giantrat', key: 'redkey' }, loc: MAZE_LOCS.red, key: 'redkey', through: s => lvl(0)(s) && pos(s).x <= 2925 },
    { label: 'ladder up', room: { x: 2928, z: 3255 }, loc: MAZE_LOCS.ladder1, through: lvl(1) },
    { label: 'ghost, orange door', room: { x: 2929, z: 3249, level: 1 }, kill: { npc: 'dragonslayer_ghost', key: 'orangekey' }, loc: MAZE_LOCS.orange, key: 'orangekey', through: s => lvl(1)(s) && pos(s).x >= 2931 },
    { label: 'ladder up', room: { x: 2934, z: 3255, level: 1 }, loc: MAZE_LOCS.ladder2, through: lvl(2) },
    { label: 'skeleton, yellow door', room: { x: 2923, z: 3251, level: 2 }, kill: { npc: 'dragonslayer_skeleton', key: 'yellowkey' }, loc: MAZE_LOCS.yellow, key: 'yellowkey', through: s => lvl(2)(s) && pos(s).z <= 3249 },
    { label: 'ladder down', room: { x: 2940, z: 3241, level: 2 }, loc: MAZE_LOCS.down2, through: lvl(1) },
    { label: 'ladder down', room: { x: 2937, z: 3241, level: 1 }, loc: MAZE_LOCS.down1, through: lvl(0) },
    { label: 'cellar ladder', room: { x: 2932, z: 3241 }, loc: MAZE_LOCS.cellar, through: s => pos(s).z > 9000 },
    { label: 'zombie, blue door', room: { x: 2932, z: 9641 }, kill: { npc: 'dragonslayer_zombie', key: 'bluekey' }, loc: MAZE_LOCS.blue, key: 'bluekey', through: s => pos(s).z > 9000 && pos(s).x <= 2930 },
    { label: 'Melzar, magenta door', room: { x: 2930, z: 9643 }, kill: { npc: 'melzar_the_mad', key: 'magentakey' }, loc: MAZE_LOCS.magenta, key: 'magentakey', through: s => pos(s).z >= 9652 },
    { label: 'demon, green door', room: { x: 2929, z: 9652 }, kill: { npc: 'dragonslayer_demon', key: 'greenkey' }, loc: MAZE_LOCS.green, key: 'greenkey', through: s => pos(s).z >= 9656 },
    { label: 'chest, exit ladder', room: { x: 2936, z: 9656 }, loc: LOCS.mazeExitLadder, through: s => pos(s).z < 9000 },
    { label: 'exit door', room: { x: 2939, z: 3256 }, loc: MAZE_LOCS.exit, through: s => lvl(0)(s) && pos(s).x <= 2937 },
    { label: 'front door out', room: { x: 2930, z: 3252 }, withPart: true, loc: LOCS.mazeDoor, key: 'melzarkey', through: s => !inBox(s, AREAS.maze) },
];

const partOrMap = (s: BotWorldState) => hasMapPart(s, 1) || has(s, ITEM.crandorMap);

/** The move to make from where the player stands, or null when outside the maze. */
export function mazeMove(s: BotWorldState): MazeMove | null {
    if (!inBox(s, AREAS.maze) && !inBox(s, AREAS.mazeCellar)) return null;
    const part = partOrMap(s);
    return MAZE.find(m => (m.withPart === undefined || m.withPart === part) && sameRoom(s, m.room.x, m.room.z, m.room.level ?? 0)) ?? null;
}

/** Kill a key monster (the quest NPC, by config id) and pick up its key. Skipped while the key is held. */
async function killForKey(where: string, ctx: Ctx, opts: Options, npcName: string, keyName: string): Promise<void> {
    const sdk = ctx.sdk;
    const key = configId('obj', keyName);
    if (invItem(sdk, key)) return;
    const npcId = configId('npc', npcName);
    const t0 = sdk.getState()!.tick;
    const npc = await waitForNpc(sdk, npcId, 60);
    if (!npc) fail(where, `${npcName} not in sight (respawning?)`);
    const t1 = sdk.getState()!.tick;
    const f = await fight(sdk, npc, { food: ITEM.shark, eatBelow: eatAt(sdk.getState()!, opts), maxTicks: 300, onDialog: 'continue' });
    console.log(`[${stepId}:${where}] ${npcName}: found after ${t1 - t0} ticks at ${npc.x},${npc.z}; fight ${f.end} ${f.ticks} ticks (engaged at +${f.engaged}), ${f.attacks} attack clicks, taken ${f.taken}`);
    if (f.end !== 'killed' && f.end !== 'gone') fail(where, `${npcName}: the fight ended ${f.end}`);
    // The key drops on the NPC's tile with its death (melzars_maze.rs2 ai_queue3).
    const seen = await waitUntil(sdk, st => st.groundItems.some(g => g.id === key), { maxTicks: 6 });
    if (!seen.ok) fail(where, `${npcName} dropped no ${keyName}`);
    need(where, await pickup(sdk, key, { maxTicks: 30 }), `pick up the ${keyName}`, sdk);
}

async function maze(where: string, ctx: Ctx, opts: Options): Promise<void> {
    const sdk = ctx.sdk;
    const s0 = sdk.getState()!;
    if (!inBox(s0, AREAS.maze) && !inBox(s0, AREAS.mazeCellar)) {
        if (partOrMap(s0)) return;
        if (chebyshev(pos(sdk), TILES.mazeOutside) > 60) await travelled(where, sdk, teleport(sdk, 'falador'), 'Falador teleport');
        await runToArea(where, sdk, { ...TILES.mazeOutside, tol: 1 }, 'the maze door');
        if (!invItem(sdk, ITEM.key)) fail(where, 'no maze key (Oziach gives it, oziach.rs2 oziach_first_piece)');
        const r = await useOn(sdk, ITEM.key, { loc: { x: LOCS.mazeDoor.x, z: LOCS.mazeDoor.z, id: LOCS.mazeDoor.id } }, st => inBox(st, AREAS.maze), { maxTicks: 30 });
        need(where, r, 'maze key on the front door', sdk);
    }
    // Inside, every move goes by server-routed clicks: the client's walker thinks the locked doors are open.
    for (let i = 0; i < MAZE.length + 4; i++) {
        const s = sdk.getState()!;
        const m = mazeMove(s);
        if (!m) {
            if (inBox(s, AREAS.maze) || inBox(s, AREAS.mazeCellar)) fail(where, `in no known maze room at ${pos(s).x},${pos(s).z},${pos(s).level}`);
            return;
        }
        if (m.kill) await killForKey(where, ctx, opts, m.kill.npc, m.kill.key);
        if (m.label.startsWith('chest')) await searchChest(where, ctx, opts, LOCS.mazeChest, 1);
        if (m.key) {
            const keyId = m.key === 'melzarkey' ? ITEM.key : configId('obj', m.key);
            if (!invItem(sdk, keyId)) fail(where, `${m.label}: no ${m.key}`);
            const r = await useOn(sdk, keyId, { loc: { x: m.loc!.x, z: m.loc!.z, id: m.loc!.id } }, m.through, { maxTicks: 40 });
            need(where, r, `${m.label}: ${m.key} on the door`, sdk);
        } else {
            await operate(where, sdk, m.loc!, new RegExp(`^${m.loc!.op}$`, 'i'), m.through);
        }
    }
    fail(where, 'lost in the maze');
}

async function wormbrain(where: string, ctx: Ctx, opts: Options): Promise<void> {
    const sdk = ctx.sdk;
    if (has(sdk.getState()!, ITEM.crandorMap)) return;
    if (!hasMapPart(sdk.getState()!, 2)) {
        // The jail corridor beside his cell: railings block the way but not the line of sight his apnpc wants within 3 (wormbrain.rs2).
        await runToArea(where, sdk, { x: 3012, z: 3186, tol: 0 }, 'the Port Sarim jail');
        await talk(where, ctx, opts, /^Wormbrain$/i, [/piece of map that I need/i, /pay you for the map piece/i, /10,000 it is/i], 'opt, 2c, opt, 2c, opt, 3c', { until: s => hasMapPart(s, 2), near: TILES.wormbrain });
    }
    for (const n of [1, 2, 3] as const) if (!hasMapPart(sdk.getState()!, n)) fail(where, `map part ${n} is missing`);
    // crandor_map.rs2: any part on another joins all three.
    const r = await useOn(sdk, mapPartId(1), { item: mapPartId(2) }, s => has(s, ITEM.crandorMap), { maxTicks: 10 });
    need(where, r, 'join the map parts', sdk);
    await clearDialogue(sdk, opts, '1c');
}

// ---- the ship

const onDeck = (s: BotWorldState) => inBox(s, AREAS.shipDeck) && pos(s).level >= 1;
/** The hold (level 1, and level 2 once patched) and Ned's deck (level 3) share the tiles at z ~9640 (lady_lumbridge.rs2). */
const inHold = (s: BotWorldState) => inBox(s, AREAS.shipHold) && (pos(s).level === 1 || pos(s).level === 2);
export const onNedsDeck = (s: BotWorldState) => inBox(s, AREAS.shipHold) && pos(s).level === 3;

async function board(where: string, sdk: Sdk): Promise<void> {
    if (onDeck(sdk.getState()!) || inHold(sdk.getState()!)) return;
    await runToArea(where, sdk, { ...TILES.dock, tol: 1 }, 'the Lady Lumbridge');
    await operate(where, sdk, LOCS.gangplankOn, /^cross$/i, onDeck, { maxTicks: 20 });
}

/** Patch the hull in the hold: one plank (and 4 nails) per use, a mesbox after each; the third lifts the player a level (lady_lumbridge.rs2). */
async function patchHull(where: string, ctx: Ctx, opts: Options): Promise<void> {
    const sdk = ctx.sdk;
    for (let i = 0; i < 4 && inHold(sdk.getState()!) && pos(sdk).level === 1; i++) {
        if (!invItem(sdk, ITEM.plank) || invCount(sdk, ITEM.nails) < 4 || !invItem(sdk, ITEM.hammer)) fail(where, `the hull needs a plank, 4 nails and a hammer (holding ${invCount(sdk, ITEM.plank)} planks, ${invCount(sdk, ITEM.nails)} nails)`);
        const planks = invCount(sdk, ITEM.plank);
        const r = await useOn(sdk, ITEM.plank, { loc: { x: LOCS.shipHole.x, z: LOCS.shipHole.z, id: LOCS.shipHole.id } }, s => invCount(s, ITEM.plank) < planks, { maxTicks: 20 });
        need(where, r, 'plank on the hole', sdk);
        await waitUntil(sdk, s => s.dialog.isOpen, { maxTicks: 2 });
        await clearDialogue(sdk, opts, '1c');
    }
    if (inHold(sdk.getState()!) && pos(sdk).level === 2) await operate(where, sdk, LOCS.holdLadder, /climb-up/i, onDeck);
}

async function leaveShip(where: string, sdk: Sdk): Promise<void> {
    if (!onDeck(sdk.getState()!)) return;
    if (pos(sdk).level !== 1) fail(where, `on the ship at level ${pos(sdk).level}, expected the deck`);
    await operate(where, sdk, LOCS.gangplankOff, /^cross$/i, s => pos(s).level === 0 && !onDeck(s), { maxTicks: 20 });
}

async function buyAndRepair(where: string, ctx: Ctx, opts: Options): Promise<void> {
    const sdk = ctx.sdk;
    if (!onDeck(sdk.getState()!) && !inHold(sdk.getState()!)) {
        // Klarense sells only at stage 2 (klarense.rs2); after that his menu has no buy option and the talk stops.
        if (invCount(sdk, ITEM.plank) >= 3) {
            await runToArea(where, sdk, { ...TILES.dock, tol: 1 }, 'Klarense');
            await talk(where, ctx, opts, /^Klarense$/i, [/could buy it/i, /Yep, sounds good/i], '1c, opt, 3c, opt, 2c', { near: TILES.dock });
        }
        await board(where, sdk);
    }
    if (onDeck(sdk.getState()!)) await operate(where, sdk, LOCS.deckLadder, /climb-down/i, s => !onDeck(s), { maxTicks: 20 });
    if (!inHold(sdk.getState()!)) fail(where, `the deck ladder did not lead to the hold (at ${pos(sdk).x},${pos(sdk).z},${pos(sdk).level})`);
    await patchHull(where, ctx, opts);
    await leaveShip(where, sdk);
}

async function hireNedAndGiveMap(where: string, ctx: Ctx, opts: Options): Promise<void> {
    const sdk = ctx.sdk;
    await measure(ctx.log, ctx.session, `${stepId}:${where}/walk`, async () => {
        await leaveShip(where, sdk);
        await runToArea(where, sdk, { ...TILES.ned, tol: 1 }, 'Ned');
    });
    await talk(where, ctx, opts, NED, [/You're a sailor/i], '1c, opt, 9c', { near: TILES.ned });
    if (!invItem(sdk, ITEM.crandorMap)) fail(where, 'no Crandor map to give Ned');
    // ned.rs2 give_map_to_ned: the mesbox comes first; the map goes (and the stage moves to 8) once it is answered.
    const r = await useOn(sdk, ITEM.crandorMap, { npc: NED }, s => s.dialog.isOpen || !invItem(s, ITEM.crandorMap), { maxTicks: 20 });
    need(where, r, 'the map on Ned', sdk);
    await clearDialogue(sdk, opts, 'state, 2c');
    if (!(await waitUntil(sdk, s => !invItem(s, ITEM.crandorMap), { maxTicks: 3 })).ok) fail(where, 'Ned did not take the map');
}

/**
 * From the dock (or anywhere on the ship) to standing outside Elvarg's gate. The deck ladder leads to
 * Ned's deck (level 3) once he holds the map and is hired, else to the hold (lady_lumbridge.rs2
 * dragonshipladdertop), which after a death means patching the hull again.
 */
async function voyage(where: string, ctx: Ctx, opts: Options): Promise<void> {
    const sdk = ctx.sdk;
    if (!onCrandor(sdk.getState()!)) {
        await board(where, sdk);
        for (let i = 0; i < 2 && !onNedsDeck(sdk.getState()!); i++) {
            if (onDeck(sdk.getState()!)) await operate(where, sdk, LOCS.deckLadder, /climb-down/i, s => !onDeck(s), { maxTicks: 20 });
            if (inHold(sdk.getState()!)) await patchHull(where, ctx, opts);
        }
        if (!onNedsDeck(sdk.getState()!)) fail(where, `not on Ned's deck (at ${pos(sdk).x},${pos(sdk).z},${pos(sdk).level})`);
        await waitTicks(sdk, 1);
        // dragonslayer_ned.rs2: two pages and the choice, p_telejump to the wreck, p_delay(11), then three arrival pages.
        await talk(where, ctx, opts, NED, [/Yep lets go/i], '1c, opt, 1c', { until: onCrandor, maxTicks: 80 });
        await converse(sdk, [], { ...talkShape(opts, '3c'), interrupts: INTERRUPTS(), openTicks: 10, idle: 2, maxTicks: 60 });
    }
    if (inBox(sdk.getState()!, AREAS.crandorSurface)) {
        // The damaged hull does not block: walk straight out of it (quest-dragon-wreck-probe.ts).
        await runToArea(where, sdk, { ...TILES.rockFoot, tol: 1 }, 'the rock opening');
        await operate(where, sdk, LOCS.rockOpening, /climb-down/i, s => inBox(s, AREAS.crandorDungeon), { maxTicks: 30 });
    }
    if (!inBox(sdk.getState()!, AREAS.lair)) await runToArea(where, sdk, { ...TILES.lairGateOutside, tol: 1 }, 'Elvarg\'s gate');
}

// ---- Elvarg

export function eatAt(s: BotWorldState, opts: Options): number {
    return Math.ceil((s.player?.maxHp ?? 99) * (opts.eatBelow ?? 0.5));
}

export function usablePrayers(s: BotWorldState, opts: Options): PrayerName[] {
    const level = s.skills.find(k => k.name.toLowerCase() === 'prayer')?.baseLevel ?? s.prayers?.prayerLevel ?? 0;
    return (opts.elvargPrayers ?? ELVARG_PRAYERS).filter(p => PRAYER_LEVELS[p] <= level);
}

async function prayers(sdk: Sdk, list: readonly PrayerName[], on: boolean): Promise<void> {
    const todo = list.filter(p => prayerActive(sdk.getState()!, p) !== on);
    if (todo.length) await Promise.all(todo.map(p => setPrayer(sdk, p, on)));
}

/**
 * The Elvarg fight on a shared world. Elvarg is one static spawn with respawnrate 15
 * (quest_dragon.npc), in a single-way lair. The wait covers another player's whole fight (120
 * hitpoints at about 0.9 a tick, ~135 ticks), the respawn and the 8-tick lock: 180 ticks.
 */
export const ELVARG_CONTENTION: Pick<FightOptions, 'adoptHitter' | 'contested'> = { adoptHitter: true, contested: { waitTicks: 180 } };

/** The fight from outside the gate (or inside the lair) to the kill; the quest completes on it (elvarg.rs2). */
async function fightElvarg(where: string, ctx: Ctx, opts: Options): Promise<FightResult> {
    const sdk = ctx.sdk;
    await wearAll(where, sdk, GEAR);
    if (!worn(sdk, ITEM.shield)) fail(where, 'no Dragonfire shield worn: never fight Elvarg without it (dragonfire 70 unshielded, elvarg.rs2)');
    await sdk.sendSetCombatStyle(1); // scimitar: aggressive (slash)
    if (!inBox(sdk.getState()!, AREAS.lair)) {
        await runToArea(where, sdk, { ...TILES.lairGateOutside, tol: 1 }, 'Elvarg\'s gate');
        await operate(where, sdk, LOCS.lairGate, /^open$/i, s => inBox(s, AREAS.lair), { maxTicks: 30 });
    }
    const list = usablePrayers(sdk.getState()!, opts);
    const protect = list.includes('protect_from_melee') ? ('protect_from_melee' as const) : undefined;
    await prayers(sdk, list, true);
    const died0 = sdk.getState()!.player?.respawnCount ?? 0;
    const f = await fight(sdk, ELVARG, {
        ...ELVARG_CONTENTION,
        food: ITEM.shark,
        eatBelow: eatAt(sdk.getState()!, opts),
        ...(protect ? { prayer: protect } : {}),
        maxTicks: 900,
        findTicks: 20,
        onDialog: 'continue',
        // The kill's dragon_complete teleports the player out of the lair; a death respawns in Lumbridge.
        done: s => (s.player?.respawnCount ?? died0) > died0 || questStatus(s, quest) === 'complete' || (!inBox(s, AREAS.lair) && chebyshev(pos(s), TILES.exit) <= 1),
    });
    return f;
}

export const LUMBRIDGE_SPAWN = { x: 3222, z: 3218 } as const;

/** Back from a death at stage 9: the shield, the re-supply, Ned re-hired, the voyage (see the file comment). */
async function returnToCrandor(where: string, ctx: Ctx, opts: Options): Promise<void> {
    const sdk = ctx.sdk;
    await duke(where, ctx, opts);
    if (inBox(sdk.getState()!, AREAS.lumbridgeCastle) && pos(sdk).level === 1) {
        await runToArea(where, sdk, { x: LOCS.lumbridgeStairs.x + 1, z: LOCS.lumbridgeStairs.z - 1, level: 1, tol: 1 }, 'the castle stairs');
        await operate(where, sdk, { ...LOCS.lumbridgeStairs, id: 1739, op: 'Climb-down', level: 1 }, /climb-down/i, s => pos(s).level === 0);
    }
    const want = kitWant(sdk.getState()!, DEATH_KIT);
    if (want.length) {
        if (!opts.resupplyFrom) fail(where, `death return: missing ${want.map(w => `${w.amount} x ${String(w.item)}`).join(', ')} and no resupplyFrom`);
        const r = await receiveFrom(sdk, opts.resupplyFrom, { want: want as WantSpec[] });
        need(where, r, `death re-supply from ${opts.resupplyFrom}`, sdk);
    }
    await wearAll(where, sdk, [ITEM.weapon, ...GEAR]);
    await runToArea(where, sdk, { ...TILES.ned, tol: 1 }, 'Ned');
    // ned.rs2 ned_dragon_slayer_back_in_draynor_after_visiting_crandor.
    await talk(where, ctx, opts, NED, [/take me to Crandor again/i], '4c, opt, 2c', { near: TILES.ned });
    await voyage(where, ctx, opts);
}

async function elvarg(ctx: Ctx, opts: Options): Promise<void> {
    const where = 'L';
    const sdk = ctx.sdk;
    let deaths = 0;
    for (;;) {
        if (questStatus(sdk.getState()!, quest) === 'complete') break;
        if (!onCrandor(sdk.getState()!)) {
            if (deaths > (opts.maxDeaths ?? 1)) fail(where, `${deaths} deaths`);
            await measure(ctx.log, ctx.session, `${stepId}:L/death-return`, () => returnToCrandor(where, ctx, opts), { deaths });
        }
        const f = await measure(ctx.log, ctx.session, `${stepId}:L/fight`, () => fightElvarg(where, ctx, opts));
        console.log(`[${stepId}:L] fight ${f.end}: ${f.ticks} ticks, ${f.attacks} attack clicks, dealt ${f.dealt}, taken ${f.taken}, min hp ${f.minHp}, ate ${f.eats}, prayer ${f.prayerUsed}, level-ups ${f.levelUps}`);
        if (questStatus(sdk.getState()!, quest) === 'complete' || f.end === 'killed') break;
        if (f.died || !onCrandor(sdk.getState()!)) {
            deaths++;
            await waitUntil(sdk, s => !s.player?.isDead && !inBox(s, AREAS.crandorDungeon), { maxTicks: 20 });
            continue;
        }
        fail(where, `the fight ended ${f.end} after ${f.ticks} ticks`);
    }
    await waitUntil(sdk, s => questStatus(s, quest) === 'complete' && !inBox(s, AREAS.lair), { maxTicks: 20 });
    await prayers(sdk, ELVARG_PRAYERS, false);
    // The quest scroll (a modal) and the reward's level-up pages.
    for (let i = 0; i < 4 && (sdk.getState()!.modalOpen || sdk.getState()!.dialog.isOpen); i++) {
        if (sdk.getState()!.modalOpen) await sdk.sendCloseModal();
        await clearDialogue(sdk, opts);
        await waitTicks(sdk, 1);
    }
    // Melzar's key is dead weight after the quest; the run's inventory ledger drops it here (fold-in 18).
    const d = await dropItems(sdk, i => ITEM.key.test(i.name));
    if (!d.ok) fail(where, `the maze key did not drop (${d.ticks} ticks)`);
}

/** The exit state holds no maze key (T26-27's inventory, STEP-MANIFEST fold-in 18). */
export const keyDropped = (s: BotWorldState): true | string => ok(invItem(s, ITEM.key) === null, "Melzar's maze key is still held: the exit drops it");

// ------------------------------------------------------------------ segments

export function steps(opts: Options = {}): Step<any>[] {
    const items = questItems(opts);
    const slots = (at: (typeof LETTERS)[number]) => slotsCover(items, LETTERS, at);
    const segs: Segment[] = [
        kitSegment(opts, kitItems(opts), { preconditions: allOf(entryCheck, wornKitCheck, slots('A')) }),
        {
            letter: 'B', label: 'guildmaster', logoutSafe: true,
            preconditions: s => ok(questStatus(s, quest) !== null && (questPoints(s) ?? 0) >= 32, 'needs 32 quest points and the quest tab'),
            async run(ctx) {
                const dropped = await dropItems(ctx.sdk, i => ITEM.mspeak.test(i.name));
                if (!dropped.ok) fail('B', "the m'speak amulet did not drop");
                if (atLeast(ctx.sdk.getState()!, 'spoken_to_guildmaster')) return;
                await enterGuild('B', ctx, opts);
                await talk('B', ctx, opts, /^Guild master$/i, [/Rune Plate mail body/i], '1c, opt, 2c, state', { until: s => questStatus(s, quest) === 'started' });
            },
            done: o => atLeast(o, 'spoken_to_guildmaster'),
        },
        {
            letter: 'C', label: 'scavvo', logoutSafe: true,
            preconditions: slots('C'),
            async run(ctx) {
                const sdk = ctx.sdk;
                if (!armourHeld(sdk.getState()!) && (opts.buyArmour ?? true)) {
                    await enterGuild('C', ctx, opts);
                    if (pos(sdk).level === 0) {
                        await runToArea('C', sdk, { x: LOCS.guildStairs.x + 1, z: LOCS.guildStairs.z, tol: 1 }, 'the guild stairs');
                        await operate('C', sdk, LOCS.guildStairs, /climb-up/i, s => pos(s).level === 1);
                    }
                    await buyFromScavvo('C', ctx, opts);
                }
                await wearAll('C', sdk, GEAR);
            },
            postconditions: s => ok(!armourHeld(s) || (worn(s, ITEM.chainbody) !== null && worn(s, ITEM.platelegs) !== null), 'the rune chainbody and platelegs are held but not worn'),
            // Once Oziach has spoken the guild is behind: a stock-0 'go on' never comes back for the armour.
            done: o => armourHeld(stateOf(o)) || atLeast(o, 'spoken_to_oziach'),
        },
        {
            letter: 'D', label: 'oziach', logoutSafe: true,
            preconditions: allOf(s => ok(atLeast(s, 'spoken_to_guildmaster'), 'the Guildmaster has not been spoken to'), slots('D')),
            async run(ctx) {
                if (atLeast(ctx.sdk.getState()!, 'spoken_to_oziach') && invItem(ctx.sdk, ITEM.key)) return;
                await measure(ctx.log, ctx.session, `${stepId}:D/walk`, async () => {
                    await leaveGuild('D', ctx);
                    // Inside the hut, so the walker opens its door (3070,3515): a talk click is never routed through one.
                    await runToArea('D', ctx.sdk, { x: 3070, z: 3516, tol: 0 }, 'Oziach');
                });
                await talk('D', ctx, opts, /^Oziach$/i, [
                    /Can you sell me some Rune plate mail/i,
                    /guildmaster of the Champions' Guild told me/i,
                    /So how am I meant to prove that/i,
                    /A dragon, that sounds like fun/i,
                    /So where can I find this dragon/i,
                    /Where is the first piece/i,
                    /Where is the second piece/i,
                    /Where is the third piece/i,
                    /antidragon shield/i,
                    /Ok I'll try and get everything together/i,
                ], '1c, opt, 2c, opt, 5c, opt, 2c, opt, 3c, state, opt, 4c, opt, 3c, state, opt, 2c, opt, 2c, opt, 2c, opt, 2c', { maxTicks: 200 });
            },
            postconditions: allOf(s => ok(invItem(s, ITEM.key) !== null, 'Oziach gave no maze key')),
            done: o => atLeast(o, 'spoken_to_oziach'),
        },
        {
            letter: 'E', label: 'oracle-chest', logoutSafe: true,
            preconditions: allOf(
                s => ok(atLeast(s, 'spoken_to_oziach'), 'Oziach has not briefed the quest'),
                s => ok(hasMapPart(s, 3) || has(s, ITEM.crandorMap) || [ITEM.mindBomb, ITEM.silk, ITEM.lobsterPot, ITEM.unfiredBowl].every(re => invItem(s, re) !== null) || inBox(s, AREAS.oracleRoom), 'the magic door needs a wizard\'s mind bomb, silk, a lobster pot and an unfired bowl (magic_door.rs2)'),
                slots('E'),
            ),
            run: ctx => oracleAndChest('E', ctx, opts),
            done: o => hasMapPart(stateOf(o), 3) || has(stateOf(o), ITEM.crandorMap) || atLeast(o, 'ned_given_map'),
            probes: PROBES,
        },
        {
            letter: 'F', label: 'duke', logoutSafe: true,
            preconditions: allOf(s => ok(atLeast(s, 'spoken_to_oziach'), 'Oziach has not mentioned the shield'), s => ok(has(s, ITEM.shield) || inBox(s, AREAS.lumbridgeCastle) || invCount(s, ITEM.earth) >= 1, 'no Lumbridge teleport runes'), slots('F')),
            run: ctx => duke('F', ctx, opts),
            postconditions: s => ok(worn(s, ITEM.shield) !== null, 'the Dragonfire shield is not worn'),
            // A death on Crandor loses the shield; segment L fetches a new one, so the walk must not stop here.
            done: o => has(stateOf(o), ITEM.shield) || atLeast(o, 'sailed_to_crandor'),
            probes: PROBES,
        },
        {
            letter: 'G', label: 'maze', logoutSafe: true,
            preconditions: allOf(s => ok(hasMapPart(s, 1) || has(s, ITEM.crandorMap) || invItem(s, ITEM.key) !== null, 'no maze key'), slots('G')),
            run: ctx => maze('G', ctx, opts),
            postconditions: s => ok(!inBox(s, AREAS.maze) && !inBox(s, AREAS.mazeCellar), 'still inside the maze'),
            done: o => hasMapPart(stateOf(o), 1) || has(stateOf(o), ITEM.crandorMap) || atLeast(o, 'ned_given_map'),
            probes: PROBES,
        },
        {
            letter: 'H', label: 'wormbrain', logoutSafe: true,
            preconditions: allOf(s => ok(has(s, ITEM.crandorMap) || hasMapPart(s, 2) || invCount(s, ITEM.coins) >= 10_000, 'Wormbrain wants 10,000 coins'), slots('H')),
            run: ctx => wormbrain('H', ctx, opts),
            postconditions: s => ok(has(s, ITEM.crandorMap), 'no Crandor map'),
            done: o => has(stateOf(o), ITEM.crandorMap) || atLeast(o, 'ned_given_map'),
            probes: PROBES,
        },
        {
            letter: 'I', label: 'ship', logoutSafe: true,
            preconditions: allOf(holds(ITEM.hammer, 1, 'hammers'), s => ok(invCount(s, ITEM.coins) >= 2000 || invCount(s, ITEM.plank) < 3, 'the ship costs 2,000 coins')),
            run: ctx => buyAndRepair('I', ctx, opts),
            done: o => atLeast(o, 'repaired_ship'),
            probes: PROBES,
        },
        {
            letter: 'J', label: 'ned', logoutSafe: true,
            preconditions: s => ok(has(s, ITEM.crandorMap), 'no Crandor map for Ned'),
            run: ctx => hireNedAndGiveMap('J', ctx, opts),
            done: o => atLeast(o, 'ned_given_map'),
            probes: PROBES,
        },
        {
            letter: 'K', label: 'voyage', logoutSafe: true,
            preconditions: s => ok(mapWithNed(s), 'the Crandor map is not with Ned'),
            run: ctx => voyage('K', ctx, opts),
            done: o => atLeast(o, 'sailed_to_crandor'),
            probes: PROBES,
        },
        {
            letter: 'L', label: 'elvarg', logoutSafe: true,
            // Complete is a start too: a run stopped after the kill resumes here for the key drop.
            preconditions: s => ok(mapWithNed(s) || questStatus(s, quest) === 'complete', 'the Crandor map is not with Ned'),
            run: ctx => elvarg(ctx, opts),
            postconditions: allOf(
                s => ok(questStatus(s, quest) === 'complete', 'Dragon Slayer is not complete'),
                s => ok(!s.modalOpen && !s.dialog.isOpen, 'a reward page is still open'),
                keyDropped,
            ),
            // The key drop is part of the exit: a run stopped between the kill and the drop resumes here.
            done: o => questStatus(stateOf(o), quest) === 'complete' && keyDropped(stateOf(o)) === true,
        },
    ];
    return questSteps(stepId, segs);
}

/** Reference ticks per segment from the arrival tile: dragon_slayer.md's fixed column regrouped into these segments (inferred), Elvarg the manifest's ~70. */
export const REFERENCE: Readonly<Record<string, number>> = {
    A: 0, B: 11, C: 18, D: 42 + 18, E: 36 + 60, F: 27, G: 74 + 259, H: 57 + 3, I: 30 + 28, J: 30, K: 38 + 124, L: 70,
};

