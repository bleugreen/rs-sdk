// Monkey Madness (S15): the shape of every conversation the module answers, in
// CONVENTIONS.md notation (docs/speedrun/quests/CONVENTIONS.md, Dialogue), read
// from the game scripts under server/content/scripts/quests/quest_mm/scripts/.
// In 'burst' the module passes each one to converse through segments.ts
// `talkShape`, which clears the continue runs blind and checks every page
// against the shape; 'fixed' passes none, so its converse calls are unchanged.
//
// Reading the scripts:
// - Every ~chatnpc / ~chatplayer / ~mesbox / ~objbox line on these paths is one
//   page: chat.rs2 splits at 4 lines of 380 px, and the longest line here is
//   about 215 characters.
// - `@label` is a goto (CoreOps JUMP -> ScriptState.gotoFrame clears the frame
//   stack), so nothing after an `@label` in the caller ever plays.
// - `state` marks the page whose click is followed by a server change before
//   the next page (a p_delay, an item given or taken, a teleport or fade, the
//   cutscene's start); a burst never crosses it. Varps the next page does not
//   read are not marked.

import { parseShape } from '../lib/converse';
import type { DialogueMode } from './segments';

/** Each conversation's shape, keyed by who and when; script citations are the branch the route takes. */
export const MM_SHAPES = {
    // ---- the gnome half (A-G)
    /** A, Narnode at mm_main 0 (mm_narnode.rs2:70-74, 103-115): Yes (:125); 'Ok, I'll do it' gives the seal (:129-131); objbox and 2 (:132-134). */
    narnodeStart: '16c, opt, state, 3c',
    /**
     * A re-run, Narnode at given_seal with no seal held (mm_narnode.rs2:143-176): 'Welcome back' (:144), the 4-option menu
     * (:152), 'I've lost my copy...' and his 2 (:164-166), the spare (:167), its objbox (:168), the 3-option menu (:175),
     * and 'I'll be back later.' (:170).
     */
    narnodeSpareSeal: '1c, opt, 3c, state, 1c, opt, 1c',
    /** B, the shipyard gate's worker at started (shipyardworker.rs2:65-68, mm_caranock.rs2:46-57): 'Please step inside', then p_delay(5) and the gate (:57-59). */
    shipyardGate: '12c, state',
    /** B, G.L.O. Caranock (mm_caranock.rs2:23-43). */
    caranock: '12c',
    /** C, Narnode's report (mm_narnode.rs2:144-194): 'Very well...', p_delay(3) and the orders (:194-199), objbox and 2 (:200-202). */
    narnodeOrders: '10c, state, 3c',
    /**
     * D, Daero with the orders (mm_daero.rs2:26-216): the orders taken (:102-109), the decode's p_delay(3) (:114-117),
     * the three topics opened and returned (:129-145, no pages between), Leave (:202-205), Who is it? and the
     * blindfold's objbox, then the fade to the hangar (:207-214, 230-238).
     */
    daeroOrders: '5c, state, 1c, state, 8c, 7 opt, 2c, opt, 3c, state',
    /** E, Daero introduces Waydar, Waydar within 14 (mm_daero.rs2:67-93). */
    daeroWaydar: '20c',
    /** F, Daero at reinit_complete, Waydar within 14 (mm_daero.rs2:37-48). */
    daeroReinit: '9c',
    /** F, Waydar before the atoll (mm_waydar.rs2:7-16): Yes; 'As you wish', then the glider map, p_delay(3) and Crash Island. */
    waydarFly: '3c, opt, 1c, state',
    /** G, Waydar's arrival intro after the flight (mm_waydar.rs2:66-70). */
    waydarIntro: '4c',
    /**
     * G, Waydar at shown_seal with Lumdo refusing (mm_waydar.rs2:63-93): 'I cannot convince Lumdo', 18 pages, then the
     * chapter 2 cutscene (quest_mm.rs2:123-358): a fade and p_delay(4), 14 pages, the last before the teleport to the atoll.
     */
    waydarLumdo: 'opt, 18c, state, 13c, state',
    /** U and the way back, Daero once he has left the tree (mm_daero.rs2:218-238): Yes, the blindfold objbox, the hangar. */
    daeroReturn: '1c, opt, 1c, state',
    /** U and the way back, Waydar in the powered hangar (mm_waydar.rs2:11-16): Yes; 'As you wish', the glider. */
    waydarReturn: '1c, opt, 1c, state',
    /** U and the way back, Lumdo on Crash Island after the first crossing (mm_lumdo.rs2:19-20): 'As you wish', the boat. */
    lumdoSail: '1c, state',

    // ---- Ape Atoll as a human (I-Q)
    /** I, Garkor at garkor 0 (mm_garkor.rs2:96-126). */
    garkorFirst: '25c',
    /** J, the denture crate (quest_mm.rs2:924-932): objbox, Yes. The p_delay(2) comes before the first page. */
    dentureCrate: '1c, opt',
    /**
     * J, the crate over the hole (quest_mm.rs2:964-991): Yes, I'm sure; 'You begin to lower yourself', the fade,
     * p_delay(3), the cellar. The search ends on arrival, so the landing mesbox (987 or 991) is left for the walk
     * out to close, a click saved.
     */
    holeCrate: '1c, opt, state',
    /** J, the mould crate in the cellar (quest_mm.rs2:934-942). */
    mouldCrate: '1c, opt',
    /** L, Zooknock's story to need_items (mm_zooknock.rs2:28-37, 304-371), the amulet's list (:260, 166) and back out (:262, 277). */
    zooknockStory: '55c, opt, 2c, opt, 1c',
    /** L, dentures on Zooknock: objbox, his line, 'We still need' (mm_zooknock.rs2:55-68, 41-46, 169-183). */
    zooknockDentures: '3c',
    /** L, the gold bar (mm_zooknock.rs2:69-82). */
    zooknockGoldBar: '3c',
    /** L, the mould completes the check (mm_zooknock.rs2:83-96, 185-199): p_delay(4) after 'Somewhere in the village', then the doubleobjbox. */
    zooknockMould: '5c, state, 1c',
    /** Q, the talisman (mm_zooknock.rs2:123-136, 209). */
    zooknockTalisman: '3c',
    /** Q, the bones complete the check (mm_zooknock.rs2:97-122, 203-228): p_delay(4) and the gree-gree after 'Bear with me'; the last page queues the chapter 3 cutscene. */
    zooknockBones: '2c, state, 3c, state',
    /** Q, the chapter 3 cutscene (quest_mm.rs2:169-208, 386-474): 19 pages, the last before the teleport back. */
    chapter3: '18c, state',
    /** O, the monkey child, amulet worn (mm_monkey_child.rs2:3-17). */
    childHello: '4c',
    /** O (mm_monkey_child.rs2:4-22, 176-179): 'monkey's uncle'. */
    childUncle: '4c, opt, 2c',
    /** O (mm_monkey_child.rs2:26-33, 154-161): 'How many bananas'. */
    childBananasWanted: '5c, opt, 6c',
    /** O, five bananas handed in (mm_monkey_child.rs2:36-43, 135-144): they are taken after 'Yes, of course there are'; the toy timer starts. */
    childBananas: '3c, state, 2c',
    /** O, after the toy's 100 ticks (mm_monkey_child.rs2:44-55): the talisman after 'Ok then...', then its objbox. */
    childTalisman: '5c, state, 1c',

    // ---- a monkey (R-W)
    /** R, Garkor with the Karamja gree-gree worn (mm_garkor.rs2:61-74, 139-140). */
    garkorAlliance: '5c',
    /** S, Elder Guard 2 from his south side, garkor_seek_alliance (mm_elder_guard.rs2:19, 44-48). */
    elderGuardFirst: '5c',
    /** S, Kruk at the west gate (mm_kruk.rs2:9-25): 'Follow me', then the fade and the escort to the throne room (:26-33). */
    kruk: '5c, state',
    /** S, Awowogei's mission at the throne, Uwogo and Murowoi within 7 (mm_awowogei.rs2:64-91). */
    awowogeiMission: '20c',
    /** T, the Monkey Minder puts a Karamja monkey in the cage (mm_monkey_minder.rs2:29-41, then the teleport :42-46). */
    minderIn: '7c, state',
    /** T, the zoo monkey with the amulet worn (mm_zoo_monkey.rs2:6-32): it goes in the backpack after the last page. */
    zooMonkey: '17c, state',
    /**
     * T, the Minder lets the human out (mm_monkey_minder.rs2:13-24): the teleport after the third page. The talk ends
     * once out of the cage, inside the ~8 closed ticks before his last two pages (23-24), which T's dismiss answers.
     */
    minderOut: '2c, state',
    /** V, Elder Guard 2 at kruk_spoken (mm_elder_guard.rs2:19, 28-37): 'As you wish', then the teleport into the hall. */
    elderGuardIn: '2c, state',
    /** V, Awowogei with the captive (mm_awowogei.rs2:42-50, 105-115): the monkey taken after 'Yes, I have.', then success. */
    awowogeiCaptive: '1c, state, 7c',
    /** W, Elder Guard 2 from inside the hall (mm_elder_guard.rs2:19-24): 'As you wish', then 3 tiles south. */
    elderGuardOut: '2c, state',
    /** W, Garkor at awowogei_complete_mission up to the chapter 4 cutscene (mm_garkor.rs2:131-137). */
    garkorChapter4: '5c, state',
    /** W, the chapter 4 cutscene (quest_mm.rs2:211-255, 514-629): if_close and p_delay(1) after part 17; the teleport back after part 24. */
    chapter4: '17c, state, 6c, state',
    /** W, Garkor at learned_plan (mm_garkor.rs2:25-47): the sigil after 'It is these sigils...', then its objbox and 6. */
    garkorSigil: '12c, state, 7c',

    // ---- the end (Z)
    /** Z, Daero's training (mm_daero.rs2:242-252): option 1, then the fade and 'Several hours later' (an interface, not a page). */
    daeroTraining: '10c, opt',
} as const;

export type MmShapeName = keyof typeof MM_SHAPES;

/** G, Lumdo the first time (mm_lumdo.rs2:33-68): the seal held shows it, one page more (:39-42). B drops the seal. */
export function lumdoRefuses(sealHeld: boolean): string {
    return sealHeld ? '25c' : '24c';
}

/**
 * Y, Narnode at defeated_demon (mm_narnode.rs2:15-31, 89-100, 78-86): the sigil's objbox only when it is held or worn
 * (:26); 'Well, now', then if_close and p_delay(0); the reward after 'No service'; the doubleobjbox queues the quest's
 * completion and the training pages.
 */
export function narnodeComplete(sigilHeld: boolean): string {
    return `${sigilHeld ? 12 : 11}c, state, state, state, 7c`;
}

// ------------------------------------------------------------------ O: the child's talks against the aunt's loop

/**
 * Dialogue ticks of a shape, by CONVENTIONS.md's columns: fixed, one per page and option; burst, a run of k
 * continues ceil(k/5) when it opens the dialogue and 1 + ceil((k-1)/5) after an option or a state page, and each
 * option and state page 1.
 */
export function shapeTicks(shape: string, mode: DialogueMode): number {
    let t = 0;
    let afterBreak = false;
    for (const p of parseShape(shape)) {
        if (p.kind !== 'continue') {
            t += 1;
            afterBreak = true;
            continue;
        }
        t += mode === 'fixed' ? p.n : afterBreak ? 1 + Math.ceil((p.n - 1) / 5) : Math.ceil(p.n / 5);
        afterBreak = false;
    }
    return t;
}

export interface ChildTalk {
    name: string;
    shape: string;
    /** House ticks the talk needs left in the aunt's loop in fixed mode, the walk in included (measured to pass, rs/201). */
    fixedNeed: number;
}

/** The four talks before the toy's timer, in order. */
export const CHILD_TALKS: readonly ChildTalk[] = [
    { name: 'hello', shape: MM_SHAPES.childHello, fixedNeed: 12 },
    { name: 'uncle', shape: MM_SHAPES.childUncle, fixedNeed: 12 },
    { name: 'bananas wanted', shape: MM_SHAPES.childBananasWanted, fixedNeed: 16 },
    { name: 'bananas', shape: MM_SHAPES.childBananas, fixedNeed: 16 },
];

/** The talisman talk after the toy's timer; 20 covers its 7 pages, the objbox's close and the walk in. */
export const CHILD_TALISMAN: ChildTalk = { name: 'talisman', shape: MM_SHAPES.childTalisman, fixedNeed: 20 };

/** The house ticks a child talk needs in `mode`: the fixed need less the dialogue ticks the mode saves, so the walk and margin stay as measured. */
export function childTalkNeed(t: ChildTalk, mode: DialogueMode): number {
    return t.fixedNeed - (shapeTicks(t.shape, 'fixed') - shapeTicks(t.shape, mode));
}

export interface ChildWindowModel {
    /** House ticks a window offers from its first talk: the aunt's loop less its safety ticks and the door's clearance. */
    window: number;
    /** The walk from the wait tile to the child, paid once per window. */
    walkIn: number;
    /** Ticks spent before the bananas' talk in its window: the searches and any sharks set down and taken back. */
    beforeBananas: number;
    /** Added to that talk's need for the same work (the module's own window call adds it). */
    bananasExtraNeed: number;
}

/**
 * Aunt loops the four talks take under the module's rule (a talk starts in the current window only while the house
 * time left covers its need; otherwise the next loop), with each talk costing its dialogue ticks in `mode`. An
 * inferred plan, not a measurement: the lab reports the loops each run used.
 */
export function childLoops(mode: DialogueMode, m: ChildWindowModel): number {
    let loops = 1;
    let left = m.window - m.walkIn;
    for (const t of CHILD_TALKS) {
        const banana = t === CHILD_TALKS[CHILD_TALKS.length - 1];
        const need = childTalkNeed(t, mode) + (banana ? m.bananasExtraNeed : 0);
        const cost = shapeTicks(t.shape, mode) + (banana ? m.beforeBananas : 0);
        if (left < need) {
            loops++;
            left = m.window - m.walkIn;
        }
        left -= cost;
    }
    return loops;
}
