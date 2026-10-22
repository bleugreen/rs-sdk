// The Grand Tree (S11b) on the lab: a fixture per segment start, run through lab/quests/run.ts.
//
//   LAB_RUNNERS=0 speedrun/lab/lab.sh <bot> 'speedrun/lab/quests/grand-tree.ts:--from=A:--until=P:--runs=3:--launch'
//
// The runner's flags (--from, --until, --runs, --dialogue, --trace, --launch; run.ts) plus:
//   --spell=fire_bolt|fire_blast  the demon's spell (default fire_bolt)
//   --root=1..15                  P's %daconia_rock_root (random otherwise, as on the scored run)
//   --elena=29                    Plague City one short of the scroll read: the scroll-read retry
//
// Each fixture is the route at that segment's start: SCORED's levels at S11b, the H7 leftovers
// and H8 (less what earlier segments spent), the quest items held by then, %grandtree, the tile.
// The runner's table carries the module's note rows (casts, climb refusals, free slots, toggles,
// the root drawn); a full A-P run also checks the quest's reward xp.

import type { ConverseResult } from '../../lib/converse';
import type { TickRow } from '../../lib/ticks';
import { skillXp } from '../../lib/world';
import { steps, stepId, type Options } from '../../quests/grand-tree';
import { arg } from '../common';
import { cheat, give, setvar } from '../setup';
import { labMain, type LabQuest, type QuestFixture } from './run';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N1', 'N2', 'O', 'P'] as const;
type Letter = (typeof LETTERS)[number];
const at = (l: Letter) => LETTERS.indexOf(l);

/** SCORED at S11b (STEP-MANIFEST.md entry 8: 80/1/1, HP 28, Magic ~64 after the warlord, Prayer ~94, Agility 22 after S11a). */
const LEVELS = { attack: 80, strength: 1, defence: 1, hitpoints: 28, magic: 64, prayer: 94, agility: 22 };

const BOOK = 'grandtree_translationbook';
const SCROLL = 'grandtree_scroll';
/** Where each segment starts: %grandtree, the tile, and the quest items held from earlier segments. */
const STARTS: Record<Letter, { stage: number; at: [number, number, number]; items: string[] }> = {
    A: { stage: 0, at: [2465, 3489, 0], items: [] },
    B: { stage: 10, at: [2464, 3497, 0], items: ['grandtree_barksample', BOOK] },
    // Where B's climb leaves SCORED: the ladder lifts the player's own tile (ladders.rs2), and the ladder's tile is blocked.
    C: { stage: 20, at: [2677, 3088, 1], items: [BOOK, SCROLL] },
    D: { stage: 30, at: [2464, 3497, 0], items: [BOOK, SCROLL] },
    E: { stage: 40, at: [2477, 3463, 1], items: [BOOK, SCROLL] },
    F: { stage: 50, at: [2464, 3497, 0], items: [BOOK, SCROLL] },
    G: { stage: 60, at: [2465, 3496, 3], items: [BOOK, SCROLL] },
    H: { stage: 70, at: [2476, 3464, 1], items: [BOOK, SCROLL, 'grandtree_journal'] },
    I: { stage: 80, at: [2466, 3496, 3], items: [BOOK, SCROLL, 'grandtree_journal'] },
    J: { stage: 90, at: [2999, 3043, 0], items: [BOOK, SCROLL, 'grandtree_journal', 'grandtree_order'] },
    K: { stage: 100, at: [2465, 3496, 3], items: [BOOK, SCROLL, 'grandtree_journal', 'grandtree_order'] },
    L: { stage: 110, at: [2482, 3463, 1], items: [BOOK, SCROLL, 'grandtree_journal', 'grandtree_order', 'grandtree_gloughskey', 'grandtree_invasionplans'] },
    M: { stage: 120, at: [2464, 3497, 0], items: [BOOK, SCROLL, 'grandtree_journal', 'grandtree_order', 'grandtree_gloughskey', 'grandtree_twigt', 'grandtree_twigu', 'grandtree_twigz', 'grandtree_twigo'] },
    N1: { stage: 130, at: [2487, 3465, 2], items: [BOOK, SCROLL, 'grandtree_journal', 'grandtree_order', 'grandtree_gloughskey'] },
    // Underground where the fight is: a drop mid-fight relogs SCORED here, and N2's re-entry walks back to the pillars.
    N2: { stage: 130, at: [2491, 9864, 0], items: [BOOK, SCROLL, 'grandtree_journal', 'grandtree_order', 'grandtree_gloughskey'] },
    O: { stage: 140, at: [2491, 9864, 0], items: [BOOK, SCROLL, 'grandtree_journal', 'grandtree_order', 'grandtree_gloughskey'] },
    P: { stage: 150, at: [2464, 9895, 0], items: [BOOK, SCROLL, 'grandtree_journal', 'grandtree_order', 'grandtree_gloughskey'] },
};

/** Teleport runes left at a segment's start: H8 gives 5 law and 4 water; B and C cast Ardougne (2+2 each), J casts Varrock (1 law, 3 air, 1 fire). */
function teleportRunes(l: Letter): Record<string, number> {
    const i = at(l);
    const ard = (i > at('B') ? 1 : 0) + (i > at('C') ? 1 : 0);
    const varrock = i > at('J') ? 1 : 0;
    return { lawrune: 5 - 2 * ard - varrock, waterrune: 4 - 2 * ard, firerune: 1 - varrock };
}

function fixture(l: Letter): QuestFixture {
    const st = STARTS[l];
    const counts = (names: string[]) => names.reduce<Record<string, number>>((m, n) => ({ ...m, [n]: (m[n] ?? 0) + 1 }), {});
    // H7 leftovers after the warlord (air 440, chaos 40, death 83), its sharks and antipoison.
    const runes = Object.fromEntries(Object.entries({ airrune: 440 - (at(l) > at('J') ? 3 : 0), chaosrune: 40, deathrune: 83, ...teleportRunes(l) }).filter(([, n]) => n > 0));
    return {
        letter: l,
        levels: LEVELS,
        vars: { tutorial: 1000, treequest: 9, elenaquest: 30, grandtree: st.stage },
        // Quest items first: a full inventory drops a give silently.
        items: { ...counts(st.items), staff_of_fire: 1, amulet_of_magic: 1, ...runes, shark: 2, '4doseantipoison': 1, ...(at(l) <= at('M') ? { '4dose1agility': 1 } : at(l) <= at('N2') ? { '3dose1agility': 1 } : {}) },
        worn: ['staff_of_fire', 'amulet_of_magic'],
        tile: { x: st.at[0], z: st.at[1], level: st.at[2] },
    };
}

/** quest_grandtree.rs2's reward: Agility 7,900, Attack 18,400, Magic 2,150 (stat_advance takes tenths), times the engine's xp rate (NODE_XPRATE, default 25). */
const XP_RATE = Number(process.env.NODE_XPRATE ?? 25);
const SKILLS = ['attack', 'magic', 'agility'] as const;
let xp0: Record<string, number> = {};

/** talkTo's click counts when the result carries them (loc-opened talks and scenes have none). */
function clickCounts(r: ConverseResult): string {
    const c = r as ConverseResult & { clicks?: number; settleTicks?: number; refusedResends?: number; unansweredResends?: number };
    const first = r.firstTick >= 0 ? `first=+${r.firstTick - r.startTick}` : 'first=none';
    if (c.clicks === undefined) return first;
    return `${first} clicks=${c.clicks} settle=${c.settleTicks ?? 0} refused=${c.refusedResends ?? 0} unanswered=${c.unansweredResends ?? 0}`;
}

const root = Number(arg('root', '0')) || undefined;
const elena = Number(arg('elena', '30'));

export const grandTree: LabQuest<Options> = {
    title: 'The Grand Tree (S11b)',
    stepId,
    steps,
    fixtures: LETTERS.map(fixture),
    options: {
        demonSpell: arg('spell', 'fire_bolt') as Options['demonSpell'],
        // One line per conversation: the click layer's counts (a talk's clicks and the jump guard's
        // re-sends; a first click the engine dropped shows as clicks > 1 or a re-send), the first
        // page's tick from the call, whether the pages followed its shape, and what burst.
        onTalk: (who, r) => console.log(`TALK ${who}: ${r.ticks} ticks, ${r.pages} pages; ${clickCounts(r)}; shape ${r.shape ? `matches=${r.shape.matches} burst=${r.shape.burst} burstPages=${r.shape.burstPages} stepPages=${r.shape.stepPages} failedBursts=${r.shape.failedBursts} expected="${r.shape.expected}" seen="${r.shape.seen}"${r.shape.stopped ? ` stopped=${r.shape.stopped}` : ''}` : 'none'}`),
    },
    // The plan's per-segment targets (inferred, rs/202's plan v4); the acceptance figure is the 1,576 total.
    reference: { A: 78, B: 184, C: 141, D: 48, E: 38, F: 22, G: 42, H: 46, I: 150, J: 170, K: 164, L: 41, M: 55, N1: 29, N2: 153, O: 95, P: 104 },
    async prepare(session, f) {
        const { sdk } = session;
        // After the relog on purpose: the quest tab keeps showing Plague City complete, as it does at 29 on the run.
        if (elena !== 30) {
            await setvar(sdk, 'elenaquest', elena);
            await give(sdk, 'ardougnescroll', 1);
        }
        if (f.letter === 'P' && root) await setvar(sdk, 'daconia_rock_root', root);
        await cheat(sdk, '~energy', 1);
        xp0 = Object.fromEntries(SKILLS.map(k => [k, skillXp(sdk, k)]));
    },
    check(session, f, rows: readonly TickRow[]) {
        if (f.letter !== 'A' || !rows.some(r => r.step === `${stepId}:P-daconia` && !r.kind && r.ok)) return undefined;
        const d = Object.fromEntries(SKILLS.map(k => [k, skillXp(session.sdk, k) - xp0[k]!]));
        if (d.attack !== 18_400 * XP_RATE) return `xp: Attack +${d.attack}, expected ${18_400 * XP_RATE}`;
        if (d.agility !== 7_900 * XP_RATE) return `xp: Agility +${d.agility}, expected ${7_900 * XP_RATE}`;
        if (d.magic! <= 2_150 * XP_RATE) return `xp: Magic +${d.magic}, expected the 2,150 reward plus the fight's (x${XP_RATE})`;
        return undefined;
    },
};

if (import.meta.main) {
    await labMain(grandTree);
    process.exit(0);
}
