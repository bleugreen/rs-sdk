// Scripted passages: doors and gates whose `oploc1` script moves the player
// through, which the SDK's collision snapshot (sdk/pathfinding.ts) keeps as
// solid because they are not wall-shaped doors. A walk whose route needs one
// stops at the nearest tile it can reach and fails. Here each passage is its two
// sides and the loc to click, and `crossingsBetween` finds which to cross, in
// order, by asking the snapshot where a plain walk gets to.
//
// The Gnome Stronghold is the case that needs it: the inside of its wall, from
// the main gate up to the Grand Tree, is closed to the pathfinder, and the
// grocers' ladder is inside the tree, behind its doors (gnome_gate.rs2).
//
// McGrubor's loose railing is deliberately absent: the snapshot treats the wood's
// locked gate as a door, so the wood looks open and the search would never pick
// the railing (questitems.ts squeezes through it itself).
import type { BotActions } from '../../sdk/actions';
import type { BotSDK } from '../../sdk/index';
import { findLongPath } from '../../sdk/pathfinding';
import type { NearbyLoc } from '../../sdk/types';
import { classifyPage } from './dialogue';

export interface Tile {
    x: number;
    z: number;
}

export interface Passage {
    name: string;
    /** The loc to click, its option, and where it stands. */
    loc: RegExp;
    option: RegExp;
    at: Tile;
    /** A tile on each side the script accepts as a start, and where it leaves you on the other. */
    sides: [Tile, Tile];
    /** Choices to pick in a dialogue the click opens instead of passing (the next attempt clicks again). */
    answers?: RegExp[];
}

export const PASSAGES: Passage[] = [
    {
        // gnome_areagate: the script walks you to (2461,3382) or (2461,3385) and pushes you 3 tiles through.
        name: 'Gnome Stronghold gate',
        loc: /^gate$/i,
        option: /^open$/i,
        at: { x: 2459, z: 3383 },
        sides: [
            { x: 2461, z: 3382 },
            { x: 2461, z: 3385 }
        ],
        // Coming in, Femi (The Grand Tree) asks for help with her boxes once, and that ends the
        // click (femi.rs2 grandtree_femi_boxes); turning her down sets %femi_help and the gate opens next time.
        answers: [/^sorry, i'm a bit busy/i]
    },
    {
        // treedoorl/treedoorr: 2 tiles north or south through the doorway at x 2465-2466.
        name: 'Grand Tree doors',
        loc: /^tree door$/i,
        option: /^open$/i,
        at: { x: 2465, z: 3492 },
        sides: [
            { x: 2465, z: 3490 },
            { x: 2465, z: 3494 }
        ]
    }
];

/** Whether a plain walk on the ground floor gets from `a` to within a tile of `b`. */
export type Reaches = (a: Tile, b: Tile) => boolean;

const cheb = (a: Tile, b: Tile) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

/** `Reaches` from the SDK's collision snapshot. */
export const reachesOnGround: Reaches = (a, b) => {
    if (cheb(a, b) <= 1) return true;
    const end = findLongPath(0, a.x, a.z, b.x, b.z, 500).at(-1);
    return !!end && cheb(end, b) <= 1;
};

export interface Crossing {
    passage: Passage;
    from: Tile;
    to: Tile;
}

/**
 * The passages to cross, in order, to walk from `here` to `dest`: [] when a plain
 * walk gets there, null when no sequence of passages helps (the caller walks as
 * usual and lets that fail on its own terms). Fewest crossings first.
 */
export function crossingsBetween(here: Tile, dest: Tile, reaches: Reaches = reachesOnGround, passages: Passage[] = PASSAGES): Crossing[] | null {
    const queue: { at: Tile; path: Crossing[] }[] = [{ at: here, path: [] }];
    const landed = new Set<string>();
    while (queue.length > 0) {
        const { at, path } = queue.shift()!;
        if (reaches(at, dest)) return path;
        for (const passage of passages)
            for (const [i, from] of passage.sides.entries()) {
                const to = passage.sides[1 - i]!;
                const key = `${to.x},${to.z}`;
                if (landed.has(key) || !reaches(at, from)) continue;
                landed.add(key);
                queue.push({ at: to, path: [...path, { passage, from, to }] });
            }
    }
    return null;
}

export interface Crosser {
    bot: BotActions;
    sdk: BotSDK;
    log: (message: string, data?: Record<string, unknown>) => void;
    /** Walk to a tile on this side; throws when it cannot. */
    walk: (t: Tile) => Promise<void>;
}

const position = (sdk: BotSDK): Tile => ({ x: sdk.getState()?.player?.worldX ?? 0, z: sdk.getState()?.player?.worldZ ?? 0 });

/**
 * Ticks to wait for a passage's loc to show before giving up. Anyone's crossing swaps
 * the Stronghold gate out for 5 ticks (gnome_gate.rs2, loc_del(5)), and with players
 * going both ways it is clickable in fewer than half the ticks (45 of 118 measured on
 * the demo), so one empty scan says nothing.
 */
export const LOC_WAIT_TICKS = 30;
/** Clicks before `cross` gives up: a click can land just as someone else's crossing swaps the gate out. */
export const CLICK_ATTEMPTS = 6;

/** The passage's loc to click, nearest its `at`, scanning each tick for up to `maxTicks`; null if it never shows. */
export async function awaitPassageLoc(sdk: Pick<BotSDK, 'scanNearbyLocs' | 'waitForTicks'>, passage: Passage, maxTicks = LOC_WAIT_TICKS): Promise<NearbyLoc | null> {
    for (let t = 0; ; t++) {
        const loc = (await sdk.scanNearbyLocs(6))
            .filter(l => passage.loc.test(l.name) && l.optionsWithIndex.some(o => passage.option.test(o.text)))
            .sort((a, b) => cheb(a, passage.at) - cheb(b, passage.at))[0];
        if (loc) return loc;
        if (t >= maxTicks) return null;
        await sdk.waitForTicks(1);
    }
}

/** Walk to the crossing's near side and click through; throws unless we end up on the far side. */
export async function cross(c: Crosser, crossing: Crossing): Promise<void> {
    const { passage, from, to } = crossing;
    await c.walk(from);
    for (let attempt = 0; attempt < CLICK_ATTEMPTS; attempt++) {
        const loc = await awaitPassageLoc(c.sdk, passage);
        if (!loc) {
            const seen = (await c.sdk.scanNearbyLocs(3)).map(l => `${l.name}@${l.x},${l.z}`).join(', ');
            throw new Error(`${passage.name} is not in view from ${JSON.stringify(position(c.sdk))} after ${LOC_WAIT_TICKS} ticks (in view: ${seen})`);
        }
        const r = await c.bot.interactLoc(loc, passage.option);
        for (let t = 0; t < 16 && cheb(position(c.sdk), to) > 1; t++) {
            const s = c.sdk.getState();
            if (s?.dialog.isOpen && !s.dialog.isWaiting) {
                if (classifyPage(s.dialog) === 'choice') {
                    const opt = s.dialog.options.find(o => (passage.answers ?? []).some(a => a.test(o.text)));
                    if (!opt) throw new Error(`${passage.name}: no answer among ${s.dialog.options.map(o => o.text).join(' | ')}`);
                    await c.sdk.sendClickDialog(opt.index);
                } else await c.sdk.sendClickDialog(0);
            }
            await c.sdk.waitForTicks(1);
        }
        if (cheb(position(c.sdk), to) <= 1) return c.log('passage', { name: passage.name, at: position(c.sdk) });
        c.log('passage retry', { name: passage.name, attempt, detail: r.message, at: position(c.sdk) });
    }
    throw new Error(`could not cross the ${passage.name}: still at ${JSON.stringify(position(c.sdk))}`);
}
