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

import type { BotWorldState } from '../../sdk/types';
import type { QuestKey, StageName } from '../data/quest-stages';
import type { ConverseOptions } from '../lib/converse';
import { matchesItem, type ItemPattern } from '../lib/items';
import { requireQuestStage, type QuestView } from '../lib/quests';
import { receiveFrom, type WantSpec } from '../lib/trade';
import type { Check, ObservedCheck, Step, StepContext } from '../runner/step';

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
}

const LETTER = /^[A-Z][0-9]?$/;
const LABEL = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function segmentName(stepId: string, letter: string, label: string): string {
    return `${stepId}:${letter}-${label}`;
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
        const step: Step<C> = {
            name: segmentName(stepId, seg.letter, seg.label),
            logoutSafe: seg.logoutSafe,
            preconditions: seg.preconditions ?? pass,
            run: ctx => seg.run(ctx),
            postconditions: seg.postconditions ?? pass,
        };
        if (seg.done) step.done = seg.done;
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
