// Fishing Contest end to end on the lab server (docs/speedrun/quests/fishing_contest.md).
//
// Default route (helper carp): a helper who has entered the contest catches a
// raw giant carp and leaves (the carp is tradeable, skill_fishing/configs/
// fishing.obj; the hand-in only checks inv_total, bonzo.rs2:58). The scored
// account then needs the pass from the dwarf, one fish of any kind inside the
// contest (any catch moves %hemenster_comp_stage past paidfee), and Bonzo.
// VARIANT=self instead digs a red vine worm in McGrubor's Wood, stashes garlic
// in the pipe and catches the carp itself at the pipe spot.
//
// Gives one helper trade's worth (fishing rod, bait, 5 coins, Camelot runes; for
// the default route a raw giant carp; for VARIANT=self a spade and garlic).
// Run: [VARIANT=self] bash docs/speedrun/scripts/quest-smallskill-lab.sh <bot> docs/speedrun/scripts/quest-smallskill-fishingcompo.ts

import { runScript } from '../../../sdk/runner';
import type { BotSDK } from '../../../sdk/index';
import type { BotWorldState } from '../../../sdk/types';
import { act, castTeleport, slotOf, talkTo, walkTo, type TalkOptions } from '../../../speedrun/lib/act';
import { converse, dialogueRuns } from '../../../speedrun/lib/converse';
import { currentTick, waitTicks, waitUntil, type Pred } from '../../../speedrun/lib/wait';
import { findLoc, findNpc, invCount, pos, skillXp } from '../../../speedrun/lib/world';
import { Recorder, type Segment } from '../../../speedrun/lab/record';
import { cheat, clearInventory, getvar, give, mustTele, setStats, setvar } from '../../../speedrun/lab/setup';

const SELF = process.env.VARIANT === 'self';
const STAIRS = { x: 2820, z: 3484, id: 55 };  // tunnelstairstop, next to the tunnel dwarf (2820,3487)
const GATE = { x: 2642, z: 3441, id: 48 };    // fishinggateclosedr; Morris (2643,3440) checks the pass
const RAILING = { x: 2662, z: 3500, id: 51 }; // mcgruborlooserailing
const VINE = { x: 2631, z: 3498 };            // red_worm_vine (mcgrubors_wood.rs2:26-48)
const PIPE = { x: 2637, z: 3446, id: 41 };    // garlicpipe
/** Camelot teleport's landing tile (skill_magic/configs/magic_spells.dbrow tele_coord). */
const CAMELOT = { x: 2757, z: 3478 };
const XP_RATE = 25; // server/engine/src/util/WorldConfig.ts:102
/** Chapter cards and the quest scroll are closed as a player would; a choice no pattern answers ends the talk. */
const DLG: TalkOptions = { idle: 3, closeModals: true, unmatched: 'stop' };
const stage = (sdk: BotSDK) => getvar(sdk, 'fishingcompo');

/**
 * Cast Camelot teleport as one recorded row. A freshly created lab account drops
 * its first casts (the spellbook is not live yet): then staff-teleport to the
 * landing tile and book the 4 ticks measured in primitives.md section 4.
 */
async function teleport(sdk: BotSDK, rec: Recorder, label: string): Promise<Segment> {
    const r = await castTeleport(sdk, 'camelot');
    if (r.ok) return rec.add({ name: `${label} camelot teleport`, ticks: r.ticks, ...(r.resends ? { note: 'recast once' } : {}) });
    await mustTele(sdk, CAMELOT.x, CAMELOT.z);
    return rec.add({ name: `${label} camelot teleport`, ticks: 4, note: 'FALLBACK staff tele; 4 ticks from primitives.md' });
}

await runScript(async ({ bot, sdk }) => {
    const rec = new Recorder(sdk, SELF ? 'fishing_contest_self' : 'fishing_contest');
    const walk = (label: string, x: number, z: number, tol: number) =>
        rec.seg(label, async () => {
            const w = await walkTo(bot, sdk, x, z, tol);
            return w.ok ? undefined : `FAILED ${w.message}`;
        });
    const talk = (label: string, npc: RegExp, choices: RegExp[] = [], opts: TalkOptions = {}) =>
        rec.seg(label, async () => {
            rec.interact();
            const r = rec.dialogue(await talkTo(sdk, npc, choices, { ...DLG, ...opts }));
            return r.ok ? `approach ${r.firstTick - r.startTick}` : `${r.reason}`;
        });
    /**
     * Click loc `loc` with option `op` and answer any dialogue it opens. The segment
     * ends where `done` first holds, or where that dialogue closes.
     */
    const useLoc = (label: string, loc: { x: number; z: number; id: number }, op: number, done: Pred, opts: { answers?: RegExp[]; maxTicks?: number } = {}) =>
        rec.seg(label, async () => {
            rec.interact();
            const conv = converse(sdk, opts.answers ?? [], { ...DLG, openTicks: 12 });
            const r = await act(sdk, () => sdk.sendInteractLoc(loc.x, loc.z, loc.id, op), s => done(s) || s.dialog.isOpen, { maxTicks: opts.maxTicks ?? 60 });
            if (r.ok) rec.mark();
            const d = rec.dialogue(await conv);
            return r.ok ? (d.ok ? undefined : d.reason) : 'TIMEOUT';
        });

    await clearInventory(sdk);
    await setvar(sdk, 'fishingcompo', 0);
    await setvar(sdk, 'hemenster_comp_stage', 0);
    await setvar(sdk, 'hemenster_pipe_stashed', 0);
    await setStats(sdk, { magic: 99, fishing: 74 });
    const items: [string, number][] = [['fishing_rod', 1], ['fishing_bait', 5], ['coins', 5], ['lawrune', 4], ['airrune', 20]];
    if (SELF) items.push(['spade', 1], ['garlic', 1]); else items.push(['raw_giant_carp', 1]);
    for (const [o, n] of items) await give(sdk, o, n);
    await mustTele(sdk, 3222, 3218);
    await waitTicks(sdk, 6);
    await cheat(sdk, '~energy', 1);
    const xp0 = skillXp(sdk, 'fishing');
    const T0 = currentTick(sdk);

    // 1. The tunnel dwarf east of Camelot gives the pass. Clicking the stairs makes him
    // stop you, which starts the conversation one option closer to the pass than Talk-to.
    await teleport(sdk, rec, '1a');
    await walk('1b walk to the tunnel stairs', STAIRS.x, STAIRS.z + 1, 1);
    await useLoc('2 dwarf: pass (tunnel stairs: the dwarf stops you)', STAIRS, 1, () => false, {
        answers: [/^Why not\?/, /If you were my friend/, /let's be friends/i, /how am I meant to do that/i, /Fortunately I'm alright/i],
        maxTicks: 120,
    });
    console.log('stage', await stage(sdk), 'pass', invCount(sdk, /competition pass/i));

    if (SELF) {
        // McGrubor's Wood: squeeze through the loose railing, dig a red vine worm, back out.
        await teleport(sdk, rec, '3a');
        await walk('3b walk to the loose railing', RAILING.x - 1, RAILING.z, 0); // outside is the west side; the wood is entered eastwards
        await useLoc('3c squeeze through', RAILING, 1, s => pos(s).x >= RAILING.x, { maxTicks: 20 });
        await walk('3d walk to the vines', VINE.x, VINE.z - 1, 1);
        const vine = await findLoc(sdk, { name: /vine/i, op: /./, radius: 6 });
        if (!vine) throw new Error('no vine loc near ' + JSON.stringify(pos(sdk)));
        await useLoc(`3e dig ${vine.name}`, vine, vine.optionsWithIndex[0]!.opIndex, s => invCount(s, /red vine worm/i) > 0, { maxTicks: 20 });
        await walk('3f back to the railing', RAILING.x, RAILING.z, 0);
        await useLoc('3g squeeze out', RAILING, 1, s => pos(s).x < RAILING.x, { maxTicks: 20 });
        await walk('4a walk to Hemenster', GATE.x + 2, GATE.z, 1);
    } else {
        await teleport(sdk, rec, '3a');
        await walk('4a walk to Hemenster', GATE.x + 2, GATE.z, 1);
    }

    // 2. Through Morris's gate, (garlic in the pipe), pay Bonzo, one catch, Bonzo again.
    await useLoc('4b gate: Morris checks the pass', GATE, 1, s => pos(s).x <= GATE.x, { maxTicks: 30 });
    if (SELF) {
        await rec.seg('4c garlic in the pipe', async () => {
            rec.interact();
            const conv = converse(sdk, [], { ...DLG, openTicks: 15 });
            const r = await act(sdk, () => sdk.sendUseItemOnLoc(slotOf(sdk, /^garlic$/i), PIPE.x, PIPE.z, PIPE.id), s => invCount(s, /^garlic$/i) === 0, { maxTicks: 40 });
            if (r.ok) rec.mark();
            rec.dialogue(await conv);
            return r.ok ? undefined : 'TIMEOUT';
        });
    }
    await talk('5 Bonzo: pay and get a spot', /^Bonzo$/i, [/enter the competition/i], { idle: 4 });
    console.log('stage', await stage(sdk), 'comp', await getvar(sdk, 'hemenster_comp_stage'));
    {
        const spot = SELF ? { x: 2637, z: 3444 } : { x: 2630, z: 3435 };
        const caught = (s: BotWorldState) => invCount(s, /^raw (shrimps|sardine|giant carp)$/i) > (SELF ? 0 : 1);
        const fish = findNpc(sdk, /fishing spot/i, spot);
        if (!fish) throw new Error('no fishing spot');
        const op = fish.optionsWithIndex[0]!;
        // Ticks run from the click to the catch; a dialogue around it is noted, not timed.
        await rec.seg(`6 one catch at (${fish.x},${fish.z}) ${op.text}`, async () => {
            rec.interact();
            const conv = converse(sdk, [], { ...DLG, openTicks: 30, idle: 2 });
            const r = await act(sdk, () => sdk.sendInteractNpc(fish.index, op.opIndex), caught, { maxTicks: 60, resendEvery: 0 });
            if (r.ok) rec.mark();
            const d = await conv;
            const runs = dialogueRuns(d.transcript);
            return [r.ok ? '' : 'TIMEOUT', sdk.getState()!.inventory.map(i => i.name).join(','), runs ? `dialogue ${runs}` : ''].filter(Boolean).join('; ');
        });
    }
    await talk('7 Bonzo: hand over, trophy', /^Bonzo$/i, [], { idle: 4 });
    console.log('stage', await stage(sdk), 'trophy', invCount(sdk, /trophy/i));

    // 3. Back to the dwarf with the trophy.
    await teleport(sdk, rec, '8a');
    await walk('8b walk to the tunnel stairs', STAIRS.x, STAIRS.z + 1, 1);
    await talk('9 dwarf: trophy', /dwarf/i, [], { idle: 4 });
    await waitUntil(sdk, s => skillXp(s, 'fishing') > xp0, { maxTicks: 20 });
    const gained = skillXp(sdk, 'fishing') - xp0;
    console.log('stage', await stage(sdk), 'fishing xp gained', gained, '=', gained / XP_RATE, 'base');
    console.log('wall ticks start->finish', currentTick(sdk) - T0);
    rec.report();
}, { timeout: 900_000 });
