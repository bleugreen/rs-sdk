// The run's transition legs as data-built Steps (STEP-MANIFEST.md entry 11; RUN-ORDER.md section
// 2): every move between two steps that is not inside a step's own travel, so legs are logged
// and resumable like steps. run.ts interleaves them by step id (`legsAfter`).
//
// A leg is a hop list for lib/travel.ts plus what the run needs around it: preconditions (runes
// and Magic for its spells, Wilderness level at most 20 when it opens with a spell, food on the
// legs past aggressive NPCs, coins for the ship, a knife for webs, the talisman for an altar),
// the postcondition (within tolerance of the next step's start), logoutSafe, and its measured
// ticks from docs/speedrun/research/run-transitions.md.
//
// Legs are transient: no `done`. runner/resume.ts resumes at the first milestone whose `done` is
// false, and a position check is false again as soon as the run moves on, so a leg with `done`
// would pull a restart back to it. Instead the resume walk skips a leg when the next step can
// already start; a leg's preconditions never ask for its start tile, so a leg re-runs from
// wherever a restart leaves the player; `run` is a no-op once the player has arrived; and `run`
// starts at the first hop the player is not yet past (checkpoints).
//
// Where a quest document already counts the arrival, the leg ends exactly at that quest step's
// first tile and the quest module does not travel there itself (rs/185, 17:55 PDT). `expected`
// holds the leg's full measured figure; `net` is what it adds to RUN-ORDER.md's step totals.

import type { BotWorldState } from '../../sdk/types';
import { measure } from '../lib/ticks';
import {
    boxAround, FOOD, fmtTile, hopNeeds, hopsDestination, inArea, inRegion, missingRunes, SPELLS, travel, wildernessLevel,
    type Area, type Hop, type Region, type TravelResult, type TravelSdk,
} from '../lib/travel';
import { currentTick } from '../lib/wait';
import { invCount, invItem, pos, skillLevel } from '../lib/world';
import type { Observed, Step, StepContext } from './step';

export const skill = 'legs';

/** m measured, i inferred, r read from the document that measured it (run-transitions.md labels). */
export type Label = 'm' | 'i' | 'r';

export interface Expected {
    /** The leg's full figure: the mean of run-transitions.md's runs, or its inference. */
    ticks: number;
    label: Label;
    source: string;
    /** What the leg adds to the steps' own totals (RUN-ORDER.md section 2: net of the arrival a quest counts). */
    net: number;
}

/** Hop `after` is behind the player once the player stands in any of `in`. */
export interface Checkpoint {
    after: number;
    in: readonly Region[];
}

export interface LegDef {
    id: string;
    /** The step the leg follows and the step it leads to (or the bands inside one step). */
    after: string;
    before: string;
    /** The earlier step's end tile (the lab's ::tele start). */
    start: Area;
    /** The next step's start, with its tolerance. */
    dest: Area;
    method: string;
    hops: readonly Hop[];
    /** Food items to hold before the leg (aggressive NPCs took up to 31 of 42 HP, run-transitions.md section 2). */
    food?: number;
    /** Also arrived when the player is here (the next step's own start, where it differs). */
    nextStart?: Area;
    /** Explicit resume checkpoints; a teleport followed by a run gets one for free. */
    checkpoints?: readonly Checkpoint[];
    /** The next step's own figure counts this travel (the leg replaces that arrival row). */
    countedBy?: string;
    expected: Expected;
}

export type LegOptions = Omit<LegDef, 'id' | 'start' | 'dest' | 'hops'>;

export type LegStep = Step<unknown> & { def: LegDef };

// ------------------------------------------------------------------ checks

export function arrived(def: LegDef, s: BotWorldState): boolean {
    return inArea(s, def.dest) || (!!def.nextStart && inArea(s, def.nextStart));
}

/** Every resume checkpoint of a leg: its explicit ones, plus one after each teleport that a run follows. */
export function checkpoints(def: LegDef): Checkpoint[] {
    const out: Checkpoint[] = [...(def.checkpoints ?? [])];
    def.hops.forEach((h, i) => {
        const next = def.hops[i + 1];
        if (h.kind !== 'teleport' || next?.kind !== 'run' || out.some(c => c.after === i)) return;
        out.push({ after: i, in: [boxAround(SPELLS[h.spell].landing, next.to, 12, next.to.level ?? 0)] });
    });
    return out.sort((a, b) => a.after - b.after);
}

/** The first hop the player is not yet past: one after the latest checkpoint the player stands in, else 0. */
export function resumeHop(def: LegDef, s: BotWorldState): number {
    const cps = checkpoints(def);
    for (let i = cps.length - 1; i >= 0; i--) {
        const c = cps[i]!;
        if (c.in.some(r => inRegion(s, r))) return c.after + 1;
    }
    return 0;
}

export function foodHeld(s: BotWorldState): number {
    return invCount(s, FOOD);
}

/** The leg's preconditions (never its start tile: after a restart a leg runs from wherever the player is). */
export function legPreconditions(def: LegDef, s: BotWorldState): true | string {
    if (!s.inGame || !s.player) return 'not in game';
    if (arrived(def, s)) return true;
    const from = resumeHop(def, s);
    const hops = def.hops.slice(from);
    const need = hopNeeds(hops);
    const magic = skillLevel(s, 'magic');
    if (need.magic > magic) return `${def.id}: Magic ${magic} is below ${need.magic}`;
    const runes = missingRunes(s, need.runes);
    if (runes) return `${def.id}: ${runes}`;
    const first = hops[0];
    const wild = wildernessLevel(pos(s));
    if (first?.kind === 'teleport' && wild > 20) return `${def.id}: Wilderness level ${wild} is above 20 for the ${first.spell} teleport`;
    if (def.food && foodHeld(s) < def.food) return `${def.id}: ${foodHeld(s)} food held, ${def.food} needed`;
    if (need.coins > invCount(s, /^coins$/i)) return `${def.id}: ${need.coins} coins needed for the ship`;
    if (need.knife && !invItem(s, /^knife$/i)) return `${def.id}: a knife is needed for the webs`;
    for (const item of need.items) if (!invItem(s, item)) return `${def.id}: no ${String(item)}`;
    return true;
}

/** logoutSafe is false for legs inside or out of the Wilderness above level 20 (STEP-MANIFEST.md entry 11). */
export function legLogoutSafe(def: LegDef): boolean {
    const places: { x: number; z: number }[] = [def.start, def.dest];
    for (const h of def.hops) {
        if (h.kind === 'run' || h.kind === 'click') places.push(h.to);
        if (h.kind === 'webs') places.push(...h.goals.map(([x, z]) => ({ x, z })));
    }
    return places.every(p => wildernessLevel(p) <= 20);
}

// ------------------------------------------------------------------ the Step

function logTravel(ctx: StepContext<unknown>, name: string, from: number, r: TravelResult): void {
    ctx.log.append({
        v: 1, kind: 'travel', runId: ctx.log.runId, account: ctx.session.name, sessionId: ctx.session.sessionId, step: name,
        startTick: r.startTick, endTick: r.endTick, ticks: r.ticks, wallMs: 0, ok: r.ok, ...(r.reason ? { error: r.reason } : {}),
        meta: { fromHop: from, segments: r.segments, doors: r.doors, clicks: r.clicks, tiles: r.tiles, webTries: r.webTries, ate: r.ate, hpMin: r.hpMin, ...(r.fellBack ? { fellBack: r.fellBack } : {}) },
        tickMs: 0, at: new Date().toISOString(),
    });
}

/** The leg's travel from where the player stands: nothing when arrived, else from the first hop not yet past. */
export async function runLeg(def: LegDef, ctx: Pick<StepContext<unknown>, 'sdk' | 'bot'> & Partial<Pick<StepContext<unknown>, 'log' | 'session'>>, name = def.id): Promise<TravelResult | null> {
    const s = ctx.sdk.getState();
    if (!s || arrived(def, s)) return null;
    const from = resumeHop(def, s);
    const r = await travel(ctx.sdk as unknown as TravelSdk, def.hops, { bot: ctx.bot, from, ...(def.food ? { eat: {} } : {}) });
    if (ctx.log && ctx.session) logTravel(ctx as StepContext<unknown>, name, from, r);
    if (!r.ok) throw new Error(`${def.id}: ${r.reason ?? 'travel failed'} (at ${fmtTile(r.at)})`);
    return r;
}

/** A leg as a Step: `leg(id, from, to, method, opts)`. */
export function leg(id: string, from: Area, to: Area, method: readonly Hop[], opts: LegOptions): LegStep {
    const def: LegDef = { id, start: from, dest: to, hops: method, ...opts };
    const name = `${id} ${opts.method}`;
    const run = async (ctx: StepContext<unknown>) => {
        await runLeg(def, ctx, name);
    };
    return {
        def,
        name,
        preconditions: s => legPreconditions(def, s),
        run,
        resume: run,
        postconditions: s => (arrived(def, s) ? true : `${id}: not within ${def.dest.tol ?? 0} of ${fmtTile(def.dest)} (at ${fmtTile(pos(s))})`),
        logoutSafe: legLogoutSafe(def),
        inProgress: (o: Observed) => resumeHop(def, o.state) > 0 && !arrived(def, o.state),
    };
}

// ------------------------------------------------------------------ the catalogue

const tele = (spell: keyof typeof SPELLS): Hop => ({ kind: 'teleport', spell });
const run = (x: number, z: number, tol = 0, level = 0): Hop => ({ kind: 'run', to: { x, z, tol, level } });
const rt = (id: string) => `run-transitions.md section 2, \`${id}\``;

/** Tiles shared by several legs (run-transitions.md section 2 and run-transitions-legs.ts). */
export const TILES = {
    lumbridgeSpawn: { x: 3222, z: 3222 },
    coop: { x: 3233, z: 3295, tol: 2 },
    /**
     * S03's row start: "open ground beside the coop" (RUN-ORDER.md S03). No module fixes it yet;
     * this tile is the leg's assumption, to be replaced by firemaking.ts's row start.
     */
    firemakingRow: { x: 3240, z: 3296, tol: 0 },
    doric: { x: 2952, z: 3451, tol: 1 },
    airAltar: { x: 2841, z: 4830, tol: 3 },
    taverleyNormals: { x: 2912, z: 3495, tol: 1 },
    taverleyOaks: { x: 2914, z: 3494, tol: 1 },
    taverleyWillows: { x: 2920, z: 3406, tol: 1 },
    edmond: { x: 2568, z: 3334, tol: 1 },
    zooIron: { x: 2604, z: 3235, tol: 2 },
    elkoy: { x: 2504, z: 3191, tol: 1 },
    bolren: { x: 2541, z: 3171 },
    gnomeCourse: { x: 2474, z: 3436, tol: 0 },
    gnomeCourseEnd: { x: 2484, z: 3437 },
    grandTreeDoor: { x: 2465, z: 3489, tol: 2 },
    narnodeRoots: { x: 2464, z: 9897 },
    ladyServil: { x: 2566, z: 3199, tol: 1 },
    lawgof: { x: 2571, z: 3463, tol: 1 },
    wildernessLever: { x: 2562, z: 3311, tol: 1 },
    spiders: { x: 3288, z: 3810, tol: 2 },
    daero: { x: 2484, z: 3486, level: 1 },
    kolodionCellar: { x: 2543, z: 4713, tol: 4 },
    chamberGuardian: { x: 2506, z: 4696 },
    /** S18's knights anchor (thieving.ts `thieving:knights`), so the band does not walk ~15 unpriced tiles from the market. */
    knights: { x: 2670, z: 3305, tol: 3 },
    caroline: { x: 2716, z: 3302, tol: 1 },
    /** Beside the tunnel stairs (2820,3484, a loc): the quest clicks the stairs and the dwarf stops it. */
    fishingContest: { x: 2820, z: 3486, tol: 1 },
    contestDwarf: { x: 2820, z: 3487 },
    barnaby: { x: 2681, z: 3276, tol: 2 },
    natureRuins: { x: 2869, z: 3021, tol: 2 },
    natureAltar: { x: 2400, z: 4835, tol: 3 },
    /** runecraft.dbrow `runecraft_body`: the ruins' altar_coord (3053,3445) and the room's enter_coord. */
    bodyRuins: { x: 3051, z: 3443, tol: 2 },
    bodyAltar: { x: 2523, z: 4838, tol: 3 },
    flySpots: { x: 3241, z: 3248, tol: 0 },
    cook: { x: 3209, z: 3215, tol: 1 },
    rustyAnchor: { x: 3045, z: 3257, tol: 1 },
    kaqemeex: { x: 2924, z: 3486, tol: 1 },
    goblinGenerals: { x: 2957, z: 3511, tol: 1 },
    romeo: { x: 3211, z: 3425, tol: 1 },
    westAnvil: { x: 3188, z: 3426, tol: 1 },
    westBooth: { x: 3185, z: 3436 },
    championsGuild: { x: 3191, z: 3364, tol: 1 },
    elvargExit: { x: 2846, z: 9636 },
    ridgeSouth: { x: 2998, z: 3916, tol: 1 },
    wildernessPipe: { x: 3004, z: 3937, tol: 0 },
} as const satisfies Record<string, Area>;

const T = TILES;
const ARDOUGNE_TO_LEVER: Hop[] = [tele('ardougne'), run(T.wildernessLever.x, T.wildernessLever.z, 1)];
/** Into the Deserted Keep by the lever, out through its north web (3158,3951). */
const LEVER_AND_KEEP_WEB: Hop[] = [{ kind: 'lever', lever: 'ardougne' }, { kind: 'webs', goals: [[3158, 3950], [3158, 3953]] }];
const KEEP: Region = { x: [3140, 3170], z: [3915, 3950] };
const NORTH_OF_KEEP: Region[] = [{ x: [3140, 3175], z: [3951, 3975] }, { x: [3176, 3310], z: [3790, 3990] }];
/** Lawgof or Elvarg's exit to the poison spiders: Ardougne teleport, lever, keep web, run. */
const TO_SPIDERS: Hop[] = [...ARDOUGNE_TO_LEVER, ...LEVER_AND_KEEP_WEB, run(T.spiders.x, T.spiders.z, T.spiders.tol)];
const TO_SPIDERS_CHECKPOINTS: Checkpoint[] = [{ after: 2, in: [KEEP] }, { after: 3, in: NORTH_OF_KEEP }];
const WILD_FOOD = 2;

export const LEGS: readonly LegStep[] = [
    leg('T01-02', T.lumbridgeSpawn, T.coop, [run(T.coop.x, T.coop.z, T.coop.tol)], {
        after: 'S01', before: 'S02', method: 'run to the coop gate',
        expected: { ticks: 50, label: 'm', source: rt('L01') + ': 51, 49, 49', net: 50 },
    }),
    leg('T02-03', T.coop, T.firemakingRow, [run(T.firemakingRow.x, T.firemakingRow.z, T.firemakingRow.tol)], {
        after: 'S02', before: 'S03', method: 'walk to the row beside the coop',
        expected: { ticks: 5, label: 'i', source: 'run-transitions.md section 9: a row at the coop gate', net: 5 },
    }),
    leg('T04-05', T.firemakingRow, T.doric, [tele('falador'), run(T.doric.x, T.doric.z, T.doric.tol)], {
        after: 'S04', before: 'S05', method: 'Falador teleport + run', countedBy: 'S05',
        expected: { ticks: 44, label: 'm', source: rt('L04') + ': 46, 42', net: 1 },
    }),
    leg('T05-06', T.doric, T.airAltar, [tele('falador'), run(2984, 3293, 2), { kind: 'item-on-loc', item: /^air talisman$/i, loc: { id: 2452 }, arrive: T.airAltar, label: 'air talisman on the ruins' }], {
        after: 'S05', before: 'S06', method: 'Falador teleport + run + air talisman on the ruins',
        expected: { ticks: 61, label: 'm', source: rt('L05') + ': 62, 60', net: 61 },
    }),
    leg('T06-07', T.airAltar, T.taverleyNormals, [tele('falador'), run(T.taverleyNormals.x, T.taverleyNormals.z, T.taverleyNormals.tol)], {
        after: 'S06', before: 'S07', method: 'Falador teleport + run',
        expected: { ticks: 74, label: 'm', source: rt('L06') + ': 75, 73', net: 74 },
    }),
    leg('T07a', T.taverleyOaks, T.taverleyWillows, [run(T.taverleyWillows.x, T.taverleyWillows.z, T.taverleyWillows.tol)], {
        after: 'woodcutting:oak-15-73', before: 'woodcutting:willow-73-99', method: 'run, oak tile to willow tile',
        expected: { ticks: 58, label: 'm', source: "run-transitions.md section 10: rs/198's lab, 58, 58 over its 114-tile route (46 i over 88 tiles before)", net: 58 },
    }),
    leg('T07-08', T.taverleyWillows, T.edmond, [tele('camelot'), run(T.edmond.x, T.edmond.z, T.edmond.tol)], {
        after: 'S07', before: 'S08', method: 'Camelot teleport + run', countedBy: 'S08',
        expected: { ticks: 131, label: 'm', source: rt('L07') + ': 134, 128', net: 2 },
    }),
    leg('T08-09', T.edmond, T.zooIron, [tele('ardougne'), run(T.zooIron.x, T.zooIron.z, T.zooIron.tol)], {
        after: 'S08', before: 'S09', method: 'Ardougne teleport + run',
        expected: { ticks: 50, label: 'm', source: rt('L08t') + ': 50, 50', net: 50 },
    }),
    leg('T09-10', T.zooIron, T.elkoy, [run(T.elkoy.x, T.elkoy.z, T.elkoy.tol)], {
        after: 'S09', before: 'S10b', method: 'run the zoo to Elkoy', countedBy: 'S10b',
        expected: { ticks: 55.5, label: 'm', source: rt('L09') + ': 54, 57', net: -47.5 },
    }),
    leg('T10-11', T.bolren, T.gnomeCourse, [{ kind: 'tree', to: 'stronghold' }, run(T.gnomeCourse.x, T.gnomeCourse.z, T.gnomeCourse.tol)], {
        after: 'S10b', before: 'S11a', method: 'village spirit tree to the stronghold + run to the course',
        checkpoints: [{ after: 0, in: [{ x: [2440, 2490], z: [3420, 3460] }] }],
        expected: { ticks: 20, label: 'm', source: rt('L10') + ': 20, 20', net: 20 },
    }),
    leg('T11a', T.gnomeCourseEnd, T.grandTreeDoor, [run(T.grandTreeDoor.x, T.grandTreeDoor.z, T.grandTreeDoor.tol)], {
        after: 'S11a', before: 'S11b', method: 'run, course end to the Grand Tree door', countedBy: 'S11b',
        expected: { ticks: 36, label: 'm', source: rt('L11a') + ': 36, 36; with T10-11, 56 against segment A 47.5', net: -11.5 },
    }),
    leg('T11-12', T.narnodeRoots, T.ladyServil, [tele('ardougne'), run(T.ladyServil.x, T.ladyServil.z, T.ladyServil.tol)], {
        after: 'S11b', before: 'S12', method: 'Ardougne teleport + run', countedBy: 'S12',
        expected: { ticks: 71, label: 'm', source: rt('L11') + ': 71, 71', net: -3 },
    }),
    leg('T12-13', T.ladyServil, T.lawgof, [tele('ardougne'), run(T.lawgof.x, T.lawgof.z, T.lawgof.tol)], {
        after: 'S12', before: 'S13', method: 'Ardougne teleport + run', countedBy: 'S13',
        expected: { ticks: 121, label: 'r', source: 'dwarf_cannon.md: teleport 4 + run 117 (run-transitions.md section 2)', net: 0 },
    }),
    leg('T13-14', T.lawgof, T.spiders, TO_SPIDERS, {
        after: 'S13', before: 'S14', method: 'Ardougne teleport + lever + keep web + run', food: WILD_FOOD, checkpoints: TO_SPIDERS_CHECKPOINTS,
        expected: { ticks: 181.5, label: 'm', source: rt('L13L') + ': 182, 181', net: 181.5 },
    }),
    leg('T14-15', T.spiders, T.grandTreeDoor, [
        { kind: 'run', to: { x: 3288, z: 3660 }, wildernessAtMost: 20 },
        tele('ardougne'),
        run(2555, 3259, 1),
        { kind: 'tree', to: 'village' },
        { kind: 'tree', to: 'stronghold' },
        run(T.grandTreeDoor.x, T.grandTreeDoor.z, T.grandTreeDoor.tol),
    ], {
        after: 'S14', before: 'S15', method: 'run to Wilderness 20 + Ardougne teleport + Khazard young tree + two tree rides + run', food: WILD_FOOD,
        checkpoints: [{ after: 3, in: [{ x: [2525, 2560], z: [3150, 3185] }] }, { after: 4, in: [{ x: [2440, 2490], z: [3420, 3500] }] }],
        expected: { ticks: 173.5, label: 'i', source: 'run-transitions.md section 2: X14n 66 + L14a 105, 102 (4 + 103.5)', net: 173.5 },
    }),
    leg('T15-16', T.daero, T.kolodionCellar, [
        ...ARDOUGNE_TO_LEVER,
        ...LEVER_AND_KEEP_WEB,
        run(3097, 3957, 1),
        { kind: 'webs', goals: [[3094, 3957], [3092, 3957]] },
        { kind: 'loc', loc: { x: 3091, z: 3957, name: /ladder/i }, op: /^climb-down$/i, arrive: T.kolodionCellar, label: 'mage bank ladder down' },
    ], {
        after: 'S15', before: 'S16', method: 'Ardougne teleport + lever + keep webs + ladder to the cellar', food: WILD_FOOD, countedBy: 'S16',
        checkpoints: [{ after: 2, in: [KEEP] }, { after: 3, in: [{ x: [3096, 3175], z: [3951, 3975] }] }, { after: 5, in: [{ x: [3085, 3094], z: [3950, 3965] }] }],
        expected: { ticks: 158, label: 'r', source: 'mage_arena.md "Tick total": 4 + 61 + 15 + 75 + 3 (run-transitions.md section 2)', net: 0 },
    }),
    leg('T16-18', T.chamberGuardian, T.knights, [tele('ardougne'), run(T.knights.x, T.knights.z, T.knights.tol)], {
        after: 'S16', before: 'S18', method: 'Ardougne teleport from the chamber + run to the knights anchor',
        expected: { ticks: 14, label: 'i', source: 'run-transitions.md section 4, `L16B`: 6, 6, 6 to the market (2655,3305), + 8 i for the run on to the anchor (2670,3305) (rs/158, fold-in 23; until measured)', net: 14 },
    }),
    leg('T18-19', T.knights, T.caroline, [run(T.caroline.x, T.caroline.z, T.caroline.tol)], {
        after: 'S18', before: 'S19', method: 'run the market to Caroline', countedBy: 'S19',
        expected: { ticks: 49, label: 'm', source: rt('L18') + ': 49, 49', net: 16 },
    }),
    leg('T19-20', T.caroline, T.fishingContest, [tele('camelot'), run(T.fishingContest.x, T.fishingContest.z, T.fishingContest.tol)], {
        after: 'S19', before: 'S20', method: 'Camelot teleport + run', countedBy: 'S20',
        expected: { ticks: 42, label: 'r', source: 'fishing_contest.md: teleport 4 + run 36-40 (run-transitions.md section 2)', net: 0 },
    }),
    leg('T20-21', T.contestDwarf, T.natureAltar, [
        tele('ardougne'),
        run(T.barnaby.x, T.barnaby.z, T.barnaby.tol),
        { kind: 'ship', route: 'brimhaven' },
        run(T.natureRuins.x, T.natureRuins.z, T.natureRuins.tol),
        { kind: 'item-on-loc', item: /^nature talisman$/i, loc: { id: 2460 }, arrive: T.natureAltar, label: 'nature talisman on the ruins' },
    ], {
        after: 'S20', before: 'S21', method: 'Ardougne teleport + Barnaby to Brimhaven + run + nature talisman',
        checkpoints: [{ after: 2, in: [{ x: [2740, 2890], z: [3000, 3245] }] }],
        expected: { ticks: 161.5, label: 'm', source: 'run-transitions.md section 6, `L20S`: 162, 161', net: 161.5 },
    }),
    leg('T21-22', T.natureAltar, T.flySpots, [tele('lumbridge'), run(T.flySpots.x, T.flySpots.z, T.flySpots.tol)], {
        after: 'S21', before: 'S22', method: 'Lumbridge teleport + run',
        expected: { ticks: 33, label: 'm', source: rt('L21') + ': 32, 34', net: 33 },
    }),
    leg('T22-23', T.flySpots, T.cook, [tele('lumbridge'), run(T.cook.x, T.cook.z, T.cook.tol)], {
        after: 'S22', before: 'S23', method: 'Lumbridge teleport + run', countedBy: 'S23',
        expected: { ticks: 16.3, label: 'm', source: rt('L22t') + ': 20, 15, 14', net: 6.3 },
    }),
    leg('T23-24', T.cook, T.rustyAnchor, [tele('falador'), run(T.rustyAnchor.x, T.rustyAnchor.z, T.rustyAnchor.tol)], {
        after: 'S23', before: 'S24', method: 'Falador teleport + run', countedBy: 'S24',
        expected: { ticks: 90, label: 'm', source: rt('L23f') + ': 90, 90', net: 45 },
    }),
    leg('L24a', T.rustyAnchor, T.kaqemeex, [tele('falador'), run(T.kaqemeex.x, T.kaqemeex.z, T.kaqemeex.tol)], {
        after: 'S24:G2-dye-mail', before: 'S24:D1-kaqemeex-start', method: 'Falador teleport + run to Kaqemeex',
        expected: { ticks: 69, label: 'm', source: rt('L24a') + ': 74, 64', net: 69 },
    }),
    leg('L24b', T.kaqemeex, T.goblinGenerals, [run(T.goblinGenerals.x, T.goblinGenerals.z, T.goblinGenerals.tol)], {
        after: 'S24:D9-kaqemeex-reward', before: 'S24:G3-orange-request', method: 'run Kaqemeex to the generals',
        expected: { ticks: 54, label: 'm', source: rt('L24b') + ': 56, 52', net: 54 },
    }),
    leg('L24c', T.goblinGenerals, T.romeo, [tele('varrock'), run(T.romeo.x, T.romeo.z, T.romeo.tol)], {
        after: 'S24:G6-plain-mail', before: 'S24:R1-juliet', method: 'Varrock teleport + run to Romeo',
        expected: { ticks: 4.5, label: 'm', source: rt('L24c') + ': 5, 4', net: 4.5 },
    }),
    leg('T24-25', T.romeo, T.westAnvil, [run(T.westAnvil.x, T.westAnvil.z, T.westAnvil.tol)], {
        after: 'S24', before: 'S25a', method: 'run Romeo to the west anvil',
        expected: { ticks: 13, label: 'm', source: rt('L24e') + ': 13, 13', net: 13 },
    }),
    leg('T25-26', T.westBooth, T.championsGuild, [run(T.championsGuild.x, T.championsGuild.z, T.championsGuild.tol)], {
        after: 'S25c', before: 'S26', method: "run the booth to the Champions' Guild door", countedBy: 'S26',
        expected: { ticks: 44, label: 'm', source: rt('L25') + ': 39, 49', net: 7 },
    }),
    leg('T26-27', T.elvargExit, T.spiders, TO_SPIDERS, {
        after: 'S26', before: 'S27', method: 'Ardougne teleport + lever + keep web + run', food: WILD_FOOD, checkpoints: TO_SPIDERS_CHECKPOINTS,
        expected: { ticks: 179, label: 'm', source: rt('L26L') + ': 179 (1 run)', net: 179 },
    }),
    leg('T27-17', T.spiders, T.wildernessPipe, [
        run(T.ridgeSouth.x, T.ridgeSouth.z, T.ridgeSouth.tol),
        { kind: 'loc', loc: { id: 2309 }, arrive: { x: [2990, 3010], z: [3929, 3945] }, label: 'ridge gate and ridge' },
        run(T.wildernessPipe.x, T.wildernessPipe.z, T.wildernessPipe.tol),
    ], {
        after: 'S27', before: 'S17', method: 'run to the ridge gate + ridge + run to the pipe', food: WILD_FOOD,
        checkpoints: [{ after: 1, in: [{ x: [2990, 3010], z: [3929, 3945] }] }],
        expected: { ticks: 185.7, label: 'm', source: 'run-transitions.md section 4, `LB`: 185, 186, 186', net: 185.7 },
    }),
];

/**
 * S21's altar (RUN-ORDER.md O7). `LEGS` is section 2 as written, which prices the nature altar by
 * the Brimhaven ship. The plan in force is the body altar (main, 15:17 PDT; 0 nature talismans
 * held): T20-21 becomes a Falador teleport and a run to the ruins south of Edgeville, and T21-22
 * leaves from the body altar room. The ids, steps and destinations S21 and S22 see are unchanged.
 */
export type S21Altar = 'nature' | 'body';

export const BODY_ALTAR_LEGS: readonly LegStep[] = [
    leg('T20-21', T.contestDwarf, T.bodyAltar, [
        tele('falador'),
        run(T.bodyRuins.x, T.bodyRuins.z, T.bodyRuins.tol),
        { kind: 'item-on-loc', item: /^body talisman$/i, loc: { id: 2457 }, arrive: T.bodyAltar, label: 'body talisman on the ruins' },
    ], {
        after: 'S20', before: 'S21', method: 'Falador teleport + run to the body ruins + body talisman',
        expected: { ticks: 69.3, label: 'm', source: 'speedrun/README.md legs table, lab/measure-legs.ts: 72, 67, 69 (teleport 4, ~118 tiles 57-62, talisman 6)', net: 69.3 },
    }),
    leg('T21-22', T.bodyAltar, T.flySpots, [tele('lumbridge'), run(T.flySpots.x, T.flySpots.z, T.flySpots.tol)], {
        after: 'S21', before: 'S22', method: 'Lumbridge teleport from the body altar room + run',
        expected: { ticks: 33, label: 'm', source: rt('L21') + ': 32, 34 (the same teleport and run from the nature room)', net: 33 },
    }),
];

/** The catalogue for one S21 altar: section 2's legs with the altar's own T20-21 and T21-22. */
export function legsFor(o: { s21Altar: S21Altar }): LegStep[] {
    if (o.s21Altar === 'nature') return [...LEGS];
    return LEGS.map(l => BODY_ALTAR_LEGS.find(b => b.def.id === l.def.id) ?? l);
}

export function legById(id: string, catalogue: readonly LegStep[] = LEGS): LegStep {
    const l = catalogue.find(x => x.def.id === id);
    if (!l) throw new Error(`no leg ${id}`);
    return l;
}

/** The legs that follow step `after`, in run order (run.ts interleaves them by id). */
export function legsAfter(after: string, catalogue: readonly LegStep[] = LEGS): LegStep[] {
    return catalogue.filter(l => l.def.after === after);
}

// ------------------------------------------------------------------ splits

/** A standard teleport's cast to landing (run-transitions.md section 2: "teleport 4" in every teleport leg's parts). */
export const TELEPORT_TICKS = 4;

export interface SplitOptions {
    /** Where part a ends and part b starts (default: the landing of hop `afterHop` when it is a teleport). */
    meet?: Area;
    /** Part a's share of the leg's figure (default TELEPORT_TICKS when part a ends with a teleport). */
    firstTicks?: number;
    /** Its source, for part a's `expected.source`. */
    firstSource?: string;
}

const tenth = (n: number) => Math.round(n * 10) / 10;

/**
 * A leg cut in two after hop `afterHop`, so a hand-off can sit between the parts (the Ardougne
 * landing, SUPPLIES' meeting spread 2659-2663, 3299-3303). Part a (`<id>a`) runs hops 0..afterHop
 * and arrives in `meet`; part b (`<id>b`) runs the rest from there. No new travel: each part is an
 * ordinary leg whose checkpoints are the original's, renumbered. `expected` splits in proportion,
 * part a's ticks from `firstTicks`, and the two nets sum to the original's exactly.
 */
export function splitLeg(l: LegStep, afterHop: number, o: SplitOptions = {}): [LegStep, LegStep] {
    const d = l.def;
    if (afterHop < 0 || afterHop >= d.hops.length - 1) throw new Error(`${d.id}: cannot split after hop ${afterHop} of ${d.hops.length}`);
    const cut = d.hops[afterHop]!;
    const meet = o.meet ?? (cut.kind === 'teleport' ? SPELLS[cut.spell].landing : undefined);
    if (!meet) throw new Error(`${d.id}: hop ${afterHop} is not a teleport, so the split needs a meeting area`);
    const firstTicks = o.firstTicks ?? (cut.kind === 'teleport' && afterHop === 0 ? TELEPORT_TICKS : undefined);
    if (firstTicks === undefined) throw new Error(`${d.id}: part a's share of ${d.expected.ticks} ticks must be given (firstTicks)`);
    if (firstTicks <= 0 || firstTicks >= d.expected.ticks) throw new Error(`${d.id}: part a's ${firstTicks} ticks are outside the leg's ${d.expected.ticks}`);
    const share = firstTicks / d.expected.ticks;
    const netA = tenth(d.expected.net * share);
    const cps = d.checkpoints ?? [];
    const a: LegOptions = {
        after: d.after, before: `${d.id}b`, method: `${d.method}, part a (to the landing)`,
        ...(d.food ? { food: d.food } : {}),
        ...(cps.some(c => c.after < afterHop) ? { checkpoints: cps.filter(c => c.after < afterHop) } : {}),
        expected: { ticks: firstTicks, label: d.expected.label, source: o.firstSource ?? `${d.id} split after hop ${afterHop}: ${firstTicks} of ${d.expected.ticks} (${d.expected.source})`, net: netA },
    };
    const rest = cps.filter(c => c.after > afterHop).map(c => ({ after: c.after - afterHop - 1, in: c.in }));
    const b: LegOptions = {
        after: `${d.id}a`, before: d.before, method: `${d.method}, part b (from the landing)`,
        ...(d.food ? { food: d.food } : {}),
        ...(d.nextStart ? { nextStart: d.nextStart } : {}),
        ...(d.countedBy ? { countedBy: d.countedBy } : {}),
        ...(rest.length ? { checkpoints: rest } : {}),
        expected: { ticks: tenth(d.expected.ticks - firstTicks), label: d.expected.label, source: `${d.id} split after hop ${afterHop}: the rest of ${d.expected.ticks} (${d.expected.source})`, net: tenth(d.expected.net - netA) },
    };
    return [leg(`${d.id}a`, d.start, meet, d.hops.slice(0, afterHop + 1), a), leg(`${d.id}b`, meet, d.dest, d.hops.slice(afterHop + 1), b)];
}

/** The step-module convention: every leg, or the ones named. */
export function steps(opts: { ids?: readonly string[]; s21Altar?: S21Altar } = {}): LegStep[] {
    const catalogue = opts.s21Altar ? legsFor({ s21Altar: opts.s21Altar }) : [...LEGS];
    return opts.ids ? opts.ids.map(id => legById(id, catalogue)) : catalogue;
}

/** RUN-ORDER.md section 2's leg total: the sum of every leg's net figure (1,382 for the order). */
export function netTotal(legs: readonly LegStep[] = LEGS): number {
    return Math.round(legs.reduce((a, l) => a + l.def.expected.net, 0) * 10) / 10;
}

/** Measure one leg end to end as a step row (lab acceptance), from the first hop's send to the arrival. */
export async function measureLeg(l: LegStep, ctx: StepContext<unknown>): Promise<{ ticks: number; result: TravelResult | null }> {
    const t0 = currentTick(ctx.sdk);
    const result = await measure(ctx.log, ctx.session, l.name, () => runLeg(l.def, ctx, l.name));
    return { ticks: currentTick(ctx.sdk) - t0, result };
}

export { hopsDestination };
