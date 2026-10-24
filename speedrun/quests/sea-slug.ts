// Sea Slug: STEP-MANIFEST.md entry 20 (S19).
//
// From Caroline's tile (2716,3302) in Witchaven, where T18-19's run from the Ardougne market
// knights leaves SCORED, to Caroline's reward and the exit drops. The route is
// docs/speedrun/scripts/quest-smallskill-seaslug.ts (sea_slug.md's step list), one segment per
// durable stage or crossing, A to Q.
//
// What the content does that the module is built around (server/content/scripts; the platform's
// NPCs under areas/area_fishing_platform, the quest under quests/quest_seaslug):
// - The fishing platform's doors sit on bridge-flagged tiles. Each is clicked as a loc by tile
//   and id (`openBridgedDoor`), and its state is read from the published locs: opening loc_1533 at
//   (2765,3277) puts loc_1534 one tile east, and loc_1530 at (2764,3285) becomes loc_1531 one tile
//   east (m, lab, both clients list them since rs/54's SceneLite.mapLevel). The store room's door
//   is the glass room's twin (loc_1533 at 2765,3287, the same shape and angle in the map). A click on the closed
//   id at the closed tile can never shut an open door: the closed loc is gone from that tile and the
//   server drops the op (server/engine OpLocHandler: no such loc).
// - The journal (seaslug_journal.rs2) has no marker at 2 or 6, and 4-5 and 8-9 share their text,
//   so `stageFloor` narrows the journal's candidates by coordinates: Holgart only sails from stage 3
//   (holgart_ardougne.rs2:45-55), so off the mainland 2 is out; he only reaches Kent's island at 5
//   (holgart_platform.rs2:26), so there 4 is out. 8 and 9 stay together: a resume there kicks the
//   panel again, which at 9 only says 'nothing interesting happens' (quest_seaslug.rs2:93-94).
// - Holgart's crossings (`board_*` procs) close the chat, p_delay(2), telejump and open a mesbox;
//   the Ardougne-to-platform crossing (also the island's way back) puts a lit torch out.
// - From stage 6 the platform ladder needs a lit torch, or the fishermen hit for 4 and SCORED stays
//   down (quest_seaslug.rs2:65-79). The rub lights it at random below Firemaking ~50 (`:48`).
// - Kennith answers through his wall (`kennithwall`, `:119-122`) once per click; the crane works
//   only from z >= 3289 (`:96-100`), north of its footprint.
// - Caroline's reward (caroline.rs2:42-46) gives 1 QP, the oyster pearls and 7,175 base Fishing,
//   and queues the quest-complete scroll.
// - Every var is scope=perm: logout-safe throughout (the entry: logoutSafe yes). Doors shut again
//   after 500 ticks (doors.rs2 open_door(500)); the door step reads the state, never assumes it.
//
// The exit drops (the slot ledger's T19-20 drops, moved into the step): the torch, the dry sticks,
// the broken glass and the oyster pearls, and any other quest leftover. H15's runes are not quest
// items and stay.

import type { BotWorldState, QuestJournalState } from '../../sdk/types';
import { act, dropItems, invOp, talkTo, useOn, type ActSdk } from '../lib/act';
import { converse, levelUpInterrupt, type ConverseResult, type ConverseSdk } from '../lib/converse';
import type { OptionPattern } from '../lib/dialogue';
import type { ItemPattern } from '../lib/items';
import { journalProbeName, questStage, questStatus, requireQuestStage, type QuestView, type StageName } from '../lib/quests';
import { logNote } from '../lib/ticks';
import { inArea, runTo, type Area, type TravelSdk } from '../lib/travel';
import { currentTick, waitTicks, waitUntil, type Pred } from '../lib/wait';
import { configId, invCount, pos, replyAfter } from '../lib/world';
import { QUESTS } from '../data/quest-stages';
import type { Check, Observed, StepContext } from '../runner/step';
import { allOf, baseLevels, inBox, kitSegment, kitWant, questSteps, slotsCover, talkShape, type Box, type KitItem, type QuestItem, type QuestOptions, type Segment } from './segments';

export const quest = 'seaslug' as const;
export const stepId = 'S19';

export type Options = QuestOptions;

// ------------------------------------------------------------------ places

/** T18-19's landing on Caroline's tile (legs.ts `T.caroline`, tolerance 1). */
export const ARRIVAL: Area = { x: 2716, z: 3302, tol: 1 };
export const CAROLINE_AT = { x: 2716, z: 3302 } as const;
export const HOLGART_SHORE_AT = { x: 2720, z: 3306 } as const;
/** Holgart beside his boat on the platform's ground floor (m, lab: 2782-2783,3276). */
export const HOLGART_PLATFORM_AT = { x: 2782, z: 3276 } as const;
/**
 * Beside Holgart, run to before talking to him on the platform: an NPC click from the ladder foot
 * opened nothing in 15 ticks (m, lab: 2 clicks, 34 ticks), as the proven script found.
 */
export const HOLGART_PLATFORM_STAND: Area = { x: 2782, z: 3277, tol: 1 };
export const HOLGART_ISLAND_AT = { x: 2799, z: 3320 } as const;
export const KENT_AT = { x: 2793, z: 3321 } as const;
/** The ground spawns (maps/m43_51.jm2): the glass inside the room behind loc_1533, the damp sticks by the ladder. */
export const GLASS_AT = { x: 2765, z: 3278 } as const;
export const STICKS_AT = { x: 2784, z: 3289 } as const;
/**
 * The glass's second spawn (maps/m43_51.jm2 OBJ `0 13 25`), two tiles north of the store room's
 * door. Unreachable with that door shut (m, lab: 45 ticks of "I can't reach that!"), so it is taken
 * through the door, and only when the glass room's has been taken.
 */
export const GLASS_AT_2 = { x: 2765, z: 3289 } as const;
/** North of the crane's footprint (z 3286-3289), where its op works (quest_seaslug.rs2:97). */
export const CRANE_STAND: Area = { x: 2768, z: 3290, level: 1, tol: 0 };

/**
 * Regions, judged by coordinates only (never by what is in sight: after a reconnect the first state
 * has no scene). The platform's ground floor is server level 0 and its upper floor level 1 (the map
 * keeps them at 1 and 2 with the bridge flag). The crossings land at ^seaslug_platform_coord
 * (2782,3273), ^seaslug_island_coord (2800,3320) and ^seaslug_shore_coord (2722,3305).
 */
export const WITCHAVEN: Box = { x0: 2700, z0: 3285, x1: 2740, z1: 3320 };
export const PLATFORM: Box = { x0: 2755, z0: 3265, x1: 2800, z1: 3300 };
export const PLATFORM_UP: Box = { ...PLATFORM, level: 1 };
export const ISLAND: Box = { x0: 2785, z0: 3310, x1: 2810, z1: 3330 };
/**
 * The rooms behind the bridged doors, west of each door's wall: the glass room (Bailey's, the glass
 * at 2765,3278), the store room under Kennith's (the second glass at 2765,3289; its south wall at
 * z 3286) and the room in front of Kennith's wall (2764,3287). Steps that start inside one leave
 * through its door, which may have shut (500 ticks) since it was opened.
 */
export const GLASS_ROOM: Box = { x0: 2758, z0: 3274, x1: 2765, z1: 3280 };
export const STORE_ROOM: Box = { x0: 2758, z0: 3286, x1: 2765, z1: 3290 };
export const KENNITH_ROOM: Box = { x0: 2758, z0: 3285, x1: 2764, z1: 3287, level: 1 };

export const inWitchaven = (s: BotWorldState) => inBox(s, WITCHAVEN);
export const onPlatformGround = (s: BotWorldState) => inBox(s, PLATFORM);
export const onPlatformUp = (s: BotWorldState) => inBox(s, PLATFORM_UP);
export const onPlatform = (s: BotWorldState) => onPlatformGround(s) || onPlatformUp(s);
export const onIsland = (s: BotWorldState) => inBox(s, ISLAND);
/** Anywhere Holgart's boat has taken SCORED: the platform (either floor) or Kent's island. */
export const offshore = (s: BotWorldState) => onPlatform(s) || onIsland(s);

// ------------------------------------------------------------------ things

export const ITEM = {
    paste: configId('obj', 'swamppaste'),
    torchUnlit: configId('obj', 'torch_unlit'),
    torchLit: configId('obj', 'torch_lit'),
    damp: configId('obj', 'damp_sticks'),
    dry: configId('obj', 'dry_sticks'),
    glass: configId('obj', 'broken_glass'),
    pearls: configId('obj', 'bigoysterpearls'),
    /** Kent drops one on the ground (kent.rs2:27); picking it up bites. Dropped if ever held. */
    slug: configId('obj', 'seasluginv'),
} as const;

export interface LocAt {
    x: number;
    z: number;
    id: number;
}

/** Locs by config id (maps/m43_51.jm2); the ladder's two ends share a tile. */
export const LOC = {
    ladderUp: { x: 2784, z: 3286, id: configId('loc', 'slugladder') },
    ladderDown: { x: 2784, z: 3286, id: configId('loc', 'laddertop') },
    kennithWall: { x: 2764, z: 3287, id: configId('loc', 'kennithwall') },
    panel: { x: 2765, z: 3288, id: configId('loc', 'loosepanel') },
    crane: { x: 2768, z: 3286, id: configId('loc', 'fishingcrane') },
} as const satisfies Record<string, LocAt>;

/** A door on a bridge-flagged floor: its closed loc, and the open loc that replaces it one tile over. */
export interface BridgedDoor {
    label: string;
    level: number;
    closed: LocAt;
    open: LocAt;
}

export const DOORS = {
    glass: {
        label: 'the glass room door', level: 0,
        closed: { x: 2765, z: 3277, id: configId('loc', 'loc_1533') },
        open: { x: 2766, z: 3277, id: configId('loc', 'loc_1534') },
    },
    kennith: {
        label: "the door by Kennith's wall", level: 1,
        closed: { x: 2764, z: 3285, id: configId('loc', 'loc_1530') },
        open: { x: 2765, z: 3285, id: configId('loc', 'loc_1531') },
    },
    store: {
        label: 'the store room door', level: 0,
        closed: { x: 2765, z: 3287, id: configId('loc', 'loc_1533') },
        open: { x: 2766, z: 3287, id: configId('loc', 'loc_1534') },
    },
} as const satisfies Record<string, BridgedDoor>;

/** A ground spawn, and the bridged door opened to reach it (none in the open). */
export interface Spawn {
    at: { x: number; z: number };
    door?: BridgedDoor;
}

/** E's spawns in the order taken: the glass room's, then the store room's when another player has taken the first. */
export const GLASS_SPAWNS: readonly Spawn[] = [{ at: GLASS_AT, door: DOORS.glass }, { at: GLASS_AT_2, door: DOORS.store }];
/** F's single spawn, by the ladder in the open. */
export const STICKS_SPAWNS: readonly Spawn[] = [{ at: STICKS_AT }];

/** The segment letters in order, for the free-slot need. */
export const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q'] as const;
type Letter = (typeof LETTERS)[number];

/**
 * H15 as this step uses it (SUPPLIES.md H15; the slot ledger's row H15), traded during S18: the
 * swamp paste and the unlit torch, by the names the trade offers ('Torch' is the game name lit and
 * unlit share). H15's Ardougne runes serve no S19 action now that T18-19 runs from the knights, so
 * the kit does not ask for them.
 */
export const KIT: readonly KitItem[] = [{ item: /^swamp paste$/i }, { item: /^torch$/i }];

/**
 * Everything the step holds, for the free-slot checks (brief addendum 8). The paste goes to Holgart
 * at D, which frees its slot; the torch lights in place (K); the damp sticks dry in place (F). The
 * glass, the sticks, the torch and Caroline's pearls are dropped at Q. Peak 2 at Q with the kit
 * held (the glass, the sticks and the pearls, less the paste's slot), the ledger's S19 need.
 */
export const QUEST_ITEMS: readonly QuestItem[] = [
    // holgart_ardougne.rs2:44
    { item: ITEM.paste, name: 'Swamp paste', from: 'A', until: 'D' },
    // quest_seaslug.rs2:56-57 swaps the unlit torch for the lit one in place.
    { item: /^torch$/i, name: 'Torch', from: 'A', until: 'Q' },
    { item: ITEM.glass, name: 'Broken glass', from: 'E', until: 'Q' },
    // quest_seaslug.rs2:39-40 swaps the damp sticks for dry ones in place.
    { item: /^(damp|dry) sticks$/i, name: 'Damp sticks (then dry)', from: 'F', until: 'Q' },
    // caroline.rs2:44, dropped at the exit.
    { item: ITEM.pearls, name: 'Oyster pearls', from: 'Q', until: 'Q' },
];
const slots = (at: Letter) => slotsCover(QUEST_ITEMS, LETTERS, at);

/** What S19 leaves that nothing later uses, dropped at its exit. H15's runes are not quest items. */
export const DEAD_AT_EXIT: readonly number[] = [ITEM.torchLit, ITEM.torchUnlit, ITEM.damp, ITEM.dry, ITEM.glass, ITEM.pearls, ITEM.paste, ITEM.slug];
export const isDead = (i: { id: number }) => DEAD_AT_EXIT.includes(i.id);

// ------------------------------------------------------------------ conversations (CONVENTIONS.md shapes, read from the scripts)

/**
 * A `state` part is itself a page: the continue whose click runs the script on to a state change
 * (a varp or item, a p_delay, a crossing) before the next page. Bursts never cross one.
 */
export const SHAPES = {
    /** Caroline at 0 (caroline.rs2:9-25): the stage is set behind 'Ok, I'll go and see if they're ok.'. */
    carolineStart: '8c, opt, 2c, state, 1c',
    /** Holgart ashore at 1 (holgart_ardougne.rs2:18-30): the stage is set behind his last page. */
    holgartAsk: '10c',
    /** Holgart ashore at 2 with the paste (holgart_ardougne.rs2:32-56): the paste goes behind 'Yes, I have some here.', the crossing behind 'Okay, lets do it.'. */
    holgartSail: '2c, state, 3c, opt, state, 1c',
    /** Kennith through his wall at 3 (kennith.rs2:3-10). */
    kennith1: '6c',
    /** Holgart on the platform at 4 (holgart_platform.rs2:21-27): the stage and the crossing behind his fourth page. */
    holgartKent: '3c, state, 1c',
    /** Kent at 5 (kent.rs2:7-29): if_close and p_delays behind his ninth and tenth pages. */
    kent: '8c, state, state, 2c',
    /** Holgart on the island at 6 (holgart_island.rs2:2-6). */
    holgartBack: '1c, state, 1c',
    /** Kennith at 7 (kennith.rs2:15-23). */
    kennith2: '7c',
    /** Kennith at 9 (kennith.rs2:24-31). */
    kennith3: '6c',
    /** Holgart on the platform at 11 (holgart_platform.rs2:29-33): the crossing ashore. */
    holgartShore: '2c, state, 1c',
    /** Caroline at 11 (caroline.rs2:33-48): the reward behind her seventh page; the level-up page is an interrupt. */
    reward: '6c, state, 2c',
} as const;

export const CHOICES = {
    carolineStart: [/^I suppose so, how do I get there\?/i] as OptionPattern[],
    sail: [/^Okay, lets do it\./i] as OptionPattern[],
};

/** Pages and messages that tell a step's outcome. */
export const LANDED = {
    /** holgart_ardougne.rs2:34: Holgart at 2 asks for the paste (C started at 2 does D's talk). */
    pasteAsked: /Did you manage to make some swamp paste/i,
    /** quest_seaslug.rs2:89 (8 -> 9) and :94 (already 9). */
    panel: /opening big enough|nothing interesting happens/i,
    /** quest_seaslug.rs2:113 (10 -> 11). */
    crane: /row boat waiting below/i,
    /** quest_seaslug.rs2:55 (the torch lights), :49 and :59 (the rub fails, or nothing to light). */
    lit: /your torch lights/i,
    rubFailed: /smoke momentarily then die out|nothing happens/i,
    /** kent.rs2:25: sent with the chat closed between 'Traveller wait!' and Kent's last two pages. */
    kentSlug: /pulls a sea slug from under your top/i,
    /** quest_seaslug.rs2:71-72: the ladder without a lit torch from stage 6. */
    smacked: /smack you on the head/i,
};

/** Rubs before K fails: at Firemaking 30 each is 77% (quest_seaslug.rs2:48), so 8 all failing is about 1 in 130,000. */
export const RUB_TRIES = 8;
/** Ticks to wait for a door loc to be published after a jump before clicking it unseen (LAB.md: the browser rebuilt the region in 46 at load). */
export const DOOR_SCENE_TICKS = 50;
/**
 * A picked-up ground spawn returns after its obj's respawnrate. Neither the broken glass nor the
 * damp sticks sets one (all.obj), so both take the engine's default of 100 ticks (ObjType.ts,
 * applied on pickup in ObjOps.ts).
 */
export const GROUND_RESPAWN_TICKS = 100;
/** How long a pickup waits for a spawn another player has taken: the whole respawn, plus the 2-tick poll and a late-published state. */
export const RESPAWN_WAIT_TICKS = GROUND_RESPAWN_TICKS + 20;
/** Pickups lost to another player under the click (seen, then gone before it landed) before the segment gives up. */
export const LOST_PICKUPS = 2;

// ------------------------------------------------------------------ resume evidence

const JOURNAL = journalProbeName(quest);
const stateOf = (o: QuestView): BotWorldState => ('probed' in o ? o.state : o);
const stageValue = (name: StageName<typeof quest>): number => QUESTS.seaslug.stages.find(s => s.name === name)!.value;
const holds = (o: QuestView, item: ItemPattern) => invCount(stateOf(o), item) > 0;
const started = (s: BotWorldState) => questStatus(s, quest) === 'started';
const complete = (s: BotWorldState) => questStatus(s, quest) === 'complete';

/**
 * The lowest stage the evidence allows: the quest tab and journal's candidates (lib/quests
 * questStage), less those the position rules out. Off the mainland the stage is at least 3, and on
 * Kent's island at least 5 (see the header). Null when the quest state is not observable or the
 * evidence contradicts itself.
 */
export function stageFloor(o: QuestView): number | null {
    const r = questStage(o, quest);
    if (!r) return null;
    const s = stateOf(o);
    let values = r.stages.map(x => x.value);
    if (offshore(s)) values = values.filter(v => v >= stageValue('boat_repaired'));
    if (onIsland(s)) values = values.filter(v => v >= stageValue('sailed_kent'));
    return values.length ? Math.min(...values) : null;
}

export const atLeast = (o: QuestView, stage: StageName<typeof quest>) => (stageFloor(o) ?? -1) >= stageValue(stage);

/**
 * The highest stage the evidence allows, for preconditions: they see the state alone, where the
 * quest tab says only 'started' unless a journal read is fresh, so they refuse only what the
 * evidence rules out. The lower bound (`atLeast`, from the journal probe) is for `done`.
 */
export function stageCeiling(o: QuestView): number | null {
    const r = questStage(o, quest);
    if (!r) return null;
    const s = stateOf(o);
    let values = r.stages.map(x => x.value);
    if (offshore(s)) values = values.filter(v => v >= stageValue('boat_repaired'));
    if (onIsland(s)) values = values.filter(v => v >= stageValue('sailed_kent'));
    return values.length ? Math.max(...values) : null;
}

// ------------------------------------------------------------------ helpers

type Ctx = StepContext<any>;
type Sdk = TravelSdk & ActSdk & ConverseSdk;
const sdkOf = (ctx: Ctx) => ctx.sdk as unknown as Sdk;
const interrupts = () => [levelUpInterrupt()];
const note = (ctx: Ctx, seg: Letter, meta: Record<string, unknown>) => logNote(ctx.log, ctx.session, `${stepId}:${seg}`, meta);

function fail(seg: Letter, why: string, sdk?: Sdk): never {
    throw new Error(`${stepId}:${seg}: ${why}${sdk ? ` at ${JSON.stringify(pos(sdk))}` : ''}`);
}

/** Run to `to`, retrying a run that ends short ('no tick', a stall): ok only inside the area. */
async function go(ctx: Ctx, seg: Letter, to: Area, what: string): Promise<void> {
    const sdk = sdkOf(ctx);
    let why = '';
    for (let i = 0; i < 3; i++) {
        if (inArea(sdk, to)) return;
        const r = await runTo(sdk, to, { bot: ctx.bot });
        if (r.ok) return;
        why = r.reason ?? 'not arrived';
    }
    if (!inArea(sdk, to)) fail(seg, `run to ${what} (${to.x},${to.z}) failed (${why})`, sdk);
}

/** Record a conversation's shape against the expected one, for the lab report. */
function noteShape(ctx: Ctx, seg: Letter, who: string, r: ConverseResult, extra: Record<string, unknown> = {}): void {
    note(ctx, seg, {
        who, pages: r.pages, options: r.options, ticks: r.ticks,
        ...(r.levelUps ? { levelUps: r.levelUps } : {}),
        ...(r.shape ? { shape: r.shape.seen, expected: r.shape.expected, matches: r.shape.matches, bursts: r.shape.bursts, failedBursts: r.shape.failedBursts } : {}),
        ...extra,
    });
}

const saw = (r: ConverseResult, re: RegExp) => r.transcript.some(l => re.test(l));

/**
 * A converse `until` for a conversation whose script closes the chat for longer than any idle
 * window before its last pages (Kent): it holds once the game message `re`, sent in that gap, has
 * arrived and a page has been published after it. A page cannot be the marker: a burst clears the
 * last pages without publishing them all. converse consults `until` only with the chat closed, so
 * the state stream is watched; `stop` ends the watch.
 */
export function afterMessage(sdk: Pick<Sdk, 'onStateUpdate' | 'getState'>, re: RegExp): { until: Pred; stop: () => void } {
    let at = -1;
    let seen = false;
    const look = (s: BotWorldState) => {
        if (at < 0) at = s.gameMessages.find(m => m.type === 0 && re.test(m.text))?.tick ?? -1;
        if (at >= 0 && s.tick > at && s.dialog.isOpen) seen = true;
    };
    const s0 = sdk.getState();
    if (s0) look(s0);
    const stop = sdk.onStateUpdate(look);
    return { until: () => seen, stop };
}

interface TalkSpec {
    who: string;
    npc: RegExp;
    near: { x: number; z: number };
    choices?: OptionPattern[];
    shape: string;
    /** The conversation is over only once this holds with the chat closed (a crossing's landing). */
    until?: Pred;
    idle?: number;
    maxTicks?: number;
}

/** Talk to an NPC and answer it to the end of its shape. */
async function talk(ctx: Ctx, seg: Letter, opts: Options | undefined, t: TalkSpec): Promise<ConverseResult> {
    const sdk = sdkOf(ctx);
    const r = await talkTo(sdk, t.npc, t.choices ?? [], {
        near: t.near, interrupts: interrupts(), unmatched: 'stop', idle: t.idle ?? 1, maxTicks: t.maxTicks ?? 120,
        ...(t.until ? { until: t.until } : {}), ...talkShape(opts, t.shape),
    });
    if (!r.opened) fail(seg, `${t.who}: no dialogue opened`, sdk);
    if (!r.ok) fail(seg, `${t.who}: ${r.reason}`, sdk);
    noteShape(ctx, seg, t.who, r, { clicks: r.clicks });
    return r;
}

/** A loc click by tile and id (no lookup: the platform's floors are bridged), waiting for `done`. */
function clickLoc(sdk: Sdk, loc: LocAt, done: Pred, maxTicks: number, op = 1) {
    return act(sdk, () => sdk.sendInteractLoc(loc.x, loc.z, loc.id, op), done, { maxTicks, interrupts: interrupts() });
}

/**
 * Kennith through his wall: the loc op opens his dialogue (no p_delay before it, so act's idle
 * re-send cannot restart a running script), then the conversation. Records the click-to-dialogue
 * ticks the browser follow-up needs (brief addendum 11).
 */
async function kennith(ctx: Ctx, seg: Letter, opts: Options | undefined, shape: string): Promise<ConverseResult> {
    const sdk = sdkOf(ctx);
    const t0 = currentTick(sdk);
    const click = await clickLoc(sdk, LOC.kennithWall, s => s.dialog.isOpen, 30);
    if (!click.ok) fail(seg, "Kennith's wall: no dialogue within 30 ticks of the click", sdk);
    const r = await converse(sdk, [], { openTicks: 3, interrupts: interrupts(), unmatched: 'stop', idle: 1, maxTicks: 60, ...talkShape(opts, shape) });
    if (!r.ok) fail(seg, `Kennith: ${r.reason}`, sdk);
    noteShape(ctx, seg, 'Kennith (the wall)', r, { locOp: true, clickToDialogue: click.ticks, resends: click.resends, ...(click.settleTicks ? { settleTicks: click.settleTicks } : {}), ticks: currentTick(sdk) - t0 });
    return r;
}

type LocList = BotWorldState['nearbyLocs'];
const locIn = (list: LocList, l: LocAt) => list.some(n => n.x === l.x && n.z === l.z && n.id === l.id);

export type DoorState = 'open' | 'closed' | 'unseen';

/**
 * The door as the published locs show it: its open loc, its closed loc, or neither (not on its
 * floor, or not in the list). `nearbyLocs` reaches only a few tiles, so a door further off shows
 * only in a scan (`seeDoor`).
 */
export function doorState(s: BotWorldState, d: BridgedDoor, list: LocList = s.nearbyLocs): DoorState {
    if (!s.player || s.player.level !== d.level) return 'unseen';
    if (locIn(list, d.open)) return 'open';
    if (locIn(list, d.closed)) return 'closed';
    return 'unseen';
}

/** The door's state from the nearby locs or a 25-tile scan, waiting up to DOOR_SCENE_TICKS for either to publish it. */
async function seeDoor(sdk: Sdk, d: BridgedDoor): Promise<DoorState> {
    const t0 = currentTick(sdk);
    for (;;) {
        const s = sdk.getState()!;
        let seen = doorState(s, d);
        if (seen === 'unseen') seen = doorState(s, d, await sdk.scanNearbyLocs(25));
        if (seen !== 'unseen' || currentTick(sdk) - t0 >= DOOR_SCENE_TICKS) return seen;
        await waitTicks(sdk, 1);
    }
}

export interface DoorOutcome {
    door: string;
    /** What the scene showed before the click (or that it showed nothing within DOOR_SCENE_TICKS). */
    before: DoorState;
    after: DoorState;
    /** Ticks waited for the door loc to be published. */
    waited: number;
    /** Click to the open loc published (0 when it was open already). */
    clickToOpen: number;
    resends: number;
}

/**
 * Open a door on a bridged floor. Waits for the door's loc first (RUN-ORDER R10: after a jump the
 * browser publishes it only once the region is rebuilt; an empty scene decides nothing), then, unless
 * it is open, clicks the closed loc by tile and id until the open loc is published. With the door
 * still unseen after DOOR_SCENE_TICKS it clicks anyway: the closed id at the closed tile cannot shut
 * an open door (see the header), and the step after fails plainly if the door stayed shut.
 */
export async function openBridgedDoor(ctx: Ctx, seg: Letter, d: BridgedDoor): Promise<DoorOutcome> {
    const sdk = sdkOf(ctx);
    const t0 = currentTick(sdk);
    const before = await seeDoor(sdk, d);
    const waited = currentTick(sdk) - t0;
    let out: DoorOutcome = { door: d.label, before, after: before, waited, clickToOpen: 0, resends: 0 };
    if (before !== 'open') {
        // The click walks SCORED to the door, so the open loc shows in the nearby locs once it opens.
        const r = await clickLoc(sdk, d.closed, s => doorState(s, d) === 'open', before === 'closed' ? 40 : 20);
        const after = doorState(sdk.getState()!, d) === 'open' ? 'open' : doorState(sdk.getState()!, d, await sdk.scanNearbyLocs(25));
        out = { ...out, after, clickToOpen: r.ticks, resends: r.resends };
        if (before === 'closed' && after !== 'open') fail(seg, `${d.label} did not open (${r.reason ?? 'timeout'})`, sdk);
    }
    note(ctx, seg, { bridgedDoor: out });
    return out;
}

/** Before a walk out of a room behind a bridged door: open the door when SCORED is inside (a no-op when it is open). */
async function leaveRoom(ctx: Ctx, seg: Letter): Promise<void> {
    const s = sdkOf(ctx).getState()!;
    if (inBox(s, GLASS_ROOM)) await openBridgedDoor(ctx, seg, DOORS.glass);
    else if (inBox(s, STORE_ROOM)) await openBridgedDoor(ctx, seg, DOORS.store);
    else if (inBox(s, KENNITH_ROOM)) await openBridgedDoor(ctx, seg, DOORS.kennith);
}

/** How a pickup got its item: on the first spawn at once, on a later spawn at once, or after waiting for a respawn. */
export type PickupPath = 'spawn' | 'second spawn' | 'respawn wait';

const holding = (list: BotWorldState['groundItems'], item: number, at: Spawn['at']) => list.some(g => g.id === item && g.x === at.x && g.z === at.z);

/** The index of the first of `spawns` holding `item` (-1: none), from the published ground items and, unless they show the first spawn's, a 25-tile scan. */
async function spawnHolding(sdk: Sdk, item: number, spawns: readonly Spawn[]): Promise<number> {
    const lists = [sdk.getState()!.groundItems];
    if (!holding(lists[0]!, item, spawns[0]!.at)) lists.push(await sdk.scanGroundItems(25));
    return spawns.findIndex(sp => lists.some(l => holding(l, item, sp.at)));
}

/**
 * Pick up `item` by tile and id from the first of `spawns` that holds it, through that spawn's door.
 * With none holding it (another player took it), wait at the first spawn's door for a respawn, on
 * whichever spawn it comes, up to RESPAWN_WAIT_TICKS; the respawn is GROUND_RESPAWN_TICKS after the
 * other player's pickup, so a longer wait means it was taken again. A pickup lost under the click
 * (the item gone from its tile when the click gave up) goes back to that wait, up to LOST_PICKUPS times.
 */
async function pickupAt(ctx: Ctx, seg: Letter, what: string, item: number, spawns: readonly Spawn[]): Promise<void> {
    const sdk = sdkOf(ctx);
    if (holds(sdk.getState()!, item)) return;
    const where = spawns.map(sp => `(${sp.at.x},${sp.at.z})`).join(' or ');
    const opened = new Set<BridgedDoor>();
    const open = async (d: BridgedDoor | undefined) => {
        if (!d || opened.has(d)) return;
        await openBridgedDoor(ctx, seg, d);
        opened.add(d);
    };
    const t0 = currentTick(sdk);
    let waited = 0;
    for (let lost = 0; ; lost++) {
        let i = await spawnHolding(sdk, item, spawns);
        if (i < 0 && spawns[0]!.door && !opened.has(spawns[0]!.door)) {
            // Look again from the first spawn's door, where a respawn is also waited for: after a jump the scene may not have shown it from afar.
            await open(spawns[0]!.door);
            i = await spawnHolding(sdk, item, spawns);
        }
        const w0 = currentTick(sdk);
        while (i < 0) {
            if (currentTick(sdk) - w0 > RESPAWN_WAIT_TICKS) fail(seg, `no ${what} on its spawn ${where} within ${RESPAWN_WAIT_TICKS} ticks`, sdk);
            await waitTicks(sdk, 2);
            i = await spawnHolding(sdk, item, spawns);
        }
        waited += currentTick(sdk) - w0;
        const sp = spawns[i]!;
        await open(sp.door);
        const before = invCount(sdk, item);
        const r = await act(sdk, () => sdk.sendPickup(sp.at.x, sp.at.z, item), s => invCount(s, item) > before, { resendEvery: 3, maxTicks: 40, interrupts: interrupts() });
        if (r.ok) {
            const path: PickupPath = waited > 0 ? 'respawn wait' : i === 0 ? 'spawn' : 'second spawn';
            note(ctx, seg, { pickup: what, path, at: [sp.at.x, sp.at.z], waited, clickToHeld: r.ticks, resends: r.resends, ticks: currentTick(sdk) - t0, ...(lost ? { lost } : {}) });
            return;
        }
        if (lost >= LOST_PICKUPS || (await spawnHolding(sdk, item, [sp])) === 0) fail(seg, `${what} was not picked up (${r.reason})`, sdk);
    }
}

/** Climb the platform ladder to `level` (up from the ground floor, down from the upper floor). */
async function climb(ctx: Ctx, seg: Letter, level: 0 | 1): Promise<void> {
    const sdk = sdkOf(ctx);
    if (pos(sdk).level === level) return;
    const loc = level === 1 ? LOC.ladderUp : LOC.ladderDown;
    const smacked = replyAfter(sdk, LANDED.smacked);
    const r = await clickLoc(sdk, loc, s => pos(s).level === level || smacked.seen(s), 40);
    if (pos(sdk).level !== level) fail(seg, smacked.first() ? 'the fishermen stopped the climb: no lit torch' : `the ladder did not take SCORED to level ${level} (${r.reason ?? ''})`, sdk);
    note(ctx, seg, { loc: level === 1 ? 'the ladder up' : 'the ladder down', clickToLevel: r.ticks, resends: r.resends, ...(r.settleTicks ? { settleTicks: r.settleTicks } : {}) });
}

/**
 * K (and L after a crossing put the torch out): rub the dry sticks until the unlit torch lights. No
 * re-send of a rub: its messages answer at once, and a second click while they show would rub again.
 */
async function lightTorch(ctx: Ctx, seg: Letter): Promise<void> {
    const sdk = sdkOf(ctx);
    const tries: number[] = [];
    for (let i = 0; i < RUB_TRIES && !holds(sdk.getState()!, ITEM.torchLit); i++) {
        if (!holds(sdk.getState()!, ITEM.torchUnlit)) fail(seg, 'no torch to light', sdk);
        const failed = replyAfter(sdk, LANDED.rubFailed);
        const r = await invOp(sdk, ITEM.dry, /^rub-together$/i, s => holds(s, ITEM.torchLit) || failed.seen(s), { resendEvery: 0, maxTicks: 10 });
        if (!r.ok) fail(seg, 'the rub drew no answer', sdk);
        tries.push(r.ticks);
    }
    if (!holds(sdk.getState()!, ITEM.torchLit)) fail(seg, `the torch did not light in ${RUB_TRIES} rubs`, sdk);
    note(ctx, seg, { rubs: tries.length, rubTicks: tries });
}

/** A loc op with no dialogue whose script ends on a game message (the panel, the crane). */
async function locMessage(ctx: Ctx, seg: Letter, what: string, loc: LocAt, landed: RegExp, maxTicks = 30): Promise<void> {
    const sdk = sdkOf(ctx);
    const reply = replyAfter(sdk, landed);
    const r = await clickLoc(sdk, loc, reply.seen, maxTicks);
    if (!r.ok) fail(seg, `${what}: no '${landed.source}' within ${maxTicks} ticks`, sdk);
    note(ctx, seg, { loc: what, clickToEffect: r.ticks, resends: r.resends, message: reply.first() });
}

/**
 * C: Holgart ashore. At 1 he asks for the paste; resumed at 2 (the journal cannot tell 1 from 2) he
 * takes it at once and offers the crossing, which the choice answers, so C has then done D's work.
 * That happens only when the journal could not be read: at 2 it reads '2 or 6', which marks C done.
 * idle 3 rides out the crossing's if_close and p_delay(2) before its mesbox.
 */
async function holgartAsk(ctx: Ctx, opts: Options | undefined): Promise<void> {
    const sdk = sdkOf(ctx);
    if (onPlatform(sdk.getState()!)) return;
    const r = await talk(ctx, 'C', opts, { who: 'Holgart (the boat)', npc: /^holgart$/i, near: HOLGART_SHORE_AT, choices: CHOICES.sail, shape: SHAPES.holgartAsk, idle: 3 });
    if (saw(r, LANDED.pasteAsked)) note(ctx, 'C', { resumedAt: 2, sailed: onPlatform(sdk.getState()!) });
}

/** D: Holgart takes the paste and sails to the platform (2 -> 3). */
async function holgartSail(ctx: Ctx, opts: Options | undefined): Promise<void> {
    const sdk = sdkOf(ctx);
    if (onPlatform(sdk.getState()!)) return;
    await talk(ctx, 'D', opts, { who: 'Holgart (the paste, the crossing)', npc: /^holgart$/i, near: HOLGART_SHORE_AT, choices: CHOICES.sail, shape: SHAPES.holgartSail, idle: 3, until: onPlatformGround });
}

/**
 * E: through the glass room door and take the broken glass; when another player has taken it,
 * through the store room door for the second, or else wait at the glass room for the respawn.
 */
async function glass(ctx: Ctx): Promise<void> {
    await pickupAt(ctx, 'E', 'the broken glass', ITEM.glass, GLASS_SPAWNS);
}

/** F: take the damp sticks and dry them with the glass (quest_seaslug.rs2:35-40, one p_delay). */
async function sticks(ctx: Ctx): Promise<void> {
    const sdk = sdkOf(ctx);
    if (holds(sdk.getState()!, ITEM.dry)) return;
    if (!holds(sdk.getState()!, ITEM.damp)) {
        await leaveRoom(ctx, 'F');
        await pickupAt(ctx, 'F', 'the damp sticks', ITEM.damp, STICKS_SPAWNS);
    }
    const r = await useOn(sdk, ITEM.glass, { item: ITEM.damp }, s => holds(s, ITEM.dry), { maxTicks: 10 });
    if (!r.ok) fail('F', `the glass did not dry the sticks (${r.reason})`, sdk);
    note(ctx, 'F', { dry: r.ticks, resends: r.resends });
}

/** Up the ladder, through the door by Kennith's wall, and Kennith. */
async function upToKennith(ctx: Ctx, seg: Letter, opts: Options | undefined, shape: string): Promise<void> {
    const sdk = sdkOf(ctx);
    if (pos(sdk).level === 0 && !holds(sdk.getState()!, ITEM.torchLit) && atLeast(sdk.getState()!, 'spoken_kent')) await lightTorch(ctx, seg);
    await climb(ctx, seg, 1);
    await openBridgedDoor(ctx, seg, DOORS.kennith);
    await kennith(ctx, seg, opts, shape);
}

/** P: from either floor, down and to Holgart, who sails ashore (stage 11 unchanged). */
async function holgartShore(ctx: Ctx, opts: Options | undefined): Promise<void> {
    const sdk = sdkOf(ctx);
    if (inWitchaven(sdk.getState()!)) return;
    await leaveRoom(ctx, 'P');
    await climb(ctx, 'P', 0);
    await go(ctx, 'P', HOLGART_PLATFORM_STAND, 'Holgart');
    await talk(ctx, 'P', opts, { who: 'Holgart (ashore)', npc: /^holgart$/i, near: HOLGART_PLATFORM_AT, shape: SHAPES.holgartShore, idle: 3, until: inWitchaven });
}

/**
 * How long after Caroline's chat closes the reward's Fishing level-up page may take to show (lab,
 * lite: 3 ticks, her talk's idle wait covering 2 of them). The page is the wait's target, so the
 * window costs nothing when the page comes; only a resumed Q with the page already answered pays it.
 */
export const LEVEL_UP_TICKS = 4;

/**
 * Q: Caroline's reward (11 -> 12): her pages, the Fishing level-up page (1 -> 74, an interrupt)
 * and the queued quest-complete scroll, which is closed; then the exit drops. The level-up page
 * shows a few ticks after her chat closes, so her conversation usually ends before it; it is then
 * the target of a wait that ends as soon as it is answered (converse `expect: 'interrupt'`).
 */
async function reward(ctx: Ctx, opts: Options | undefined): Promise<void> {
    const sdk = sdkOf(ctx);
    let inTalk = 0;
    if (!complete(sdk.getState()!)) {
        const t = await talk(ctx, 'Q', opts, { who: 'Caroline (the reward)', npc: /^caroline$/i, near: CAROLINE_AT, shape: SHAPES.reward, idle: 2 });
        inTalk = (t.interrupts ?? 0) + t.levelUps;
        const done = await waitUntil(sdk, complete, { maxTicks: 10 });
        if (!done.ok) fail('Q', 'Sea Slug not complete after Caroline', sdk);
    }
    const r = inTalk ? null : await converse(sdk, [], { openTicks: LEVEL_UP_TICKS, idle: 0, closeModals: true, interrupts: interrupts(), expect: 'interrupt' });
    if (sdk.getState()?.modalOpen) {
        await sdk.sendCloseModal();
        await waitUntil(sdk, s => !s.modalOpen, { maxTicks: 3 });
    }
    note(ctx, 'Q', r ? { afterReward: r.transcript.length, levelUps: r.levelUps, interrupts: r.interrupts ?? 0 } : { levelUpInTalk: inTalk });
    await exitDrops(ctx);
}

/** Drop every dead item at once (rs/158's ledger: S19's leftovers off before T19-20). */
export async function exitDrops(ctx: Ctx): Promise<void> {
    const sdk = sdkOf(ctx);
    const t0 = currentTick(sdk);
    const dead = (sdk.getState()?.inventory ?? []).filter(isDead).map(i => i.name);
    const d = await dropItems(sdk, isDead);
    if (!d.ok) fail('Q', `exit: the dead items (${(sdk.getState()?.inventory ?? []).filter(isDead).map(i => i.name).join(', ')}) were not dropped`, sdk);
    note(ctx, 'Q', { exitDrops: currentTick(sdk) - t0, dropped: dead });
}

// ------------------------------------------------------------------ checks

const need = (what: string, ok: boolean, why: string): true | string => (ok ? true : `${what}: ${why}`);
const hasItem = (item: ItemPattern, what: string): Check<any> => s => need(what, holds(s, item), 'not held');
const isStarted: Check<any> = s => need('Sea Slug', started(s), `not in progress (${questStatus(s, quest) ?? 'unobservable'})`);
const notStarted: Check<any> = s => requireQuestStage(s, quest, 'not_started');
const kitHeld: Check<any> = s => {
    const want = kitWant(s, KIT);
    return want.length ? `kit missing: ${want.map(w => `${w.amount} x ${String(w.item)}`).join(', ')}` : true;
};
const where = (what: string, test: (s: BotWorldState) => boolean): Check<any> => s => need('position', test(s), `not ${what} (at ${pos(s).x},${pos(s).z} L${pos(s).level})`);
const atArrival = where("on the arrival tile beside Caroline", s => inArea(s, ARRIVAL));
const witchaven = where('in Witchaven', inWitchaven);
const platformGround = where("on the platform's ground floor", onPlatformGround);
const platformUp = where("on the platform's upper floor", onPlatformUp);
const platform = where('on the platform', onPlatform);
const island = where("on Kent's island", onIsland);
/** Not ruled out: the evidence allows the quest to be at `stage` or later. */
const floor = (stage: StageName<typeof quest>): Check<any> => s => need('Sea Slug', (stageCeiling(s) ?? -1) >= stageValue(stage), `not yet ${stage} (${stageValue(stage)}): highest stage the evidence allows ${stageCeiling(s) ?? 'unobservable'}`);
const torchHeld: Check<any> = s => need('the torch', holds(s, ITEM.torchLit) || holds(s, ITEM.torchUnlit), 'not held');
const noDeadItems: Check<any> = s => {
    const held = s.inventory.filter(isDead).map(i => i.name);
    return held.length ? `exit: still holding ${held.join(', ')}` : true;
};
const firemaking = baseLevels({ firemaking: 30 });

// ------------------------------------------------------------------ the segments

export function steps(opts?: Options) {
    const probes = [JOURNAL] as const;
    const segs: Segment[] = [
        kitSegment(opts, KIT, {
            preconditions: allOf(atArrival, notStarted, firemaking, slots('A')),
        }),
        {
            letter: 'B', label: 'caroline-start', logoutSafe: true,
            // At stage 0 B needs A's kit: the resume walk takes the latest segment that can start and must not skip A.
            preconditions: allOf(witchaven, notStarted, firemaking, kitHeld, slots('B')),
            run: ctx => talk(ctx, 'B', opts, { who: 'Caroline (the start)', npc: /^caroline$/i, near: CAROLINE_AT, choices: CHOICES.carolineStart, shape: SHAPES.carolineStart, until: started }).then(() => undefined),
            postconditions: isStarted,
            done: o => atLeast(o, 'started'),
            probes,
        },
        {
            letter: 'C', label: 'holgart-ask', logoutSafe: true,
            preconditions: allOf(witchaven, isStarted, hasItem(ITEM.paste, 'the swamp paste')),
            run: ctx => holgartAsk(ctx, opts),
            done: o => atLeast(o, 'spoken_holgart'),
            probes,
        },
        {
            letter: 'D', label: 'holgart-sail', logoutSafe: true,
            preconditions: allOf(isStarted, s => (onPlatformGround(s) || (inWitchaven(s) && holds(s, ITEM.paste)) ? true : 'D: neither in Witchaven with the swamp paste nor on the platform')),
            run: ctx => holgartSail(ctx, opts),
            postconditions: allOf(platformGround, s => need('the swamp paste', !holds(s, ITEM.paste), 'still held')),
            done: o => atLeast(o, 'boat_repaired'),
            probes,
        },
        {
            letter: 'E', label: 'glass', logoutSafe: true,
            preconditions: allOf(platformGround, floor('boat_repaired'), slots('E')),
            run: ctx => glass(ctx),
            postconditions: hasItem(ITEM.glass, 'the broken glass'),
            done: o => holds(o, ITEM.glass) || atLeast(o, 'lit_torch'),
            probes,
        },
        {
            letter: 'F', label: 'sticks', logoutSafe: true,
            preconditions: allOf(platformGround, s => need('the glass or the dry sticks', holds(s, ITEM.glass) || holds(s, ITEM.dry), 'neither held'), slots('F')),
            run: ctx => sticks(ctx),
            postconditions: hasItem(ITEM.dry, 'the dry sticks'),
            done: o => holds(o, ITEM.dry) || atLeast(o, 'lit_torch'),
            probes,
        },
        {
            letter: 'G', label: 'kennith-1', logoutSafe: true,
            preconditions: allOf(platform, floor('boat_repaired')),
            run: ctx => upToKennith(ctx, 'G', opts, SHAPES.kennith1),
            done: o => atLeast(o, 'spoken_kennith'),
            probes,
        },
        {
            letter: 'H', label: 'holgart-kent', logoutSafe: true,
            preconditions: allOf(platform, floor('spoken_kennith')),
            run: async ctx => {
                await leaveRoom(ctx, 'H');
                await climb(ctx, 'H', 0);
                await go(ctx, 'H', HOLGART_PLATFORM_STAND, 'Holgart');
                await talk(ctx, 'H', opts, { who: 'Holgart (to Kent)', npc: /^holgart$/i, near: HOLGART_PLATFORM_AT, shape: SHAPES.holgartKent, idle: 3, until: onIsland });
            },
            postconditions: island,
            done: o => atLeast(o, 'sailed_kent'),
            probes,
        },
        {
            letter: 'I', label: 'kent', logoutSafe: true,
            preconditions: allOf(island, floor('sailed_kent')),
            run: async ctx => {
                const last = afterMessage(sdkOf(ctx), LANDED.kentSlug);
                try {
                    await talk(ctx, 'I', opts, { who: 'Kent', npc: /^kent$/i, near: KENT_AT, shape: SHAPES.kent, until: last.until });
                } finally {
                    last.stop();
                }
            },
            done: o => atLeast(o, 'spoken_kent'),
            probes,
        },
        {
            letter: 'J', label: 'holgart-back', logoutSafe: true,
            preconditions: allOf(island, floor('spoken_kent')),
            run: ctx => talk(ctx, 'J', opts, { who: 'Holgart (back to the platform)', npc: /^holgart$/i, near: HOLGART_ISLAND_AT, shape: SHAPES.holgartBack, idle: 3, until: onPlatformGround }).then(() => undefined),
            postconditions: platformGround,
        },
        {
            letter: 'K', label: 'torch', logoutSafe: true,
            preconditions: allOf(platformGround, floor('spoken_kent'), hasItem(ITEM.dry, 'the dry sticks'), torchHeld),
            run: ctx => lightTorch(ctx, 'K'),
            postconditions: hasItem(ITEM.torchLit, 'the lit torch'),
            done: o => atLeast(o, 'lit_torch'),
            probes,
        },
        {
            letter: 'L', label: 'kennith-2', logoutSafe: true,
            preconditions: allOf(platform, floor('lit_torch')),
            run: ctx => upToKennith(ctx, 'L', opts, SHAPES.kennith2),
            done: o => atLeast(o, 'kennith_need_escape'),
            probes,
        },
        {
            letter: 'M', label: 'panel', logoutSafe: true,
            preconditions: allOf(platformUp, floor('kennith_need_escape')),
            run: async ctx => {
                // The panel is kicked from outside the room (2766,3288): out through the door first.
                await leaveRoom(ctx, 'M');
                await locMessage(ctx, 'M', 'the loose panel', LOC.panel, LANDED.panel);
            },
            done: o => atLeast(o, 'panel_opened'),
            probes,
        },
        {
            letter: 'N', label: 'kennith-3', logoutSafe: true,
            preconditions: allOf(platformUp, floor('kennith_need_escape')),
            run: async ctx => {
                await openBridgedDoor(ctx, 'N', DOORS.kennith);
                await kennith(ctx, 'N', opts, SHAPES.kennith3);
            },
            done: o => atLeast(o, 'need_kennith_path'),
            probes,
        },
        {
            letter: 'O', label: 'crane', logoutSafe: true,
            preconditions: allOf(platformUp, floor('need_kennith_path')),
            run: async ctx => {
                await leaveRoom(ctx, 'O');
                await go(ctx, 'O', CRANE_STAND, 'north of the crane');
                await locMessage(ctx, 'O', 'the crane', LOC.crane, LANDED.crane);
            },
            done: o => atLeast(o, 'saved_kennith'),
            probes,
        },
        {
            letter: 'P', label: 'holgart-shore', logoutSafe: true,
            preconditions: allOf(platform, floor('saved_kennith')),
            run: ctx => holgartShore(ctx, opts),
            postconditions: witchaven,
        },
        {
            letter: 'Q', label: 'caroline-reward', logoutSafe: true,
            preconditions: allOf(witchaven, floor('saved_kennith'), slots('Q')),
            run: ctx => reward(ctx, opts),
            postconditions: allOf(
                s => requireQuestStage(s, quest, 'complete', { atLeast: true }),
                s => (s.dialog.isOpen || s.modalOpen ? 'a dialogue or modal is still open' : true),
                noDeadItems,
            ),
            done: o => complete(stateOf(o)) && noDeadItems(stateOf(o), undefined) === true,
        },
    ];
    return questSteps(stepId, segs);
}

/** For tests and the lab: the observation `done` checks read. */
export function observed(state: BotWorldState, journal?: Pick<QuestJournalState, 'title' | 'lines'>): Observed {
    return { state, probed: journal ? { [JOURNAL]: { open: false, tick: state.tick, ...journal } } : {} };
}
