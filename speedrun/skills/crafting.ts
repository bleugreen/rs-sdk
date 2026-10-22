// S25d, Crafting from 45 (Dwarf Cannon's 750 and Goblin Diplomacy's 200 base) to the hand-off
// xp at the Varrock west booth (STEP-MANIFEST.md entry 28; docs/speedrun/skills/crafting.md,
// section 9 "Module"). SCORED stands on (3185,3436) beside booth (3186,3436) and makes hard
// leather bodies, needle on hard leather, 26 an inventory and 5 a tick, through the page's
// item-cycle program in tool mode (server/webclient/src/bot/programs/item-cycle.ts) driven by
// lib/item-cycle.ts. The thread is a `keep` item beside the needle; the last visit stows needle,
// thread and bodies so S25e (Herblore) starts with 28 free slots.
//
// The step stops at CRAFTING_HANDOFF_XP, not 99: the uncut gems cut in S25c's wine windows
// (cooking.ts) carry Crafting the rest of the way. Gems are not S25d's: the fleet's gems all go
// to the windows (rs/158's ruling), and dragonstones are unobtainable.
//
// One step: every inventory boundary is safe to log out at, and the program restarts from any
// inventory (a reset visit), so `inProgress` + `resume` cover a mid-band logout.

import type { BotWorldState } from '../../sdk/types';
import { runItemCycle, stockFrom, type Booth, type ItemRecipe } from '../lib/item-cycle';
import { levelForXp, XP_RATE, xpForLevel } from '../lib/xp';
import type { Observed, Step, StepContext } from '../runner/step';
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

/** Base xp of the uncut gems S25c cuts in the wine windows (rs/158; research/wine-window.md section 5 B). */
export const WINDOW_GEM_BASE_XP = 6567.5;
/**
 * Where S25d stops, in game xp: 99 less the windows' gems, so S25c's cutting takes Crafting to
 * 99. Defined here once; cooking.ts (S25c) imports it. 834,270.5, Crafting 96.
 */
export const CRAFTING_HANDOFF_XP = xpForLevel(99) - WINDOW_GEM_BASE_XP * XP_RATE;
/** The standalone stop: 99, with no gems in the windows. */
export const CRAFTING_99_XP = xpForLevel(99);

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
    /** Game xp to stop at: CRAFTING_HANDOFF_XP (default) or CRAFTING_99_XP standalone. */
    untilXp?: number;
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

export function untilXpOf(opts: CraftingOptions = {}): number {
    return opts.untilXp ?? CRAFTING_HANDOFF_XP;
}

export function reached(s: BotWorldState, untilXp = CRAFTING_HANDOFF_XP): boolean {
    return craftingXp(s) >= untilXp;
}

/** Bodies from `xp` to `untilXp`: the last one may pass it, none after. */
export function bodiesTo(xp: number, untilXp = CRAFTING_HANDOFF_XP): number {
    return Math.max(0, Math.ceil((untilXp - xp) / XP_PER_BODY));
}

/** Thread for n bodies at the worst-case wear (%thread_used is server-only, so 4 is assumed). */
export function threadFor(bodies: number): number {
    return bodies <= 0 ? 0 : Math.floor((bodies - 1 + THREAD_EVERY - 1) / THREAD_EVERY) + 1;
}

/** An attempt's supply: the bodies, the leather with a spare inventory, the thread, one needle. */
export function supplyFor(fromXp: number, untilXp = CRAFTING_HANDOFF_XP): { bodies: number; hardLeather: number; thread: number; needle: number } {
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
    const untilXp = untilXpOf(opts);
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
    const bodies = plannedBodies(s, opts);
    // The whole stock is in sight while the bank is open, or the leather while its notes are held
    // (the trade lands the package at once). Banked out of sight, the program's first visit reads
    // it and faults `out of supplies` with the counts if it falls short.
    const bankSeen = !!s.bank?.isOpen;
    const notesHeld = s.inventory.some(i => i.id === ITEM.hardLeatherNote);
    if (bankSeen || notesHeld) {
        const leather = count(s, [ITEM.hardLeather, ITEM.hardLeatherNote], bankSeen);
        if (leather < bodies) return `supplies short: ${leather} hard leather for ${bodies} bodies to ${untilXp} xp (they reach Crafting ${levelForXp(craftingXp(s) + leather * XP_PER_BODY)})`;
    }
    if (bankSeen) {
        if (count(s, [ITEM.needle], true) < 1) return 'no needle held or banked';
        const thread = count(s, [ITEM.thread], true);
        if (thread < threadFor(bodies)) return `thread short: ${thread} for ${bodies} bodies (one worn every ${THREAD_EVERY}th, ${threadFor(bodies)} at the worst-case wear)`;
    }
    return true;
}

export function craftingStep(opts: CraftingOptions = {}): Step<any> {
    const untilXp = untilXpOf(opts);
    const done = (s: BotWorldState) => reached(s, untilXp) && cycleItems(s).length === 0;
    const entry = async (ctx: StepContext<any>) => {
        const s = ctx.sdk.getState();
        if (!s) throw new Error('no state');
        await runItemCycle(
            { sdk: ctx.sdk, session: ctx.session, log: ctx.log },
            {
                mode: 'tool',
                skill: 'crafting',
                recipes: [HARD_LEATHER_BODY],
                booth: boothFor(s, opts.booth ?? VARROCK_WEST),
                // exact: the program withdraws no more than this, so the stop does not overshoot
                maxActions: plannedBodies(s, opts),
                untilXp,
                stow: true,
                step: STEP_NAME
            }
        );
    };
    return {
        name: STEP_NAME,
        preconditions: s => preconditions(s, opts),
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
