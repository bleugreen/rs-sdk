// The quest step modules' shared scaffold: a quest's segment table in, the
// runner's Steps out (runner/step.ts), named and shaped the way the run chain
// and the resume walk expect. The quest modules own their logic; this file
// owns only the naming, the defaults, the shared options and the kit hand-off.
//
// Module convention (rs/185's shared brief):
//
//   export const quest: QuestKey;
//   export const stepId = 'S15';
//   export interface Options extends QuestOptions { ...the entry's parameters }
//   export function steps(opts?: Options): Step<any>[] {
//       return questSteps(stepId, [kitSegment(opts, KIT, { preconditions }), { letter: 'B', ... }]);
//   }
//
// Names are `<stepId>:<letter>-<label>` (S15:A-narnode): run.ts keys on the
// step id, and `runSteps({from})` starts at any segment by its full name.

import type { BotSDK } from '../../sdk/index';
import type { BotWorldState, InventoryItem } from '../../sdk/types';
import type { QuestKey, StageName } from '../data/quest-stages';
import { prayerDoses } from '../lib/combat';
import type { ConverseOptions } from '../lib/converse';
import { matchesItem, type ItemPattern } from '../lib/items';
import { requireQuestStage, type QuestView } from '../lib/quests';
import { receiveFrom, type WantSpec } from '../lib/trade';
import { FOOD } from '../lib/travel';
import { waitUntil, type StateSource } from '../lib/wait';
import type { Check, Observed, ObservedCheck, Step, StepContext } from '../runner/step';

export type DialogueMode = 'burst' | 'fixed';

/**
 * The run takes the fast path: known continue runs are burst, and a burst that
 * does not land falls back to a page per tick by itself (lib/converse.ts).
 */
export const DEFAULT_DIALOGUE: DialogueMode = 'burst';

/** Options every quest module's `Options` extends. */
export interface QuestOptions {
    /** 'burst' clears known continue runs in blind bursts; 'fixed' answers a page per tick. Default DEFAULT_DIALOGUE. */
    dialogue?: DialogueMode;
    /** The helper who hands over the kit in the first segment. Without one, that segment only checks the inventory. */
    kitFrom?: string;
}

/** Converse options for a conversation of this shape (CONVENTIONS.md notation), bursting when the module runs in burst mode. */
export function talkShape(opts: QuestOptions | undefined, shape: string): Pick<ConverseOptions, 'shape' | 'burst'> {
    return { shape, burst: (opts?.dialogue ?? DEFAULT_DIALOGUE) === 'burst' };
}

/** One segment of a quest: a Step without its name, plus the letter and label the name is built from. */
export interface Segment<C = any> {
    /** The segment letter, as in the lab script's STARTS table: A, B, ... (a digit may follow: H2). */
    letter: string;
    /** Short kebab-case label: narnode, glough-chest. */
    label: string;
    /** As the manifest entry's logout-unsafe stretches say. */
    logoutSafe: boolean;
    /** Default: none. The first segment's are the entry's preconditions (levels, inventory, quest stages, arrival tile). */
    preconditions?: Check<C>;
    run(ctx: StepContext<C>): Promise<void>;
    /** Default: none. The last segment's are the entry's postconditions. */
    postconditions?: Check<C>;
    /** A durable mark (quest stage, items held for good, xp); omit on pure travel. Judge position by coordinates, never by nearby locs or NPCs. */
    done?: ObservedCheck<C>;
    inProgress?: ObservedCheck<C>;
    resume?(ctx: StepContext<C>): Promise<void>;
    probes?: readonly string[];
    /** Its run picks up a fight already on (runner/step.ts Step.startsInCombat). */
    startsInCombat?: true;
    /**
     * `done` also holds once the attempt's step record has this segment (`recorded`). Only for a milestone
     * the game keeps no mark of after the step; `done` stays the live check, the only evidence during the
     * step and outside a run. A clause that must still hold on top of the record is written out with
     * `recorded` in `done` instead.
     */
    recorded?: true;
}

const LETTER = /^[A-Z][0-9]?$/;
const LABEL = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function segmentName(stepId: string, letter: string, label: string): string {
    return `${stepId}:${letter}-${label}`;
}

/**
 * Whether the attempt's step record has `stepName`: runner/step.ts `Observed.record`, which runSteps marks
 * when a step's postconditions pass (fresh and resume paths alike), keyed by the attempt and kept on disk
 * so a resumed process sees an earlier one's marks. Absent outside a run (unit tests, lab stand-ins): false.
 * Prefer a game fact (a quest stage, items kept, a level) wherever one exists.
 */
export function recorded(o: Observed, stepName: string): boolean {
    return !!o.record?.has(stepName);
}

const pass = () => true as const;

/**
 * The segment table as runner Steps, in order. Throws on a bad step id,
 * letter or label, or on a repeated letter or name.
 */
export function questSteps<C = any>(stepId: string, segments: readonly Segment<C>[]): Step<C>[] {
    if (!/^[A-Za-z0-9]+$/.test(stepId)) throw new Error(`questSteps: bad step id "${stepId}" (RUN-ORDER.md ids look like S15 or S11b)`);
    if (!segments.length) throw new Error(`questSteps: ${stepId} has no segments`);
    const seen = new Set<string>();
    return segments.map(seg => {
        if (!LETTER.test(seg.letter)) throw new Error(`questSteps: ${stepId} has a bad segment letter "${seg.letter}"`);
        if (!LABEL.test(seg.label)) throw new Error(`questSteps: ${stepId}:${seg.letter} has a bad label "${seg.label}" (kebab-case)`);
        if (seen.has(seg.letter)) throw new Error(`questSteps: ${stepId} repeats segment ${seg.letter}`);
        seen.add(seg.letter);
        const name = segmentName(stepId, seg.letter, seg.label);
        if (seg.recorded && !seg.done) throw new Error(`questSteps: ${name} is recorded but has no done`);
        const step: Step<C> = {
            name,
            logoutSafe: seg.logoutSafe,
            preconditions: seg.preconditions ?? pass,
            run: ctx => seg.run(ctx),
            postconditions: seg.postconditions ?? pass,
        };
        if (seg.done) {
            const live = seg.done;
            step.done = seg.recorded ? (o, c) => live(o, c) || recorded(o, name) : live;
        }
        if (seg.inProgress) step.inProgress = seg.inProgress;
        if (seg.resume) step.resume = ctx => seg.resume!(ctx);
        if (seg.probes) step.probes = seg.probes;
        if (seg.startsInCombat) step.startsInCombat = true;
        return step;
    });
}

// ---------------------------------------------------------------- checks

/** Every check in turn; the first failure's message. Undefined entries are skipped. */
export function allOf<C = any>(...checks: ReadonlyArray<Check<C> | undefined>): Check<C> {
    return (s, c) => {
        for (const check of checks) {
            const r = check?.(s, c);
            if (r !== undefined && r !== true) return r;
        }
        return true;
    };
}

/** The quest at `stage` or later. */
export function stageAtLeast<K extends QuestKey>(key: K, stage: StageName<K>): Check<any> {
    return s => requireQuestStage(s, key, stage, { atLeast: true });
}

/** A `done` for a segment whose mark is a quest stage (or any later one). */
export function stageDone<K extends QuestKey>(key: K, stage: StageName<K>): ObservedCheck<any> {
    return (o: QuestView) => requireQuestStage(o, key, stage, { atLeast: true }) === true;
}

/** Base levels at least these (skill names as the client publishes them, case-insensitive). */
export function baseLevels(min: Readonly<Record<string, number>>): Check<any> {
    return s => {
        const low = Object.entries(min)
            .map(([skill, lvl]) => [skill, lvl, s.skills.find(k => k.name.toLowerCase() === skill.toLowerCase())?.baseLevel ?? 0] as const)
            .filter(([, lvl, have]) => have < lvl);
        return low.length ? `base levels short: ${low.map(([k, lvl, have]) => `${k} ${have}/${lvl}`).join(', ')}` : true;
    };
}

/** A rectangle of tiles on one level (inclusive), for position checks by coordinates. */
export interface Box {
    x0: number;
    z0: number;
    x1: number;
    z1: number;
    level?: number;
}

export function inBox(s: BotWorldState, b: Box): boolean {
    const p = s.player;
    if (!p) return false;
    return p.worldX >= Math.min(b.x0, b.x1) && p.worldX <= Math.max(b.x0, b.x1) && p.worldZ >= Math.min(b.z0, b.z1) && p.worldZ <= Math.max(b.z0, b.z1) && p.level === (b.level ?? 0);
}

/** The player inside `b`, judged by coordinates (never by nearby locs or NPCs: after a reconnect the first state has none). */
export function within(b: Box, what = 'the area'): Check<any> {
    return s => (inBox(s, b) ? true : `not in ${what} (${b.x0},${b.z0})-(${b.x1},${b.z1}) L${b.level ?? 0}: at ${s.player ? `${s.player.worldX},${s.player.worldZ} L${s.player.level}` : 'unknown'}`);
}

// ---------------------------------------------------------------- prayer points
//
// Prayer points are a consumable on the route: S07's bones leave the pool at the level (99), and
// nothing but a carried potion or an altar refills it (rs/687's budget: S10b and S11b alone spend
// 95). Each protect fight's first segment checks the pool against the stretch's measured drain, so a
// short pool is named at the step boundary rather than found mid-fight.

/** A Prayer potion dose restores 7 + 25% of the Prayer level (consume_effects.dbrow, prayer_potion_effect). */
export function doseRestore(prayerLevel: number): number {
    return 7 + Math.floor(prayerLevel / 4);
}

export function prayerLevelOf(s: BotWorldState): number {
    return s.prayers?.prayerLevel || s.skills.find(k => k.name.toLowerCase() === 'prayer')?.baseLevel || 0;
}

export function prayerPointsOf(s: BotWorldState): number {
    return s.prayers?.prayerPoints ?? 0;
}

/** Prayer points the pool can draw: the points now plus every held dose at its restore. */
export function prayerReserve(s: BotWorldState): number {
    return prayerPointsOf(s) + prayerDoses(s) * doseRestore(prayerLevelOf(s));
}

/** A precondition: the pool, counting held doses, covers `need` points for `what` (e.g. 'S12:G ... for G-J'). */
export function prayerCovers(what: string, need: number): Check<any> {
    return s => {
        const reserve = prayerReserve(s);
        if (reserve >= need) return true;
        const doses = prayerDoses(s);
        return `${what} needs ~${need} prayer points, has ${prayerPointsOf(s)}${doses ? ` and ${doses} potion doses (${reserve} in all)` : ' and no prayer potion'}`;
    };
}

export type DrinkSdk = StateSource & Pick<BotSDK, 'sendUseItem'>;

/** A drink clicked during a scene's delay is dropped without a reply: re-sent after this many ticks. */
export const DRINK_RESEND_TICKS = 3;

/**
 * Drink held Prayer potion doses one at a time until the points reach `target` (at most the level)
 * or no dose is left; each drink is confirmed by the points rising or a dose going before the next,
 * and re-sent every DRINK_RESEND_TICKS while it does not land (a cutscene's delay drops item clicks).
 * Never clicks while a chat page is open: an inventory click closes the chat, so a page in a talk or
 * a scene would be lost (rs/688's S15 race). It waits up to `maxTicks` for the chat to close, then
 * returns what it drank so the caller's conversation can go on. Returns the doses drunk; throws when
 * a drink does not land within `maxTicks`.
 */
export async function drinkPrayerTo(sdk: DrinkSdk, target: number, maxTicks = 9): Promise<number> {
    let drunk = 0;
    for (;;) {
        const s = sdk.getState();
        if (!s) throw new Error('drinkPrayerTo: no state');
        const pts = prayerPointsOf(s);
        if (pts >= Math.min(target, prayerLevelOf(s))) return drunk;
        const pot = s.inventory.find(i => /^Prayer potion\(\d\)$/i.test(i.name));
        if (!pot) return drunk;
        if (s.dialog?.isOpen && !(await waitUntil(sdk, st => !st.dialog?.isOpen, { maxTicks })).ok) return drunk;
        const doses = prayerDoses(s);
        const landed = (st: BotWorldState) => prayerPointsOf(st) > pts || prayerDoses(st) < doses;
        let ok = false;
        for (let waited = 0; waited < maxTicks && !ok; waited += DRINK_RESEND_TICKS) {
            const cur = sdk.getState()!;
            if (cur.dialog?.isOpen) break;
            const p = cur.inventory.find(i => /^Prayer potion\(\d\)$/i.test(i.name)) ?? pot;
            void sdk.sendUseItem(p.slot, p.optionsWithIndex.find(o => /^drink$/i.test(o.text))?.opIndex ?? 1);
            ok = (await waitUntil(sdk, landed, { maxTicks: Math.min(DRINK_RESEND_TICKS, maxTicks - waited) })).ok;
        }
        if (!ok) {
            if (sdk.getState()?.dialog?.isOpen) return drunk;
            throw new Error(`a Prayer potion drink did not land in ${maxTicks} ticks (${pts} points, ${doses} doses)`);
        }
        drunk++;
    }
}

// ---------------------------------------------------------------- poison
//
// A poison is carried from step to step: %poison is a perm varp and login restarts its timer
// (poison.rs2 set_poison_login), and nothing on the route cures it unless a step drinks. The client
// is never sent %poison (all.varp: no transmit), so the published evidence is the poison's own
// damage, a hitsplat of type HITMARK_POISON every POISON_PERIOD ticks while it lasts, and 'You have
// been poisoned!', which comes only on a fresh poisoning (%poison 0 before, poison.rs2:13-15). A poison
// tick also runs if_close (poison.rs2:36), closing an open trade or talk. One record of the last
// dose, whoever drank it, keeps two cures from drinking for one poisoning.

/** The server's hitmark type for poison damage (hitmark.constant ^hitmark_poison; poison.rs2 poison_damage). */
export const HITMARK_POISON = 2;
/** Ticks between poison hits (poison.rs2 set_poison_timer: settimer(poison, 30)). */
export const POISON_PERIOD = 30;
/** Evidence this recent means the poison is still on: while it lasts a hit lands every POISON_PERIOD. */
export const POISON_WINDOW = POISON_PERIOD + 2;
/** Any antipoison's doses by name: "Antipoison(3)" and "Superantipoison(4)" (no space). */
export const ANTIPOISON = /antipoison\(\d\)$/i;
const POISONED_MESSAGE = /you have been poisoned/i;
/** Ticks an entry cure waits for an open chat to close before drinking through it: no talk of the step's own is open yet. */
const CURE_CHAT_TICKS = 5;

/** The tick of the newest poison evidence the state holds: a poison hitsplat on the player or the poisoned message; -Infinity if none. */
export function poisonSeenAt(s: Pick<BotWorldState, 'combatEvents' | 'gameMessages'>): number {
    let at = -Infinity;
    for (const e of s.combatEvents ?? []) if (e.type === 'damage_taken' && e.targetType === 'player' && e.hitmark === HITMARK_POISON) at = Math.max(at, e.tick);
    for (const m of s.gameMessages ?? []) if (POISONED_MESSAGE.test(m.text)) at = Math.max(at, m.tick);
    return at;
}

let drunkAt = -Infinity;
/** The highest client tick seen since the last restart. */
let seenTick = -Infinity;

/**
 * Watch the published tick: it is the client's own and restarts at a reload, so a tick below the highest seen means a new
 * session, and a dose recorded in the old one says nothing about a poison carried into it (measured in the S15:A lab: a
 * stale record hid a carried poison until its next hit, HP 26 to 20).
 */
function observeTick(tick: number): void {
    if (!Number.isFinite(tick)) return;
    if (tick < seenTick) drunkAt = -Infinity;
    seenTick = tick;
}

/**
 * The tick of the run's last antipoison dose, by any caller; -Infinity after a restart, after a client reload seen at
 * `now`, or when the record is ahead of `now`.
 */
export function antipoisonDrunkAt(now = Infinity): number {
    observeTick(now);
    return drunkAt > now ? -Infinity : drunkAt;
}

/** Record a dose, in the tick its drink is sent: from then `poisoned` reads every earlier evidence as cured. -Infinity clears it. */
export function noteAntipoison(tick: number): void {
    if (tick === -Infinity) seenTick = -Infinity;
    observeTick(tick);
    drunkAt = tick;
}

/**
 * Whether the poison is on as far as the published state shows: evidence newer than `since` (the last dose) and within
 * POISON_WINDOW of now. A poison that wore off reads as on for at most POISON_WINDOW past its last hit (a wasted dose at
 * worst); after a client reload, a carried poison shows only at its next hit. A `since` ahead of the state's tick is a
 * record from before a reload (the client's tick restarts) and counts as no dose: measured in the lab, it hid a carried
 * poison until its next hit.
 */
export function poisoned(s: Pick<BotWorldState, 'tick' | 'combatEvents' | 'gameMessages'>, since?: number): boolean {
    observeTick(s.tick);
    since ??= drunkAt;
    const at = poisonSeenAt(s);
    const dose = since > s.tick ? -Infinity : since;
    return at > dose && s.tick - at <= POISON_WINDOW;
}

/** What a potion's drink prints once its p_delay is over (consume_effects.rs2 consume_effect_messages). */
const DRINK_DONE = /^You have (finished your potion|\d doses? of potion left)/i;
/** The most ticks a potion's p_delay holds the player (its message_delay; the doses-left message came 2-3 ticks after the drink at 400 ms). */
export const DRINK_DELAY_TICKS = 4;

/**
 * Until a potion drunk at `sent` has finished its p_delay (its doses-left message), at most DRINK_DELAY_TICKS. A click sent
 * inside the delay is dropped with no message: measured at S15:A, Narnode's talk sent there opened 16 ticks late.
 */
export async function drinkDelayOver(sdk: StateSource, sent: number): Promise<void> {
    await waitUntil(sdk, s => (s.gameMessages ?? []).some(m => m.tick >= sent && DRINK_DONE.test(m.text)), { maxTicks: DRINK_DELAY_TICKS });
}

const dosesOf = (name: string) => Number(/\((\d)\)$/.exec(name)?.[1] ?? 0);
const isSuper = (name: string) => /^super/i.test(name);

/**
 * The antipoison dose to drink: a plain Antipoison(n) before any Superantipoison (the plain one is H7's, leaving in H12's
 * swap; the super is a kit line), the fewest doses first within a kind; null if none is held.
 */
export function cureDose(s: Pick<BotWorldState, 'inventory'>): InventoryItem | null {
    const held = s.inventory.filter(i => ANTIPOISON.test(i.name));
    held.sort((a, b) => Number(isSuper(a.name)) - Number(isSuper(b.name)) || dosesOf(a.name) - dosesOf(b.name));
    return held[0] ?? null;
}

/**
 * Cure a poison that is on: one dose (cureDose), confirmed by the potion leaving its slot (a dose fewer, or the vial) and
 * re-sent once after DRINK_RESEND_TICKS (a scene's delay drops item clicks), then the drink's own delay waited out
 * (drinkDelayOver), so the caller's next click lands. An open chat gets CURE_CHAT_TICKS to close first. Notes the dose in
 * the tick it is sent. Throws when neither drink lands.
 */
export async function curePoison(sdk: DrinkSdk, where: string): Promise<'clean' | 'cured' | 'none-held'> {
    let s = sdk.getState();
    if (!s) throw new Error(`${where}: no state`);
    if (!poisoned(s)) return 'clean';
    if (s.dialog?.isOpen) {
        await waitUntil(sdk, st => !st.dialog?.isOpen, { maxTicks: CURE_CHAT_TICKS });
        s = sdk.getState()!;
        if (!poisoned(s)) return 'clean';
    }
    const dose = cureDose(s);
    if (!dose) return 'none-held';
    const { slot, name } = dose;
    const gone = (st: BotWorldState) => st.inventory.find(i => i.slot === slot)?.name !== name;
    for (let attempt = 0; attempt < 2; attempt++) {
        const sent = sdk.getState()!.tick;
        noteAntipoison(sent);
        void sdk.sendUseItem(slot, dose.optionsWithIndex.find(o => /^drink$/i.test(o.text))?.opIndex ?? 1);
        if ((await waitUntil(sdk, gone, { maxTicks: DRINK_RESEND_TICKS })).ok) {
            await drinkDelayOver(sdk, sent);
            return 'cured';
        }
    }
    throw new Error(`${where}: the ${name} in slot ${slot} was not drunk in ${2 * DRINK_RESEND_TICKS} ticks`);
}

/** A precondition: not poisoned, or a dose is held to cure it; else the shortfall, named. */
export function poisonCovered(where: string): Check<any> {
    return s => !poisoned(s) || cureDose(s) !== null || `${where} entered poisoned with no antipoison held`;
}

/**
 * `segs` with an entry cure on each of `letters`: the poison check first among the preconditions (poisonCovered), and
 * a poison carried in cured before the body (and a resume) runs. For a segment that can be entered poisoned, a fight or
 * the last safe point before one; clean, it costs nothing.
 */
export function entryCured<C>(stepId: string, letters: readonly string[], segs: readonly Segment<C>[]): Segment<C>[] {
    const missing = letters.filter(l => !segs.some(s => s.letter === l));
    if (missing.length) throw new Error(`entryCured: ${stepId} has no segment ${missing.join(', ')}`);
    return segs.map(seg => {
        if (!letters.includes(seg.letter)) return seg;
        const where = `${stepId}:${seg.letter}`;
        const cured: Segment<C> = {
            ...seg,
            preconditions: allOf(poisonCovered(where), seg.preconditions),
            run: async ctx => {
                await curePoison(ctx.sdk, where);
                await seg.run(ctx);
            },
        };
        if (seg.resume) {
            const resume = seg.resume;
            cured.resume = async ctx => {
                await curePoison(ctx.sdk, where);
                await resume(ctx);
            };
        }
        return cured;
    });
}

// ---------------------------------------------------------------- kit consumables

/**
 * Whether a kit line names something the run uses up after the row's serve: food (lib/travel.ts FOOD), a
 * potion at any dose, a rune. Once the row is recorded served, such a line is satisfied by its count at the
 * serve: eating, drinking or casting afterwards never re-opens the kit's want (main's ruling, 10-24).
 */
export function consumable(name: string): boolean {
    return FOOD.test(name) || /\(\d\)$/.test(name) || /potion|antipoison/i.test(name) || / rune$/i.test(name);
}

// ---------------------------------------------------------------- kit consumables

/**
 * Whether a kit line names something the run uses up after the row's serve: food (lib/travel.ts FOOD), a
 * potion at any dose, a rune. Once the row is recorded served, such a line is satisfied by its count at the
 * serve: eating, drinking or casting afterwards never re-opens the kit's want (main's ruling, 10-24).
 */
export function consumable(name: string): boolean {
    return FOOD.test(name) || /\(\d\)$/.test(name) || /potion|antipoison/i.test(name) || / rune$/i.test(name);
}

// ---------------------------------------------------------------- inventory need

export const INVENTORY_SLOTS = 28;

export function freeSlots(s: BotWorldState): number {
    return INVENTORY_SLOTS - s.inventory.length;
}

/** An item the content hands the step inside it, held from the segment that receives it through `until`. */
export interface QuestItem {
    /** As the inventory names it, or its config id where several items share a name (matchesItem). */
    item: ItemPattern;
    /** For refusals; default the pattern. */
    name?: string;
    /** How many the content gives (default 1). */
    n?: number;
    /** The whole stack takes one slot (default false: one slot each). */
    stackable?: boolean;
    /** Letter of the segment that receives it. */
    from: string;
    /** Letter of the last segment it is held through (taken or used up in it). Absent: kept past the step. */
    until?: string;
}

export interface SlotNeed {
    /** The most free slots any segment from `at` on needs. */
    slots: number;
    /** The segment where that peak falls (null when nothing is needed). */
    peak: string | null;
    /** What makes up the peak, as `n name`. */
    items: string[];
}

/**
 * Free slots the step needs from segment `at` on: at each segment, every item
 * held there (received at or after `at`, not yet taken), less what the
 * inventory already holds of it, less the slots that what the pack holds now
 * frees once it is handed back (an item past its `until`); the peak over the
 * segments. An item received before `at` is already in the pack or spent, so
 * it needs nothing.
 */
export function slotNeed(s: BotWorldState, items: readonly QuestItem[], letters: readonly string[], at: string): SlotNeed {
    const idx = (l: string) => {
        const i = letters.indexOf(l);
        if (i < 0) throw new Error(`slotNeed: segment ${l} is not one of ${letters.join(',')}`);
        return i;
    };
    const start = idx(at);
    let best: SlotNeed = { slots: 0, peak: null, items: [] };
    for (let x = start; x < letters.length; x++) {
        let slots = 0;
        const parts: string[] = [];
        for (const q of items) {
            const from = idx(q.from);
            const until = q.until === undefined ? letters.length - 1 : idx(q.until);
            const have = s.inventory.filter(i => matchesItem(i, q.item)).length;
            const n = q.n ?? 1;
            if (x > until) {
                // Handed back before this segment: whatever of it the pack holds now is a free slot here.
                slots -= q.stackable ? (have ? 1 : 0) : Math.min(have, n);
                continue;
            }
            if (from < start || x < from) continue;
            const add = q.stackable ? (have ? 0 : 1) : Math.max(0, n - have);
            if (!add) continue;
            slots += add;
            parts.push(`${n} ${q.name ?? String(q.item)}`);
        }
        if (slots > best.slots) best = { slots, peak: letters[x]!, items: parts };
    }
    return best;
}

/** A precondition: the free slots cover `slotNeed` from `at` on; the refusal names the peak segment, its items and the shortfall. */
export function slotsCover(items: readonly QuestItem[], letters: readonly string[], at: string): Check<any> {
    return s => {
        const need = slotNeed(s, items, letters, at);
        const free = freeSlots(s);
        return free >= need.slots ? true : `inventory: segment ${need.peak} needs ${need.slots} free slots (${need.items.join(', ')}), ${free} free: ${need.slots - free} short`;
    };
}

// ---------------------------------------------------------------- kit

/** One kit line: at least `n` (default 1) of items whose name matches. */
export interface KitItem {
    item: string | RegExp;
    n?: number;
}

const held = (s: BotWorldState, k: KitItem) => s.inventory.filter(i => matchesItem(i, k.item)).reduce((a, i) => a + i.count, 0);

/** What the inventory still lacks of the kit, as receiveFrom want specs (the missing amounts). */
export function kitWant(s: BotWorldState, kit: readonly KitItem[]): WantSpec[] {
    return kit.map(k => ({ item: k.item, amount: (k.n ?? 1) - held(s, k) })).filter(w => w.amount > 0);
}

function describeWant(want: readonly WantSpec[]): string {
    return want.map(w => `${w.amount} x ${String(w.item)}`).join(', ');
}

export interface KitSegmentOptions<C> {
    /** Default 'A'. */
    letter?: string;
    /** Default 'kit'. */
    label?: string;
    /** The entry's preconditions other than the kit (levels, quest stages, arrival tile). */
    preconditions?: Check<C>;
    /** receiveFrom's bounds. */
    maxTicks?: number;
    openTimeoutMs?: number;
}

/**
 * The standard first segment: the helper trade of the manifest entry. When
 * the inventory already holds the kit it does nothing; otherwise it receives
 * the missing items from `opts.kitFrom` (lib/trade.ts `receiveFrom`), and with
 * no giver it fails. Its postcondition is the kit held. It has no `done`: the
 * kit is spent later, so holding it is not a durable mark.
 */
export function kitSegment<C = any>(opts: QuestOptions | undefined, kit: readonly KitItem[], seg: KitSegmentOptions<C> = {}): Segment<C> {
    return {
        letter: seg.letter ?? 'A',
        label: seg.label ?? 'kit',
        logoutSafe: true,
        ...(seg.preconditions ? { preconditions: seg.preconditions } : {}),
        async run({ sdk }) {
            const s = sdk.getState();
            if (!s) throw new Error('kit: no state');
            const want = kitWant(s, kit);
            if (!want.length) return;
            if (!opts?.kitFrom) throw new Error(`kit: missing ${describeWant(want)} and no kitFrom to receive it from`);
            const r = await receiveFrom(sdk, opts.kitFrom, {
                want,
                ...(seg.maxTicks !== undefined ? { maxTicks: seg.maxTicks } : {}),
                ...(seg.openTimeoutMs !== undefined ? { openTimeoutMs: seg.openTimeoutMs } : {}),
            });
            if (!r.ok) throw new Error(`kit: receiveFrom ${opts.kitFrom} failed (${r.reason ?? 'unknown'}) wanting ${describeWant(want)}`);
        },
        postconditions: s => {
            const want = kitWant(s, kit);
            return want.length ? `kit missing: ${describeWant(want)}` : true;
        },
    };
}
