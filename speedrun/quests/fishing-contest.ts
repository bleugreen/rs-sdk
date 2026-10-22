// Fishing Contest: STEP-MANIFEST.md entry 23 (S20), the self route.
//
// The raw giant carp is untradeable (skill_fishing/configs/fishing.obj:378, tradeable=no), as are
// the red vine worm and the pass (quest_fishingcompo.obj), so SCORED does every untradeable part
// itself (main's ruling, 2026-10-22): the pass from the tunnel dwarf, a red vine worm dug in
// McGrubor's Wood, the carp caught at the contest's pipe spot, the trophy back to the dwarf. H16
// stages the rest: a fishing rod, a spade, garlic, 5 coins and the Camelot runes.
//
// From the arrival tile beside the tunnel stairs (T19-20 ends at 2820,3486 tol 1; the stairs loc
// at 2820,3484 cannot be stood on) to the quest complete beside the dwarf. Fourteen segments, A-N:
// the kit, the dwarf's pass (by the stairs, which make him stop you one option nearer the pass
// than Talk-to), Camelot teleport and the run round the wood to the railing's outside tile, in,
// the worm, out, the run to Hemenster, Morris's gate, Bonzo, the garlic, the carp, Bonzo again,
// Camelot teleport and the run back, the dwarf.
//
// What the content does that this module is built around (server/content/scripts):
// - quest_fishingcompo.rs2:7-19: the stairs start the dwarf's dialogue only while a tunnel dwarf
//   is within 5 tiles; otherwise the click does nothing and says nothing, so B falls back to
//   Talk-to after a few ticks. Neither op p_delays before its first page.
// - McGrubor's Wood lies EAST of the loose railing (2662,3500): its wall is between x 2661 and
//   2662, and the squeeze (mcgrubors_wood.rs2:12-23, p_delay(0) and a 1-tile exactmove) goes from
//   (2661,3500) to (2662,3500) and back (m, lab probe). Inside, the run to the vines winds round an
//   inner fence (37 ticks from the railing, m). Aimed at the vines from outside, the SDK
//   pathfinder routes through McGrubor's locked gate (2649,3469) and stalls, so every walk here is
//   aimed at a tile on the right side of the railing.
// - A vine's Check digs with a spade (mcgrubors_wood.rs2:25-48): the worm 2 ticks after the click.
// - The worm is the bait (hemenster_fishing.rs2:20-24 prefers it), so no fishing bait is needed,
//   and with it the pipe spot gives the carp (:29-32), never shrimps.
// - Bonzo first, then the garlic: stashing while the fee is paid sets %fishingcompo to
//   garlic_comp unconditionally (quest_fishingcompo.rs2:90-93). Stashing first leaves that to
//   ~move_hemenster_pipe, which needs the Sinister Stranger (2635,3437) within 8 tiles of the
//   player when Bonzo seats him (bonzo.rs2:40-42, quest_fishingcompo.rs2:97-105). Paying first
//   also walks fewer tiles: the pipe is beside the carp spot.
// - Leaving through the gate between paying and the trophy resets the contest (bonzo.rs2:72-81)
//   and a second entry costs 5 more coins, so H to K are logout-unsafe: a reconnect inside the fence
//   must not walk out. From won_comp the gate no longer resets anything (quest_fishingcompo.rs2:24),
//   so L is logout-safe again.
// - Every varp is scope=perm (quest_fishingcompo.varp). The quest tab shows only started; the
//   sub-stages (in_comp, garlic_comp, won_comp) come from the journal probe, and the live checks go
//   by the inventory (pass, worm, carp, trophy), never by what is in sight.

import type { BotWorldState, QuestJournalState } from '../../sdk/types';
import { act, dropItems, opLoc, talkTo, useOn, type ActSdk } from '../lib/act';
import { converse, levelUpInterrupt, type ConverseResult, type ConverseSdk } from '../lib/converse';
import type { OptionPattern } from '../lib/dialogue';
import type { ItemPattern } from '../lib/items';
import { journalProbeName, questDone, questStatus, requireQuestStage, type QuestView, type StageName } from '../lib/quests';
import { logNote } from '../lib/ticks';
import { inArea, missingRunes, runTo, runeUseOf, spellUse, SPELLS, teleport, type Area, type RuneUseTable, type TravelSdk } from '../lib/travel';
import { currentTick, waitOrThrow, waitUntil } from '../lib/wait';
import { invCount, invItem, opIndex, pos, skillLevel, waitForNpc } from '../lib/world';
import type { Check, Observed, StepContext } from '../runner/step';
import { allOf, baseLevels, inBox, kitSegment, kitWant, questSteps, slotsCover, talkShape, within, type Box, type KitItem, type QuestItem, type QuestOptions, type Segment } from './segments';

export const quest = 'fishingcompo' as const;
export const stepId = 'S20';

export type Options = QuestOptions;

// ------------------------------------------------------------------ places and things

/** T19-20's landing: beside the tunnel stairs, tolerance 1. */
export const ARRIVAL: Area = { x: 2820, z: 3486, tol: 1 };
/** tunnelstairstop (loc 55, 2x2). */
export const STAIRS = { x: 2820, z: 3484, id: 55 } as const;
/** The two Mountain Dwarves (npc 232) stand at (2821,3487) and (2821,3488) (m). */
const DWARF_RE = /^mountain dwarf$/i;
const DWARF_AT = { x: 2821, z: 3487 } as const;
/** The stairs, the dwarves and the arrival tile, for position checks by coordinates. */
export const TUNNEL: Box = { x0: 2814, z0: 3480, x1: 2826, z1: 3492 };

/** mcgruborlooserailing: its wall runs between x 2661 (outside) and 2662 (inside, the wood). */
export const RAILING = { x: 2662, z: 3500, id: 51 } as const;
export const RAILING_OUT: Area = { x: 2661, z: 3500, tol: 0 };
export const RAILING_IN: Area = { x: 2662, z: 3500, tol: 0 };
/** Beside the vine at (2631,3499) (loc 2989), the nearest one to the railing by path (m). */
export const VINE_STAND: Area = { x: 2631, z: 3500, tol: 0 };
const VINE_AT = { x: 2631, z: 3499 } as const;
/**
 * McGrubor's Wood as three boxes, from the lab's inside trail (railing to vine) and outside trail
 * (round the wood's fence). The wood is not a rectangle: west of the railing the ground north of
 * z 3499 is outside, and so are the fence-side lanes at z 3509 and x 2681-2683.
 */
export const WOOD: readonly Box[] = [
    { x0: 2662, z0: 3470, x1: 2680, z1: 3507 },
    { x0: 2642, z0: 3470, x1: 2661, z1: 3498 },
    { x0: 2620, z0: 3470, x1: 2641, z1: 3505 },
];
export const inWood = (s: BotWorldState) => WOOD.some(b => inBox(s, b));

/** fishinggateclosedr (loc 48); Morris (2643,3440) checks the pass. Inside the fence is x <= 2642. */
export const GATE = { x: 2642, z: 3441, id: 48 } as const;
export const GATE_OUT: Area = { x: 2643, z: 3441, tol: 1 };
/** Just outside the gate, east. */
export const GATE_APPROACH: Box = { x0: 2643, z0: 3436, x1: 2648, z1: 3446 };
/** The contest ground inside the fence (Bonzo 2641,3439, the willow spot 2630,3435, the pipe 2637,3446). */
export const FENCE: Box = { x0: 2622, z0: 3424, x1: 2642, z1: 3452 };
export const inFence = (s: BotWorldState) => inBox(s, FENCE);
const BONZO_RE = /^bonzo$/i;
const BONZO_AT = { x: 2641, z: 3439 } as const;
/**
 * garlicpipe (loc 41): of the three wall pipes along z 3446 only this one can be reached (the client
 * finds no route to 2636 or 2637, and a use on them gets "I can't reach that!"; m, lab probe). The
 * use is made from its own tile.
 */
export const PIPE = { x: 2638, z: 3446, id: 41 } as const;
/** 0_41_53_sinisterfishspot, the pipe spot: with the worm it gives the carp. */
export const CARP_SPOT = { x: 2637, z: 3444 } as const;

const ITEM = {
    pass: /^fishing pass$/i,
    worm: /^red vine worm$/i,
    carp: /^raw giant carp$/i,
    trophy: /^fishing trophy$/i,
    rod: /^fishing rod$/i,
    spade: /^spade$/i,
    garlic: /^garlic$/i,
    coins: /^coins$/i,
    shrimps: /^raw shrimps$/i,
    sardine: /^raw sardine$/i,
} as const;

/** The segment letters in order, for the free-slot need. */
export const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N'] as const;
type Letter = (typeof LETTERS)[number];

/** The entry fee (bonzo.rs2:24-29). */
export const FEE = 5;

/**
 * H16 as this step uses it (the self route): the rod and the worm's spade, the garlic for the pipe
 * and the fee. The Camelot runes are checked apart (RUNES). No fishing bait: the worm is the bait.
 */
export const KIT: readonly KitItem[] = [{ item: ITEM.rod }, { item: ITEM.spade }, { item: ITEM.garlic }, { item: ITEM.coins, n: FEE }];

/** The two Camelot casts the module makes (to McGrubor's Wood, and back to the dwarf). T19-20's is the leg's. */
export const RUNES = { air: 2 * SPELLS.camelot.runes.air!, law: 2 * SPELLS.camelot.runes.law! };

/** RUNES by segment (lib/travel.ts RuneUseTable): Camelot at C and at M. C and M each want their own cast held (oneCast). */
export const RUNE_USE: RuneUseTable = { C: spellUse('camelot'), M: spellUse('camelot') };

/** What A wants held: both casts' runes (runesHeld). */
export const RUNE_NEED: RuneUseTable = { A: runeUseOf(RUNES) };

/**
 * Everything the step holds, for the free-slot checks (brief addendum 8): the kit as segment A
 * receives it, each line until it leaves, then what the content gives. `until` is where the item
 * really leaves the pack: the garlic in the pipe (J), the worm on the catch (K, which deletes it
 * and adds the carp; the garlic's slot, freed at J, covers the carp there), the carp to Bonzo (L),
 * the trophy to the dwarf and the pass and spade dropped at the exit (N). Coins are a stack and
 * keep their slot (a held stack may outlast the fee); the rod goes on T20-21. Peak 2 (the pass and
 * the worm, E to K), which is the slot ledger's S20 need.
 */
export const QUEST_ITEMS: readonly QuestItem[] = [
    { item: ITEM.rod, name: 'Fishing rod', from: 'A' },
    { item: ITEM.spade, name: 'Spade', from: 'A', until: 'N' },
    { item: ITEM.garlic, name: 'Garlic', from: 'A', until: 'J' },
    { item: ITEM.coins, name: 'Coins', n: FEE, stackable: true, from: 'A' },
    // mountain_dwarf.rs2:71; never taken back, dropped at N's exit.
    { item: ITEM.pass, name: 'Fishing pass', from: 'B', until: 'N' },
    // mcgrubors_wood.rs2:48 (stackable); hemenster_fishing.rs2:28 spends it.
    { item: ITEM.worm, name: 'Red vine worm', stackable: true, from: 'E', until: 'K' },
    // hemenster_fishing.rs2:31; bonzo.rs2:60 takes it.
    { item: ITEM.carp, name: 'Raw giant carp', from: 'K', until: 'L' },
    // bonzo.rs2:62; mountain_dwarf.rs2:99 takes it.
    { item: ITEM.trophy, name: 'Fishing trophy', from: 'L', until: 'N' },
];
const slots = (at: Letter) => slotsCover(QUEST_ITEMS, LETTERS, at);

/**
 * What S20 leaves that nothing later uses, dropped at its exit (the slot ledger's T20-21 drops
 * moved into the step): the pass (never deleted), the spade (the self route's), and any raw
 * shrimps or sardine (the willow spot's or a bait catch's; Bonzo takes neither). The rod stays for
 * T20-21's drop.
 */
export const DEAD_AT_EXIT: readonly RegExp[] = [ITEM.pass, ITEM.spade, ITEM.shrimps, ITEM.sardine, ITEM.worm];
const dead = (i: { name: string }) => DEAD_AT_EXIT.some(p => p.test(i.name));

// ------------------------------------------------------------------ conversations (CONVENTIONS.md shapes, read from the scripts)

export const SHAPES = {
    /** The stairs at stage 0 (mountain_dwarf.rs2:20-23, then :33-71): the last page is followed by the pass. */
    stairs: '2c, opt, 2c, opt, 2c, opt, 2c, opt, 5c, opt, 1c, state',
    /** Talk-to at stage 0 (:8-14, then as the stairs from "Why not?"). */
    talk: '1c, opt, 2c, opt, 2c, opt, 2c, opt, 2c, opt, 5c, opt, 1c, state',
    /** Morris (quest_fishingcompo.rs2:36-43): the last page is followed by if_close and the teleport through. */
    gate: '2c, state',
    /** Bonzo's entry (bonzo.rs2:16-45): the fee is taken after "Marvelous!", the spot set after the set-places page. */
    enter: '3c, opt, 1c, state, 2c, state, 1c',
    /** The stranger moves and Bonzo gives the pipe spot (quest_fishingcompo.rs2:97-105). */
    pipe: '3c',
    /** "So how are you doing so far?" and the hand-over (bonzo.rs2:47-64). */
    carp: '2c, state, 2c',
    /** The trophy (mountain_dwarf.rs2:91-102): the completion is queued after the mesbox. */
    trophy: '4c, state, 1c',
} as const;

export const CHOICES = {
    stairs: [/^Why not\?/i, /If you were my friend/i, /let's be friends/i, /how am I meant to do that/i, /Fortunately I'm alright/i] as OptionPattern[],
    talk: [/wondering what was down those stairs/i, /^Why not\?/i, /If you were my friend/i, /let's be friends/i, /how am I meant to do that/i, /Fortunately I'm alright/i] as OptionPattern[],
    sparePass: [/another competition pass/i] as OptionPattern[],
    enter: [/enter the competition/i] as OptionPattern[],
};

/** Ticks the stairs get to open the dwarf's dialogue before B talks to him instead (m: the dialogue opened 1-2 ticks after the click). */
export const STAIRS_TICKS = 5;

// ------------------------------------------------------------------ resume evidence

const JOURNAL = journalProbeName(quest);
const stateOf = (o: QuestView): BotWorldState => ('probed' in o ? o.state : o);
const atLeast = (o: QuestView, stage: StageName<typeof quest>) => requireQuestStage(o, quest, stage, { atLeast: true }) === true;
const holds = (o: QuestView, item: ItemPattern) => invCount(stateOf(o), item) > 0;
/** Won the contest: the trophy in hand, the journal's won stage, or the quest complete. */
const won = (o: QuestView) => holds(o, ITEM.trophy) || atLeast(o, 'won_comp');

// ------------------------------------------------------------------ helpers

type Ctx = StepContext<any>;
type Sdk = TravelSdk & ActSdk & ConverseSdk;
const sdkOf = (ctx: Ctx) => ctx.sdk as unknown as Sdk;
const interrupts = () => [levelUpInterrupt()];
const note = (ctx: Ctx, seg: Letter, meta: Record<string, unknown>) => logNote(ctx.log, ctx.session, `${stepId}:${seg}`, meta);

function fail(seg: Letter, why: string, sdk?: Sdk): never {
    throw new Error(`${stepId}:${seg}: ${why}${sdk ? ` at ${JSON.stringify(pos(sdk))}` : ''}`);
}

/** Run to `to`, retrying a run that ends short ('no tick', a stall): ok only inside the area. */
async function go(ctx: Ctx, seg: Letter, to: Area, what: string): Promise<void> {
    const sdk = sdkOf(ctx);
    let why = '';
    for (let i = 0; i < 3; i++) {
        if (inArea(sdk, to)) return;
        const r = await runTo(sdk, to, { bot: ctx.bot });
        if (r.ok) return;
        why = r.reason ?? 'not arrived';
    }
    if (!inArea(sdk, to)) fail(seg, `run to ${what} (${to.x},${to.z}) failed (${why})`, sdk);
}

/** Camelot teleport, confirmed by the landing; a refusal is final, a lost cast is re-cast only if the player has not landed. */
async function camelot(ctx: Ctx, seg: Letter): Promise<void> {
    const sdk = sdkOf(ctx);
    const landing = SPELLS.camelot.landing;
    let why = '';
    for (let i = 0; i < 2; i++) {
        const r = await teleport(sdk, 'camelot', { walkOnRefusal: false });
        if (r.ok || inArea(sdk, landing)) return;
        why = r.reason ?? 'not landed';
        if (/refused/i.test(why) || r.segments.some(s => /runes short|below|Wilderness/i.test(s.note ?? ''))) break;
    }
    fail(seg, `Camelot teleport failed: ${why}`, sdk);
}

/** A conversation that must end well. */
function ensure(seg: Letter, who: string, r: ConverseResult): ConverseResult {
    if (!r.opened) fail(seg, `${who}: no dialogue opened`);
    if (!r.ok) fail(seg, `${who}: ${r.reason}`);
    return r;
}

/** Record a conversation's shape against the expected one, for the lab report. */
function noteShape(ctx: Ctx, seg: Letter, who: string, r: ConverseResult, extra: Record<string, unknown> = {}): void {
    const dialogueTicks = r.firstTick >= 0 && r.endTick >= 0 ? r.endTick - r.firstTick : null;
    note(ctx, seg, { who, ticks: r.ticks, dialogueTicks, pages: r.pages, options: r.options, ...(r.shape ? { shape: r.shape.seen, expected: r.shape.expected, matches: r.shape.matches, bursts: r.shape.bursts, failedBursts: r.shape.failedBursts } : {}), ...extra });
}

// ------------------------------------------------------------------ segment runs

/**
 * Segment B: the pass. At stage 0, click the stairs (the dwarf stops you) and answer; if no dialogue
 * opens within STAIRS_TICKS (no dwarf within 5 tiles), talk to him instead. Started without the pass
 * (lost, or banked), his "Have you won yet?" offers a spare.
 */
async function dwarfPass(ctx: Ctx, opts: Options | undefined): Promise<void> {
    const sdk = sdkOf(ctx);
    if (invItem(sdk, ITEM.pass)) return;
    const until = (s: BotWorldState) => invCount(s, ITEM.pass) > 0;
    const base = { interrupts: interrupts(), until, maxTicks: 200, unmatched: 'stop' as const };
    if (questStatus(sdk.getState()!, quest) === 'not_started') {
        const t0 = currentTick(sdk);
        const click = await opLoc(sdk, { ...STAIRS, radius: 6 }, 1, s => s.dialog.isOpen, { maxTicks: STAIRS_TICKS, resendEvery: 0 });
        if (click.ok) {
            const r = ensure('B', 'the dwarf (stairs)', await converse(sdk, CHOICES.stairs, { ...base, openTicks: 3, ...talkShape(opts, SHAPES.stairs) }));
            noteShape(ctx, 'B', 'dwarf by the stairs', r, { clickToDialogue: click.ticks });
        } else {
            const r = ensure('B', 'the dwarf (talk-to)', await talkTo(sdk, DWARF_RE, CHOICES.talk, { ...base, near: DWARF_AT, ...talkShape(opts, SHAPES.talk) }));
            noteShape(ctx, 'B', 'dwarf by talk-to (the stairs opened nothing)', r, { stairsTicks: currentTick(sdk) - t0 });
        }
    } else {
        const r = ensure('B', 'the dwarf (spare pass)', await talkTo(sdk, DWARF_RE, CHOICES.sparePass, { ...base, near: DWARF_AT }));
        noteShape(ctx, 'B', 'dwarf: a spare pass', r);
    }
    await waitOrThrow(sdk, until, 5, `${stepId}:B the pass`);
}

/** Squeeze through the railing until the player is on the far side (`inside` true: into the wood). */
async function squeeze(ctx: Ctx, seg: Letter, inside: boolean): Promise<void> {
    const sdk = sdkOf(ctx);
    const there = (s: BotWorldState) => (inside ? pos(s).x >= RAILING.x && inWood(s) : pos(s).x < RAILING.x && !inWood(s));
    if (there(sdk.getState()!)) return;
    const r = await opLoc(sdk, { ...RAILING, radius: 4 }, 1, there, { maxTicks: 20 });
    if (!r.ok) fail(seg, `the railing squeeze did not take the player ${inside ? 'in' : 'out'} within 20 ticks`, sdk);
    note(ctx, seg, { railing: inside ? 'in' : 'out', clickToOtherSide: r.ticks, resends: r.resends });
}

/** Segment E: to the vine beside the railing's nearest and dig a worm. */
async function vineWorm(ctx: Ctx): Promise<void> {
    const sdk = sdkOf(ctx);
    if (invItem(sdk, ITEM.worm)) return;
    await go(ctx, 'E', VINE_STAND, 'the vines');
    const got = (s: BotWorldState) => invCount(s, ITEM.worm) > 0;
    const r = await opLoc(sdk, { name: /^vine$/i, op: /^check$/i, near: VINE_AT, radius: 4 }, /^check$/i, got, { maxTicks: 15, interrupts: interrupts() });
    if (!r.ok) fail('E', 'the vine gave no worm within 15 ticks', sdk);
    note(ctx, 'E', { vine: `${r.loc.x},${r.loc.z}`, clickToWorm: r.ticks, resends: r.resends });
}

/** Segment H: Morris's gate. The pass is shown and the player is put through. */
async function gate(ctx: Ctx, opts: Options | undefined): Promise<void> {
    const sdk = sdkOf(ctx);
    if (inFence(sdk.getState()!)) return;
    if (!inBox(sdk.getState()!, GATE_APPROACH)) await go(ctx, 'H', GATE_OUT, 'the Hemenster gate');
    const click = await opLoc(sdk, { ...GATE, radius: 6 }, /^open$/i, s => s.dialog.isOpen || inFence(s), { maxTicks: 15, interrupts: interrupts() });
    if (!click.ok) fail('H', 'the gate opened no dialogue within 15 ticks', sdk);
    const r = await converse(sdk, [], { openTicks: 3, until: inFence, interrupts: interrupts(), maxTicks: 40, ...talkShape(opts, SHAPES.gate) });
    if (!r.ok) fail('H', `Morris: ${r.reason}`, sdk);
    await waitOrThrow(sdk, inFence, 5, `${stepId}:H inside the fence`);
    noteShape(ctx, 'H', 'Morris', r, { clickToDialogue: click.ticks });
}

/** Segment I: pay Bonzo the fee and take a spot (stage in_comp). */
async function enter(ctx: Ctx, opts: Options | undefined): Promise<void> {
    const sdk = sdkOf(ctx);
    const coins = invCount(sdk, ITEM.coins);
    const r = ensure('I', 'Bonzo (entry)', await talkTo(sdk, BONZO_RE, CHOICES.enter, { near: BONZO_AT, interrupts: interrupts(), unmatched: 'stop', maxTicks: 120, ...talkShape(opts, SHAPES.enter) }));
    noteShape(ctx, 'I', 'Bonzo: entry', r);
    // A resumed entry (the fee already paid, no spot yet) skips the fee: bonzo.rs2:3-6.
    if (r.options > 0 && invCount(sdk, ITEM.coins) > coins - FEE) fail('I', `Bonzo did not take the fee (${coins} coins before, ${invCount(sdk, ITEM.coins)} after)`);
}

/** Segment J: the garlic in the pipe; the stranger moves and the pipe spot is ours (stage garlic_comp). */
async function garlic(ctx: Ctx, opts: Options | undefined): Promise<void> {
    const sdk = sdkOf(ctx);
    if (!invItem(sdk, ITEM.garlic)) return;
    const t0 = currentTick(sdk);
    const gone = (s: BotWorldState) => invCount(s, ITEM.garlic) === 0;
    const u = await useOn(sdk, ITEM.garlic, { loc: { ...PIPE } }, gone, { maxTicks: 30 });
    if (!u.ok) fail('J', `the garlic did not go into the pipe (${u.reason})`, sdk);
    // The stranger's and Bonzo's pages follow in the same script, with no delay, only when the stranger
    // is within 8 tiles of the player (quest_fishingcompo.rs2:97); from this pipe he usually is not (he
    // stands 9 off, m), so look for one tick rather than wait out converse's default.
    await waitUntil(sdk, s => s.dialog.isOpen, { maxTicks: 1 });
    if (sdk.getState()!.dialog.isOpen) {
        const r = await converse(sdk, [], { openTicks: 1, interrupts: interrupts(), maxTicks: 30, ...talkShape(opts, SHAPES.pipe) });
        if (!r.ok) fail('J', `the pipe dialogue: ${r.reason}`, sdk);
        noteShape(ctx, 'J', 'the stranger moves', r, { clickToStash: u.ticks, ticks: currentTick(sdk) - t0 });
    } else note(ctx, 'J', { stranger: 'out of range, no pages', clickToStash: u.ticks, ticks: currentTick(sdk) - t0 });
}

/** Segment K: one catch at the pipe spot with the worm: the carp. */
async function carp(ctx: Ctx): Promise<void> {
    const sdk = sdkOf(ctx);
    if (invItem(sdk, ITEM.carp)) return;
    if (!invItem(sdk, ITEM.worm)) fail('K', 'no red vine worm to bait the pipe spot with');
    const spot = await waitForNpc(sdk, /^fishing spot$/i, 10, CARP_SPOT);
    if (!spot || spot.x !== CARP_SPOT.x || spot.z !== CARP_SPOT.z) fail('K', `the pipe spot is not at ${CARP_SPOT.x},${CARP_SPOT.z}`, sdk);
    const op = opIndex(spot, /^fish$/i) ?? 1;
    const caught = (s: BotWorldState) => invCount(s, ITEM.carp) > 0;
    // p_delay(4) between the cast and the catch (hemenster_fishing.rs2:100): a re-click inside it is dropped, one after it would cast again.
    const r = await act(sdk, () => sdk.sendInteractNpc(spot.index, op), s => caught(s) || s.dialog.isOpen, { maxTicks: 30, resendEvery: 8, maxResends: 2, interrupts: interrupts() });
    if (sdk.getState()!.dialog.isOpen && !caught(sdk.getState()!)) {
        const d = await converse(sdk, [], { idle: 2, interrupts: interrupts() });
        fail('K', `the pipe spot opened a dialogue instead of a catch (${d.transcript.slice(0, 2).join(' | ')})`, sdk);
    }
    if (!r.ok) fail('K', 'no carp within 30 ticks', sdk);
    note(ctx, 'K', { clickToCarp: r.ticks, resends: r.resends });
}

/** Segment L: Bonzo takes the carp and gives the trophy (stage won_comp). */
async function handIn(ctx: Ctx, opts: Options | undefined): Promise<void> {
    const sdk = sdkOf(ctx);
    if (invItem(sdk, ITEM.trophy)) return;
    const until = (s: BotWorldState) => invCount(s, ITEM.trophy) > 0;
    const r = ensure('L', 'Bonzo (the carp)', await talkTo(sdk, BONZO_RE, [], { near: BONZO_AT, until, interrupts: interrupts(), unmatched: 'stop', maxTicks: 80, ...talkShape(opts, SHAPES.carp) }));
    noteShape(ctx, 'L', 'Bonzo: the carp', r);
    await waitOrThrow(sdk, until, 5, `${stepId}:L the trophy`);
}

/**
 * Segment N: the trophy to the dwarf; the completion is queued after his pages (stage 5, 2,437
 * Fishing). Its scroll and level-up pages are closed and the dead items dropped. Resumed after the
 * quest completed, it only drops.
 */
async function trophy(ctx: Ctx, opts: Options | undefined): Promise<void> {
    const sdk = sdkOf(ctx);
    if (questStatus(sdk.getState()!, quest) !== 'complete') {
        const r = ensure('N', 'the dwarf (trophy)', await talkTo(sdk, DWARF_RE, [], { near: DWARF_AT, interrupts: interrupts(), unmatched: 'stop', maxTicks: 80, ...talkShape(opts, SHAPES.trophy) }));
        noteShape(ctx, 'N', 'dwarf: the trophy', r);
        await waitOrThrow(sdk, s => questStatus(s, quest) === 'complete', 10, `${stepId}:N Fishing Contest complete`);
        // The reward's level-up pages and the quest scroll (a modal).
        await converse(sdk, [], { openTicks: 2, idle: 1, closeModals: true, interrupts: interrupts() });
        if (sdk.getState()?.modalOpen) {
            await sdk.sendCloseModal();
            await waitUntil(sdk, s => !s.modalOpen, { maxTicks: 3 });
        }
    }
    const d = await dropItems(sdk, dead);
    if (!d.ok) fail('N', `exit: the dead items (${(sdk.getState()?.inventory ?? []).filter(dead).map(i => i.name).join(', ')}) were not dropped`);
}

// ------------------------------------------------------------------ checks

const need = (what: string, ok: boolean, why: string): true | string => (ok ? true : `${what}: ${why}`);
const runesHeld: Check<any> = s => missingRunes(s, RUNES) ?? true;
const magicForCamelot: Check<any> = s => need('Magic', skillLevel(s, 'magic') >= SPELLS.camelot.magic, `${skillLevel(s, 'magic')} is below ${SPELLS.camelot.magic} for the Camelot teleport`);
const oneCast: Check<any> = s => missingRunes(s, SPELLS.camelot.runes) ?? true;
const notStarted: Check<any> = s => requireQuestStage(s, quest, 'not_started');
const atArrival = within({ x0: ARRIVAL.x - 1, z0: ARRIVAL.z - 1, x1: ARRIVAL.x + 1, z1: ARRIVAL.z + 1 }, 'the arrival tile beside the tunnel stairs');
const hasItem = (item: ItemPattern, what: string): Check<any> => s => need(what, invCount(s, item) > 0, 'not held');
const nearTunnel = within(TUNNEL, 'the tunnel stairs');
const kitHeld: Check<any> = s => {
    const want = kitWant(s, KIT);
    return want.length ? `kit missing: ${want.map(w => `${w.amount} x ${String(w.item)}`).join(', ')}` : true;
};
const outsideWood: Check<any> = s => need('position', !inWood(s), 'inside McGrubor\'s Wood');
const insideWood: Check<any> = s => need('position', inWood(s), `not inside McGrubor's Wood (at ${pos(s).x},${pos(s).z})`);
const outsideFence: Check<any> = s => need('position', !inFence(s), 'inside the contest fence');
const insideFence = within(FENCE, 'the contest fence');
const atRailingOut: Check<any> = s => need('position', inArea(s, { ...RAILING_OUT, tol: 2 }) && !inWood(s), `not at the railing's outside tile (at ${pos(s).x},${pos(s).z})`);
const atGate = within(GATE_APPROACH, 'outside the Hemenster gate');
const noDeadItems: Check<any> = s => {
    const held = s.inventory.filter(dead);
    return held.length ? `exit: still holding ${held.map(i => i.name).join(', ')}` : true;
};

// ------------------------------------------------------------------ the segments

export function steps(opts?: Options) {
    const probes = [JOURNAL] as const;
    const segs: Segment[] = [
        kitSegment(opts, KIT, {
            preconditions: allOf(atArrival, notStarted, baseLevels({ fishing: 10 }), magicForCamelot, runesHeld, slots('A')),
        }),
        {
            letter: 'B', label: 'dwarf-pass', logoutSafe: true,
            // At stage 0 B needs A's kit: the resume walk takes the latest segment that can start, and
            // must not skip A's check by starting B on a fresh arrival without the kit.
            preconditions: allOf(nearTunnel, (s, c) => (questStatus(s, quest) === 'started' ? true : kitHeld(s, c)), slots('B')),
            run: ctx => dwarfPass(ctx, opts),
            postconditions: hasItem(ITEM.pass, 'the fishing pass'),
            done: o => (atLeast(o, 'started') && holds(o, ITEM.pass)) || won(o),
        },
        {
            letter: 'C', label: 'to-railing', logoutSafe: true,
            preconditions: allOf(outsideWood, outsideFence, magicForCamelot, oneCast),
            run: async ctx => {
                if (inArea(sdkOf(ctx), RAILING_OUT)) return;
                await camelot(ctx, 'C');
                await go(ctx, 'C', RAILING_OUT, "McGrubor's railing (outside)");
            },
        },
        {
            letter: 'D', label: 'railing-in', logoutSafe: true,
            preconditions: atRailingOut,
            run: ctx => squeeze(ctx, 'D', true),
            postconditions: insideWood,
        },
        {
            letter: 'E', label: 'vine-worm', logoutSafe: true,
            preconditions: allOf(insideWood, hasItem(ITEM.spade, 'a spade'), slots('E')),
            run: ctx => vineWorm(ctx),
            postconditions: hasItem(ITEM.worm, 'the red vine worm'),
            done: o => holds(o, ITEM.worm) || holds(o, ITEM.carp) || won(o),
            probes,
        },
        {
            letter: 'F', label: 'railing-out', logoutSafe: true,
            preconditions: insideWood,
            run: async ctx => {
                await go(ctx, 'F', RAILING_IN, "McGrubor's railing (inside)");
                await squeeze(ctx, 'F', false);
            },
            postconditions: outsideWood,
        },
        {
            letter: 'G', label: 'to-gate', logoutSafe: true,
            preconditions: allOf(outsideWood, outsideFence),
            run: ctx => go(ctx, 'G', GATE_OUT, 'the Hemenster gate'),
        },
        {
            letter: 'H', label: 'gate', logoutSafe: false,
            preconditions: allOf(atGate, hasItem(ITEM.pass, 'the fishing pass')),
            run: ctx => gate(ctx, opts),
            postconditions: insideFence,
        },
        {
            letter: 'I', label: 'bonzo-enter', logoutSafe: false,
            preconditions: allOf(insideFence, s => need('coins', invCount(s, ITEM.coins) >= FEE, `${invCount(s, ITEM.coins)} held, the fee is ${FEE}`)),
            run: ctx => enter(ctx, opts),
            done: o => atLeast(o, 'in_comp') || holds(o, ITEM.carp) || won(o),
            probes,
        },
        {
            letter: 'J', label: 'garlic-pipe', logoutSafe: false,
            preconditions: allOf(insideFence, hasItem(ITEM.garlic, 'the garlic')),
            run: ctx => garlic(ctx, opts),
            postconditions: s => need('garlic', invCount(s, ITEM.garlic) === 0, 'still held'),
            done: o => atLeast(o, 'garlic_comp') || holds(o, ITEM.carp) || won(o),
            probes,
        },
        {
            letter: 'K', label: 'carp', logoutSafe: false,
            preconditions: allOf(insideFence, hasItem(ITEM.worm, 'the red vine worm'), hasItem(ITEM.rod, 'a fishing rod'), s => need('Fishing', skillLevel(s, 'fishing') >= 10, 'below 10 (hemenster_fishing.rs2:70)')),
            run: ctx => carp(ctx),
            postconditions: hasItem(ITEM.carp, 'the raw giant carp'),
            done: o => holds(o, ITEM.carp) || won(o),
            probes,
        },
        {
            letter: 'L', label: 'bonzo-carp', logoutSafe: true,
            preconditions: allOf(insideFence, hasItem(ITEM.carp, 'the raw giant carp')),
            run: ctx => handIn(ctx, opts),
            postconditions: hasItem(ITEM.trophy, 'the fishing trophy'),
            done: o => won(o),
            probes,
        },
        {
            letter: 'M', label: 'to-dwarf', logoutSafe: true,
            preconditions: allOf(hasItem(ITEM.trophy, 'the fishing trophy'), s => (inBox(s, TUNNEL) ? true : allOf(magicForCamelot, oneCast)(s, undefined))),
            run: async ctx => {
                if (inBox(ctx.sdk.getState()!, TUNNEL)) return;
                await camelot(ctx, 'M');
                await go(ctx, 'M', ARRIVAL, 'the tunnel stairs');
            },
            postconditions: nearTunnel,
        },
        {
            letter: 'N', label: 'dwarf-trophy', logoutSafe: true,
            preconditions: allOf(nearTunnel, s => (questStatus(s, quest) === 'complete' || invCount(s, ITEM.trophy) > 0 ? true : 'the fishing trophy: not held')),
            run: ctx => trophy(ctx, opts),
            postconditions: allOf(s => requireQuestStage(s, quest, 'complete'), nearTunnel, s => (s.dialog.isOpen || s.modalOpen ? 'a dialogue or modal is still open' : true), noDeadItems),
            done: o => questDone(quest)(o) && !stateOf(o).inventory.some(dead),
        },
    ];
    return questSteps(stepId, segs);
}

/** For tests and the lab: the observation `done` checks read. */
export function observed(state: BotWorldState, journal?: Pick<QuestJournalState, 'title' | 'lines'>): Observed {
    return { state, probed: journal ? { [JOURNAL]: { open: false, tick: state.tick, ...journal } } : {} };
}
