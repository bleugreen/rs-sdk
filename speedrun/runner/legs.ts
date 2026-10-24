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

import type { BotWorldState, InventoryItem } from '../../sdk/types';
import { dropItems, opLoc, type ActSdk } from '../lib/act';
import { measure } from '../lib/ticks';
import {
    boxAround, EAT_SPACING, eatAt, FOOD, FOOD_HEAL, fmtTile, healHeld, hopNeeds, hopsDestination, HP_FLOOR, inArea, inRegion, missingRunes, POISON_HIT_MAX, SPELLS, travel, wildernessLevel,
    type Area, type Hop, type Region, type TravelOptions, type TravelResult, type TravelSdk,
} from '../lib/travel';
import { currentTick, waitUntil } from '../lib/wait';
import { invCount, invItem, pos, skillLevel, type LocQuery, type OpPattern } from '../lib/world';
import type { Observed, Step, StepContext } from './step';
import { curePoison, type DrinkSdk } from '../quests/segments';
import { DeathWatch } from './death';
import { SETTLE_TICKS, watchStretch, type Stretch, type UpkeepSdk } from './wait-guard';

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
    /**
     * The leg's route passes aggressive NPCs (hostileLeg): it starts at its start floor (startFloor) and
     * eats and cures on every frame of its travel, whatever the hop. Default: a leg with `food`, which
     * the table gives exactly the routes past aggressive NPCs. splitLeg sets it on both parts of such a
     * leg, so a part whose hops never enter the Wilderness (and so needs no food held) still eats a
     * poison carried into it: T14-15b, past the Khazard battlefield.
     */
    hostile?: boolean;
    /** Also arrived when the player is here (the next step's own start, where it differs). */
    nextStart?: Area;
    /** Explicit resume checkpoints; a teleport followed by a run gets one for free. */
    checkpoints?: readonly Checkpoint[];
    /** The next step's own figure counts this travel (the leg replaces that arrival row). */
    countedBy?: string;
    /**
     * What the leg drops: its STEP-MANIFEST ledger row's `drop` outs, by inventory name (legs.test.ts
     * pins each to its row). See dropsDue for when each goes.
     */
    drops?: readonly RegExp[];
    /**
     * Hops that follow this leg's own, whose needs its drops must leave held: splitLeg's part a
     * keeps what part b needs, so the parts drop exactly what the whole leg would.
     */
    keepFor?: readonly Hop[];
    /** Stops made on the way only while they are wanted (LegStop): T14-15's church altar. */
    stops?: readonly LegStop[];
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

/**
 * The first hop the player is not yet past: one after the latest checkpoint the player stands in,
 * else the deep-Wilderness resume (deepWildernessHop), else 0.
 */
export function resumeHop(def: LegDef, s: BotWorldState): number {
    const cps = checkpoints(def);
    for (let i = cps.length - 1; i >= 0; i--) {
        const c = cps[i]!;
        if (c.in.some(r => inRegion(s, r))) return c.after + 1;
    }
    return deepWildernessHop(def, s) ?? 0;
}

/**
 * A player above Wilderness level 20 outside every checkpoint (a drop mid-run between the keep and
 * the spiders, off the checkpoint boxes) cannot restart a leg that opens with a teleport: the spell
 * is refused there. It is past that teleport and the lever, so the leg resumes by walking: at its
 * last run whose target is itself above level 20, the run across the deep Wilderness (rs/511).
 * Null for a leg with no such run, or a player at level 20 or below.
 */
export function deepWildernessHop(def: LegDef, s: BotWorldState): number | null {
    if (def.hops[0]?.kind !== 'teleport' || !s.player || wildernessLevel(pos(s)) <= 20) return null;
    for (let i = def.hops.length - 1; i > 0; i--) {
        const h = def.hops[i]!;
        if (h.kind === 'run' && wildernessLevel(h.to) > 20) return i;
    }
    return null;
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
    const short = startFloorShort(def, s);
    if (short) return short;
    if (need.coins > invCount(s, /^coins$/i)) return `${def.id}: ${need.coins} coins needed for the ship`;
    if (need.knife && !invItem(s, /^knife$/i)) return `${def.id}: a knife is needed for the webs`;
    for (const item of need.items) if (!invItem(s, item)) return `${def.id}: no ${String(item)}`;
    return true;
}

// ------------------------------------------------------------------ drops

/** Inventory actions sent in one tick (measured; rs/158's ruling). A longer burst spans ticks. */
export const DROPS_PER_TICK = 5;
/** Ticks one batch of drops is watched for before what is left is sent again. */
export const DROP_WATCH_TICKS = 3;
/** Batches sent again, beyond the ones the drops need, before the leg gives up. */
export const DROP_RESENDS = 3;

/** Whether a hop in `hops` needs the held item (`name`, obj `id`): a spell's runes, an item used on a loc, the webs' knife, a ship's coins. */
export function neededBy(hops: readonly Hop[], name: string, id?: number): boolean {
    const need = hopNeeds(hops);
    const rune = /^(\w+) rune$/i.exec(name)?.[1]?.toLowerCase();
    if (rune && ((need.runes as Record<string, number | undefined>)[rune] ?? 0) > 0) return true;
    if (need.knife && /^knife$/i.test(name)) return true;
    if (need.coins > 0 && /^coins$/i.test(name)) return true;
    return need.items.some(p => (typeof p === 'number' ? p === id : typeof p === 'string' ? p.toLowerCase() === name.toLowerCase() : p.test(name)));
}

/**
 * The held names `hops` need that drop pattern `p` takes: a spell's runes, the webs' knife, a ship's
 * coins, an item used on a loc (by its name, or a regex's literal `^name$`). Empty when none.
 */
export function dropTakesNeeded(p: RegExp, hops: readonly Hop[]): string[] {
    const need = hopNeeds(hops);
    const runes = Object.entries(need.runes).filter(([, n]) => (n ?? 0) > 0).map(([r]) => `${r[0]!.toUpperCase()}${r.slice(1)} rune`);
    const items = need.items.flatMap(i => (typeof i === 'string' ? [i] : i instanceof RegExp ? (/^\^([\w' ]+)\$$/.exec(i.source)?.slice(1) ?? []) : []));
    const names = [...runes, ...(need.knife ? ['Knife'] : []), ...(need.coins > 0 ? ['Coins'] : []), ...items];
    return names.filter(n => p.test(n));
}

/**
 * The held items `def` drops before hop `at` (at = hops.length: on arrival): those its `drops` name
 * that no hop from `at` on needs. So most go in one burst before the first click, and a rune the
 * leg's own teleport spends goes on the standing tick after the landing, before the next click
 * (an inventory click cancels a walk, so never mid-run). Read from what is held, so a resumed leg
 * drops only what is still there.
 */
export function dropsDue(def: LegDef, s: BotWorldState, at: number): InventoryItem[] {
    if (!def.drops?.length) return [];
    const rest = [...def.hops.slice(at), ...(def.keepFor ?? [])];
    return s.inventory.filter(i => i.count > 0 && def.drops!.some(p => p.test(i.name)) && !neededBy(rest, i.name, i.id));
}

export interface LegDrops {
    /** The hop the drops went before (hops.length: on arrival). */
    at: number;
    ok: boolean;
    dropped: string[];
    ticks: number;
    /** Batches sent, the first sends and any sent again. */
    batches: number;
    reason?: string;
}

const names = (items: readonly InventoryItem[]) => [...new Set(items.map(i => i.name))].join(', ');

/**
 * Drop what is due before hop `at`: DROPS_PER_TICK at a time (act.dropItems), each batch confirmed
 * from state before the next is sent, what a batch left held sent again (a drop from a delayed
 * player is ignored), bounded. Never throws: a failure is the reason, naming what is still held.
 */
export async function dropDue(sdk: ActSdk, def: LegDef, at: number): Promise<LegDrops> {
    const t0 = currentTick(sdk);
    const first = sdk.getState();
    const initial = first ? dropsDue(def, first, at) : [];
    const out: LegDrops = { at, ok: true, dropped: [], ticks: 0, batches: 0 };
    const limit = Math.ceil(initial.length / DROPS_PER_TICK) + DROP_RESENDS;
    for (;;) {
        const s = sdk.getState();
        const due = s ? dropsDue(def, s, at) : [];
        out.ticks = currentTick(sdk) - t0;
        if (!due.length) return out;
        if (out.batches >= limit) return { ...out, ok: false, reason: `${def.id}: still holding ${names(due)} after ${out.batches} drop batches` };
        const batch = due.slice(0, DROPS_PER_TICK);
        const pick = new Set<object>(batch);
        out.batches++;
        try {
            // dropItems reads the same state object, so `pick` finds these very items.
            await dropItems(sdk, i => pick.has(i), DROP_WATCH_TICKS);
        } catch (e) {
            return { ...out, ticks: currentTick(sdk) - t0, ok: false, reason: `${def.id}: dropping ${names(batch)}: ${e instanceof Error ? e.message : String(e)}` };
        }
        const after = sdk.getState();
        out.dropped.push(...batch.filter(b => !after?.inventory.some(i => i.slot === b.slot && i.id === b.id)).map(b => b.name));
    }
}

// ------------------------------------------------------------------ stops

/**
 * A stop on the way, made before hop `before` only while `wanted` holds: walk `hops` (travel, so a
 * closed door on the route is opened), then operate `loc` with `op` until `wanted` no longer holds.
 * When it does not hold at its hop, nothing is sent and the stop costs 0 ticks. The stop is not a
 * hop, so the hop indices and the checkpoints that name them are the same with or without it, and a
 * restart anywhere before its hop asks `wanted` again.
 */
export interface LegStop {
    before: number;
    label: string;
    wanted: (s: BotWorldState) => boolean;
    /** What the stop changes, for the travel row ('Prayer 20 of 99'). */
    reading: (s: BotWorldState) => string;
    hops: readonly Hop[];
    loc: LocQuery;
    op: OpPattern;
}

export interface LegStopRecord {
    /** The hop the stop came before. */
    at: number;
    label: string;
    /** False when it was not wanted: skipped, nothing sent. */
    made: boolean;
    ok: boolean;
    ticks: number;
    before: string;
    after?: string;
    doors?: TravelResult['doors'];
    reason?: string;
}

/** Ticks a stop's op is watched for (act re-sends a dropped click every 6). */
export const STOP_OP_TICKS = 20;

/** Make `stop` before hop `at` if it is wanted. Never throws: a failure is the record's reason. */
export async function makeStop(sdk: TravelSdk, stop: LegStop, at: number, bot?: TravelOptions['bot']): Promise<LegStopRecord> {
    const s0 = sdk.getState();
    const base = { at, label: stop.label, before: s0 ? stop.reading(s0) : 'no state' };
    if (!s0 || !stop.wanted(s0)) return { ...base, made: false, ok: true, ticks: 0 };
    const t0 = currentTick(sdk);
    const end = (ok: boolean, more: Partial<LegStopRecord> = {}): LegStopRecord => {
        const s = sdk.getState();
        return { ...base, made: true, ok, ticks: currentTick(sdk) - t0, ...(s ? { after: stop.reading(s) } : {}), ...more };
    };
    const walk = await travel(sdk, stop.hops, bot ? { bot } : {});
    const doors = walk.doors.length ? { doors: walk.doors } : {};
    if (!walk.ok) return end(false, { ...doors, reason: `${stop.label}: ${walk.reason ?? 'the walk failed'} (at ${fmtTile(walk.at)})` });
    try {
        const r = await opLoc(sdk, stop.loc, stop.op, s => !stop.wanted(s), { maxTicks: STOP_OP_TICKS });
        if (r.ok) return end(true, doors);
        const s = sdk.getState();
        return end(false, { ...doors, reason: `${stop.label}: ${r.loc.name} at ${r.loc.x},${r.loc.z} left ${s ? stop.reading(s) : '?'} after ${STOP_OP_TICKS} ticks` });
    } catch (e) {
        return end(false, { ...doors, reason: `${stop.label}: ${e instanceof Error ? e.message : String(e)}` });
    }
}

/** Prayer points below the Prayer level (`prayers`, as combat.ts reads them). */
export function prayerShort(s: BotWorldState): boolean {
    return (s.prayers?.prayerPoints ?? 0) < (s.prayers?.prayerLevel ?? 0);
}

const prayerReading = (s: BotWorldState) => `Prayer ${s.prayers?.prayerPoints ?? '?'} of ${s.prayers?.prayerLevel ?? '?'}`;

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

/** A hostile leg's cures before its hops (legCure): doses drunk, and the reason of any drink that did not land. */
interface LegCures {
    cured: number;
    failed: string[];
}

function logTravel(ctx: StepContext<unknown>, name: string, from: number, r: TravelResult, drops: readonly LegDrops[], stops: readonly LegStopRecord[], kept: Stretch | null, start: LegStart | null, cures: LegCures): void {
    const ate = r.ate + (kept?.upkeep.eats ?? 0);
    const { cured } = cures;
    ctx.log.append({
        v: 1, kind: 'travel', runId: ctx.log.runId, account: ctx.session.name, sessionId: ctx.session.sessionId, step: name,
        startTick: r.startTick, endTick: r.endTick, ticks: r.ticks, wallMs: 0, ok: r.ok, ...(r.reason ? { error: r.reason } : {}),
        meta: { fromHop: from, segments: r.segments, doors: r.doors, clicks: r.clicks, tiles: r.tiles, webTries: r.webTries, ate, ...(cured ? { cured } : {}), ...(cures.failed.length ? { cureFailed: cures.failed } : {}), hpMin: r.hpMin, ...(start ? { start } : {}), ...(r.fellBack ? { fellBack: r.fellBack } : {}), ...(drops.length ? { drops } : {}), ...(stops.length ? { stops } : {}) },
        tickMs: 0, at: new Date().toISOString(),
    });
}

/**
 * The leg upkeep's dialogue rule: a pack click closes the open chat (OpHeldHandler's
 * clearPendingAction), which would end a spirit tree's or a lever's talk part way, so the eat waits
 * for the chat to close unless hitpoints are at or under this, where the next poison hit could cross
 * HP_FLOOR. The antipoison always waits.
 */
export const LEG_URGENT_HP = HP_FLOOR + POISON_HIT_MAX;

/** Whether `def`'s route passes aggressive NPCs: it starts at the start floor and travels under the leg upkeep. */
export function hostileLeg(def: Pick<LegDef, 'hostile' | 'food'>): boolean {
    return def.hostile ?? !!def.food;
}

/** The ids of `legs` whose routes pass aggressive NPCs (hostileLeg), in table order. */
export function hostileLegIds(legs: readonly LegStep[]): string[] {
    return legs.filter(l => hostileLeg(l.def)).map(l => l.def.id);
}

/**
 * The hitpoints a hostile leg starts its first hop at or above (main, 19:1xZ: rs/764 started T14-15b
 * at 12 of 42 with 7 sharks, ate nothing and died ~6 ticks after a tree ride): the eat line,
 * eatAt(maxHp), so 25 at SCORED's 38-42, and never above the maximum.
 */
export function startFloor(maxHp: number): number {
    return Math.min(maxHp, eatAt(maxHp));
}

/**
 * Why hostile leg `def` cannot start at its floor, or null: hitpoints under startFloor and the food
 * held, all of it eaten, heals short of it (FOOD_HEAL). A state without hitpoints is not judged.
 */
export function startFloorShort(def: LegDef, s: BotWorldState): string | null {
    const p = s.player;
    if (!hostileLeg(def) || !p || typeof p.hp !== 'number' || typeof p.maxHp !== 'number') return null;
    const floor = startFloor(p.maxHp);
    if (p.hp >= floor) return null;
    const heal = healHeld(s);
    if (p.hp + heal >= floor) return null;
    return `${def.id}: ${p.hp} HP, and the ${foodHeld(s)} food held heals ${heal}, short of the leg's start floor of ${floor}`;
}

/** A hostile leg's start under its floor, on the travel row: hitpoints before and after the eating, and its ticks. */
export interface LegStart {
    hp: number;
    floor: number;
    reached: number;
    ticks: number;
}

const MIN_HEAL = Math.min(...Object.values(FOOD_HEAL));

/**
 * A hostile leg's start: hitpoints up to startFloor before the first hop. The leg upkeep `kept` does
 * the eating (it eats at or under eatAt on the frame it starts, then every EAT_SPACING); this waits
 * for the heal to show. An eat holds the player in nothing (consume.rs2 sets only %eat_delay and
 * %action_delay), so one shark costs the tick its heal takes to show, and a start at the floor costs
 * 0 ticks. Refuses, by startFloorShort's reason, when the food held cannot reach the floor.
 */
async function reachFloor(sdk: UpkeepSdk, def: LegDef, kept: Stretch): Promise<LegStart | null> {
    const s = sdk.getState();
    const p = s?.player;
    if (!s || !p || typeof p.hp !== 'number' || typeof p.maxHp !== 'number') return null;
    const floor = startFloor(p.maxHp);
    if (p.hp >= floor) return null;
    const short = startFloorShort(def, s);
    if (short) throw new Error(short);
    const maxTicks = EAT_SPACING * Math.ceil((floor - p.hp) / MIN_HEAL) + SETTLE_TICKS;
    const w = await waitUntil(sdk, st => !!kept.death() || (st.player?.hp ?? 0) >= floor, { maxTicks });
    const end = sdk.getState() ?? s;
    const reached = end.player?.hp ?? 0;
    if (!kept.death() && !w.ok && reached < floor) throw new Error(`${def.id}: ${reached} HP after ${end.tick - s.tick} ticks of eating from ${p.hp}, under the leg's start floor of ${floor}`);
    return { hp: p.hp, floor, reached, ticks: end.tick - s.tick };
}

/**
 * The eating over a leg's whole travel: runner/wait-guard.ts's WaitUpkeep on every published frame,
 * so on every hop alike (a run, a teleport's cast and landing, a spirit tree's walk and talk, a door,
 * a stop), not only on a run hop's own ticks. It eats by the run's eat rule (lib/travel.ts eatDue: at
 * or under eatAt(maxHp), 25 at SCORED's maximum here), never while a trade is open. It drinks nothing:
 * a potion's p_delay drops the click a hop sends inside it, so the leg cures between hops (legCure).
 * Its death watch has no session: runLeg's own DeathWatch records a death on the leg.
 */
export function legStretch(sdk: UpkeepSdk, def: LegDef): Stretch {
    return watchStretch({ sdk }, `on ${def.id}`, { holdInDialog: true, urgentHp: LEG_URGENT_HP, cure: null });
}

/**
 * A hostile leg's cure before hop `at`: quests/segments.ts curePoison, one dose when SCORED reads
 * poisoned (a carried poison by its hitmark), confirmed, and its drink delay waited out before the
 * hop's first click. A drink that does not land is recorded, not fatal: the eating holds the floor.
 */
async function legCure(sdk: DrinkSdk, def: LegDef, at: number, cures: LegCures): Promise<void> {
    try {
        if ((await curePoison(sdk, `${def.id} before hop ${at}`)) === 'cured') cures.cured++;
    } catch (e) {
        cures.failed.push(e instanceof Error ? e.message : String(e));
    }
}

/** What an antipoison's last dose leaves in its slot (potions.obj next_obj_stage: vials.obj `vial_empty`). */
const VIAL = /^vial$/i;

/**
 * The vials the leg's own cure emptied, dropped at the leg's end so the pack leaves the leg as the slot
 * ledger has it (rs/185: S15:A runs at 27 of 28 slots, so one stray vial is attempt 4's willow log
 * again). A vial in a slot that held one before the leg is not the cure's, and is kept.
 */
async function dropEmptied(sdk: ActSdk, def: LegDef, before: ReadonlySet<number>): Promise<string | null> {
    try {
        const r = await dropItems(sdk, i => VIAL.test(i.name) && !before.has((i as InventoryItem).slot), DROP_WATCH_TICKS);
        return r.ok ? null : `${def.id}: the emptied vial is still held after ${r.ticks} ticks`;
    } catch (e) {
        return `${def.id}: dropping the emptied vial: ${e instanceof Error ? e.message : String(e)}`;
    }
}

/** The leg's travel from where the player stands: nothing when arrived, else from the first hop not yet past. */
export async function runLeg(def: LegDef, ctx: Pick<StepContext<unknown>, 'sdk' | 'bot'> & Partial<Pick<StepContext<unknown>, 'log' | 'session'>>, name = def.id): Promise<TravelResult | null> {
    const s = ctx.sdk.getState();
    if (!s) return null;
    const drops: LegDrops[] = [];
    const dropAt = async (at: number): Promise<string | null> => {
        const d = await dropDue(ctx.sdk as unknown as ActSdk, def, at);
        if (d.batches) drops.push(d);
        return d.ok ? null : d.reason!;
    };
    if (arrived(def, s)) {
        // Arrived (a resume), with whatever the leg drops still held: drop it, nothing else.
        const why = await dropAt(def.hops.length);
        if (why) throw new Error(why);
        return null;
    }
    const stops: LegStopRecord[] = [];
    const stopAt = async (at: number): Promise<string | null> => {
        for (const st of def.stops ?? []) {
            if (st.before !== at) continue;
            const rec = await makeStop(ctx.sdk as unknown as TravelSdk, st, at, ctx.bot);
            stops.push(rec);
            if (!rec.ok) return rec.reason!;
        }
        return null;
    };
    const hostile = hostileLeg(def);
    const cures: LegCures = { cured: 0, failed: [] };
    const beforeHop = async (at: number): Promise<string | null> => {
        if (hostile) await legCure(ctx.sdk as unknown as DrinkSdk, def, at, cures);
        return (def.drops?.length ? await dropAt(at) : null) ?? (await stopAt(at));
    };
    const from = resumeHop(def, s);
    // A relocation travel sees fails the hop only as a death the watch corroborates; any other jump re-paths as before.
    const watch = new DeathWatch(s, `on ${def.id}`);
    const unwatch = ctx.sdk.onStateUpdate(st => watch.see(st));
    const onRelocated: TravelOptions['onRelocated'] = rel => (rel.respawn && watch.death() ? 'fail' : 'repath');
    const vials = new Set(s.inventory.filter(i => VIAL.test(i.name)).map(i => i.slot));
    const kept = hostile ? legStretch(ctx.sdk as unknown as UpkeepSdk, def) : null;
    const done = () => {
        unwatch();
        kept?.stop();
    };
    let start: LegStart | null = null;
    try {
        if (kept) start = await reachFloor(ctx.sdk as unknown as UpkeepSdk, def, kept);
    } catch (e) {
        done();
        throw e;
    }
    const early = watch.death();
    if (early) {
        done();
        if (ctx.session) ctx.session.died ??= early;
        throw new Error(`${def.id}: ${early.reason}`);
    }
    const r = await travel(ctx.sdk as unknown as TravelSdk, def.hops, { bot: ctx.bot, from, onRelocated, ...(hostile || def.drops?.length || def.stops?.length ? { beforeHop } : {}) }).finally(done);
    const death = watch.death();
    if (death && ctx.session) ctx.session.died ??= death;
    const emptied = r.ok && !death && cures.cured ? await dropEmptied(ctx.sdk as unknown as ActSdk, def, vials) : null;
    const why = emptied ?? (r.ok && !death ? await dropAt(def.hops.length) : null);
    if (ctx.log && ctx.session) logTravel(ctx as StepContext<unknown>, name, from, r, drops, stops, kept, start, cures);
    if (death) throw new Error(`${def.id}: ${death.reason}`);
    // Drops refused before a hop stop the trip; their reason (naming what is held) is the leg's.
    const refused = drops.find(d => !d.ok);
    if (refused) throw new Error(refused.reason!);
    const failed = stops.find(st => !st.ok);
    if (failed) throw new Error(`${def.id}: ${failed.reason!}`);
    if (!r.ok) throw new Error(`${def.id}: ${r.reason ?? 'travel failed'} (at ${fmtTile(r.at)})`);
    if (why) throw new Error(why);
    return r;
}

/** A leg as a Step: `leg(id, from, to, method, opts)`. */
export function leg(id: string, from: Area, to: Area, method: readonly Hop[], opts: LegOptions): LegStep {
    for (const st of opts.stops ?? []) if (st.before < 0 || st.before >= method.length) throw new Error(`${id}: stop '${st.label}' comes before hop ${st.before} of ${method.length}`);
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
        postconditions: s => {
            if (!arrived(def, s)) return `${id}: not within ${def.dest.tol ?? 0} of ${fmtTile(def.dest)} (at ${fmtTile(pos(s))})`;
            const held = dropsDue(def, s, def.hops.length);
            return held.length ? `${id}: still holding ${names(held)}, which the leg drops` : true;
        },
        logoutSafe: legLogoutSafe(def),
        inProgress: (o: Observed) => resumeHop(def, o.state) > 0 && !arrived(def, o.state),
        watchesDeath: true,
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
     * S03's row entry: the first planned tile of the measured Lumbridge castle lap
     * (docs/speedrun/rehearsals/firemaking.md, `3222-3218@3219;3218-3243@3218;3242-3223@3219`, the
     * run config's firemakingTiles). firemaking.ts lights its first log here and walks here itself
     * before the first fire when more than a tile off, so the leg ends on it.
     */
    firemakingRow: { x: 3222, z: 3219, tol: 0 },
    /**
     * Where S03 leaves SCORED, so where S04 casts and its ring givers stand beside it. The 157 logs
     * (firemaking.ts routeLogs, 1 to 99) are lit in planned order on the 51-tile lap; a lap takes 204
     * ticks and a fire burns 100-199, so no lap skips a tile, and the 157th is tile 156 mod 51 = 3,
     * (3219,3219). Its success pushes the player west first (firemaking.rs2: west, east, south,
     * north; a fire is blockwalk=no), onto (3218,3219).
     */
    s03End: { x: 3218, z: 3219 },
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
    // Two rows north of the door (3191,3363): mule1's H22 trade refuses a partner on a door's neighbour.
    championsGuild: { x: 3191, z: 3365, tol: 0 },
    elvargExit: { x: 2846, z: 9636 },
    ridgeSouth: { x: 2998, z: 3916, tol: 1 },
    wildernessPipe: { x: 3004, z: 3937, tol: 0 },
    /** The East Ardougne church altar's south face, at the head of the aisle (CHURCH_ALTAR). */
    churchAltar: { x: 2617, z: 3308, tol: 1 },
    khazardTree: { x: 2555, z: 3259, tol: 1 },
} as const satisfies Record<string, Area>;

const T = TILES;

/**
 * The East Ardougne church altar, loc 409 `altar` at (2617,3309), 2x1 (skill_prayer/configs/altars.loc:
 * op1 Pray-at, category prayer_altar; server/content/maps/m40_51.jm2 `0 57 45: 409 10`). Its oploc1
 * (skill_prayer/scripts/altar.rs2) sets Prayer points to the level in the click's tick with no delay,
 * and at full points only says so. The nave (2613-2621, 3304-3310) is entered by the open doorway in
 * its south wall at x 2615-2616 (timber pillars, no door loc); its aisle (2617-2618, 3304-3308) ends
 * at the altar's south face. The doors 1530 and 1533 are the west vestries' and off the way.
 */
export const CHURCH_ALTAR: Omit<LegStop, 'before'> = {
    label: 'East Ardougne church altar',
    wanted: prayerShort,
    reading: prayerReading,
    hops: [run(T.churchAltar.x, T.churchAltar.z, T.churchAltar.tol)],
    loc: { id: 409, x: 2617, z: 3309 },
    op: /^pray-at$/i,
};
const ARDOUGNE_TO_LEVER: Hop[] = [tele('ardougne'), run(T.wildernessLever.x, T.wildernessLever.z, 1)];
/** Into the Deserted Keep by the lever, out through its north web (3158,3951). */
const LEVER_AND_KEEP_WEB: Hop[] = [{ kind: 'lever', lever: 'ardougne' }, { kind: 'webs', goals: [[3158, 3950], [3158, 3953]] }];
const KEEP: Region = { x: [3140, 3170], z: [3915, 3950] };
const NORTH_OF_KEEP: Region[] = [{ x: [3140, 3175], z: [3951, 3975] }, { x: [3176, 3310], z: [3790, 3990] }];
/** Lawgof or Elvarg's exit to the poison spiders: Ardougne teleport, lever, keep web, run. */
const TO_SPIDERS: Hop[] = [...ARDOUGNE_TO_LEVER, ...LEVER_AND_KEEP_WEB, run(T.spiders.x, T.spiders.z, T.spiders.tol)];
const TO_SPIDERS_CHECKPOINTS: Checkpoint[] = [{ after: 2, in: [KEEP] }, { after: 3, in: NORTH_OF_KEEP }];
const WILD_FOOD = 2;
/**
 * T14-15's first hop, the leg out of S14: south from the spiders down the Wilderness toward the
 * ditch, to level 20 for the Ardougne teleport. The cannon steps' retreat runs it too, stopping
 * where the spiders' reach ends (skills/ranged.ts spiderRetreat).
 */
export const SPIDERS_SOUTH: Hop = { kind: 'run', to: { x: 3288, z: 3660 }, wildernessAtMost: 20 };

export const LEGS: readonly LegStep[] = [
    leg('T01-02', T.lumbridgeSpawn, T.coop, [run(T.coop.x, T.coop.z, T.coop.tol)], {
        after: 'S01', before: 'S02', method: 'run to the coop gate',
        // The starter junk, and the body and water runes (the staff of water covers water).
        drops: [
            /^bronze axe$/i, /^small fishing net$/i, /^shrimps$/i, /^bucket$/i, /^pot$/i, /^bread$/i, /^bronze pickaxe$/i,
            /^bronze dagger$/i, /^bronze sword$/i, /^wooden shield$/i, /^shortbow$/i, /^bronze arrow$/i, /^body rune$/i, /^water rune$/i,
        ],
        expected: { ticks: 50, label: 'm', source: rt('L01') + ': 51, 49, 49', net: 50 },
    }),
    leg('T02-03', T.coop, T.firemakingRow, [run(T.firemakingRow.x, T.firemakingRow.z, T.firemakingRow.tol)], {
        after: 'S02', before: 'S03', method: 'run to the castle row entry',
        expected: { ticks: 48, label: 'm', source: "rs/496's live twin walk from (3240,3296), the old row placeholder by the coop, to (3222,3219): 48; 1-2 more from the coop", net: 48 },
    }),
    leg('T04-05', T.s03End, T.doric, [tele('falador'), run(T.doric.x, T.doric.z, T.doric.tol)], {
        after: 'S04', before: 'S05', method: 'Falador teleport + run', countedBy: 'S05',
        // S03's tinderbox and S04's leftover earth runes (S06's slot rule).
        drops: [/^tinderbox$/i, /^earth rune$/i],
        expected: { ticks: 44, label: 'm', source: rt('L04') + ': 46, 42', net: 1 },
    }),
    leg('T05-06', T.doric, T.airAltar, [tele('falador'), run(2984, 3293, 2), { kind: 'item-on-loc', item: /^air talisman$/i, loc: { id: 2452 }, arrive: T.airAltar, label: 'air talisman on the ruins' }], {
        after: 'S05', before: 'S06', method: 'Falador teleport + run + air talisman on the ruins',
        expected: { ticks: 61, label: 'm', source: rt('L05') + ': 62, 60', net: 61 },
    }),
    leg('T06-07', T.airAltar, T.taverleyNormals, [tele('falador'), run(T.taverleyNormals.x, T.taverleyNormals.z, T.taverleyNormals.tol)], {
        after: 'S06', before: 'S07', method: 'Falador teleport + run',
        // S06's air runes, after the Falador teleport has spent its 3.
        drops: [/^air rune$/i],
        expected: { ticks: 74, label: 'm', source: rt('L06') + ': 75, 73', net: 74 },
    }),
    leg('T07a', T.taverleyOaks, T.taverleyWillows, [run(T.taverleyWillows.x, T.taverleyWillows.z, T.taverleyWillows.tol)], {
        after: 'woodcutting:oak-15-73', before: 'woodcutting:willow-73-99', method: 'run, oak tile to willow tile',
        expected: { ticks: 58, label: 'm', source: "run-transitions.md section 10: rs/198's lab, 58, 58 over its 114-tile route (46 i over 88 tiles before)", net: 58 },
    }),
    leg('T07-08', T.taverleyWillows, T.edmond, [tele('camelot'), run(T.edmond.x, T.edmond.z, T.edmond.tol)], {
        after: 'S07', before: 'S08', method: 'Camelot teleport + run', countedBy: 'S08',
        // The last load's unburied bones: S07 closes by count at Prayer 99 before burying them, and
        // H6's trade needs their slots. Dragon, babydragon or any other; never the Camelot runes.
        // And the willow band's kept log: S09's knife-mine takes a normal log only (H4p brings two).
        drops: [/bones$/i, /^willow logs$/i],
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
        // The Grand Tree's leftovers (5: one tick of drops).
        drops: [/^translation book$/i, /^hazelmere's scroll$/i, /^glough's journal$/i, /^lumber order$/i, /^glough's key$/i],
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
        SPIDERS_SOUTH,
        tele('ardougne'),
        run(T.khazardTree.x, T.khazardTree.z, T.khazardTree.tol),
        { kind: 'tree', to: 'village' },
        { kind: 'tree', to: 'stronghold' },
        run(T.grandTreeDoor.x, T.grandTreeDoor.z, T.grandTreeDoor.tol),
    ], {
        after: 'S14', before: 'S15', method: 'run to Wilderness 20 + Ardougne teleport + the church altar when Prayer is short + Khazard young tree + two tree rides + run', food: WILD_FOOD,
        // Monkey Madness's protect stretches start from full points (rs/687's budget; main's R2).
        stops: [{ ...CHURCH_ALTAR, before: 2 }],
        checkpoints: [{ after: 3, in: [{ x: [2525, 2560], z: [3150, 3185] }] }, { after: 4, in: [{ x: [2440, 2490], z: [3420, 3500] }] }],
        // Prayer is short here on the run (S10b-S12's protect fights), so the figure is the drained one.
        expected: { ticks: 185, label: 'm', source: "rs/689's leg lab (bgsrv-mac, lite, 400 ms, n = 1): drained to 20 of 99, 185 (the altar stop 30, then 44 to the Khazard tree); full, 175 (skipped, 65 to the tree); the altar +10", net: 185 },
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
        // S22's kit, its knife included: H23 hands a fresh knife back for T26-27's keep web (rs/158).
        // Then the fly band's leftovers, which S25d's whole-pack need refuses (rs/764 F12): the shafts
        // its knife loop fletches from the logs, and the catch still waiting for its drop when the
        // band stops, trout or salmon. Each is `any` on the ledger row: nothing sent when none is held.
        drops: [/^fly fishing rod$/i, /^logs$/i, /^feather$/i, /^knife$/i, /^arrow shaft$/i, /^raw (trout|salmon)$/i],
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
        drops: [/^hammer$/i],
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
        // The surplus runes once the teleport has spent its own (S21 starts holding only the talisman),
        // and Fishing Contest's rod. The talisman is runecraft.ts's to drop, on entry, as at S06.
        drops: [/^law rune$/i, /^air rune$/i, /^water rune$/i, /^fishing rod$/i],
        expected: { ticks: 69.3, label: 'm', source: 'speedrun/README.md legs table, lab/measure-legs.ts: 72, 67, 69 (teleport 4, ~118 tiles 57-62, talisman 6)', net: 69.3 },
    }),
    leg('T21-22', T.bodyAltar, T.flySpots, [tele('lumbridge'), run(T.flySpots.x, T.flySpots.z, T.flySpots.tol)], {
        after: 'S21', before: 'S22', method: 'Lumbridge teleport from the body altar room + run',
        // S21's product.
        drops: [/^body rune$/i],
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

/** Whether `hops`, ending at `dest`, go into the Wilderness: a lever, or a tile they name (a run's, a click's, a web's, the end) above level 0. */
export function entersWilderness(hops: readonly Hop[], dest: Area): boolean {
    if (wildernessLevel(dest) > 0) return true;
    return hops.some(h =>
        h.kind === 'lever'
        || ((h.kind === 'run' || h.kind === 'click') && wildernessLevel(h.to) > 0)
        || (h.kind === 'webs' && h.goals.some(([x, z]) => wildernessLevel({ x, z }) > 0)));
}

/**
 * A leg cut in two after hop `afterHop`, so a hand-off can sit between the parts (the Ardougne
 * landing, SUPPLIES' meeting spread 2659-2663, 3299-3303). Part a (`<id>a`) runs hops 0..afterHop
 * and arrives in `meet`; part b (`<id>b`) runs the rest from there. No new travel: each part is an
 * ordinary leg whose checkpoints are the original's, renumbered. `expected` splits in proportion,
 * part a's ticks from `firstTicks`, and the two nets sum to the original's exactly. The food check
 * goes only to a part that enters the Wilderness (entersWilderness): a teleport to the landing
 * needs none, and the hand-off between the parts may be what brings the food.
 *
 * Part a makes the whole leg's drops, keeping what part b's hops need (keepFor), and part b makes
 * none, so nothing the hand-off between the parts brings is dropped. A drop that part b's hops
 * need would then never be made by either part, so that split is refused.
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
    const hopsA = d.hops.slice(0, afterHop + 1);
    const hopsB = d.hops.slice(afterHop + 1);
    const late = (d.drops ?? []).flatMap(p => dropTakesNeeded(p, hopsB).map(n => `${p} takes the ${n} part b needs`));
    if (late.length) throw new Error(`${d.id}: cannot split after hop ${afterHop}: ${late.join('; ')}`);
    // A stop before part b's first hop is made in part b, after whatever hand-off sits between.
    const stopsA = (d.stops ?? []).filter(st => st.before <= afterHop);
    const stopsB = (d.stops ?? []).filter(st => st.before > afterHop).map(st => ({ ...st, before: st.before - afterHop - 1 }));
    // The food check goes only to a part that enters the Wilderness; hostility (the floor and the upkeep) to both.
    const upkeep = hostileLeg(d) ? { hostile: true } : {};
    const a: LegOptions = {
        after: d.after, before: `${d.id}b`, method: `${d.method}, part a (to the landing)`,
        ...(d.food && entersWilderness(hopsA, meet) ? { food: d.food } : {}),
        ...upkeep,
        ...(d.drops?.length ? { drops: d.drops, keepFor: [...hopsB, ...(d.keepFor ?? [])] } : {}),
        ...(stopsA.length ? { stops: stopsA } : {}),
        ...(cps.some(c => c.after < afterHop) ? { checkpoints: cps.filter(c => c.after < afterHop) } : {}),
        expected: { ticks: firstTicks, label: d.expected.label, source: o.firstSource ?? `${d.id} split after hop ${afterHop}: ${firstTicks} of ${d.expected.ticks} (${d.expected.source})`, net: netA },
    };
    const rest = cps.filter(c => c.after > afterHop).map(c => ({ after: c.after - afterHop - 1, in: c.in }));
    const b: LegOptions = {
        after: `${d.id}a`, before: d.before, method: `${d.method}, part b (from the landing)`,
        ...(d.food && entersWilderness(hopsB, d.dest) ? { food: d.food } : {}),
        ...upkeep,
        ...(d.nextStart ? { nextStart: d.nextStart } : {}),
        ...(d.countedBy ? { countedBy: d.countedBy } : {}),
        ...(d.keepFor?.length ? { keepFor: d.keepFor } : {}),
        ...(stopsB.length ? { stops: stopsB } : {}),
        ...(rest.length ? { checkpoints: rest } : {}),
        expected: { ticks: tenth(d.expected.ticks - firstTicks), label: d.expected.label, source: `${d.id} split after hop ${afterHop}: the rest of ${d.expected.ticks} (${d.expected.source})`, net: tenth(d.expected.net - netA) },
    };
    return [leg(`${d.id}a`, d.start, meet, hopsA, a), leg(`${d.id}b`, meet, d.dest, hopsB, b)];
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
