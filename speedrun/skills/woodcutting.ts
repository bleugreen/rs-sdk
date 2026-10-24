// Woodcutting: STEP-MANIFEST.md entry 3 (S07, and S25b's bones in the lab).
//
// Normal trees beside the Taverley oak tile to 15, oaks 15-73 from (2914,3494), willows 73-99
// from (2920,3406) (docs/speedrun/skills/woodcutting.md sections 1-2), with a rune axe carried
// in the pack: woodcut.rs2's axe checker has its level gates commented out and takes a rune axe
// worn or carried, so a fresh account chops with it from level 1 without the Attack 41 wield.
// Five level-driven steps; each reads the level from the state, so a band already passed is a
// no-op and the module runs from any start:
//
//   woodcutting:walk-oaks        to the oak tile, by the `approach` waypoints, which keep a
//                                level-3 account away from the dark wizards (woodcutting.md s6)
//   woodcutting:normal-1-15      knife-cycle `tree`, plain: the band is about 3 logs, so a
//                                20-trial probe would cost more than the band, and the in-page
//                                knife on normal trees (7.24 per log) is slower than plain
//   woodcutting:oak-15-73        knife-cycle `oak` under rs/156's gated loop, own gate (when
//                                burying, no gate: the on-time switch, see Bones)
//   woodcutting:walk-willows     the oak-to-willow leg, kept out of the band rows
//   woodcutting:willow-73-99     knife-cycle `willow`, gated, to `to` (burying: the on-time switch,
//                                and on past `to` while Prayer or the runes are owed: see Prayer at the end)
//
// The gate's reference is plain ticks per expected roll (4: the plain loop's 4-tick cycle), and
// each log is weighted by the rolls it stands for at the current level (1 / success chance), so
// the measured switch-off stays fair while the success chance climbs through a band.
//
// The gate judges its measured switch-off over `MEASURE_DROPS` logs, not the library's 30: over
// 30 logs chop luck alone moves the knife's mean about 13%, enough to read a sound knife as
// slower than plain (rs/236's Taverley chain c1 went plain at oak 15 and willow 85 and finished
// at 4,189). Over 120 the knife's ~3.15 sits more than 4 standard errors below plain's 4, and a
// knife that is really slow is still caught within ~500 ticks.
//
// Two things keep the gate from paying for the stand itself. Knife segments on oak and willow
// carry knife-cycle's `waitRespawn`: with every listed tree down the program waits for the
// respawn instead of calling it a lost lock, which the gate would read as a slip and answer with
// a stop and a re-probe. And each band's probe walks only to the stand's free neighbours
// (`freeDirs`, from the trees' footprints), since every blocked one costs the probe 9 ticks.
//
// Bones (S07): with `bury`, the oak and willow bands run no gate and no probe, and every segment,
// knife or plain, carries knife-cycle's `bury` and `trees`: knife-cycle has two bury loops, knife +
// bury (a bone on the 3-tick lattice) and plain + bury (a bone in the plain 4-tick cycle's idle
// ticks, #165), so a burying band never chops without burying, whichever it runs. Attempt 3's gated
// willow band, whose probe read a ragged server (15/20), ran plain without `bury` and could never
// reach its Prayer; rs/642's forced knife then lost a roll to every late bury-cycle send (a click
// landing in the bury's p_delay is dropped, OpLocHandler.ts). So under `technique` auto a burying
// band switches between the two loops on the on-time rate it measures in itself (OnTimeMeter):
// knife-cycle judges each Bury on time or late on the label after it should have landed
// (`buryOnTime`, `buryLate`). The band starts on the knife, every band and every resume, with an
// empty window; it goes to plain + bury once a 50-Bury knife window can no longer reach the
// break-even, 44 of 50 (17.6 of 20, where 3 / r^2 ticks per landed roll, both of the knife cycle's
// sends on time, meets plain + bury's measured ~3.87), and back to the knife on a plain + bury window
// of 47 of 50 or better (the switch section's comment says why). A forced `technique` knife or
// plain runs that loop alone, still burying. The giver asks to trade while the account holds 2
// bones; the account takes the trade on the roll label after its last bury (2 ticks after the pack
// shows none: knife, the bury lands on R+1 and the cycle's click rolls on R+3; plain + bury, the
// bury lands on R+2 and the click rolls on R+4), by stopping the run, `receiveFrom`, and starting it
// again in the technique it ran. A load's number in its row is the S07 session's: with a group, the
// loads its status files count before the band, plus the band's own. The bones a burying band holds
// count as free slots in its 2-slot precondition: its first cycles bury them.
//
// Routes: `route` picks the stands as data (ROUTES). `taverley` (SITES) is the scored run's;
// `rimmington` (the Rimmington oaks and the Draynor-west willows) walks about 130 ticks less
// from Lumbridge and is what a fresh rehearsal account takes.
//
// Hits: every hitpoint lost in a walk or a band is logged (tick, tile, the NPCs beside the
// player) as a 0-tick `woodcutting:hit` row. With `hpStop`, a hit that leaves the player at or
// below it stops the walk or the band and fails the step, so the harness logs out cleanly: no
// NPC on either route hits a combat-3 account for more than 1, so this is a guard, not a plan.
//
// Slots (STEP-MANIFEST.md's inventory ledger, rows H4k to T07-08). The normal band keeps
// `keepProducts` normal logs (default 1, knife-cycle's own default is 3), counting the kit's,
// and drops every other log it chops, except the last: the program ends on the label that shows
// it (rs/196's lab, rs/158's ruling). So each oak and willow band starts by dropping every
// normal log past `keepProducts`, sent without waiting before the walk to the stand (0 ticks;
// the starter takes the first log), and the oaks start with the axe, the knife and one log,
// which leaves a 23-bone load and the chopped log their 24 slots with one to spare.
//
// S07's end, two opt-in steps after the last band (rehearsals keep their axe and carry no bones).
// The scored run's path: T07-08's Camelot runes ride the last bone load (receiveFrom takes an
// offer holding more than the bones), and `dropAxe` adds `woodcutting:drop-axe`, which drops the
// axe at `to` without waiting, as nothing after S07 chops. A giver that shrinks that load to make
// room for the two rune stacks is named by `bones.lastLoad`, its bone count: every receive then
// wants at least that many (receiveFrom judges the want on both screens, so a full-load want
// would refuse the shrunken load), the bury precondition needs room for the larger of the two
// loads and none once the runes are in (that load came, and no other follows), and the last
// band's postcondition asks for the runes. The fallback until a bone giver can
// add the runes to a load: `handBack` adds `woodcutting:hand-back`, one `swap()` at `to` that
// gives the axe and every bone held and takes the runes (1 law, 5 air), a trade of its own,
// since the axe chops to the last level, after the last load. Once the runes are in, that load was
// the last: the band asks for no other, and the knife cycle chops on without bones to the band end.
//
// Prayer at the end: the last burying band ends on the Woodcutting level and on the Prayer it owes.
// At `to` with Prayer under `prayerTo` and something left to bury (bones held, or a load the givers
// are known to hold: `lastLoad`'s still to come, or fewer loads given than the group's status files
// publish as its `loads`), the band runs its bury loop on, bounded by Prayer instead of the level
// (PRAYER_RUN_TICKS per run), taking loads as before, the runes' load still last. It closes once
// Prayer reaches `prayerTo` or nothing is left, and only then may its Prayer postcondition fail.
// With `lastLoad` it also stays while the runes' load is still to come and a load is known to be
// left, even at `prayerTo`: T07-08's runes ride the group's last load, so a group whose `loads`
// outlasts the Prayer still delivers them. What those loads bring is buried, since either bury loop
// buries a bone a roll at little cost to the chop. It closes once the runes are held, or with no load
// left, which keeps the runes postcondition's failure. `done` and `inProgress` read the same, so a
// resume at `to` that still owes Prayer or the runes re-enters the band, and the willow walk takes
// it back to the stand.
//
// The giver group (`bones.group`, S07's b01-b04 taking turns; bone-giver.md "Taking turns"): the
// module writes the cue the givers read, scoped { step: 'S07', family: 'bone' } (S07_BONE_CUE), at
// each burying band's start and stops it when S07's last band reaches `to`, in one session for the
// whole step so the group counts its loads across both bands. The cue names SCORED's site (Cue.site,
// the band's stand), and the givers wait there rather than rotate between the trees: each band's
// start (a resume too) names its own stand, and the oak band's end names the willows' as SCORED sets
// off for them, so the givers walk with it. Nothing else writes it: Runecraft's
// S06 cue is scoped to S06's altar givers. Before each load the partner is the group's server
// (bone-giver.ts boneServer over the givers' status files) once SCORED sees it (awaitServerInSight),
// waiting on observed ticks while none serves here; a trade that fails before any item can have moved
// re-picks, and a load with no server in sight within `serverWait` fails the band. The want
// is the same whichever giver serves, so `lastLoad` holds for the group as for one giver: which
// giver carries the runes is the helpers' choice (bone-giver.ts finalExtras).

import type { BotWorldState, InventoryItem } from '../../sdk/types';
import { canonName, CueWriter, cueDir as defaultCueDir, type Beacon, type CueScope } from '../helpers/altar-cue';
import { boneServer, groupLoads, groupLoadsDone, readBoneStatuses, SERVER_WAIT_TICKS, type ServerWait } from '../helpers/bone-giver';
import { GATED_PROGRAMS, type GatedSegment, type GatedTechnique, inPageGate, type InPageGateOptions, runGatedProgram, type SegmentTechnique } from '../lib/gated-program';
import type { HostGate } from '../lib/hostgate';
import { withLevelUpDismissal } from '../lib/levelup';
import type { ProgramStatus } from '../lib/programs';
import type { TickLog } from '../lib/ticks';
import { type GiveSpec, receiveFrom, type ReceiveResult, swap, tradeOf, type WantSpec } from '../lib/trade';
import { type StateSource, tickMs, waitUntil } from '../lib/wait';
import type { RunnerSession, Step, StepContext } from '../runner/step';

export const skill = 'woodcutting';

export type Tree = 'normal' | 'oak' | 'willow';
export type Tile = readonly [number, number];

// ------------------------------------------------------------------ the tree model (read)

/** The rune axe's stat_random bounds per tree (trees.dbrow `successchance,rune_axe`). */
export const RUNE_BOUNDS: Record<Tree, readonly [number, number]> = { normal: [224, 700], oak: [112, 350], willow: [56, 175] };
/** trees.dbrow `levelrequired`. */
export const TREE_LEVEL: Record<Tree, number> = { normal: 1, oak: 15, willow: 30 };
/** knife-cycle presets. */
export const PRESET: Record<Tree, string> = { normal: 'tree', oak: 'oak', willow: 'willow' };
/**
 * Ticks per roll: the knife's 3-tick lattice, and the plain loop's 4 (woodcut.rs2: a click on
 * an expired clock sets it to map_clock + 3, and each roll re-queues the op).
 */
export const CYCLE: Record<SegmentTechnique, number> = { knife: 3, plain: 4 };
/** Ticks a felled tree is unavailable beyond its respawn: the click and the first swing (woodcutting-model.ts). */
export const RESPAWN_REACT = 4;

/** The engine's stat_random (PlayerOps STAT_RANDOM): the chance one roll with a rune axe gives a log. */
export function successChance(tree: Tree, level: number): number {
    const [lo, hi] = RUNE_BOUNDS[tree];
    const l = Math.min(Math.max(Math.floor(level), 1), 99);
    return Math.min(1, (Math.floor((lo * (99 - l)) / 98) + Math.floor((hi * (l - 1)) / 98) + 1) / 256);
}

/** Respawn ticks D of an oak or willow for the online player count (scale_by_playercount, read; woodcutting.md s6). */
export function respawnTicks(players: number, base = 30): number {
    return Math.floor((base * (4000 - Math.min(Math.max(players, 0), 2000))) / 4000);
}

/** Erlang's loss formula: the share of time all `servers` are busy at offered load `load`. */
export function erlangB(load: number, servers: number): number {
    let b = 1;
    for (let k = 1; k <= servers; k++) b = (load * b) / (k + load * b);
    return b;
}

/**
 * Expected ticks per log (inferred). Rolls every `CYCLE[technique]` ticks with success p; at a
 * three-tree tile each log fells its tree 1 time in 8 for D + RESPAWN_REACT ticks, and the
 * player loses time only while all three are down. That is a loss system with three servers,
 * whose all-down share is Erlang B at load (p / cycle / 8) x (D + 4), whatever the downtime's
 * distribution. Without D the figure is the bare lattice, cycle / p: rs/158's acceptance for the
 * in-page knife. Normal trees fall on every log and respawn in 120-199 ticks, so the player
 * walks to the next one: one tick per log (woodcutting.md s2, inferred).
 */
export function modelTicksPerLog(tree: Tree, level: number, technique: SegmentTechnique = 'plain', D?: number): number {
    const p = successChance(tree, level);
    const cycle = CYCLE[technique];
    if (tree === 'normal') return cycle / p + 1;
    if (D === undefined) return cycle / p;
    return cycle / p / (1 - erlangB((p / cycle / 8) * (D + RESPAWN_REACT), 3));
}

/** Expected rolls behind a count of logs by the level each was cut at: the sum of logs / p(level). */
export function expectedRolls(tree: Tree, logsAtLevel: ReadonlyMap<number, number> | Record<number, number>): number {
    const entries = logsAtLevel instanceof Map ? [...logsAtLevel.entries()] : Object.entries(logsAtLevel).map(([l, n]) => [Number(l), n] as const);
    return entries.reduce((sum, [level, n]) => sum + n / successChance(tree, level), 0);
}

// ------------------------------------------------------------------ sites and bands

/** Tree footprints in tiles (oak.loc and willow.loc: width = length). */
export const FOOTPRINT: Record<Exclude<Tree, 'normal'>, number> = { oak: 3, willow: 2 };
/** The in-page probe's own order of neighbour steps (probe.ts NEIGHBOURS): E, W, N, S. */
export const PROBE_DIRS: readonly Tile[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * The neighbour steps from `stand` that no tree's footprint covers, in the probe's order. A tree at
 * (x, z) covers x..x+size-1 by z..z+size-1. Other blockers (fences, map flags) are not modelled, so
 * a stand whose free side is blocked otherwise needs its own list.
 */
export function freeDirs(stand: Tile, trees: readonly Tile[], size: number): Tile[] {
    const covered = (x: number, z: number) => trees.some(([tx, tz]) => x >= tx && x < tx + size && z >= tz && z < tz + size);
    return PROBE_DIRS.filter(([dx, dz]) => !covered(stand[0] + dx, stand[1] + dz));
}

export interface Site {
    /** The standing tile; a band starts within NEAR of it, and oak and willow chop from it exactly. */
    stand: Tile;
    /** The tree tiles reachable from `stand`, passed to knife-cycle as `trees`; none for normal trees. */
    trees?: readonly Tile[];
}

export interface Sites {
    normal: Site;
    oak: Site;
    willow: Site;
    /**
     * Waypoints from Lumbridge to the oak tile (inferred, unmeasured): north of Draynor's dark
     * wizards (3085,3237), west of the Varrock stone circle's (3226,3369), through Falador,
     * and north to Taverley clear of the Dark Wizards' Tower (2908,3334); every one of them is
     * 50 tiles or more from a wizard spawn (the map spawns, read). The lab measures the leg.
     */
    approach: readonly Tile[];
}

/** woodcutting.md sections 1, 2 and 6; bones-wc.ts SITES. The scored run's stands. */
export const SITES: Sites = {
    // The normal trees beside the oak tile, e.g. (2912,3495), (2910,3492), (2918,3493): no
    // `trees` list, because every log fells the tree and the plain loop walks to the next.
    normal: { stand: [2914, 3494] },
    oak: { stand: [2914, 3494], trees: [[2912, 3491], [2914, 3495], [2915, 3492]] },
    willow: { stand: [2920, 3406], trees: [[2918, 3405], [2919, 3407], [2921, 3405]] },
    approach: [[3170, 3285], [3007, 3360], [2965, 3395], [2935, 3450]]
};

export type RouteName = 'taverley' | 'rimmington';

/**
 * Stands by route. `rimmington`: the oak stand (2984,3205) and the Draynor-west willow stand
 * (3058,3253), all six trees surveyed in the lab (rs/236); the normal trees are beside the oaks.
 * The walk from Lumbridge needs no waypoints: the nearest dark wizard is 26 tiles from the
 * willow stand, and the giant spiders and the highwayman the Lumbridge-Draynor road shares with
 * the Taverley path hit for at most 1 (rs/236, read).
 */
export const ROUTES: Record<RouteName, Sites> = {
    taverley: SITES,
    rimmington: {
        normal: { stand: [2984, 3205] },
        oak: { stand: [2984, 3205], trees: [[2981, 3205], [2984, 3206], [2985, 3203]] },
        willow: { stand: [3058, 3253], trees: [[3057, 3251], [3057, 3254], [3059, 3252]] },
        approach: []
    }
};

export interface Band {
    name: 'woodcutting:normal-1-15' | 'woodcutting:oak-15-73' | 'woodcutting:willow-73-99';
    tree: Tree;
    /** The level the band ends at before clipping to `to`. */
    end: number;
}

export const BANDS: readonly Band[] = [
    { name: 'woodcutting:normal-1-15', tree: 'normal', end: 15 },
    { name: 'woodcutting:oak-15-73', tree: 'oak', end: 73 },
    { name: 'woodcutting:willow-73-99', tree: 'willow', end: 99 }
];

/** rs/158's reporting splits (rs/147, 13:19): each band's rows, so chop RNG and the client separate. */
export const SUB_BANDS: Record<Tree, ReadonlyArray<readonly [number, number]>> = {
    normal: [[1, 15]],
    oak: [[15, 60], [60, 73]],
    willow: [[73, 85], [85, 99]]
};

/** A walk is skipped, and a band may start, within this many tiles of its standing tile. */
export const NEAR = 8;
/** Ticks after the pack shows no bones before the top-up: the last bury cycle's roll label (header). */
export const BONES_SETTLE = 2;
/**
 * A Prayer run's bound in ticks (Prayer at the end): a load buries in about 70, one bone per 3-tick
 * cycle, so a run that reaches it has stopped burying.
 */
export const PRAYER_RUN_TICKS = 600;
/** The run's bone loads (Ashburn helpers, rs/117). */
export const BONE_LOAD = 23;
/** S25b's Prayer target. */
export const PRAYER_TO = 94;
/** Logs over which the gate judges its measured switch-off (see the file comment). */
export const MEASURE_DROPS = 120;
/** NPCs within this many tiles of the player are named in a hit row. */
export const HIT_REACH = 2;
/** Normal logs the normal band keeps (knife-cycle `keepProducts`): the oak knife's one log (ledger H4k, H4.x). */
export const NORMAL_KEEP = 1;
/** T07-08's Camelot teleport, received in the hand-back (the ledger's teleport runes: 1 law, 5 air). */
export const CAMELOT_RUNES: readonly WantSpec[] = [{ item: /^law rune$/i, amount: 1 }, { item: /^air rune$/i, amount: 5 }];
/** The cue S07's bone giver group reads (bone-giver.ts `scope` in the standing mode). */
export const S07_BONE_CUE: CueScope = { step: 'S07', family: 'bone' };

// ------------------------------------------------------------------ state

const AXE = /^(bronze|iron|steel|black|mithril|adamant|rune) axe$/i;
const RUNE_AXE = /^rune axe$/i;
const KNIFE = /^knife$/i;
const LOGS = /^logs$/i;
const LAW = /^law rune$/i;
const AIR = /^air rune$/i;
const DEFAULT_BONES = 'bones$';

function levelOf(s: BotWorldState | null, name: string): number {
    const k = s?.skills.find(x => x.name.toLowerCase() === name);
    return k?.baseLevel ?? 1;
}

export function wcLevel(s: BotWorldState | null): number {
    return levelOf(s, 'woodcutting');
}

function xpOf(s: BotWorldState | null, name: string): number {
    return s?.skills.find(x => x.name.toLowerCase() === name)?.experience ?? 0;
}

function count(items: readonly InventoryItem[], re: RegExp): number {
    return items.filter(i => re.test(i.name)).reduce((n, i) => n + Math.max(1, i.count), 0);
}

/** T07-08's Camelot runes, CAMELOT_RUNES, are in the pack. */
function runesHeld(s: BotWorldState): boolean {
    return count(s.inventory, LAW) >= 1 && count(s.inventory, AIR) >= 5;
}

function axeOf(s: BotWorldState): string | null {
    const all = [...s.equipment, ...s.inventory];
    return (all.find(i => RUNE_AXE.test(i.name)) ?? all.find(i => AXE.test(i.name)))?.name ?? null;
}

/** Normal logs past the first `keep`: the starter's log is the first in the pack (knife-cycle `invItem`). */
export function extraLogs(s: BotWorldState, keep: number): InventoryItem[] {
    return s.inventory.filter(i => LOGS.test(i.name)).slice(keep);
}

/** knife-cycle presets' products on oak and willow (`^oak logs$`, `^willow logs$`). */
const PRODUCT: Record<Exclude<Tree, 'normal'>, RegExp> = { oak: /^oak logs$/i, willow: /^willow logs$/i };

/**
 * The oak or willow logs a run left in the pack: knife-cycle ends on the label that shows a log without
 * dropping it. A run anchors on the xp of its first chopped log before it buries or drops anything, so
 * a run started on a full pack never chops and stalls (the lab's 23-bone pack at WC 99, rs/642): the
 * band drops them before every run.
 */
export function productLogs(s: BotWorldState, tree: Tree): InventoryItem[] {
    return tree === 'normal' ? [] : s.inventory.filter(i => PRODUCT[tree].test(i.name));
}

/**
 * The oak band's product logs carried into the willow band (its last runs' logs): the willow band drops
 * them at its start and counts them as room. Without it, two oak logs carried in with a part load left
 * the willow precondition one slot short of a load (rs/635's lab). None for another band.
 */
export function carriedLogs(s: BotWorldState, tree: Tree): InventoryItem[] {
    return tree === 'willow' ? productLogs(s, 'oak') : [];
}

function near(s: BotWorldState, t: Tile, r: number): boolean {
    const p = s.player;
    return !!p && Math.max(Math.abs(p.worldX - t[0]), Math.abs(p.worldZ - t[1])) <= r;
}

const chebyshev = (a: Tile, b: Tile) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));

/** The approach waypoints still ahead of a player at `from`: those nearer the goal than it is. */
export function routeFrom(from: Tile, goal: Tile, waypoints: readonly Tile[]): Tile[] {
    const left = chebyshev(from, goal);
    const i = waypoints.findIndex(w => chebyshev(w, goal) < left);
    return i < 0 ? [] : waypoints.slice(i);
}

// ------------------------------------------------------------------ options

export interface BonesOptions {
    /** One giver by display name (the lab's second bot). Give this or `group`. */
    giver?: string;
    /**
     * The givers taking turns (bone-giver.ts `group`, S07's b01-b04): each load comes from the
     * group's server, and the module writes the S07 bone cue they read. Give this or `giver`.
     */
    group?: readonly string[];
    /** With a group: observed ticks a load waits for a server before the band fails (default SERVER_WAIT_TICKS). */
    serverWait?: number;
    /** Bones per load (default 23). */
    load?: number;
    /**
     * Bones in S07's last load, which also carries CAMELOT_RUNES (default: unset, every load is
     * `load` and carries nothing else). From 1 to `load`.
     */
    lastLoad?: number;
}

export interface WoodcuttingOptions {
    /** Target level (default 99); bands are clipped to it. */
    to?: number | string;
    /** 'auto' (default): each oak and willow band gets its own in-page gate. 'knife' / 'plain' force it (lab). */
    technique?: GatedTechnique;
    /** Bury bones inside the knife cycle on oak and willow: true, or a bones regex. */
    bury?: boolean | string;
    /** The bone giver; `boneGiver` / `boneGroup` (comma-separated) / `boneServerWait` / `boneLoad` / `boneLastLoad` are the CLI's flat form (--skill-opt). */
    bones?: BonesOptions;
    boneGiver?: string;
    boneGroup?: string | readonly string[];
    boneServerWait?: number | string;
    /** With a giver group: the cue directory (default altar-cue.ts cueDir(): RC_CUE_DIR or run-machine/rc-cue). */
    cueDir?: string;
    /**
     * With a giver group: the S07 bone cue's session, the same in every process of one attempt, so a
     * resumed S07 continues the session the givers count their loads in (CueWriter adopts the persisted
     * cue only when it is this session, scope and receiver). Default: a new session per process.
     */
    boneSession?: string;
    boneLoad?: number | string;
    boneLastLoad?: number | string;
    /** The last band's Prayer postcondition with `bury` (default 94; 0 checks nothing). */
    prayerTo?: number | string;
    /** The gate's plain reference in ticks per expected roll (default 4). */
    plainTicksPerRoll?: number | string;
    /** The stands (ROUTES; default 'taverley'). */
    route?: RouteName | string;
    /** Sites as data over the route's: a second-choice tile goes here, not into code. A JSON string from the CLI. */
    sites?: Partial<Sites> | string;
    /** Stop the walk or band (and fail the step) on a hit that leaves hitpoints at or below this (default 0: never). */
    hpStop?: number | string;
    /** inPageGate options over the module's own. */
    gate?: Partial<InPageGateOptions>;
    /** Extra knife-cycle parameters, lab only (rs/156's forced-slip `hold`); never set on an attempt. */
    params?: Record<string, unknown>;
    /** `params.hold`, flat for the CLI. */
    hold?: number | string;
    /** Lab only: `hold` goes only on runs started within this many ticks of a band's start (a ragged stretch that ends). */
    holdTicks?: number | string;
    /** knife-cycle's `waitRespawn` on oak and willow knife segments (default true; 'false' from the CLI turns it off). */
    waitRespawn?: boolean | string;
    /** Probe only the stand's free neighbours (default true; 'false' probes E, W, N, S as the page does). */
    probeDirs?: boolean | string;
    /** knife-cycle `keepProducts` on the normal band: normal logs kept, the kit's included (default 1). */
    keepProducts?: number | string;
    /**
     * The hand-back at `to` (default off): true swaps with the bone giver, a string names the
     * partner. Gives the axe and any bones held, takes CAMELOT_RUNES.
     */
    handBack?: boolean | string;
    /** Drop the axe at `to` without waiting (default false: a rehearsal keeps it). */
    dropAxe?: boolean | string;
    /** Test seams. */
    runGated?: typeof runGatedProgram;
    makeGate?: typeof inPageGate;
    receive?: typeof receiveFrom;
    swap?: typeof swap;
    log?: (line: string) => void;
    [k: string]: unknown;
}

interface Resolved {
    to: number;
    technique: GatedTechnique;
    bury: string | true | null;
    bonesRe: RegExp;
    bones: { giver: string; load: number; lastLoad: number | null } | { group: string[]; serverWait: number; cueDir: string; session?: string; load: number; lastLoad: number | null } | null;
    prayerTo: number;
    plainTicksPerRoll: number;
    route: RouteName;
    sites: Sites;
    hpStop: number;
    gate: Partial<InPageGateOptions>;
    params: Record<string, unknown>;
    holdTicks: number | null;
    waitRespawn: boolean;
    probeDirs: boolean;
    keepProducts: number;
    /** The hand-back's partner, or null for none. */
    handBack: string | null;
    dropAxe: boolean;
    runGated: typeof runGatedProgram;
    makeGate: typeof inPageGate;
    receive: typeof receiveFrom;
    swap: typeof swap;
    log: (line: string) => void;
}

function numberOpt(name: string, raw: unknown, ok: (n: number) => boolean, def: number): number {
    if (raw === undefined) return def;
    const n = Number(raw);
    if (!Number.isFinite(n) || !ok(n)) throw new Error(`woodcutting: bad ${name} ${JSON.stringify(raw)}`);
    return n;
}

function flag(name: string, raw: unknown, def: boolean): boolean {
    if (raw === undefined) return def;
    if (raw === true || raw === 'true') return true;
    if (raw === false || raw === 'false') return false;
    throw new Error(`woodcutting: ${name} must be true or false, got ${JSON.stringify(raw)}`);
}

function groupOpt(raw: unknown): string[] {
    const names = (typeof raw === 'string' ? raw.split(',') : Array.isArray(raw) ? raw : null)?.map(n => (typeof n === 'string' ? n.trim() : ''));
    if (!names || names.length < 2 || names.some(n => !n)) throw new Error(`woodcutting: a bone group lists at least two giver names, got ${JSON.stringify(raw)}`);
    if (new Set(names.map(canonName)).size !== names.length) throw new Error(`woodcutting: the bone group names a giver twice: ${names.join(', ')}`);
    return names;
}

function resolve(opts: WoodcuttingOptions): Resolved {
    const to = numberOpt('to (an integer from 2 to 99)', opts.to, n => Number.isInteger(n) && n >= 2 && n <= 99, 99);
    const technique = opts.technique ?? 'auto';
    if (!['auto', 'knife', 'plain'].includes(technique)) throw new Error(`woodcutting: technique must be auto, knife or plain, got ${technique}`);
    const b = opts.bury;
    const bury = b === undefined || b === false || b === 'false' ? null : b === true || b === 'true' ? true : String(b);
    if (bury !== null && to <= BANDS[0]!.end) throw new Error(`woodcutting: bury needs an oak or willow band, and to=${to} ends on normal trees`);
    const giver = opts.bones?.giver ?? opts.boneGiver;
    const groupRaw = opts.bones?.group ?? opts.boneGroup;
    const group = groupRaw === undefined ? null : groupOpt(groupRaw);
    if (giver !== undefined && group) throw new Error('woodcutting: name one bone giver or a group, not both');
    const waitRaw = opts.bones?.serverWait ?? opts.boneServerWait;
    if (waitRaw !== undefined && !group) throw new Error('woodcutting: serverWait is for a bone group');
    const serverWait = numberOpt('serverWait (a whole number of ticks, at least 1)', waitRaw, n => Number.isInteger(n) && n >= 1, SERVER_WAIT_TICKS);
    const load = numberOpt('bone load', opts.bones?.load ?? opts.boneLoad, n => Number.isInteger(n) && n >= 1 && n <= 27, BONE_LOAD);
    if ((giver !== undefined || group) && bury === null) throw new Error('woodcutting: a bone giver without bury');
    const lastRaw = opts.bones?.lastLoad ?? opts.boneLastLoad;
    const lastLoad = lastRaw === undefined ? null : numberOpt(`last load (an integer from 1 to the load, ${load})`, lastRaw, n => Number.isInteger(n) && n >= 1 && n <= load, load);
    if (lastLoad !== null && !giver && !group) throw new Error('woodcutting: a last load without a bone giver');
    if (opts.boneSession !== undefined && (typeof opts.boneSession !== 'string' || !opts.boneSession.trim())) throw new Error(`woodcutting: boneSession must be a nonempty string, got ${JSON.stringify(opts.boneSession)}`);
    if (opts.boneSession !== undefined && !group) throw new Error('woodcutting: boneSession names the S07 cue a giver group reads, and there is no group');
    const route = opts.route ?? 'taverley';
    if (!Object.hasOwn(ROUTES, route)) throw new Error(`woodcutting: route must be ${Object.keys(ROUTES).join(' or ')}, got ${JSON.stringify(route)}`);
    const sitesIn = typeof opts.sites === 'string' ? (JSON.parse(opts.sites) as Partial<Sites>) : (opts.sites ?? {});
    const hold = opts.hold === undefined ? {} : { hold: numberOpt('hold', opts.hold, n => n >= 0 && n <= 1, 0) };
    if (opts.holdTicks !== undefined && opts.hold === undefined) throw new Error('woodcutting: holdTicks bounds hold, and there is none');
    const holdTicks = opts.holdTicks === undefined ? null : numberOpt('holdTicks (a whole number of ticks)', opts.holdTicks, n => Number.isInteger(n) && n >= 0, 0);
    const hb = opts.handBack;
    let handBack: string | null = null;
    if (hb === true || hb === 'true') {
        if (group) throw new Error('woodcutting: handBack true swaps with the bone giver, and a group has no one giver (name the partner instead)');
        if (!giver) throw new Error('woodcutting: handBack true swaps with the bone giver, and there is none (name the partner instead)');
        handBack = String(giver);
    } else if (hb !== undefined && hb !== false && hb !== 'false') {
        if (typeof hb !== 'string' || !hb.trim()) throw new Error(`woodcutting: handBack must be true, false or a partner name, got ${JSON.stringify(hb)}`);
        handBack = hb;
    }
    return {
        to,
        technique,
        bury,
        bonesRe: new RegExp(bury === null || bury === true ? DEFAULT_BONES : bury, 'i'),
        bones: giver ? { giver: String(giver), load, lastLoad } : group ? { group, serverWait, cueDir: opts.cueDir ?? defaultCueDir(), ...(opts.boneSession !== undefined ? { session: opts.boneSession } : {}), load, lastLoad } : null,
        prayerTo: bury === null ? 0 : numberOpt('prayerTo', opts.prayerTo, n => Number.isInteger(n) && n >= 0 && n <= 99, PRAYER_TO),
        plainTicksPerRoll: numberOpt('plainTicksPerRoll', opts.plainTicksPerRoll, n => n > 0, CYCLE.plain),
        route: route as RouteName,
        sites: { ...ROUTES[route as RouteName], ...sitesIn },
        hpStop: numberOpt('hpStop (an integer from 0 to 98)', opts.hpStop, n => Number.isInteger(n) && n >= 0 && n <= 98, 0),
        gate: opts.gate ?? {},
        params: { ...opts.params, ...hold },
        holdTicks,
        waitRespawn: flag('waitRespawn', opts.waitRespawn, true),
        probeDirs: flag('probeDirs', opts.probeDirs, true),
        keepProducts: numberOpt('keepProducts (an integer from 0 to 27)', opts.keepProducts, n => Number.isInteger(n) && n >= 0 && n <= 27, NORMAL_KEEP),
        handBack,
        dropAxe: flag('dropAxe', opts.dropAxe, false),
        runGated: opts.runGated ?? runGatedProgram,
        makeGate: opts.makeGate ?? inPageGate,
        receive: opts.receive ?? receiveFrom,
        swap: opts.swap ?? swap,
        log: opts.log ?? (() => {})
    };
}

const bandEnd = (o: Resolved, b: Band) => Math.min(b.end, o.to);

/** The band the state is in, or null once the target level is reached. */
export function bandFor(s: BotWorldState, opts: WoodcuttingOptions = {}): Band['name'] | null {
    const o = resolve(opts);
    const l = wcLevel(s);
    return BANDS.find(b => l < bandEnd(o, b))?.name ?? null;
}

/**
 * The technique a band starts on: a burying band (oak or willow with `bury`) the knife, or plain
 * when plain is forced (see Bones; under auto it then switches on its on-time rate, `bandSwitches`);
 * normal trees plain unless the knife is forced; else the option ('auto': the gate).
 */
export function bandTechnique(opts: WoodcuttingOptions, tree: Tree): GatedTechnique {
    return techniqueOf(resolve(opts), tree);
}

/** A burying band under `technique` auto: no gate, the on-time switch between knife + bury and plain + bury (see Bones). */
export function bandSwitches(opts: WoodcuttingOptions, tree: Tree): boolean {
    return switchesOf(resolve(opts), tree);
}

const buryingOf = (o: Resolved, tree: Tree) => tree !== 'normal' && o.bury !== null;
const switchesOf = (o: Resolved, tree: Tree) => buryingOf(o, tree) && o.technique === 'auto';

function techniqueOf(o: Resolved, tree: Tree): GatedTechnique {
    if (buryingOf(o, tree)) return o.technique === 'plain' ? 'plain' : 'knife';
    return tree === 'normal' && o.technique === 'auto' ? 'plain' : o.technique;
}

/**
 * knife-cycle's parameters for a band and technique. A burying band passes `bury` on both
 * techniques (knife + bury and plain + bury, see Bones), and `waitRespawn` on knife segments only
 * (normal trees fall on every log, so they never wait for a respawn). `dropEach` (rs/152: drop on
 * the label that shows the log, re-click on the same pass) goes on plain segments that do not bury:
 * plain + bury drops on its own roll label. The normal band passes `keepProducts` on both: its
 * product is the knife's own log.
 */
export function bandParams(opts: WoodcuttingOptions, tree: Tree, untilLevel: number): (technique: SegmentTechnique) => Record<string, unknown> {
    return paramsOf(resolve(opts), tree, untilLevel);
}

/** With `untilLevel` null, a Prayer run's (Prayer at the end): bounded by PRAYER_RUN_TICKS, stopped by the band. */
function paramsOf(o: Resolved, tree: Tree, untilLevel: number | null): (technique: SegmentTechnique) => Record<string, unknown> {
    const trees = o.sites[tree].trees;
    const bury = tree !== 'normal' && o.bury !== null ? o.bury : null;
    return technique => ({
        method: PRESET[tree],
        ...(trees ? { trees: trees.map(t => [t[0], t[1]]) } : {}),
        ...(untilLevel === null ? { maxTicks: PRAYER_RUN_TICKS } : { untilLevel }),
        reanchor: 'xp',
        dismiss: 'now',
        ...(bury !== null ? { bury } : {}),
        ...(technique === 'knife' ? (o.waitRespawn && tree !== 'normal' ? { waitRespawn: true } : {}) : bury === null ? { dropEach: true } : {}),
        ...(tree === 'normal' ? { keepProducts: o.keepProducts } : {}),
        ...o.params
    });
}

// ------------------------------------------------------------------ the band ledger

/** Ticks and logs of one technique at one level. */
export interface Cell {
    ticks: number;
    logs: number;
    expectedRolls: number;
    /** Logs whose gap from the previous log is a whole number of cycles, and those cycles (the rolls behind them). */
    latticeLogs: number;
    latticeRolls: number;
}

export interface LevelRow {
    knife: Cell;
    plain: Cell;
    /** Ticks between runs: the gate's probes and the restarts after them. */
    probeTicks: number;
    /** Ticks between runs around a bone load (stop, trade, restart). */
    bonesTicks: number;
}

const emptyCell = (): Cell => ({ ticks: 0, logs: 0, expectedRolls: 0, latticeLogs: 0, latticeRolls: 0 });

/** knife-cycle's log counter: its gated drop counter (`successes`, one log each). */
export function logsOf(status: ProgramStatus): number {
    return status.counters[GATED_PROGRAMS['knife-cycle']!.drop] ?? 0;
}

/**
 * Every tick of a band filed by Woodcutting level and technique, from the program statuses
 * (`observe`, every published one, and each segment's last). Each log is filed under the level
 * it was cut at (the level before its xp), with the rolls it stands for, 1 / p(level); a log
 * whose gap from the previous one is a whole number of cycles (3 knife, 4 plain) also counts
 * toward the fitted success per roll, logs over the cycles they took. Off-lattice gaps
 * (re-bootstraps, resyncs, all-down waits) are left out of the fit, so it measures the chop RNG
 * and not the client.
 */
export class BandLedger {
    readonly levels = new Map<number, LevelRow>();
    private runId = Number.NaN;
    private lastTick: number;
    private lastRollTick: number | null = null;
    private lastLogs = 0;
    private nextGap: 'probe' | 'bones' = 'probe';

    constructor(readonly tree: Tree, startTick: number, private level: number) {
        this.lastTick = startTick;
    }

    row(level: number): LevelRow {
        let r = this.levels.get(level);
        if (!r) this.levels.set(level, (r = { knife: emptyCell(), plain: emptyCell(), probeTicks: 0, bonesTicks: 0 }));
        return r;
    }

    /** The gap before the next run is a bone load. */
    bonesLoad(): void {
        this.nextGap = 'bones';
    }

    private between(until: number): void {
        const gap = Math.max(0, until - this.lastTick);
        const r = this.row(this.level);
        if (this.nextGap === 'bones') r.bonesTicks += gap;
        else r.probeTicks += gap;
        this.nextGap = 'probe';
        this.lastTick = Math.max(this.lastTick, until);
    }

    observe(st: ProgramStatus, technique: SegmentTechnique, level: number): void {
        if (st.runId !== this.runId) {
            this.between(st.startedTick);
            this.runId = st.runId;
            this.lastRollTick = null;
            this.lastLogs = 0;
        }
        const tick = st.endedTick ?? st.tick;
        const cell = this.row(this.level)[technique];
        if (tick > this.lastTick) {
            cell.ticks += tick - this.lastTick;
            this.lastTick = tick;
        }
        const logs = logsOf(st);
        if (logs > this.lastLogs) {
            const n = logs - this.lastLogs;
            cell.logs += n;
            cell.expectedRolls += n / successChance(this.tree, this.level);
            const cycle = CYCLE[technique];
            if (n === 1 && this.lastRollTick !== null) {
                const gap = tick - this.lastRollTick;
                if (gap > 0 && gap % cycle === 0) {
                    cell.latticeLogs++;
                    cell.latticeRolls += gap / cycle;
                }
            }
            this.lastRollTick = tick;
            this.lastLogs = logs;
        }
        this.level = level;
    }

    /** Close the band at `tick`: the time after the last run is probe time. */
    finish(tick: number): void {
        this.between(tick);
    }
}

// ------------------------------------------------------------------ band summaries

export interface TechniqueFigures {
    ticks: number;
    logs: number;
    expectedRolls: number;
    /** The primary figure: knife about 3, plain about 4, whatever the level. */
    ticksPerExpectedRoll: number;
    ticksPerLog: number;
    /** Logs over rolls on the lattice gaps (the chop RNG, measured). */
    fittedSuccess: number;
    /** Logs over expected rolls: the formula's success over the same levels (read). */
    formulaSuccess: number;
    /** cycle / formula success: the lattice's ticks per log at these levels (rs/158's acceptance for the knife). */
    latticeTicksPerLog: number;
}

export interface SubBandRow {
    from: number;
    to: number;
    ticks: number;
    knife?: TechniqueFigures;
    plain?: TechniqueFigures;
    probeTicks: number;
    bonesTicks: number;
    /** Knife ticks over knife and plain ticks: how much of the stretch the gate held the knife. */
    knifeShare: number;
}

export interface BandSummary extends SubBandRow {
    tree: Tree;
    subBands: SubBandRow[];
    /** Roll-gap histograms by technique (the programs' own). */
    histogram: Partial<Record<SegmentTechnique, Record<number, number>>>;
    /** Program counters summed over the band's segments. */
    counters: Record<string, number>;
    deferred: number;
    skippedTicks: number;
    segments: Array<{ technique: SegmentTechnique; reason: string; runId: number; ticks: number; logs: number }>;
    /** `knife->plain (measured)` style list of the segment ends that switched technique. */
    switches: string[];
    /** A burying band's buries and Burys judged on time and late (knife-cycle), by technique: the per-mode bones a tick and on-time rate. */
    bury?: Partial<Record<SegmentTechnique, { buried: number; onTime: number; late: number }>>;
}

const r3 = (n: number) => (Number.isFinite(n) ? Math.round(n * 1000) / 1000 : Number.NaN);

const COUNTERS = ['phaseResyncs', 'resyncs', 'slips', 'switches', 'noTarget', 'levelUps', 'held', 'starters', 'fellBack', 'buried', 'burySent', 'buryOnTime', 'buryLate', 'noBoneCycles', 'lateClicks', 'prayerLevelUps', 'overBudget'] as const;

function addCell(a: Cell, b: Cell): void {
    a.ticks += b.ticks;
    a.logs += b.logs;
    a.expectedRolls += b.expectedRolls;
    a.latticeLogs += b.latticeLogs;
    a.latticeRolls += b.latticeRolls;
}

function figures(c: Cell, technique: SegmentTechnique): TechniqueFigures | undefined {
    if (!c.ticks && !c.logs) return undefined;
    return {
        ticks: c.ticks,
        logs: c.logs,
        expectedRolls: r3(c.expectedRolls),
        ticksPerExpectedRoll: r3(c.ticks / c.expectedRolls),
        ticksPerLog: r3(c.ticks / c.logs),
        fittedSuccess: r3(c.latticeLogs / c.latticeRolls),
        formulaSuccess: r3(c.logs / c.expectedRolls),
        latticeTicksPerLog: r3((CYCLE[technique] * c.expectedRolls) / c.logs)
    };
}

function rowOver(from: number, to: number, rows: LevelRow[]): SubBandRow {
    const knife = emptyCell();
    const plain = emptyCell();
    let probeTicks = 0;
    let bonesTicks = 0;
    for (const r of rows) {
        addCell(knife, r.knife);
        addCell(plain, r.plain);
        probeTicks += r.probeTicks;
        bonesTicks += r.bonesTicks;
    }
    const k = figures(knife, 'knife');
    const p = figures(plain, 'plain');
    return {
        from,
        to,
        ticks: knife.ticks + plain.ticks + probeTicks + bonesTicks,
        ...(k ? { knife: k } : {}),
        ...(p ? { plain: p } : {}),
        probeTicks,
        bonesTicks,
        knifeShare: r3(knife.ticks / (knife.ticks + plain.ticks))
    };
}

/**
 * A band's figures for the findings doc and rs/158: per sub-band (oak 15-60 and 60-73, willow
 * 73-85 and 85-99) and for the band, by technique, ticks per expected roll first, then ticks per
 * log, the fitted success per roll against the formula's, and the knife's share of the ticks.
 */
export function summarizeBand(ledger: BandLedger, segments: readonly GatedSegment[] = []): BandSummary {
    const tree = ledger.tree;
    const splits = SUB_BANDS[tree];
    const last = splits.length - 1;
    const levels = [...ledger.levels.entries()];
    const subBands = splits.map(([from, to], i) =>
        rowOver(from, to, levels.filter(([l]) => (i === 0 || l >= from) && (i === last || l < to)).map(([, r]) => r))
    );
    const histogram: BandSummary['histogram'] = {};
    const counters: Record<string, number> = {};
    let deferred = 0;
    let skippedTicks = 0;
    const bury: NonNullable<BandSummary['bury']> = {};
    for (const seg of segments) {
        const st = seg.status;
        if (st.counters.burySent) {
            const b = (bury[seg.technique] ??= { buried: 0, onTime: 0, late: 0 });
            b.buried += st.counters.buried ?? 0;
            b.onTime += st.counters.buryOnTime ?? 0;
            b.late += st.counters.buryLate ?? 0;
        }
        const h = ((st.result as { histogram?: Record<string, number> } | undefined)?.histogram ?? {}) as Record<string, number>;
        const into = (histogram[seg.technique] ??= {});
        for (const [gap, n] of Object.entries(h)) into[Number(gap)] = (into[Number(gap)] ?? 0) + n;
        for (const c of COUNTERS) if (st.counters[c]) counters[c] = (counters[c] ?? 0) + st.counters[c]!;
        deferred += st.deferred ?? 0;
        skippedTicks += st.skippedTicks ?? 0;
    }
    const segs = segments.map(s => ({ technique: s.technique, reason: s.reason, runId: s.status.runId, ticks: Math.max(0, (s.status.endedTick ?? s.status.tick) - s.status.startedTick), logs: logsOf(s.status) }));
    return {
        tree,
        ...rowOver(splits[0]![0], splits[last]![1], levels.map(([, r]) => r)),
        subBands,
        histogram,
        counters,
        deferred,
        skippedTicks,
        segments: segs,
        switches: segs.slice(0, -1).flatMap((s, i) => (segs[i + 1]!.technique !== s.technique ? [`${s.technique}->${segs[i + 1]!.technique} (${s.reason})`] : [])),
        ...(Object.keys(bury).length ? { bury } : {})
    };
}

// ------------------------------------------------------------------ the on-time switch (burying bands)

/**
 * The on-time share at which knife + bury and plain + bury cost the same per landed roll: 17.6 of 20
 * (main's design for rs/643). A knife bury cycle lands its roll only when both of its sends land on
 * their ticks, so it costs about 3 / r^2 ticks per landed roll against plain + bury's measured ~3.87
 * (rs/206): r = 0.88.
 */
export const BURY_BREAK_EVEN = 17.6 / 20;
/** Burys judged per window. A window holds one technique's Burys only: a switch starts a new one. */
export const SWITCH_WINDOW = 50;
/** On time in a knife window, at least, to keep the knife: the break-even, 44 of 50. */
export const KNIFE_KEEP = Math.ceil(BURY_BREAK_EVEN * SWITCH_WINDOW - 1e-9);
/** On time in a plain + bury window, at least, to go back to the knife: 47 of 50 (0.94). */
export const KNIFE_BACK = 47;

export interface RateWindow {
    /** The tick of the status that closed it. */
    tick: number;
    technique: SegmentTechnique;
    onTime: number;
    judged: number;
    /** The technique it switched to, or null when it kept the one it ran. */
    to: SegmentTechnique | null;
}

/**
 * A burying band's switch between knife + bury and plain + bury on the on-time rate it measures in
 * itself, with no probe. It reads knife-cycle's `buryOnTime` and `buryLate` from every status of the
 * technique it holds, into tumbling windows of SWITCH_WINDOW Burys:
 *
 * - knife: once more than SWITCH_WINDOW - KNIFE_KEEP (6) of the window are late it can no longer
 *   reach the break-even, and the band switches to plain + bury then, not at the window's end: on a
 *   ragged server each late send costs a roll, so the early switch is the window's own verdict, sooner.
 * - plain + bury: a full window of KNIFE_BACK (47) or more on time switches back to the knife.
 *
 * Why a minimum window and a deadband (44 to 46 keeps either technique), not a bare threshold: the
 * on-time share over 50 Burys has a standard error of about 0.046 near the break-even, so a bare
 * threshold re-switches on chop-to-chop noise, and each switch stops and restarts the program (a
 * re-anchor, a few ticks). Near the break-even the two loops cost the same per roll, so the deadband
 * costs nothing there; above it, at a true 0.94, plain + bury runs about 1.5 windows (some 300 ticks)
 * before the knife is back. At exactly 0.88 the knife keeps a window about half the time and plain +
 * bury returns about one window in eight: a switch every ~550 Burys, under 1% of the band's ticks in
 * restarts. The meter lives for one band's run: a resume starts on the knife with an empty window,
 * since a rate measured before the stop says nothing sure about the server now, and the early
 * switch bounds a ragged start at 7 late Burys.
 */
export class OnTimeMeter {
    technique: SegmentTechnique = 'knife';
    /** The open window's counts. */
    onTime = 0;
    late = 0;
    readonly windows: RateWindow[] = [];
    private runId = Number.NaN;
    private seenOnTime = 0;
    private seenLate = 0;

    /** One status of a run of `technique`; returns the technique to switch to now, or null. */
    observe(st: ProgramStatus, technique: SegmentTechnique): SegmentTechnique | null {
        if (st.runId !== this.runId) {
            this.runId = st.runId;
            this.seenOnTime = 0;
            this.seenLate = 0;
        }
        const on = st.counters.buryOnTime ?? 0;
        const late = st.counters.buryLate ?? 0;
        const dOn = Math.max(0, on - this.seenOnTime);
        const dLate = Math.max(0, late - this.seenLate);
        this.seenOnTime = on;
        this.seenLate = late;
        // a stopped run's last statuses, after the switch away from it, are not the new technique's
        if (technique !== this.technique) return null;
        this.onTime += dOn;
        this.late += dLate;
        return this.judge(st.tick);
    }

    private judge(tick: number): SegmentTechnique | null {
        const judged = this.onTime + this.late;
        if (this.technique === 'knife') {
            if (this.late > SWITCH_WINDOW - KNIFE_KEEP) return this.close(tick, 'plain');
            if (judged >= SWITCH_WINDOW) this.close(tick, null);
            return null;
        }
        if (judged < SWITCH_WINDOW) return null;
        return this.close(tick, this.onTime >= KNIFE_BACK ? 'knife' : null);
    }

    private close(tick: number, to: SegmentTechnique | null): SegmentTechnique | null {
        this.windows.push({ tick, technique: this.technique, onTime: this.onTime, judged: this.onTime + this.late, to });
        this.onTime = 0;
        this.late = 0;
        if (to) this.technique = to;
        return to;
    }
}

// ------------------------------------------------------------------ steps

function annotation(log: TickLog, session: RunnerSession, step: string, startTick: number, endTick: number, ok: boolean, meta: Record<string, unknown>): void {
    // A 0-tick row: the step's own measure row carries its ticks, so report() never counts these.
    log.append({ v: 1, runId: log.runId, account: session.name, sessionId: session.sessionId, step, startTick, endTick, ticks: 0, wallMs: 0, ok, meta, tickMs: tickMs(), at: new Date().toISOString() });
}

function gateMeta(gate: HostGate) {
    return {
        history: gate.history.map(h => ({ tick: h.tick, why: h.why, on: h.on, switched: h.switched, ...(h.measured ? { measured: h.measured } : {}), ...(h.result ? { probe: { ticks: h.result.ticks, lost: h.result.lost } } : {}) })),
        switches: gate.switches()
    };
}

export interface Hit {
    tick: number;
    at: Tile;
    hpFrom: number;
    hpTo: number;
    /** The NPCs within HIT_REACH, as `name (combat N) at x,z`: the published hit's source index is unreliable while the player interacts (rs/195). */
    near: string[];
}

/** The hit between two states, if hitpoints fell. */
export function hitBetween(prev: BotWorldState | null, s: BotWorldState): Hit | null {
    const a = prev?.player;
    const p = s.player;
    if (!a || !p || !(p.hp < a.hp)) return null;
    const near = s.nearbyNpcs
        .filter(n => Math.max(Math.abs((n.tileX ?? n.x) - p.worldX), Math.abs((n.tileZ ?? n.z) - p.worldZ)) <= HIT_REACH)
        .map(n => `${n.name} (combat ${n.combatLevel}) at ${n.tileX ?? n.x},${n.tileZ ?? n.z}`);
    return { tick: s.tick, at: [p.worldX, p.worldZ], hpFrom: a.hp, hpTo: p.hp, near };
}

/**
 * Watches a step's states for hits: logs each one and writes its row, and trips once a hit leaves
 * hitpoints at or below `hpStop` (never with 0). `tripped` resolves on the trip, for a race.
 */
class HitGuard {
    hit: Hit | null = null;
    readonly tripped: Promise<Hit>;
    private trip!: (h: Hit) => void;
    private readonly off: () => void;
    private readonly stopAt: number;

    constructor(o: Resolved, ctx: StepContext<Record<string, never>>, step: string, onTrip: (h: Hit) => void = () => {}) {
        this.tripped = new Promise(r => (this.trip = r));
        this.stopAt = o.hpStop;
        let prev = ctx.sdk.getState();
        this.off = ctx.sdk.onStateUpdate(s => {
            const h = hitBetween(prev, s);
            prev = s;
            if (!h) return;
            o.log(`${step}: T${h.tick} hit ${h.hpFrom} -> ${h.hpTo} at ${h.at.join(',')}; beside: ${h.near.join(', ') || 'no NPC'}`);
            annotation(ctx.log, ctx.session, 'woodcutting:hit', h.tick, h.tick, true, { kind: 'wc-hit', step, ...h });
            if (!this.hit && o.hpStop > 0 && h.hpTo <= o.hpStop) {
                this.hit = h;
                o.log(`${step}: hitpoints ${h.hpTo}, at or below hpStop ${o.hpStop}: stopping for a clean logout`);
                onTrip(h);
                this.trip(h);
            }
        });
    }

    /** Unsubscribe (idempotent). */
    stop(): void {
        this.off();
    }

    /** Unsubscribe; throws the stop if the guard tripped. */
    close(): void {
        this.off();
        const h = this.hit;
        if (h) throw new Error(`hpStop: hitpoints ${h.hpTo}, at or below ${this.stopAt}, after a hit on T${h.tick} at ${h.at.join(',')} (beside: ${h.near.join(', ') || 'no NPC'})`);
    }
}

function walkStep(o: Resolved, name: string, goal: Tile, needed: (s: BotWorldState) => boolean, waypoints: readonly Tile[]): Step {
    return {
        name,
        preconditions: () => true,
        async run(ctx) {
            const { sdk, bot } = ctx;
            const s = sdk.getState();
            if (!s?.player || !needed(s) || near(s, goal, NEAR)) return;
            const from: Tile = [s.player.worldX, s.player.worldZ];
            o.log(`${name}: route ${o.route}, from ${from.join(',')} to ${goal.join(',')} (T${s.tick})`);
            const guard = new HitGuard(o, ctx, name);
            try {
                // The SDK walks run whenever the player has energy; level-ups (Hitpoints from an
                // attacker) would otherwise hold the walk.
                await withLevelUpDismissal(sdk, async () => {
                    for (const [x, z] of [...routeFrom(from, goal, waypoints), goal]) {
                        const r = await Promise.race([bot.walkTo(x, z, x === goal[0] && z === goal[1] ? 0 : 2, { timeout: 600 * tickMs() }), guard.tripped.then(() => null)]);
                        if (r === null) return;
                        if (!r.success) throw new Error(`walkTo ${x},${z}: ${r.message}`);
                        o.log(`${name}: at ${sdk.getState()?.player?.worldX},${sdk.getState()?.player?.worldZ} (T${sdk.getState()?.tick})`);
                    }
                });
            } finally {
                guard.close();
            }
        },
        postconditions: s => (!needed(s) || near(s, goal, NEAR) ? true : `not within ${NEAR} tiles of ${goal[0]},${goal[1]}`),
        logoutSafe: true
    };
}

/**
 * S07's bone cue for a giver group: one CueWriter, so one session, for the whole step. It names the
 * scored account (by hash) to the givers, which ignore every cue not scoped S07_BONE_CUE. With
 * `session` a resumed process carries on that session (its seq and open), so the givers' load count
 * in it holds; without, each process starts its own.
 */
export class BoneCue {
    private writer: CueWriter | null = null;
    constructor(readonly dir: string, private readonly sessionId?: string) {}

    private static beacons(s: BotWorldState | null): Beacon[] {
        return [{ tick: s?.tick ?? 0, ms: Date.now() }];
    }

    /** `stand`: SCORED's stand at the site it chops at now (Cue.site), which the givers go to and wait at. */
    write(s: BotWorldState | null, receiver: string, stand: Tile): void {
        this.writer ??= new CueWriter(this.dir, receiver, S07_BONE_CUE, this.sessionId);
        this.writer.write({ beacons: BoneCue.beacons(s), turns: [], site: { x: stand[0], z: stand[1] } });
    }

    stop(s: BotWorldState | null): void {
        this.writer?.stop(BoneCue.beacons(s));
    }

    get session(): string | null {
        return this.writer?.session ?? null;
    }
}

/**
 * The group's server once SCORED sees it: boneServer's choice (the rule and status files the givers
 * read, so both sides name the same giver), taken only on a frame whose nearbyPlayers shows it. The
 * choice is site-blind: a giver waiting loaded at the other site can be the oldest ready (attempt 3,
 * S07 load 2: the server waited at the willows while SCORED chopped oaks, and the trade click failed
 * player_not_found). That giver never sees SCORED, leaves its site after siteWaitTicks and drops out
 * of the order (bone-giver.ts cycle), and the choice moves on to a giver here, already queued, which
 * requests once it is the server. Re-reads the statuses each frame, at most `maxTicks` observed ticks;
 * with `after`, only frames past that tick count.
 */
export async function awaitServerInSight(sdk: StateSource, dir: string, group: readonly string[], maxTicks: number, session?: string, after?: number): Promise<ServerWait> {
    const from = after ?? sdk.getState()?.tick ?? 0;
    let server: string | undefined;
    const seen = (s: BotWorldState) => {
        server = boneServer(readBoneStatuses(dir), group, Date.now(), session);
        const name = server === undefined ? null : canonName(server);
        return name !== null && s.nearbyPlayers.some(p => canonName(p.name) === name);
    };
    const r = await waitUntil(sdk, seen, { maxTicks, ...(after !== undefined ? { after } : {}) });
    return { server: r.ok ? server : undefined, waited: Math.max(0, r.tick - from) };
}

const bonesIn = (o: Resolved, s: BotWorldState) => s.inventory.filter(i => o.bonesRe.test(i.name)).length;

/**
 * Whether the givers hold another S07 load: false once the last load came (`lastLoad`'s, with the
 * runes) or, for a group, once its status files in the cue's session count every load given (the
 * givers' `loads`); true while the last load is still to come; null when nothing says (one giver
 * without `lastLoad`, or a group whose session or count is not yet published).
 */
function loadsLeftOf(o: Resolved, cue: BoneCue | null): (s: BotWorldState | null) => boolean | null {
    const giver = o.bones;
    return s => {
        if (!giver || (s && giver.lastLoad !== null && runesHeld(s))) return false;
        if ('group' in giver) {
            const session = giver.session ?? cue?.session ?? undefined;
            if (session !== undefined) {
                const statuses = readBoneStatuses(giver.cueDir);
                const total = groupLoads(statuses, giver.group, session);
                if (total !== null) return groupLoadsDone(statuses, giver.group, session) < total;
            }
        }
        return giver.lastLoad !== null ? true : null;
    };
}

/** Prayer under `prayerTo` (never with 0). */
const prayerShort = (o: Resolved, s: BotWorldState | null) => o.prayerTo > 0 && levelOf(s, 'prayer') < o.prayerTo;
/** The last load (`lastLoad`'s, with T07-08's runes) is still to come. */
const runesOwed = (o: Resolved, s: BotWorldState | null) => !!s && o.bones?.lastLoad != null && !runesHeld(s);

/**
 * The last burying band past its end with work left (Prayer at the end): Prayer owed and something to
 * bury toward it (bones held, or a load the givers are known to hold), or the runes' load still to come
 * and a load known to be left. Never for another band.
 */
function endWorkOf(o: Resolved, b: Band, last: boolean, cue: BoneCue | null): (s: BotWorldState) => boolean {
    if (!last || b.tree === 'normal' || o.bury === null) return () => false;
    const end = bandEnd(o, b);
    const left = loadsLeftOf(o, cue);
    return s => wcLevel(s) >= end && ((prayerShort(o, s) && (bonesIn(o, s) > 0 || left(s) === true)) || (runesOwed(o, s) && left(s) === true));
}

/** `next`: the burying band after this one (the willows after the oaks), whose site the cue names once this band is done. */
function bandStep(o: Resolved, b: Band, last: boolean, cue: BoneCue | null, next: Site | null = null): Step {
    const end = bandEnd(o, b);
    const site = o.sites[b.tree];
    const technique = techniqueOf(o, b.tree);
    const knifeCapable = technique !== 'plain';
    const burying = buryingOf(o, b.tree);
    const switching = switchesOf(o, b.tree);
    const giver = burying ? o.bones : null;
    const group = giver && 'group' in giver ? giver : null;
    const passed = (s: BotWorldState) => wcLevel(s) >= end;
    const bonesHeld = (s: BotWorldState) => bonesIn(o, s);
    const loadsLeft = loadsLeftOf(o, cue);
    const endWork = endWorkOf(o, b, last, cue);
    const bandDone = (s: BotWorldState) => passed(s) && !endWork(s);
    const params = paramsOf(o, b.tree, end);
    const prayerParams = paramsOf(o, b.tree, null);

    const pre = (s: BotWorldState): true | string => {
        if (bandDone(s)) return true;
        const l = wcLevel(s);
        const axe = axeOf(s);
        if (!axe) return 'no axe worn or carried';
        if (!RUNE_AXE.test(axe)) o.log(`${b.name}: chopping with ${axe}, not a rune axe (the adamant fallback is priced at +441)`);
        if (l < TREE_LEVEL[b.tree]) return `Woodcutting ${l}, ${b.tree} trees need ${TREE_LEVEL[b.tree]}`;
        if (knifeCapable && (!count(s.inventory, KNIFE) || !count(s.inventory, LOGS))) return `technique ${technique} needs a knife and a normal log`;
        if (knifeCapable && !s.skills.some(k => k.name.toLowerCase() === 'fletching' && k.baseLevel >= 1)) return 'technique needs Fletching 1';
        // the logs this band drops at its start count as free
        const free = 28 - s.inventory.length + (b.tree === 'normal' ? 0 : extraLogs(s, o.keepProducts).length + productLogs(s, b.tree).length + carriedLogs(s, b.tree).length);
        // a burying band's first cycles bury the bones it holds, each a slot freed for the log; the
        // first log needs a free slot all the same, as a run buries only once it has anchored on one
        const held = burying ? bonesHeld(s) : 0;
        if (free < 1 || free + held < 2) return `${free} free inventory slots${burying ? ` and ${held} bones to bury` : ''}, 2 needed${free < 1 ? ', 1 of them free for the first log' : ''}`;
        if (!near(s, site.stand, NEAR)) return `not within ${NEAR} tiles of ${site.stand[0]},${site.stand[1]}`;
        if (burying) {
            if (!held && !giver) return 'bury needs bones in the pack or a bone giver';
            if (giver && giver.lastLoad === null && free + held < giver.load + 1) return `${free} free slots and ${held} bones: no room for a ${giver.load}-bone load and the log`;
            if (giver && giver.lastLoad !== null && !runesHeld(s)) {
                const room = Math.max(giver.load, giver.lastLoad + CAMELOT_RUNES.length);
                if (free + held < room + 1) return `${free} free slots and ${held} bones: no room for a ${giver.load}-bone load, or the last load's ${giver.lastLoad} bones and ${CAMELOT_RUNES.length} rune stacks, and the log`;
            }
        }
        return true;
    };

    const run = async (ctx: StepContext<Record<string, never>>) => {
        const { sdk, bot, session, log } = ctx;
        const s0 = sdk.getState();
        if (!s0 || bandDone(s0)) return;
        if (b.tree !== 'normal') {
            // a drop keeps the walk queue, and it lands before the first load's trade completes
            const extra = extraLogs(s0, o.keepProducts);
            const carried = carriedLogs(s0, b.tree);
            for (const i of [...extra, ...carried].slice(0, 5)) void sdk.sendDropItem(i.slot);
            if (extra.length) o.log(`${b.name}: dropped ${Math.min(5, extra.length)} normal log(s) past ${o.keepProducts} at the band's start`);
            if (carried.length) o.log(`${b.name}: dropped ${Math.min(5 - Math.min(5, extra.length), carried.length)} oak log(s) carried in from the oak band at the band's start`);
        }
        if (site.trees && !(s0.player?.worldX === site.stand[0] && s0.player?.worldZ === site.stand[1])) {
            // `trees` are the tiles reachable from the stand itself (knife-cycle header)
            const r = await bot.walkTo(site.stand[0], site.stand[1], 0, { timeout: 100 * tickMs() });
            const s = sdk.getState();
            if (!r.success || s?.player?.worldX !== site.stand[0] || s?.player?.worldZ !== site.stand[1]) throw new Error(`${b.name}: not on the stand ${site.stand.join(',')}: ${r.message}`);
        }
        const startTick = sdk.getState()?.tick ?? s0.tick;
        const startLevel = wcLevel(s0);
        const startPrayer = levelOf(s0, 'prayer');
        // A fresh gate per band: its first probe and its measured stretch are the band's own.
        const dirs = o.probeDirs && site.trees && b.tree !== 'normal' ? freeDirs(site.stand, site.trees, FOOTPRINT[b.tree]) : [];
        const gate = technique === 'auto' ? o.makeGate(sdk, { plainTicksPerRoll: o.plainTicksPerRoll, measureDrops: MEASURE_DROPS, log: o.log, ...(dirs.length ? { dirs } : {}), ...o.gate }) : undefined;
        const ledger = new BandLedger(b.tree, startTick, startLevel);
        const segments: GatedSegment[] = [];
        // A burying band's switch (see Bones): the band and a resume start on the knife, with an empty window.
        const meter = switching ? new OnTimeMeter() : null;
        const switched = (to: SegmentTechnique, tick: number) => {
            const w = meter!.windows[meter!.windows.length - 1]!;
            const why = to === 'plain' ? `${w.judged - w.onTime} of ${w.judged} late, past the ${SWITCH_WINDOW - KNIFE_KEEP} a ${SWITCH_WINDOW}-Bury window allows (${KNIFE_KEEP}/${SWITCH_WINDOW}, 17.6/20)` : `${w.onTime}/${w.judged} on time, at least ${KNIFE_BACK}/${SWITCH_WINDOW}`;
            o.log(`${b.name}: T${tick} ${w.technique} + bury -> ${to} + bury: ${why}`);
            annotation(log, session, `${b.name}:switch`, tick, tick, true, { kind: 'wc-switch', from: w.technique, to, onTime: w.onTime, judged: w.judged, level: wcLevel(sdk.getState()), prayer: levelOf(sdk.getState(), 'prayer') });
        };
        // The group finds the scored account by the cue, and its site by the cue's: written before the first load, every band (a resume too).
        if (group && cue) cue.write(sdk.getState(), session.name, site.stand);
        // The loads the group gave in this session before the band (the oak band's, or a stopped process's): row numbers carry on from them.
        const loadsBefore = group && cue?.session ? groupLoadsDone(readBoneStatuses(group.cueDir), group.group, cue.session) : 0;
        let loads = 0;
        let current: AbortController | null = null;
        const guard = new HitGuard(o, ctx, b.name, () => current?.abort());

        const topUp = async () => {
            const t0 = sdk.getState()?.tick ?? 0;
            const before = bonesHeld(sdk.getState()!);
            const want = { want: [{ item: o.bonesRe, amount: giver!.lastLoad ?? giver!.load }], maxTicks: 60, openMaxTicks: 67 };
            let partner: string | null = giver && 'giver' in giver ? giver.giver : null;
            let r: ReceiveResult;
            let pick: { waited: number; repicks: number; tried: string[] } | null = null;
            if (!group) r = await o.receive(sdk, partner!, want);
            else {
                // A group's load comes from its server, whoever that is now, once it is here. One budget of
                // `serverWait` observed ticks covers the waits and the trades: while it lasts, a trade that
                // failed before any item could move re-picks rather than failing the band.
                pick = { waited: 0, repicks: 0, tried: [] };
                const refusal = `no giver of the group served within ${group.serverWait} observed ticks`;
                let after: number | undefined;
                let failed: ReceiveResult | null = null;
                for (;;) {
                    const left = group.serverWait - ((sdk.getState()?.tick ?? t0) - t0);
                    if (failed && left > 0) {
                        pick.repicks++;
                        o.log(`${b.name}: bone load ${loadsBefore + loads + 1} from ${partner} failed before any item moved (${failed.reason ?? 'no reason'}): re-picking the server, ${left} ticks of serverWait left`);
                    }
                    // The cue's session, as the givers count theirs: a status file another run left counts for nothing.
                    const w = left > 0 ? await awaitServerInSight(sdk, group.cueDir, group.group, left, cue?.session ?? undefined, after) : { server: undefined, waited: 0 };
                    pick.waited += w.waited;
                    if (w.server === undefined) {
                        r = failed && left <= 0 ? failed : { ok: false, ticks: 0, received: [], reason: failed ? `${refusal} (after ${failed.reason ?? 'a failed trade'})` : refusal };
                        if (!failed) partner = null;
                        break;
                    }
                    partner = w.server;
                    pick.tried.push(partner);
                    // Items move only once SCORED has accepted the confirm screen: before that a failed trade is safe to retry.
                    let confirmed = false;
                    const unwatch = sdk.onStateUpdate(s => {
                        const t = tradeOf(s);
                        if (t.isOpen && t.screen === 'confirm' && t.myAccepted) confirmed = true;
                    });
                    try {
                        r = await o.receive(sdk, partner, want);
                    } finally {
                        unwatch();
                    }
                    if (r.ok || confirmed || r.received.length > 0 || bonesHeld(sdk.getState()!) !== before) break;
                    failed = r;
                    // The next pick reads a later frame: the statuses and who is in sight have had a tick to change.
                    after = sdk.getState()?.tick ?? t0;
                }
            }
            const t1 = sdk.getState()?.tick ?? t0;
            const got = bonesHeld(sdk.getState()!) - before;
            loads++;
            annotation(log, session, 'woodcutting:bones-load', t0, t1, r.ok, {
                kind: 'wc-bones-load', band: b.name, load: loadsBefore + loads, ticks: r.ticks, stepTicks: t1 - t0, received: got, ...(r.reason ? { reason: r.reason } : {}),
                ...(pick ? { giver: partner, serverWait: pick.waited, repicks: pick.repicks, tried: pick.tried } : {})
            });
            if (!r.ok) throw new Error(`${b.name}: bone load ${loadsBefore + loads} from ${partner ?? `the group (${group!.group.join(', ')})`} failed: ${r.reason}`);
            ledger.bonesLoad();
        };

        let ended = 'stopped';
        // a load before the first start when the pack is empty, and after each stop for one
        let needLoad = !!giver && bonesHeld(s0) === 0 && loadsLeft(s0) !== false;
        // Once no load is left none comes back: the status files are not read again.
        let spent = false;
        const left = (s: BotWorldState | null): boolean | null => {
            if (spent) return false;
            const l = loadsLeft(s);
            spent = l === false;
            return l;
        };
        try {
            for (;;) {
                if (guard.hit) break;
                const here = sdk.getState()!;
                // Past the band's end only the Prayer or the runes it owes keep it (endWorkOf): runs bounded by those, not the level.
                const owing = passed(here);
                if (owing) {
                    if (!endWork(here)) {
                        ended = 'done';
                        break;
                    }
                    if (!bonesHeld(here)) needLoad = true;
                    o.log(`${b.name}: Woodcutting ${wcLevel(here)}, Prayer ${levelOf(here, 'prayer')} of ${o.prayerTo}${runesOwed(o, here) ? ', the runes to come' : ''}: burying on, ${bonesHeld(here)} bones held`);
                }
                // the last run's log (productLogs): dropped before the load's trade and the run, both of which need its slot
                const spare = productLogs(here, b.tree);
                for (const i of spare.slice(0, 5)) void sdk.sendDropItem(i.slot);
                if (spare.length) o.log(`${b.name}: dropped ${Math.min(5, spare.length)} ${b.tree} log(s) before the run`);
                if (needLoad) await topUp();
                needLoad = false;
                const prayerXp = xpOf(sdk.getState(), 'prayer');
                const stop = new AbortController();
                current = stop;
                let wantBones = false;
                // set from the closures, which TypeScript's narrowing does not follow
                let switchTo = null as SegmentTechnique | null;
                let noneSince: number | null = null;
                const base = owing ? prayerParams : params;
                // lab only (holdTicks): the forced-slip hold stops reaching runs once the band is that far in
                const holdOver = o.holdTicks !== null && (sdk.getState()?.tick ?? startTick) - startTick >= o.holdTicks;
                const runParams = holdOver ? (t: SegmentTechnique) => Object.fromEntries(Object.entries(base(t)).filter(([k]) => k !== 'hold')) : base;
                const result = await o.runGated(sdk, 'knife-cycle', runParams, {
                    technique: meter ? meter.technique : technique,
                    ...(gate ? { gate } : {}),
                    rollsPerDrop: s => 1 / successChance(b.tree, wcLevel(s)),
                    signal: stop.signal,
                    log: o.log,
                    onProgress: (st, tech) => {
                        ledger.observe(st, tech, wcLevel(sdk.getState()));
                        if (stop.signal.aborted) return;
                        const to = meter?.observe(st, tech) ?? null;
                        if (to) {
                            switchTo = to;
                            switched(to, st.tick);
                            stop.abort();
                            return;
                        }
                        // either bury loop buries and takes loads (see Bones)
                        if (!burying) return;
                        const now = sdk.getState();
                        if (owing && !prayerShort(o, now) && !runesOwed(o, now)) {
                            stop.abort();
                            return;
                        }
                        if (!giver && !owing) return;
                        if (st.gauges.bonesLeft !== 0) {
                            noneSince = null;
                            return;
                        }
                        noneSince ??= st.tick;
                        if (st.tick - noneSince < BONES_SETTLE) return;
                        // Before the end a load is asked for unless none is left; past it, only one the givers are known to hold.
                        const l = left(now);
                        if (owing ? l === true : l !== false) wantBones = true;
                        else if (!owing) return;
                        stop.abort();
                    },
                    onSegment: seg => {
                        ledger.observe(seg.status, seg.technique, wcLevel(sdk.getState()));
                        // the run's last Burys, judged after its last progress: the next run starts on their verdict
                        const to = meter?.observe(seg.status, seg.technique) ?? null;
                        if (to) {
                            switchTo = to;
                            switched(to, seg.status.endedTick ?? seg.status.tick);
                        }
                        segments.push(seg);
                        const st = seg.status;
                        annotation(log, session, `${b.name}:segment`, st.startedTick, st.endedTick ?? st.tick, seg.reason !== 'fault', {
                            kind: 'wc-segment', technique: seg.technique, reason: seg.reason, runId: st.runId, level: wcLevel(sdk.getState()), counters: st.counters,
                            result: st.result, frames: st.frames, skippedTicks: st.skippedTicks, deferred: st.deferred
                        });
                    }
                });
                ended = result.ended;
                if (guard.hit) break;
                if (result.ended === 'aborted' && (wantBones || switchTo)) {
                    // a load, a switch, or both: the next run starts in the meter's technique
                    if (wantBones) needLoad = true;
                    continue;
                }
                // The band's end: the loop's top decides whether Prayer keeps it.
                if (result.ended === 'done' && !owing && passed(sdk.getState()!)) continue;
                if (owing && result.ended === 'aborted') {
                    // Prayer reached, or nothing left to bury: the top closes. A run that buried nothing closes it here.
                    if (xpOf(sdk.getState(), 'prayer') > prayerXp) continue;
                    o.log(`${b.name}: a Prayer run buried nothing: closing at Prayer ${levelOf(sdk.getState(), 'prayer')}`);
                    ended = 'done';
                    break;
                }
                if (owing && result.ended === 'done') ended = `the ${PRAYER_RUN_TICKS}-tick bound of a Prayer run`;
                break;
            }
        } finally {
            current = null;
            guard.stop();
        }
        const endState = sdk.getState();
        const endTick = endState?.tick ?? startTick;
        ledger.finish(endTick);
        annotation(log, session, `${b.name}:summary`, startTick, endTick, ended === 'done', {
            kind: 'wc-band', ended, technique, route: o.route, stand: [site.stand[0], site.stand[1]], hpStop: o.hpStop, startLevel, endLevel: wcLevel(endState), bonesLoads: loads,
            ...(burying ? { startPrayer, endPrayer: levelOf(endState, 'prayer') } : {}),
            ...summarizeBand(ledger, segments),
            ...(meter ? { onTimeSwitch: { finalTechnique: meter.technique, windows: meter.windows, open: { onTime: meter.onTime, judged: meter.onTime + meter.late } } } : {}),
            ...(gate ? { gate: gateMeta(gate) } : {}),
            ...(guard.hit ? { stoppedBy: guard.hit } : {})
        });
        guard.close();
        if (ended !== 'done') throw new Error(`knife-cycle ended ${ended} at Woodcutting ${wcLevel(endState)}`);
        // S07's chopping is over: the group stands down (a band that failed keeps it, for the resume).
        if (last && group && cue) cue.stop(endState);
        // SCORED leaves for the next band's site now: the givers set off with it, not after its walk.
        else if (next && group && cue) cue.write(endState, session.name, next.stand);
    };

    return {
        name: b.name,
        preconditions: pre,
        run,
        resume: run,
        postconditions: s => {
            if (!passed(s)) return `Woodcutting ${wcLevel(s)}: the band did not reach ${end}`;
            if (!axeOf(s)) return 'the axe is gone';
            if (knifeCapable && (!count(s.inventory, KNIFE) || !count(s.inventory, LOGS))) return 'the knife or the last normal log is gone';
            if (last && burying && o.prayerTo && levelOf(s, 'prayer') < o.prayerTo) return `Prayer ${levelOf(s, 'prayer')}, below ${o.prayerTo}`;
            if (last && giver?.lastLoad != null && !runesHeld(s)) return `law ${count(s.inventory, LAW)} and air ${count(s.inventory, AIR)}: the last load's Camelot runes (1 and 5) are not held`;
            return true;
        },
        logoutSafe: true,
        done: ({ state }) => bandDone(state),
        inProgress: ({ state }) => !bandDone(state) && wcLevel(state) >= TREE_LEVEL[b.tree] && near(state, site.stand, NEAR)
    };
}

/** What the hand-back gives: the axe in the pack and every bone held, one spec per item id (a spec offers one id). */
export function handBackSpecs(s: BotWorldState, bonesRe: RegExp): GiveSpec[] {
    return [...new Set(s.inventory.filter(i => AXE.test(i.name) || bonesRe.test(i.name)).map(i => i.id))].map(id => ({ item: id }));
}

function handBackStep(o: Resolved, partner: string): Step {
    const out = (s: BotWorldState) => s.inventory.filter(i => AXE.test(i.name) || o.bonesRe.test(i.name));
    const handedBack = (s: BotWorldState) => out(s).length === 0 && runesHeld(s);
    return {
        name: 'woodcutting:hand-back',
        preconditions: s => {
            if (handedBack(s)) return true;
            if (wcLevel(s) < o.to) return `Woodcutting ${wcLevel(s)}: the hand-back waits for ${o.to}`;
            if (!s.inventory.some(i => AXE.test(i.name))) return 'no axe in the pack to hand back (a worn axe cannot be traded)';
            // swap() offers first, and the server counts offered items as freed (trade.rs2:161-190)
            const frees = out(s).length;
            const adds = [LAW, AIR].filter(re => !s.inventory.some(i => re.test(i.name))).length;
            const free = 28 - s.inventory.length;
            return free + frees >= adds ? true : `${free} free slots and ${frees} handed back: the Camelot runes need ${adds}`;
        },
        async run(ctx) {
            const { sdk, session, log } = ctx;
            const s0 = sdk.getState();
            if (!s0 || handedBack(s0)) return;
            const r = await o.swap(sdk, partner, handBackSpecs(s0, o.bonesRe), CAMELOT_RUNES, { closeModals: true, maxTicks: 60 });
            const t1 = sdk.getState()?.tick ?? s0.tick;
            const items = (xs: ReadonlyArray<{ name: string; count: number }>) => xs.map(i => `${i.name} x${i.count}`);
            annotation(log, session, 'woodcutting:hand-back', s0.tick, t1, r.ok, {
                kind: 'wc-hand-back', ticks: r.ticks, openTicks: r.openTicks, gave: items(r.gave), received: items(r.received), ...(r.reason ? { reason: r.reason } : {})
            });
            if (!r.ok) throw new Error(`woodcutting:hand-back: the swap failed: ${r.reason}`);
        },
        postconditions: s => (handedBack(s) ? true : `after the hand-back: ${out(s).length} axe or bone slots still held, law ${count(s.inventory, LAW)} and air ${count(s.inventory, AIR)} (1 and 5 wanted)`),
        logoutSafe: true,
        done: ({ state }) => handedBack(state)
    };
}

/** At `to`: drop every axe in the pack, without waiting (as mining.exit): the leg after keeps its queue. */
function dropAxeStep(o: Resolved): Step {
    const axes = (s: BotWorldState) => s.inventory.filter(i => AXE.test(i.name));
    const sent = new Set<number>();
    return {
        name: 'woodcutting:drop-axe',
        preconditions: s => (wcLevel(s) >= o.to ? true : `Woodcutting ${wcLevel(s)}: the axe drop waits for ${o.to}`),
        async run({ sdk }) {
            sent.clear();
            for (const i of axes(sdk.getState()!).slice(0, 5)) {
                sent.add(i.slot);
                void sdk.sendDropItem(i.slot);
            }
        },
        // a drop sent and not yet published passes: waiting on it would cost the leg a tick
        postconditions: s => {
            const left = axes(s).filter(i => !sent.has(i.slot));
            return left.length ? `still held at S07's end: ${left.map(i => i.name).join(', ')}` : true;
        },
        logoutSafe: true,
        done: ({ state }) => wcLevel(state) >= o.to && axes(state).length === 0
    };
}

/** The woodcutting steps from the current state to `to` (see the file comment). */
export function steps(opts: WoodcuttingOptions = {}): Step[] {
    const o = resolve(opts);
    const [normal, oak, willow] = BANDS as [Band, Band, Band];
    const oakEnd = bandEnd(o, oak);
    // the band the Prayer postcondition goes on (bury needs to > 15, so oak or willow)
    const willowLast = o.to > oak.end;
    const cue = o.bones && 'group' in o.bones ? new BoneCue(o.bones.cueDir, o.bones.session) : null;
    const willowOwes = endWorkOf(o, willow, willowLast, cue);
    return [
        walkStep(o, 'woodcutting:walk-oaks', o.sites.oak.stand, s => wcLevel(s) < oakEnd, o.sites.approach),
        bandStep(o, normal, false, cue),
        bandStep(o, oak, !willowLast, cue, willowLast ? o.sites.willow : null),
        walkStep(o, 'woodcutting:walk-willows', o.sites.willow.stand, s => (wcLevel(s) >= oakEnd && wcLevel(s) < o.to) || willowOwes(s), []),
        bandStep(o, willow, willowLast, cue),
        ...(o.handBack !== null ? [handBackStep(o, o.handBack)] : []),
        ...(o.dropAxe ? [dropAxeStep(o)] : [])
    ];
}
