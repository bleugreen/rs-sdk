// The Grand Tree (S11b, STEP-MANIFEST.md entry 8) as runner Steps, one per segment A-P.
//
// The step starts where T10-11 leaves SCORED, at the Grand Tree door (2465,3489), and ends beside
// King Narnode in the roots, where T11-12's Ardougne teleport leaves. The route is
// docs/speedrun/scripts/quest-grandtree-full.ts with three changes: Hazelmere is reached by the
// Ardougne teleport (segments B and C) instead of on foot, the black demon is killed by Fire Bolt
// under Protect from Melee (rs/56), and N is split so the logout-unsafe stretch is a step of its
// own. Segment letters follow that script's STARTS table.
//
// Stage observation. %grandtree is server-only, so `done` reads the quest tab (A: started, P:
// complete) or the journal probe for everything between. The journal has no marker for 60 and 90
// (quest-stages.ts), so gtStage decides that pair from the inventory: the lumber order is held
// from 90 on and never taken back.
//
// Logout safety. The demon deletes itself on logout, beyond 17 tiles of the player, or when Glough
// comes within 7 tiles (grandtree_black_demon.rs2), and at stage 130 the trapdoor replays the
// scene (quest_grandtree.rs2 oploc1,grandtree_trapdoorclosed). So only N1 (Protect from Melee on,
// the trapdoor, the scene) is logoutSafe:false; runSteps never stops between it and N2, and N2
// re-opens the trapdoor itself when it starts with no demon in sight (a resume after a drop).
//
// Every segment's run is a list of moves, each skipped when its effect is already there (already
// on Hazelmere's floor, already past the teleport, the item already held), so a segment entered
// again after a drop does not repeat a teleport. Positions are judged by coordinates; a 'nothing
// in sight' test waits for the scene first (rs/185 addendum 4).

import type { BotWorldState, NearbyLoc, PrayerName } from '../../sdk/types';
import { act, actConverse, talkTo, useOn, type ActOptions } from '../lib/act';
import { COMBAT_SPELLS, combatSpellUse, fight, prayerActive, setPrayer, type FightResult } from '../lib/combat';
import { converse, type ConverseResult } from '../lib/converse';
import { pageText, type OptionPattern } from '../lib/dialogue';
import { INVENTORY_SIZE, type ItemPattern } from '../lib/items';
import { questStage, questStatus, journalProbeName, type QuestView } from '../lib/quests';
import { logNote } from '../lib/ticks';
import { runTo, spellUse, spiritTree, sumUse, teleport, type RuneUseTable } from '../lib/travel';
import { receiveFrom, type WantSpec } from '../lib/trade';
import { waitUntil, type Pred } from '../lib/wait';
import { chebyshev, configId, findLoc, findNpc, invCount, invItem, opIndex, pos, replyAfter, skillLevel, worn, type LocQuery, type Tile } from '../lib/world';
import type { Step, StepContext } from '../runner/step';
import { DEFAULT_DIALOGUE, talkShape, type QuestOptions } from './segments';

export const quest = 'grandtree' as const;
export const stepId = 'S11b';

export interface Options extends QuestOptions {
    // dialogue: default DEFAULT_DIALOGUE (burst). Each conversation carries its shape from
    // grand_tree.md's "Dialogue runs"; a burst that does not land falls back by itself.
    // kitFrom: the H8 giver at the Grand Tree door. Absent, or the kit already held, means check only.
    /** Observation only: called with each conversation's result (the lab prints its shape match). */
    onTalk?: (who: string, r: ConverseResult) => void;
    /** Default 'fire_bolt'. */
    demonSpell?: 'fire_bolt' | 'fire_blast';
}

export function resolveOptions(o: Options = {}): Required<Omit<Options, 'kitFrom' | 'onTalk'>> & Pick<Options, 'kitFrom' | 'onTalk'> {
    return { dialogue: o.dialogue ?? DEFAULT_DIALOGUE, demonSpell: o.demonSpell ?? 'fire_bolt', ...(o.kitFrom ? { kitFrom: o.kitFrom } : {}), ...(o.onTalk ? { onTalk: o.onTalk } : {}) };
}

// ------------------------------------------------------------------ data

const SPELLS = COMBAT_SPELLS;

/** Casts the kit must cover: rs/56's 153-tick kill at the 5-tick cast delay is ~31. */
export const DEMON_CASTS = 35;
/** The demon's Fire Bolts at their measured maximum: rs/202's lab kills at N2 took 20-24 casts (m, 300 ms). */
export const DEMON_MAX_CASTS = 24;

/** The worn staff whose element RUNE_USE leaves out (entryCheck wants it worn). */
export const RUNE_STAFF = 'staff of fire';

/**
 * The step's runes on the route (lib/travel.ts RuneUseTable): the Ardougne teleport at B and at C,
 * Varrock at J, and the demon's Fire Bolts at N2 at their measured maximum.
 */
export const RUNE_USE: RuneUseTable = {
    B: spellUse('ardougne'),
    C: spellUse('ardougne'),
    J: spellUse('varrock', 1, RUNE_STAFF),
    N2: combatSpellUse(resolveOptions().demonSpell, DEMON_MAX_CASTS, RUNE_STAFF),
};

/** What kitCheck wants held at A: the three teleports' runes and DEMON_CASTS casts'. */
export const RUNE_NEED: RuneUseTable = {
    A: sumUse(RUNE_USE.B!, RUNE_USE.C!, RUNE_USE.J!, combatSpellUse(resolveOptions().demonSpell, DEMON_CASTS, RUNE_STAFF)),
};
/** The Ardougne teleport's Magic level. */
export const TELEPORT_MAGIC = 51;
/** Free slots SCORED needs after H8 for the quest items (rs/158, entry 8). */
export const FREE_SLOTS = 9;
/**
 * Base Agility after the reward, STEP-MANIFEST entry 8's postcondition. On this engine's xp curve
 * (engine/entity/Player.ts; CONVENTIONS.md) level 22 plus 7,900 xp at the 25x rate lands at 75.
 */
export const AGILITY_AFTER = 75;

export const ITEM = {
    bark: /^Bark sample$/i,
    book: /^Translation book$/i,
    scroll: /^Hazelmere's scroll$/i,
    journal: /^Glough's journal$/i,
    order: /^Lumber order$/i,
    key: /^Glough's key$/i,
    plans: /^Invasion plans$/i,
    twigs: /^Twigs$/i,
    rock: /^Daconia rock$/i,
    agilityPotion: /^Agility potion\(\d\)$/i,
    magicScroll: /^A magic scroll$/i,
    staffOfFire: /^Staff of fire$/i,
    law: /^Law rune$/i,
    water: /^Water rune$/i,
    air: /^Air rune$/i,
    fire: /^Fire rune$/i,
} as const;

/** H8 (SUPPLIES.md): an Agility potion(4), Varrock runes for 1 cast, Ardougne runes for 2. */
export const H8: WantSpec[] = [
    { item: /^Agility potion\(4\)$/i, amount: 1 },
    { item: ITEM.law, amount: 5 },
    { item: ITEM.water, amount: 4 },
    { item: ITEM.air, amount: 3 },
    { item: ITEM.fire, amount: 1 },
];

const UNDERGROUND_Z = 6400;

export const TILES = {
    /** Where T10-11 leaves SCORED. */
    arrival: { x: 2465, z: 3489 },
    /**
     * The tree doors, two centrepiece locs two tiles wide (treedoorl, treedoorr, m38_54): scripted,
     * each forcemoves two tiles north or south (gnome_gate.rs2 open_tree_door).
     */
    door: { x: 2464, z: 3492 },
    doorRight: { x: 2466, z: 3492 },
    doorOutside: { x: 2465, z: 3490 },
    doorInside: { x: 2465, z: 3494 },
    treeLadder: { x: 2466, z: 3495 },
    narnode: { x: 2464, z: 3497 },
    gloughLadder: { x: 2476, z: 3463 },
    gloughLadderFoot: { x: 2476, z: 3464 },
    cupboard: { x: 2476, z: 3465 },
    chest: { x: 2482, z: 3462 },
    climbTree: { x: 2484, z: 3464 },
    trapdoor: { x: 2487, z: 3464 },
    /** The roots' ladder up into the tree (ladder_from_cellar, m38_154). */
    rootsLadder: { x: 2463, z: 9897 },
    narnodeRoots: { x: 2464, z: 9896 },
    hazelmereLadder: { x: 2677, z: 3087 },
    hazelmereLadderFoot: { x: 2677, z: 3088 },
    battlefieldTree: { x: 2555, z: 3259 },
    villageTree: { x: 2543, z: 3168 },
    villageArrival: { x: 2542, z: 3169 },
    strongholdArrival: { x: 2461, z: 3444 },
    varrockTree: { x: 3177, z: 3506 },
    varrockTreeFoot: { x: 3177, z: 3505 },
    shipyardGate: { x: 2945, z: 3041 },
    shipyardGateFoot: { x: 2943, z: 3041 },
    foreman: { x: 2998, z: 3043 },
    anitaStairs: { x: 2389, z: 3512 },
    anitaStairsFoot: { x: 2389, z: 3511 },
    anitaStairsDown: { x: 2389, z: 3513 },
} as const;

/** The four pillars on Glough's platform (level 2) and the twig each takes, west to east. */
export const PILLARS = [
    { twig: 'grandtree_twigt', x: 2485, z: 3467 },
    { twig: 'grandtree_twigu', x: 2486, z: 3467 },
    { twig: 'grandtree_twigz', x: 2487, z: 3467 },
    { twig: 'grandtree_twigo', x: 2488, z: 3467 },
] as const;

/** The 15 roots (%daconia_rock_root value to tile, daconia_coords.enum). */
export const ROOTS: Readonly<Record<number, readonly [number, number]>> = {
    1: [2456, 9886], 2: [2457, 9881], 3: [2455, 9874], 4: [2443, 9878], 5: [2439, 9881],
    6: [2444, 9893], 7: [2452, 9893], 8: [2465, 9891], 9: [2468, 9890], 10: [2467, 9896],
    11: [2473, 9897], 12: [2481, 9904], 13: [2485, 9885], 14: [2490, 9889], 15: [2467, 9872],
};
/** Search order from Narnode, the 2-opt optimum of quest-gnome-routes.ts (77 ticks expected). */
export const ROOT_ORDER = [10, 8, 9, 7, 6, 5, 4, 1, 2, 3, 11, 12, 13, 14, 15] as const;

const NARNODE = /^King Narnode( Shareen)?$/i;
const DEMON = /^Black demon$/i;
const CLIMB_REFUSED = /at least 25 Agility to climb/i;
const ROOT_EMPTY = /search the root but don't find anything|don't find anything interesting|turns out to be nothing/i;

// ------------------------------------------------------------------ state

const stateOf = (o: QuestView): BotWorldState => ('probed' in o ? o.state : o);

export function baseLevel(s: BotWorldState, skill: string): number {
    return s.skills.find(k => k.name.toLowerCase() === skill)?.baseLevel ?? 0;
}

export function freeSlots(s: BotWorldState): number {
    return INVENTORY_SIZE - s.inventory.length;
}

/** Agility potion doses held: a potion(3) counts 3. */
export function agilityDoses(s: BotWorldState): number {
    return s.inventory.reduce((a, i) => {
        const m = /^Agility potion\((\d)\)$/i.exec(i.name);
        return m ? a + i.count * Number(m[1]) : a;
    }, 0);
}

/**
 * The lowest %grandtree value the evidence allows: the tab alone for not started and complete,
 * the journal (probe or fresh) in between, and the lumber order for the 60/90 pair the journal
 * cannot tell apart. Null when the quest tab is not observable.
 */
export function gtStage(o: QuestView): number | null {
    const r = questStage(o, quest);
    if (!r) return null;
    let values = r.stages.map(x => x.value);
    if (values.length === 2 && values[0] === 60 && values[1] === 90) values = [invCount(stateOf(o), ITEM.order) > 0 ? 90 : 60];
    return Math.min(...values);
}

const atStage = (n: number) => (o: QuestView) => (gtStage(o) ?? -1) >= n;
const PROBES = [journalProbeName(quest)] as const;

const underground = (s: BotWorldState) => pos(s).z >= UNDERGROUND_Z;
const inBox = (x0: number, x1: number, z0: number, z1: number) => (s: BotWorldState) => {
    const p = pos(s);
    return p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1;
};
/** Inside the Grand Tree, any floor (the door is at z 3492). */
export const inTree = inBox(2450, 2480, 3493, 3510);
const atGlough = inBox(2470, 2495, 3455, 3472);
const onGloughFloor = (s: BotWorldState) => atGlough(s) && pos(s).level === 1;
export const onPlatform = (s: BotWorldState) => atGlough(s) && pos(s).level === 2;
const atHazelmere = inBox(2660, 2700, 3070, 3110);
const inVillage = inBox(2500, 2565, 3140, 3200);
const inStronghold = inBox(2380, 2500, 3380, 3520);
const inKaramja = inBox(2880, 3010, 3000, 3100);
const nearVarrockTree = (s: BotWorldState) => pos(s).x > 3100 && pos(s).z > 3350;
const started = (s: BotWorldState) => questStatus(s, quest) === 'started';
const lvl = (l: number): Pred => s => pos(s).level === l;
export const demonInSight = (s: BotWorldState) => findNpc(s, DEMON) !== null;

const need = (s: BotWorldState, what: ItemPattern, n: number, label: string): true | string =>
    invCount(s, what) >= n ? true : `holds ${invCount(s, what)} ${label}, needs ${n}`;

const all = (...checks: Array<true | string>): true | string => checks.find(c => c !== true) ?? true;

const isStarted = (s: BotWorldState): true | string => (started(s) ? true : `The Grand Tree is ${questStatus(s, quest) ?? 'unobservable'}, not started`);

/** The entry's preconditions apart from the kit (STEP-MANIFEST.md entry 8). */
export function entryCheck(s: BotWorldState, opts: Options = {}): true | string {
    const o = resolveOptions(opts);
    if (questStatus(s, 'tree') !== 'complete') return 'Tree Gnome Village is not complete (the spirit trees need it)';
    if (questStatus(s, 'elena') !== 'complete') return 'Plague City is not complete (the Ardougne teleport needs it)';
    const gt = questStatus(s, quest);
    if (gt === null) return 'the quest tab is not observable';
    if (gt !== 'not_started') return `The Grand Tree is already ${gt}`;
    if (baseLevel(s, 'agility') < 22) return `Agility ${baseLevel(s, 'agility')}, needs 22 (a potion dose makes 25)`;
    const magic = Math.max(TELEPORT_MAGIC, SPELLS[o.demonSpell].magic);
    if (baseLevel(s, 'magic') < magic) return `Magic ${baseLevel(s, 'magic')}, needs ${magic} (Ardougne teleport and ${o.demonSpell})`;
    if (baseLevel(s, 'prayer') < 43) return `Prayer ${baseLevel(s, 'prayer')}, needs 43 for Protect from Melee`;
    if (!worn(s, ITEM.staffOfFire)) return 'the staff of fire is not worn (the demon spells take their fire runes from it)';
    const p = pos(s);
    if (p.level !== 0 || chebyshev(p, TILES.arrival) > 10) return `not at the Grand Tree door (at ${p.x},${p.z},${p.level})`;
    return true;
}

/** The kit after H8: potion (or Agility 25), teleport runes, the demon's runes, and 9 free slots. */
export function kitCheck(s: BotWorldState, opts: Options = {}): true | string {
    const sp = SPELLS[resolveOptions(opts).demonSpell];
    if (skillLevel(s, 'agility') < 25 && agilityDoses(s) === 0) return `no Agility potion: Agility is ${skillLevel(s, 'agility')} and the climb to Glough's pillars needs 25 (H8)`;
    return all(
        need(s, ITEM.law, 5, 'law runes (2 Ardougne casts, 1 Varrock)'),
        need(s, ITEM.water, 4, 'water runes (2 Ardougne casts)'),
        need(s, ITEM.air, 3 + sp.air * DEMON_CASTS, `air runes (Varrock + ${DEMON_CASTS} casts)`),
        need(s, sp.rune, DEMON_CASTS, `${sp.runeName} runes (${DEMON_CASTS} casts)`),
        freeSlots(s) >= FREE_SLOTS ? true : `${freeSlots(s)} free slots, needs ${FREE_SLOTS} for the quest items`,
    );
}

/** The H8 items SCORED would otherwise trade for. */
export function holdsH8(s: BotWorldState): boolean {
    return (agilityDoses(s) > 0 || skillLevel(s, 'agility') >= 25) && invCount(s, ITEM.law) >= 5 && invCount(s, ITEM.water) >= 4;
}

function spellRunes(s: BotWorldState, opts: Options): true | string {
    const sp = SPELLS[resolveOptions(opts).demonSpell];
    return all(
        need(s, sp.rune, 1, `${sp.runeName} runes`),
        need(s, ITEM.air, sp.air, 'air runes'),
        // Without the staff the spell takes fire runes, and the route carries none at N.
        worn(s, ITEM.staffOfFire) ? true : need(s, ITEM.fire, sp.fire, 'fire runes and no staff of fire worn'),
        (s.prayers?.prayerPoints ?? 0) > 0 ? true : 'no prayer points for Protect from Melee',
    );
}

/** S11b's exit state: complete, the reward, no rock, beside Narnode in the roots (T11-12 leaves from here). */
export function exitCheck(s: BotWorldState): true | string {
    if (questStatus(s, quest) !== 'complete') return `The Grand Tree is ${questStatus(s, quest)}, not complete`;
    if (baseLevel(s, 'agility') < AGILITY_AFTER) return `Agility ${baseLevel(s, 'agility')} after the reward, expected at least ${AGILITY_AFTER}`;
    if (invCount(s, ITEM.rock) > 0) return 'still holds the Daconia rock';
    const p = pos(s);
    if (!underground(s) || chebyshev(p, TILES.narnodeRoots) > 8) return `not beside Narnode in the roots (at ${p.x},${p.z},${p.level})`;
    return true;
}

type Ctx = StepContext<unknown>;
type Sdk = Ctx['sdk'];

/**
 * setPrayer, but a prayer that does not turn as asked stops the step. Returns the ticks to the
 * state showing it. Every call here is made standing still: a prayer click clears a pending
 * action, so one sent mid-walk would cancel the walk (rs/241).
 */
async function pray(sdk: Sdk, name: PrayerName, on: boolean): Promise<number> {
    const r = await setPrayer(sdk, name, on);
    if (!r.ok) throw new Error(`${name} did not turn ${on ? 'on' : 'off'}: ${r.reason}`);
    return r.ticks;
}

// ------------------------------------------------------------------ moves

/** Travel inside the quest: throw when it does not arrive. */
async function go(ctx: Pick<Ctx, 'sdk' | 'bot'>, to: { x: number; z: number; level?: number }, tol = 1): Promise<void> {
    const r = await runTo(ctx.sdk, { ...to, tol }, { bot: ctx.bot });
    if (!r.ok) throw new Error(`run to (${to.x},${to.z}) stopped at ${r.at.x},${r.at.z},${r.at.level}: ${r.reason}`);
}

async function tree(sdk: Sdk, to: 'village' | 'stronghold'): Promise<void> {
    const r = await spiritTree(sdk, to);
    if (!r.ok) throw new Error(`spirit tree to ${to}: ${r.reason}`);
}

/** A loc op confirmed by `done`; throws when it does not land. */
async function loc(sdk: Sdk, what: string, at: { x: number; z: number }, op: RegExp, done: Pred, opts: ActOptions = {}): Promise<void> {
    const l = await findLoc(sdk, { x: at.x, z: at.z, op });
    if (!l) throw new Error(`${what}: no loc with ${op} at (${at.x},${at.z}) near ${JSON.stringify(pos(sdk))}`);
    const r = await act(sdk, () => sdk.sendInteractLoc(l.x, l.z, l.id, opIndex(l, op)!), done, { maxTicks: 30, ...opts });
    if (!r.ok) throw new Error(`${what}: ${op} on (${at.x},${at.z}) did not take within ${opts.maxTicks ?? 30} ticks`);
}

/** A loc op that opens a conversation (a spirit tree, a gate's password, a search with an objbox), finished on `done`. */
async function locTalk(sdk: Sdk, what: string, q: LocQuery, op: RegExp, choices: OptionPattern[], done: Pred, opts: ActOptions & { idle?: number; shape?: string; quest?: Options } = {}): Promise<void> {
    const l = await findLoc(sdk, { ...q, op });
    if (!l) throw new Error(`${what}: no loc ${JSON.stringify({ ...q, op: String(op) })} near ${JSON.stringify(pos(sdk))}`);
    const r = await actConverse(sdk, () => sdk.sendInteractLoc(l.x, l.z, l.id, opIndex(l, op)!), choices, {
        done, idle: opts.idle ?? 2, maxTicks: opts.maxTicks ?? 200, closeModals: true, unmatched: 'stop',
        ...(opts.resendEvery !== undefined ? { resendEvery: opts.resendEvery } : {}),
        ...(opts.shape ? talkShape(resolveOptions(opts.quest), opts.shape) : {}),
    });
    if (r.dialogue) opts.quest?.onTalk?.(what, r.dialogue);
    if (!r.ok) throw new Error(`${what}: ${r.reason}`);
}

interface TalkOpts {
    /** A page shown only after the segment's stage change; the conversation ends 2 ticks after it closes. */
    expect?: RegExp;
    /** Otherwise (or as well) the conversation ends once this holds with the dialogue closed. */
    until?: Pred;
    choices?: OptionPattern[];
    /** The conversation's shape, grand_tree.md "Dialogue runs" (CONVENTIONS.md notation). */
    shape?: string;
}

/**
 * Talk to an NPC and answer the conversation. It ends on its own evidence (the stage-setting page
 * seen, or `until`), 2 ticks after the dialogue closes, not on a long idle wait: scripted scenes
 * close the chat during their p_delays, and an idle long enough to span them would be dead ticks.
 */
async function talk(sdk: Sdk, opts: Options, npc: RegExp, t: TalkOpts): Promise<ConverseResult> {
    let seen = false;
    const stop = sdk.onStateUpdate(s => {
        if (t.expect && t.expect.test(pageText(s.dialog))) seen = true;
    });
    try {
        // The expect page is the only proof some stages moved (the runner re-checks postconditions, not
        // done), so it gates the end in both modes. A blind burst skips the middle of a continue run;
        // each shape marks the page before the expect page `state`, so the expect page starts a run
        // and is always published.
        const until: Pred = s => (!t.expect || seen) && (!t.until || t.until(s));
        const r = await talkTo(sdk, npc, t.choices ?? [], {
            idle: 2, maxTicks: 600, unmatched: 'stop', closeModals: true, findTicks: 15, until,
            ...(t.shape ? talkShape(resolveOptions(opts), t.shape) : {}),
        });
        opts.onTalk?.(npc.source, r);
        if (!r.opened) throw new Error(`${npc.source}: no conversation opened after ${r.clicks} clicks`);
        if (!r.ok) {
            const p = pos(sdk);
            throw new Error(`${npc.source}: ${r.reason} at ${p.x},${p.z},${p.level} after ${r.clicks} click(s); last pages: ${r.transcript.slice(-4).join(' | ')}`);
        }
        if (t.expect && !seen) throw new Error(`${npc.source}: the conversation never showed /${t.expect.source}/, the page after the stage change`);
        return r;
    } finally {
        stop();
    }
}

/** Dismiss a page an action opened (a mesbox, an objbox), if one opens within 2 ticks. */
async function dismissPages(sdk: Sdk): Promise<void> {
    await converse(sdk, [], { idle: 1, openTicks: 2, maxTicks: 40, closeModals: true, unmatched: 'stop' });
}

const OPEN = /^open$/i;
/**
 * Ticks to wait for a tree door to show Open again. Anyone's crossing turns the door they used
 * into its open form for 6 ticks (gnome_gate.rs2 open_tree_door, loc_change(_, 6)); that form has
 * no ops and keeps the door's blocking shape, so it cannot be walked through, only waited out.
 */
export const TREE_DOOR_WAIT = 8;
/** Clicks before a crossing refuses: a click can land just as another player's crossing turns that door. */
export const TREE_DOOR_CLICKS = 3;
/** Click to the forced move's landing, with act's re-send at 6 still inside it. */
const TREE_DOOR_CLICK_TICKS = 15;

/** The nearer tree door that shows Open now (findLoc: waits for the scene, scans on a miss). */
async function openTreeDoor(sdk: Sdk): Promise<NearbyLoc | null> {
    const doors = await Promise.all([TILES.door, TILES.doorRight].map(d => findLoc(sdk, { x: d.x, z: d.z, op: OPEN })));
    const here = pos(sdk);
    return doors.filter((d): d is NearbyLoc => d !== null).sort((a, b) => chebyshev(a, here) - chebyshev(b, here))[0] ?? null;
}

const showsOpenTreeDoor = (s: BotWorldState) =>
    s.nearbyLocs.some(l => l.z === TILES.door.z && (l.x === TILES.door.x || l.x === TILES.doorRight.x) && opIndex(l, OPEN) !== undefined);

/**
 * Through the Grand Tree doorway, confirmed by `crossed`. Either door takes SCORED through in the
 * same ticks, so a door another player has just opened is passed over for the other; with both
 * open, wait up to TREE_DOOR_WAIT ticks for one to close. Refuses once no door shows Open within
 * that wait, or after TREE_DOOR_CLICKS clicks that did not cross.
 */
export async function crossTreeDoor(sdk: Sdk, what: string, crossed: Pred): Promise<void> {
    for (let click = 1; ; click++) {
        let door = await openTreeDoor(sdk);
        if (!door) {
            const opened = await waitUntil(sdk, showsOpenTreeDoor, { maxTicks: TREE_DOOR_WAIT });
            door = opened.ok ? await openTreeDoor(sdk) : null;
        }
        if (!door) {
            throw new Error(`${what}: neither tree door (${TILES.door.x},${TILES.door.z}) nor (${TILES.doorRight.x},${TILES.doorRight.z}) showed Open within ${TREE_DOOR_WAIT} ticks near ${JSON.stringify(pos(sdk))}`);
        }
        const d = door;
        const r = await act(sdk, () => sdk.sendInteractLoc(d.x, d.z, d.id, opIndex(d, OPEN)!), crossed, { maxTicks: TREE_DOOR_CLICK_TICKS });
        if (r.ok || crossed(sdk.getState()!)) return;
        if (click >= TREE_DOOR_CLICKS) {
            throw new Error(`${what}: ${click} tree door clicks did not cross (last on (${d.x},${d.z}), ${TREE_DOOR_CLICK_TICKS} ticks each) near ${JSON.stringify(pos(sdk))}`);
        }
    }
}

async function enterTree(sdk: Sdk, ctx: Pick<Ctx, 'bot'>): Promise<void> {
    if (inTree(sdk.getState()!)) return;
    await go({ sdk, bot: ctx.bot }, TILES.doorOutside, 1);
    await crossTreeDoor(sdk, 'tree door in', s => pos(s).z >= 3493);
}

async function treeLadder(sdk: Sdk, to: number): Promise<void> {
    for (let l = pos(sdk).level; l !== to; l = pos(sdk).level) {
        const up = l < to;
        await loc(sdk, `tree ladder ${l}->${up ? l + 1 : l - 1}`, TILES.treeLadder, up ? /^climb-up$/i : /^climb-down$/i, lvl(up ? l + 1 : l - 1), { maxTicks: 20 });
    }
}

async function leaveTree(sdk: Sdk, ctx: Pick<Ctx, 'bot'>): Promise<void> {
    if (!inTree(sdk.getState()!)) return;
    await treeLadder(sdk, 0);
    await go({ sdk, bot: ctx.bot }, TILES.doorInside, 0);
    await crossTreeDoor(sdk, 'tree door out', s => pos(s).z <= 3491);
}

async function gloughUp(sdk: Sdk, ctx: Pick<Ctx, 'bot'>): Promise<void> {
    const s = sdk.getState()!;
    if (onGloughFloor(s) || onPlatform(s)) return;
    await leaveTree(sdk, ctx);
    await go({ sdk, bot: ctx.bot }, TILES.gloughLadderFoot, 1);
    await loc(sdk, "Glough's ladder up", TILES.gloughLadder, /^climb-up$/i, lvl(1), { maxTicks: 20 });
}

async function gloughDown(sdk: Sdk): Promise<void> {
    if (!onGloughFloor(sdk.getState()!)) return;
    await loc(sdk, "Glough's ladder down", TILES.gloughLadder, /^climb-down$/i, lvl(0), { maxTicks: 20 });
}

export interface ClimbResult {
    doses: number;
    refusals: number;
}

/**
 * Climb Glough's tree to the pillar platform. Below Agility 25 drink one potion dose and send the
 * climb the tick the boost shows. The boost loses a level every 100 ticks on a timer whose phase
 * cannot be read, so a refusal (a mesbox, quest_grandtree.rs2 oploc1,grandtree_climbtree) means
 * drink another dose and climb again.
 */
export async function climbToPillars(sdk: Sdk): Promise<ClimbResult> {
    const res: ClimbResult = { doses: 0, refusals: 0 };
    for (;;) {
        const s = sdk.getState()!;
        if (onPlatform(s)) return res;
        const agility = skillLevel(s, 'agility');
        if (agility < 25) {
            const pot = s.inventory.find(i => ITEM.agilityPotion.test(i.name));
            if (!pot) {
                throw new Error(`Agility ${agility} and no Agility potion dose left after ${res.refusals} refused climb(s): the tree needs 25. Fallback: lap the Gnome course to 25 in S11a`);
            }
            const drink = opIndex(pot, /^drink$/i) ?? 1;
            const d = await act(sdk, () => sdk.sendUseItem(pot.slot, drink), st => skillLevel(st, 'agility') > agility, { resendEvery: 3, maxResends: 1, maxTicks: 8 });
            if (!d.ok) throw new Error('the Agility potion dose did not raise Agility');
            res.doses++;
        }
        const tree = await findLoc(sdk, { x: TILES.climbTree.x, z: TILES.climbTree.z, op: /^climb-up$/i });
        if (!tree) throw new Error(`no climbable tree at (${TILES.climbTree.x},${TILES.climbTree.z})`);
        const r = await act(sdk, () => sdk.sendInteractLoc(tree.x, tree.z, tree.id, opIndex(tree, /^climb-up$/i)!), st => onPlatform(st) || CLIMB_REFUSED.test(pageText(st.dialog)), { maxTicks: 20 });
        if (!r.ok) throw new Error("the climb up Glough's tree did not take within 20 ticks");
        if (onPlatform(sdk.getState()!)) return res;
        res.refusals++;
        await dismissPages(sdk);
    }
}

/** From anywhere on the route (the roots, the tree, the stronghold) to the pillar platform. */
async function toPillars(sdk: Sdk, ctx: Pick<Ctx, 'bot'>): Promise<ClimbResult> {
    if (onPlatform(sdk.getState()!)) return { doses: 0, refusals: 0 };
    if (underground(sdk.getState()!)) {
        await go({ sdk, bot: ctx.bot }, { x: TILES.rootsLadder.x, z: TILES.rootsLadder.z - 1 }, 1);
        await loc(sdk, 'roots ladder up', TILES.rootsLadder, /^climb-up$/i, s => !underground(s), { maxTicks: 20 });
    }
    await gloughUp(sdk, ctx);
    return climbToPillars(sdk);
}

export interface TeleportReport {
    scrollRead: boolean;
    /** What reading the scroll showed: its pages, and whether the scroll left the inventory. */
    scroll?: { pages: string[]; consumed: boolean };
}

/**
 * The Ardougne teleport. The quest tab cannot tell %elenaquest 29 from 30, and at 29 the spell is
 * refused ("You haven't learnt how to cast this spell yet.", teleport.rs2); reading Plague City's
 * magic scroll sets 30 (elena_teleport_scroll.rs2), so on a refusal read it and cast again.
 */
export async function ardougneTeleport(sdk: Sdk): Promise<TeleportReport> {
    const first = await teleport(sdk, 'ardougne');
    if (first.ok) return { scrollRead: false };
    if (!/refused/.test(first.reason ?? '')) throw new Error(first.reason ?? 'Ardougne teleport failed');
    const scroll = invItem(sdk, ITEM.magicScroll);
    if (!scroll) throw new Error(`${first.reason}, and no magic scroll is held to learn the spell from`);
    const read = await actConverse(sdk, () => sdk.sendUseItem(scroll.slot, opIndex(scroll, /^read$/i) ?? 1), [], {
        done: s => !invItem(s, ITEM.magicScroll), resendEvery: 0, idle: 2, maxTicks: 30, closeModals: true, unmatched: 'stop',
    });
    const report: TeleportReport = {
        scrollRead: true,
        scroll: { pages: (read.dialogue?.transcript ?? []).filter(l => / page: /.test(l)), consumed: !invItem(sdk, ITEM.magicScroll) },
    };
    const again = await teleport(sdk, 'ardougne');
    if (!again.ok) throw new Error(`after reading the scroll: ${again.reason}`);
    return report;
}

async function varrockTeleport(sdk: Sdk): Promise<void> {
    const r = await teleport(sdk, 'varrock');
    if (!r.ok) throw new Error(r.reason);
}

/** The village spirit tree to the stronghold, unless already in the stronghold. */
async function villageToStronghold(sdk: Sdk): Promise<void> {
    if (!inStronghold(sdk.getState()!)) await tree(sdk, 'stronghold');
}

/** Open the trapdoor with Protect from Melee on, and answer Glough's scene until the demon is in sight. */
async function trapdoorScene(sdk: Sdk, opts: Options): Promise<number> {
    const prayerTicks = await pray(sdk, 'protect_from_melee', true);
    await loc(sdk, 'trapdoor', TILES.trapdoor, /^open$/i, underground, { maxTicks: 20 });
    const scene = await converse(sdk, [], { idle: 2, openTicks: 20, maxTicks: 80, until: demonInSight, closeModals: true, unmatched: 'stop', ...talkShape(resolveOptions(opts), 'state, 4c') });
    opts.onTalk?.('trapdoor scene', scene);
    if (!demonInSight(sdk.getState()!)) throw new Error('no black demon in sight after the trapdoor scene');
    return prayerTicks;
}

/** Wait until the scene is populated, so an 'absent' test is not judged on a reconnect's first state. */
async function sceneLoaded(sdk: Sdk): Promise<void> {
    const r = await waitUntil(sdk, s => s.nearbyLocs.length > 0, { maxTicks: 10 });
    if (!r.ok) throw new Error('the scene did not load within 10 ticks');
}

export interface DemonReport {
    spell: string;
    fallback: boolean;
    ticks: number;
    /** Spell clicks sent (fight re-sends every 2 ticks; the 5-tick cast delay sets the real rate). */
    clicks: number;
    /** Casts that landed: chaos plus death runes spent, one per cast. What SUPPLIES sizes H7 by. */
    casts: number;
    dealt: number;
    taken: number;
    prayerUsed: number;
    levelUps: number;
    end: string;
    staffWorn: boolean;
    reopened: boolean;
}

function sumFights(fs: FightResult[]): Pick<DemonReport, 'ticks' | 'clicks' | 'dealt' | 'taken' | 'prayerUsed' | 'levelUps'> {
    const sum = (k: 'ticks' | 'attacks' | 'dealt' | 'taken' | 'prayerUsed' | 'levelUps') => fs.reduce((a, f) => a + f[k], 0);
    return { ticks: sum('ticks'), clicks: sum('attacks'), dealt: sum('dealt'), taken: sum('taken'), prayerUsed: sum('prayerUsed'), levelUps: sum('levelUps') };
}

/**
 * Kill the demon by spell in place under Protect from Melee. Out of chaos runes with it alive
 * means carry on with Fire Blast (death runes, Magic 59).
 */
export async function killDemon(sdk: Sdk, opts: Options, reopened: boolean): Promise<DemonReport> {
    const first = resolveOptions(opts).demonSpell;
    const castRunes = (s: BotWorldState) => invCount(s, SPELLS.fire_bolt.rune) + invCount(s, SPELLS.fire_blast.rune);
    const runes0 = castRunes(sdk.getState()!);
    const out = (sp: keyof typeof SPELLS): Pred => s => invCount(s, SPELLS[sp].rune) === 0 || invCount(s, ITEM.air) < SPELLS[sp].air;
    const base = { prayer: 'protect_from_melee' as const, drinkBelow: 8, eatBelow: 14, maxTicks: 1500, findTicks: 10 };
    const fights = [await fight(sdk, DEMON, { ...base, spell: SPELLS[first].component, done: out(first) })];
    let fallback = false;
    if (fights[0]!.end === 'done' && first === 'fire_bolt' && demonInSight(sdk.getState()!)) {
        const s = sdk.getState()!;
        if (baseLevel(s, 'magic') < SPELLS.fire_blast.magic || out('fire_blast')(s)) {
            throw new Error(`out of Fire Bolt runes with the demon alive, and Fire Blast needs Magic ${SPELLS.fire_blast.magic} with death and air runes`);
        }
        fallback = true;
        const npc = findNpc(s, DEMON)!;
        fights.push(await fight(sdk, npc, { ...base, spell: SPELLS.fire_blast.component, done: out('fire_blast') }));
    }
    const last = fights[fights.length - 1]!;
    await pray(sdk, 'protect_from_melee', false);
    const report: DemonReport = { spell: first, fallback, ...sumFights(fights), casts: runes0 - castRunes(sdk.getState()!), end: last.end, staffWorn: worn(sdk, ITEM.staffOfFire) !== null, reopened };
    if (last.end !== 'killed') throw new Error(`the demon fight ended '${last.end}' (${JSON.stringify(report)})`);
    return report;
}

/**
 * Search one root; true when it held the rock (its objbox opened or the rock arrived). An empty
 * root is told by its reply after the click (replyAfter): the browser stamps that reply on the
 * click's own tick, so a tick offset would miss it there.
 */
export async function searchRoot(sdk: Sdk, n: number): Promise<boolean> {
    const [x, z] = ROOTS[n]!;
    const l = await findLoc(sdk, { x, z, op: /^search$/i });
    if (!l) throw new Error(`no root ${n} at (${x},${z})`);
    const empty = replyAfter(sdk, ROOT_EMPTY);
    const found = (s: BotWorldState) => /Daconia/i.test(pageText(s.dialog)) || invCount(s, ITEM.rock) > 0;
    // A second search is harmless (an empty root prints again; the rock root gives one rock), so a
    // dropped click is re-sent once the player has stood still for 4 ticks.
    const r = await act(sdk, () => sdk.sendInteractLoc(l.x, l.z, l.id, opIndex(l, /^search$/i)!), s => found(s) || empty.seen(s), { resendEvery: 4, maxResends: 2, maxTicks: 40 });
    if (!r.ok) throw new Error(`searching root ${n} at (${x},${z}) gave no answer within 40 ticks`);
    if (!found(sdk.getState()!)) return false;
    await dismissPages(sdk);
    const got = await waitUntil(sdk, s => invCount(s, ITEM.rock) > 0, { maxTicks: 4 });
    if (!got.ok) throw new Error(`root ${n}'s rock was shown but never arrived (no free slot?)`);
    return true;
}

// ------------------------------------------------------------------ steps

const name = (letter: string) => `${stepId}:${letter}`;

export function steps(input: Options = {}): Step<any>[] {
    const opts = resolveOptions(input);
    const note = (ctx: Ctx, step: string, meta: Record<string, unknown>) => logNote(ctx.log, ctx.session, step, meta);

    return [
        {
            name: name('A-narnode'),
            preconditions: s => all(entryCheck(s, opts), opts.kitFrom ? true : kitCheck(s, opts)),
            run: async ctx => {
                const { sdk } = ctx;
                if (opts.kitFrom && !holdsH8(sdk.getState()!)) {
                    const r = await receiveFrom(sdk, opts.kitFrom, { want: H8 });
                    if (!r.ok) throw new Error(`H8 from ${opts.kitFrom}: ${r.reason}`);
                }
                const kit = kitCheck(sdk.getState()!, opts);
                if (kit !== true) throw new Error(`kit: ${kit}`);
                note(ctx, name('A-narnode'), { freeSlots: freeSlots(sdk.getState()!) });
                await enterTree(sdk, ctx);
                // "seem worried", the trapdoor walk (scripted), "happy to help", then the two objboxes.
                await talk(sdk, opts, NARNODE, {
                    choices: [/seem worried/i, /happy to help/i],
                    shape: '3c, opt, 3c, state, 8c, opt, 13c',
                    until: s => started(s) && invCount(s, ITEM.book) > 0 && invCount(s, ITEM.bark) > 0 && !underground(s),
                });
            },
            postconditions: s => all(isStarted(s), need(s, ITEM.bark, 1, 'bark samples'), need(s, ITEM.book, 1, 'translation books')),
            logoutSafe: true,
            done: o => { const st = questStatus(stateOf(o), quest); return st === 'started' || st === 'complete'; },
        },
        {
            name: name('B-hazelmere'),
            preconditions: s => all(isStarted(s), need(s, ITEM.bark, 1, 'bark samples'), need(s, ITEM.book, 1, 'translation books')),
            run: async ctx => {
                const { sdk } = ctx;
                if (!(atHazelmere(sdk.getState()!) && pos(sdk).level === 1)) {
                    if (pos(sdk).x < 2600) note(ctx, name('B-hazelmere'), { teleport: await ardougneTeleport(sdk) });
                    await go(ctx, TILES.hazelmereLadderFoot, 1);
                    await loc(sdk, "Hazelmere's ladder up", TILES.hazelmereLadder, /^climb-up$/i, lvl(1), { maxTicks: 20 });
                }
                await talk(sdk, opts, /^Hazelmere$/i, { shape: '9c', until: s => invCount(s, ITEM.scroll) > 0 });
            },
            postconditions: s => all(need(s, ITEM.scroll, 1, "Hazelmere's scrolls"), invCount(s, ITEM.bark) === 0 ? true : 'still holds the bark sample'),
            logoutSafe: true,
            done: atStage(20),
            probes: PROBES,
        },
        {
            name: name('C-translation'),
            preconditions: s => all(isStarted(s), need(s, ITEM.book, 1, 'translation books'), need(s, ITEM.scroll, 1, "Hazelmere's scrolls")),
            run: async ctx => {
                const { sdk } = ctx;
                if (atHazelmere(sdk.getState()!)) {
                    if (pos(sdk).level === 1) await loc(sdk, "Hazelmere's ladder down", TILES.hazelmereLadder, /^climb-down$/i, lvl(0), { maxTicks: 20 });
                    note(ctx, name('C-translation'), { teleport: await ardougneTeleport(sdk) });
                }
                const s = sdk.getState()!;
                if (!inVillage(s) && !inStronghold(s)) {
                    await go(ctx, TILES.battlefieldTree, 2);
                    await tree(sdk, 'village');
                }
                await villageToStronghold(sdk);
                await enterTree(sdk, ctx);
                await talk(sdk, opts, NARNODE, {
                    choices: [/I think so/i, /None of the above/i, /None of the above/i, /King's seal/i, /gave the man Daconia/i, /kill the tree/i],
                    shape: '4c, opt, 2c, opt, opt, opt, 1c, opt, 1c, opt, state, 8c',
                    expect: /First I must warn the tree guardians/i,
                });
            },
            postconditions: isStarted,
            logoutSafe: true,
            done: atStage(30),
            probes: PROBES,
        },
        {
            name: name('D-glough'),
            preconditions: isStarted,
            run: async ctx => {
                await gloughUp(ctx.sdk, ctx);
                await talk(ctx.sdk, opts, /^Glough$/i, { shape: '8c, state, 1c', expect: /Your type can't be trusted/i });
            },
            postconditions: isStarted,
            logoutSafe: true,
            done: atStage(40),
            probes: PROBES,
        },
        {
            name: name('E-narnode'),
            preconditions: isStarted,
            run: async ctx => {
                await gloughDown(ctx.sdk);
                await enterTree(ctx.sdk, ctx);
                await talk(ctx.sdk, opts, NARNODE, { shape: '5c, state, 1c', expect: /He's on the top level of the tree/i });
            },
            postconditions: isStarted,
            logoutSafe: true,
            done: atStage(50),
            probes: PROBES,
        },
        {
            name: name('F-charlie'),
            preconditions: isStarted,
            run: async ctx => {
                await enterTree(ctx.sdk, ctx);
                await treeLadder(ctx.sdk, 3);
                await talk(ctx.sdk, opts, /^Charlie$/i, { shape: '8c, state, 2c', expect: /I don't know what he's up to/i });
            },
            postconditions: isStarted,
            logoutSafe: true,
            done: atStage(60),
            probes: PROBES,
        },
        {
            name: name('G-journal'),
            preconditions: isStarted,
            run: async ctx => {
                const { sdk } = ctx;
                await gloughUp(sdk, ctx);
                const cupboard = { x: TILES.cupboard.x, z: TILES.cupboard.z };
                if (!(await findLoc(sdk, { ...cupboard, op: /^search$/i }))) await loc(sdk, 'open the cupboard', cupboard, /^open$/i, s => s.nearbyLocs.some(l => l.x === cupboard.x && l.z === cupboard.z && opIndex(l, /^search$/i) !== undefined), { maxTicks: 20 });
                await locTalk(sdk, 'search the cupboard', cupboard, /^search$/i, [], s => invCount(s, ITEM.journal) > 0, { resendEvery: 0, maxTicks: 40 });
            },
            postconditions: s => need(s, ITEM.journal, 1, "Glough's journals"),
            logoutSafe: true,
            done: atStage(70),
            probes: PROBES,
        },
        {
            name: name('H-arrest'),
            preconditions: s => all(isStarted(s), need(s, ITEM.journal, 1, "Glough's journals")),
            run: async ctx => {
                await gloughUp(ctx.sdk, ctx);
                // Glough calls the guards, the jail, Charlie, then Narnode lets you out (charlie.rs2, king_narnode.rs2).
                await talk(ctx.sdk, opts, /^Glough$/i, { shape: '4c, state, state, 7c, state, state, 1c, state, 3c', expect: /glider pilot fly you away/i });
            },
            postconditions: isStarted,
            logoutSafe: true,
            done: atStage(80),
            probes: PROBES,
        },
        {
            name: name('I-karamja'),
            preconditions: isStarted,
            run: async ctx => {
                const { sdk } = ctx;
                const s0 = sdk.getState()!;
                const hp0 = skillLevel(s0, 'hitpoints');
                const prayer0 = s0.prayers?.prayerPoints ?? 0;
                // The glider lands at (2917,3058) among jogres (level 53, aggressive at SCORED's
                // combat). The crash conversation after the landing sets nothing (the stage moves at
                // the foreman), and a jogre's hit makes SCORED retaliate, which closes it mid-way:
                // waiting for its last page stalled the step until the jogres killed SCORED. So
                // SCORED walks off at the first page after the landing (walking ends the dialogue),
                // under Protect from Melee from boarding until through the shipyard gate.
                const westOfGate = !inKaramja(s0) || pos(s0).x < TILES.shipyardGate.x;
                const toggles = { on: westOfGate ? await pray(sdk, 'protect_from_melee', true) : 0, off: 0 };
                if (!inKaramja(sdk.getState()!)) {
                    await enterTree(sdk, ctx);
                    await treeLadder(sdk, 3);
                    // Not during the landing's p_delay(4), which drops clicks: once a page is up. So the
                    // pilot's shape (grand_tree.md: "5c, opt, 1c, state, 1c") ends at the first crash page.
                    let left = false;
                    const leave = sdk.onStateUpdate(s => {
                        if (left || !inKaramja(s) || !s.dialog?.isOpen) return;
                        left = true;
                        void sdk.sendWalk(TILES.shipyardGateFoot.x, TILES.shipyardGateFoot.z, true);
                    });
                    try {
                        await talk(sdk, opts, /^Gnome pilot$/i, { choices: [/Karamja/i], shape: '5c, opt, 1c, state', until: inKaramja });
                    } finally {
                        leave();
                    }
                }
                if (pos(sdk).x < TILES.shipyardGate.x) {
                    await go(ctx, TILES.shipyardGateFoot, 1);
                    await locTalk(sdk, 'shipyard gate', TILES.shipyardGate, /^open$/i, [/Glough sent me/i, /^Ka\.$/, /^Lu\.$/, /^Min\.$/], s => pos(s).x >= TILES.shipyardGate.x, { idle: 2, shape: '3c, opt, 4c, opt, 1c, opt, 1c, opt, 2c', quest: opts });
                }
                if (westOfGate) {
                    toggles.off = await pray(sdk, 'protect_from_melee', false);
                    const s1 = sdk.getState()!;
                    note(ctx, name('I-karamja'), { crash: { hpLost: hp0 - skillLevel(s1, 'hitpoints'), prayerUsed: prayer0 - (s1.prayers?.prayerPoints ?? 0), toggleTicks: toggles } });
                }
                await go(ctx, TILES.foreman, 3);
                await talk(sdk, opts, /^Foreman$/i, { choices: [/no longer with us/i, /worm holes/i, /^Anita/i], shape: '6c, state, 3c, opt, 3c, opt, 2c, opt, 12c, state, 1c', until: s => invCount(s, ITEM.order) > 0 });
            },
            postconditions: s => need(s, ITEM.order, 1, 'lumber orders'),
            logoutSafe: true,
            done: atStage(90),
            probes: PROBES,
        },
        {
            name: name('J-charlie'),
            preconditions: s => all(isStarted(s), need(s, ITEM.order, 1, 'lumber orders')),
            run: async ctx => {
                const { sdk } = ctx;
                if (inKaramja(sdk.getState()!)) await varrockTeleport(sdk);
                if (nearVarrockTree(sdk.getState()!)) {
                    await go(ctx, TILES.varrockTreeFoot, 1);
                    await tree(sdk, 'village');
                }
                await villageToStronghold(sdk);
                await enterTree(sdk, ctx);
                await treeLadder(sdk, 3);
                await talk(sdk, opts, /^Charlie$/i, { shape: '8c, state', expect: /I'll see what I can find/i });
            },
            postconditions: isStarted,
            logoutSafe: true,
            done: atStage(100),
            probes: PROBES,
        },
        {
            name: name('K-plans'),
            preconditions: isStarted,
            run: async ctx => {
                const { sdk } = ctx;
                if (invCount(sdk, ITEM.key) === 0) {
                    await leaveTree(sdk, ctx);
                    await go(ctx, TILES.anitaStairsFoot, 1);
                    await loc(sdk, "Anita's stairs up", TILES.anitaStairs, /^climb-up$/i, lvl(1), { maxTicks: 20 });
                    await talk(sdk, opts, /^Anita$/i, { shape: '6c, state, 4c', until: s => invCount(s, ITEM.key) > 0 });
                    await loc(sdk, "Anita's stairs down", TILES.anitaStairsDown, /^climb-down$/i, lvl(0), { maxTicks: 20 });
                }
                await gloughUp(sdk, ctx);
                // The chest shows the plans' objbox, then adds them (quest_grandtree.rs2 oplocu,grandtree_chestclosed).
                const r = await useOn(sdk, ITEM.key, { loc: { x: TILES.chest.x, z: TILES.chest.z, name: /chest/i } }, s => invCount(s, ITEM.plans) > 0 || /found a scroll/i.test(pageText(s.dialog)), { maxTicks: 30 });
                if (!r.ok) throw new Error("Glough's key on the chest did nothing within 30 ticks");
                await dismissPages(sdk);
            },
            postconditions: s => need(s, ITEM.plans, 1, 'invasion plans'),
            logoutSafe: true,
            done: atStage(110),
            probes: PROBES,
        },
        {
            name: name('L-twigs'),
            preconditions: s => all(isStarted(s), need(s, ITEM.plans, 1, 'invasion plans')),
            run: async ctx => {
                await gloughDown(ctx.sdk);
                await enterTree(ctx.sdk, ctx);
                note(ctx, name('L-twigs'), { freeSlots: freeSlots(ctx.sdk.getState()!) });
                await talk(ctx.sdk, opts, NARNODE, { shape: '9c', until: s => invCount(s, ITEM.twigs) >= 4 });
            },
            postconditions: s => need(s, ITEM.twigs, 4, 'twigs'),
            logoutSafe: true,
            done: atStage(120),
            probes: PROBES,
        },
        {
            name: name('M-pillars'),
            preconditions: s => all(
                isStarted(s), need(s, ITEM.twigs, 4, 'twigs'),
                skillLevel(s, 'agility') >= 25 || agilityDoses(s) > 0 ? true : `Agility ${skillLevel(s, 'agility')} and no Agility potion for the climb`,
            ),
            run: async ctx => {
                const { sdk } = ctx;
                const climb = await toPillars(sdk, ctx);
                note(ctx, name('M-pillars'), { climb });
                for (const p of PILLARS) {
                    const id = configId('obj', p.twig);
                    if (invCount(sdk, id) === 0) continue;
                    const r = await useOn(sdk, id, { loc: { x: p.x, z: p.z, name: /pillar/i } }, s => invCount(s, id) === 0, { maxTicks: 20 });
                    if (!r.ok) throw new Error(`${p.twig} on the pillar at (${p.x},${p.z}) did nothing within 20 ticks`);
                }
                // The fourth twig unlocks the trapdoor and shows a mesbox.
                await dismissPages(sdk);
            },
            postconditions: s => (invCount(s, ITEM.twigs) === 0 ? (onPlatform(s) ? true : 'not on the pillar platform') : `${invCount(s, ITEM.twigs)} twigs still held`),
            logoutSafe: true,
            done: atStage(130),
            probes: PROBES,
        },
        {
            // Unsafe from here to the kill: the demon deletes itself on logout.
            name: name('N1-trapdoor'),
            preconditions: s => all(isStarted(s), spellRunes(s, opts)),
            run: async ctx => {
                const { sdk } = ctx;
                await sceneLoaded(sdk);
                // A demon already here (re-entry) must not be spawned twice: glough.rs2 adds one without checking.
                if (demonInSight(sdk.getState()!)) return;
                note(ctx, name('N1-trapdoor'), { protectOnTicks: await trapdoorScene(sdk, opts) });
            },
            postconditions: s => (demonInSight(s) ? true : 'no black demon in sight'),
            logoutSafe: false,
        },
        {
            name: name('N2-demon'),
            preconditions: s => all(isStarted(s), spellRunes(s, opts)),
            run: async ctx => {
                const { sdk } = ctx;
                await sceneLoaded(sdk);
                let reopened = false;
                if (!demonInSight(sdk.getState()!)) {
                    // Entered after a drop: the demon went with the logout and stage 130 replays the scene.
                    reopened = true;
                    note(ctx, name('N2-demon'), { reentry: { climb: await toPillars(sdk, ctx) } });
                    await trapdoorScene(sdk, opts);
                }
                note(ctx, name('N2-demon'), { demon: await killDemon(sdk, opts, reopened) });
            },
            // The kill itself is confirmed by fight's 'killed' (the run throws on any other end) and by
            // `done` at 140. The demon stays in the npc list through its death animation, so "not in
            // sight" would cost ticks to wait out; Protect from Melee off is the step's visible end.
            postconditions: s => (prayerActive(s, 'protect_from_melee') ? 'Protect from Melee is still on after the kill' : true),
            logoutSafe: true,
            done: atStage(140),
            probes: PROBES,
        },
        {
            name: name('O-guards'),
            preconditions: isStarted,
            run: async ctx => {
                await go(ctx, TILES.narnodeRoots, 1);
                // Narnode calls the guard (p_delay 6), the guard searches (p_delay 4): king_narnode.rs2.
                await talk(ctx.sdk, opts, NARNODE, { shape: '3c, state, state, state, 1c, state, 8c, state, 1c', expect: /A reward will have to wait/i });
            },
            postconditions: isStarted,
            logoutSafe: true,
            done: atStage(150),
            probes: PROBES,
        },
        {
            name: name('P-daconia'),
            preconditions: isStarted,
            run: async ctx => {
                const { sdk } = ctx;
                let root: number | null = null;
                let searched = 0;
                for (const n of ROOT_ORDER) {
                    if (invCount(sdk, ITEM.rock) > 0) break;
                    searched++;
                    if (await searchRoot(sdk, n)) {
                        root = n;
                        break;
                    }
                }
                if (invCount(sdk, ITEM.rock) === 0) throw new Error(`searched ${searched} roots and found no Daconia rock`);
                note(ctx, name('P-daconia'), { root, searched });
                await go(ctx, TILES.narnodeRoots, 1);
                await talk(sdk, opts, NARNODE, { shape: '17c, state, 4c', until: s => questStatus(s, quest) === 'complete' });
            },
            postconditions: exitCheck,
            logoutSafe: true,
            done: o => questStatus(stateOf(o), quest) === 'complete',
        },
    ];
}

