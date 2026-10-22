// S25d, Crafting from 45 (Dwarf Cannon's 750 and Goblin Diplomacy's 200 base) to the hand-off
// xp at the Varrock west booth (STEP-MANIFEST.md entry 28; docs/speedrun/skills/crafting.md,
// section 9 "Module"). SCORED stands on (3185,3436) beside booth (3186,3436) and makes hard
// leather bodies, needle on hard leather, 26 an inventory and 5 a tick, through the page's
// item-cycle program in tool mode (server/webclient/src/bot/programs/item-cycle.ts) driven by
// lib/item-cycle.ts. The thread is a `keep` item beside the needle; the last visit stows needle,
// thread and bodies so S25e (Herblore) starts with 28 free slots.
//
// The step stops at craftingHandoffXp of the gems staged for S25c's wine windows, not 99: those
// uncut gems, cut in the windows (cooking.ts), carry Crafting the rest of the way. Gems are not
// S25d's: the fleet's gems all go to the windows (rs/158's ruling), and dragonstones are
// unobtainable. The staged gems are H21d's row of STEP-MANIFEST.md's inventory ledger, the one
// list of them: a shorter mix moves the stop up, and S25d makes the bodies the gems no longer cover.
//
// One step: every inventory boundary is safe to log out at, and the program restarts from any
// inventory (a reset visit), so `inProgress` + `resume` cover a mid-band logout.

import { readFileSync } from 'fs';
import type { BotWorldState } from '../../sdk/types';
import { GEM, GEMS, type Gem } from '../helpers/jeweller';
import { runItemCycle, stockFrom, type Booth, type ItemRecipe } from '../lib/item-cycle';
import { levelForXp, XP_RATE, xpForLevel } from '../lib/xp';
import type { Observed, Step, StepContext } from '../runner/step';
import { MANIFEST, parseLedger } from '../tools/slot-ledger';
import { boothFor, boothLoc, HERB_NOTES, VARROCK_WEST } from './herblore';

export const skill = 'crafting';

export const STEP_NAME = 'S25d crafting';

/** obj.pack ids; a banknote is its item's id + 1 (crafting.test.ts checks each). */
export const ITEM = {
    needle: 1733,
    thread: 1734,
    hardLeather: 1743,
    hardLeatherNote: 1744,
    body: 1131,
    bodyNote: 1132,
    chisel: 1755
} as const;

/**
 * leather.dbrow craft_hardleather_body: level 28, productexp 350 tenths = 35 base. Needle on
 * hard leather calls @craft_leather(hardleather_body, 1), which makes the body at once (no
 * interface, no delay) and wears out a thread every 5th body (%thread_used, leather.rs2).
 */
export const HARD_LEATHER_BODY: ItemRecipe = { name: 'hardleather_body', level: 28, xp: 35, a: ITEM.hardLeather, tool: ITEM.needle, keep: [{ id: ITEM.thread, every: 5 }], products: [ITEM.body] };

/** Needle and thread take 2 of the 28 slots. */
export const LOAD = 26;
const INVENTORY = 28;
export const THREAD_EVERY = 5;
/** Game xp a body gives. */
export const XP_PER_BODY = HARD_LEATHER_BODY.xp * XP_RATE;

/** The standalone stop: 99, with no gems in the windows. */
export const CRAFTING_99_XP = xpForLevel(99);

// ---------------------------------------------------------------- the staged gems and the stop

/**
 * An uncut gem stack staged for S25c's windows, as the ledger names it: `uncut sapphire`, or by
 * its unnoted obj id (`uncut sapphire @1623`, the name then only a label). slot-ledger.ts's
 * InEntry is one; a `?` count is null.
 */
export interface StagedGem {
    name?: string;
    id?: number;
    count: number | null;
}

/** The ledger row that hands SCORED the windows' gems (with S25d's leather, H21e's herbs). */
export const GEM_ROW = 'H21d';

/** The gem a staged entry names: by id when it has one (the ledger's rule), else by `uncut <gem>`. */
export function gemOf(g: StagedGem): Gem | undefined {
    if (g.id !== undefined) return GEMS.find(k => GEM[k].uncut === g.id);
    const m = g.name?.trim().toLowerCase().match(/^uncut (\w+)$/);
    return m ? GEMS.find(k => k === m[1]) : undefined;
}

const label = (g: StagedGem) => (g.id !== undefined ? `${g.name ?? 'gem'} @${g.id}` : (g.name ?? '(no name or id)'));

/**
 * The staged gems counted by gem (two stacks of one gem add), or why they are refused: a gem the
 * windows do not cut (jeweller.ts GEM, the table S25c's recipes are built from), or a count that
 * is not a whole number.
 */
export function stagedGemCounts(gems: readonly StagedGem[]): Record<Gem, number> | string {
    const counts = Object.fromEntries(GEMS.map(g => [g, 0])) as Record<Gem, number>;
    for (const e of gems) {
        const g = gemOf(e);
        if (!g) return `${label(e)} is not an uncut gem the windows cut (${GEMS.map(k => `uncut ${k} @${GEM[k].uncut}`).join(', ')})`;
        if (e.count === null || !Number.isInteger(e.count) || e.count < 0) return `${label(e)}: count ${e.count ?? '?'} is not a whole number of gems`;
        counts[g] += e.count;
    }
    return counts;
}

/** Base xp of cutting `counts` (jeweller.ts GEM cutXp, uncut_gem.rs2). */
export const gemBaseXp = (counts: Readonly<Record<Gem, number>>) => GEMS.reduce((xp, g) => xp + counts[g] * GEM[g].cutXp, 0);

/**
 * Where S25d stops, in game xp: 99 less the staged gems' cut xp, so S25c's windows take Crafting
 * to exactly 99. The full 107 (2 diamond, 20 ruby, 23 emerald, 62 sapphire: 6,567.5 base) give
 * 834,270.5, Crafting 96; no gems give 99. Throws the reason for a gem it does not know.
 */
export function craftingHandoffXp(gems: readonly StagedGem[]): number {
    const counts = stagedGemCounts(gems);
    if (typeof counts === 'string') throw new Error(counts);
    return CRAFTING_99_XP - gemBaseXp(counts) * XP_RATE;
}

/** The uncut gem entries of ledger row `row` (H21d) in `markdown` (STEP-MANIFEST.md), read by slot-ledger.ts's parser. */
export function stagedGemsFrom(markdown: string, row: string = GEM_ROW): StagedGem[] {
    const { rows, errors } = parseLedger(markdown);
    if (errors.length) throw new Error(`the inventory ledger does not parse: ${errors.join('; ')}`);
    const found = rows.find(r => r.row === row);
    if (!found) throw new Error(`the inventory ledger has no row ${row}`);
    // every uncut gem the row brings, known or not: an unknown one is refused, never dropped
    const isGem = (e: StagedGem) => /^uncut /i.test(e.name ?? '') || gemOf(e) !== undefined;
    return found.in.filter(isGem).map(e => ({ name: e.name, ...(e.id !== undefined ? { id: e.id } : {}), count: e.count }));
}

/** `stagedGemsFrom` on a file, STEP-MANIFEST.md by default. */
export function loadStagedGems(file: string = MANIFEST, row: string = GEM_ROW): StagedGem[] {
    return stagedGemsFrom(readFileSync(file, 'utf8'), row);
}

/**
 * Items H21d and H21e hand over beside S25d's own (the chisel and gem notes for S25c's windows,
 * the herb notes for S25e). The program's first visit banks every item that is not the needle
 * or the thread, so these do not count against the 28 free slots (rs/158's slot ledger).
 */
export const HANDOFF_BANKED: readonly number[] = [
    ITEM.chisel,
    // cert_uncut_<gem>: diamond, ruby, emerald, sapphire, opal, jade, red topaz, dragonstone
    1618, 1620, 1622, 1624, 1626, 1628, 1630, 1632,
    ...HERB_NOTES.keys()
];

const OURS = new Set<number>(Object.values(ITEM).filter(id => id !== ITEM.chisel));

export interface CraftingOptions {
    /** Game xp to stop at, in place of the staged gems' hand-off: CRAFTING_99_XP standalone. */
    untilXp?: number;
    /**
     * The uncut gems staged for S25c's windows; the step stops at craftingHandoffXp of them.
     * Default: H21d's row read from STEP-MANIFEST.md (loadStagedGems).
     */
    stagedGems?: readonly StagedGem[];
    booth?: Booth;
    /** Hand-written cap on bodies (the demo). */
    maxActions?: number;
    /** Items the first visit banks without counting against the free slots (default HANDOFF_BANKED). */
    banksFirst?: readonly number[];
}

function craft(s: BotWorldState) {
    return s.skills.find(k => k.name.toLowerCase() === 'crafting');
}

export function craftingLevel(s: BotWorldState): number {
    return craft(s)?.baseLevel ?? 0;
}

export function craftingXp(s: BotWorldState): number {
    return craft(s)?.experience ?? 0;
}

/** Where the step stops: `untilXp` when given, else the staged gems' hand-off; a string says why the gems are refused. */
export function stopOf(opts: CraftingOptions = {}): number | string {
    if (opts.untilXp !== undefined) return opts.untilXp;
    let gems: readonly StagedGem[];
    try {
        gems = opts.stagedGems ?? loadStagedGems();
    } catch (e) {
        return `staged gems (${GEM_ROW}): ${(e as Error).message}`;
    }
    const counts = stagedGemCounts(gems);
    return typeof counts === 'string' ? `staged gems (${GEM_ROW}): ${counts}` : CRAFTING_99_XP - gemBaseXp(counts) * XP_RATE;
}

/** `stopOf`, throwing its refusal. */
export function untilXpOf(opts: CraftingOptions = {}): number {
    const stop = stopOf(opts);
    if (typeof stop === 'string') throw new Error(stop);
    return stop;
}

export function reached(s: BotWorldState, untilXp: number): boolean {
    return craftingXp(s) >= untilXp;
}

/** Bodies from `xp` to `untilXp`: the last one may pass it, none after. */
export function bodiesTo(xp: number, untilXp: number): number {
    return Math.max(0, Math.ceil((untilXp - xp) / XP_PER_BODY));
}

/** Thread for n bodies at the worst-case wear (%thread_used is server-only, so 4 is assumed). */
export function threadFor(bodies: number): number {
    return bodies <= 0 ? 0 : Math.floor((bodies - 1 + THREAD_EVERY - 1) / THREAD_EVERY) + 1;
}

/** An attempt's supply: the bodies, the leather with a spare inventory, the thread, one needle. */
export function supplyFor(fromXp: number, untilXp: number): { bodies: number; hardLeather: number; thread: number; needle: number } {
    const bodies = bodiesTo(fromXp, untilXp);
    return { bodies, hardLeather: bodies + LOAD, thread: threadFor(bodies), needle: 1 };
}

/** The bodies this run of the step makes: to untilXp, capped by maxActions. */
export function plannedBodies(s: BotWorldState, opts: CraftingOptions = {}): number {
    const n = bodiesTo(craftingXp(s), untilXpOf(opts));
    return opts.maxActions === undefined ? n : Math.min(n, opts.maxActions);
}

/** The cycle's own items held unnoted: the needle, hard leather or bodies (the inventory the stow clears). */
export function cycleItems(s: BotWorldState): string[] {
    const held = new Set<number>([ITEM.needle, ITEM.hardLeather, ITEM.body]);
    return s.inventory.filter(i => i.count > 0 && held.has(i.id)).map(i => i.name);
}

/** Inventory items that are neither the cycle's nor H21d/H21e's banked stacks: each blocks a working slot. */
export function otherItems(s: BotWorldState, banksFirst: readonly number[] = HANDOFF_BANKED): string[] {
    const ok = new Set<number>([...OURS, ...banksFirst]);
    return s.inventory.filter(i => i.count > 0 && !ok.has(i.id)).map(i => i.name);
}

function count(s: BotWorldState, ids: readonly number[], bank: boolean): number {
    const stock = stockFrom(bank ? s : { ...s, bank: { ...s.bank, items: [] } });
    return ids.reduce((n, id) => n + (stock.get(id) ?? 0), 0);
}

export function preconditions(s: BotWorldState, opts: CraftingOptions = {}): true | string {
    if (!s.inGame || !s.player) return 'not in game';
    const untilXp = stopOf(opts);
    if (typeof untilXp === 'string') return untilXp;
    if (!(untilXp > 0) || untilXp > xpForLevel(99)) return `untilXp ${untilXp} is not a Crafting xp from 1 to 99 (${xpForLevel(99)})`;
    // a run past its stop only stows what it holds
    if (reached(s, untilXp)) return true;
    const level = craftingLevel(s);
    if (level < HARD_LEATHER_BODY.level) return `Crafting ${level} is below ${HARD_LEATHER_BODY.level}: hard leather bodies need ${HARD_LEATHER_BODY.level} (leather.dbrow craft_hardleather_body)`;
    const booth = opts.booth ?? VARROCK_WEST;
    // right after a login the position is published before the scene's locs
    if (s.nearbyLocs.length && !boothLoc(s, booth)) return `no bank booth (${booth.x},${booth.z}) in view (at ${s.player.worldX},${s.player.worldZ})`;
    const other = otherItems(s, opts.banksFirst);
    if (other.length) return `${other.length} other items (${[...new Set(other)].join(', ')}): need ${INVENTORY} free slots`;
    const bodies = opts.maxActions === undefined ? bodiesTo(craftingXp(s), untilXp) : Math.min(bodiesTo(craftingXp(s), untilXp), opts.maxActions);
    // The whole stock is in sight while the bank is open, or the leather and thread while the
    // leather's notes are held (H21d's trade lands the package, thread with it, at once). Banked
    // out of sight, the program's first visit reads it and faults `out of supplies` if it falls short.
    const bankSeen = !!s.bank?.isOpen;
    const notesHeld = s.inventory.some(i => i.id === ITEM.hardLeatherNote);
    if (bankSeen || notesHeld) {
        const leather = count(s, [ITEM.hardLeather, ITEM.hardLeatherNote], bankSeen);
        if (leather < bodies) return `supplies short: ${leather} hard leather for ${bodies} bodies to ${untilXp} xp (they reach Crafting ${levelForXp(craftingXp(s) + leather * XP_PER_BODY)})`;
    }
    if (bankSeen && count(s, [ITEM.needle], true) < 1) return 'no needle held or banked';
    if (bankSeen || notesHeld) {
        const thread = count(s, [ITEM.thread], bankSeen);
        if (thread < threadFor(bodies)) return `thread short: ${thread} for ${bodies} bodies (one worn every ${THREAD_EVERY}th, ${threadFor(bodies)} at the worst-case wear)`;
    }
    return true;
}

export function craftingStep(opts: CraftingOptions = {}): Step<any> {
    // resolved once: H21d's row is read when the step is built, not at every check
    const stop = stopOf(opts);
    const o: CraftingOptions = typeof stop === 'number' ? { ...opts, untilXp: stop } : opts;
    const untilXp = typeof stop === 'number' ? stop : Infinity;
    const done = (s: BotWorldState) => reached(s, untilXp) && cycleItems(s).length === 0;
    const entry = async (ctx: StepContext<any>) => {
        const s = ctx.sdk.getState();
        if (!s) throw new Error('no state');
        if (typeof stop === 'string') throw new Error(stop);
        await runItemCycle(
            { sdk: ctx.sdk, session: ctx.session, log: ctx.log },
            {
                mode: 'tool',
                skill: 'crafting',
                recipes: [HARD_LEATHER_BODY],
                booth: boothFor(s, opts.booth ?? VARROCK_WEST),
                // exact: the program withdraws no more than this, so the stop does not overshoot
                maxActions: plannedBodies(s, o),
                untilXp,
                stow: true,
                step: STEP_NAME
            }
        );
    };
    return {
        name: STEP_NAME,
        preconditions: s => preconditions(s, o),
        run: entry,
        resume: entry,
        postconditions: s => {
            const held = cycleItems(s);
            if (held.length) return `the stow left ${[...new Set(held)].join(', ')} in the inventory`;
            return reached(s, untilXp) || opts.maxActions !== undefined ? true : `Crafting xp ${craftingXp(s)} < ${untilXp}`;
        },
        logoutSafe: true,
        done: (o: Observed) => done(o.state),
        inProgress: (o: Observed) => !!o.state.player && !done(o.state) && (reached(o.state, untilXp) || cycleItems(o.state).length > 0)
    };
}

/** The step-module convention (`skill`, `steps()`): one step, S25d. */
export function steps(opts: CraftingOptions = {}): Step<any>[] {
    return [craftingStep(opts)];
}
