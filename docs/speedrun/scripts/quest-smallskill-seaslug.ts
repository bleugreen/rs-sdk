// Sea Slug end to end on the lab server (docs/speedrun/quests/sea_slug.md).
// Resets %seaslugquest, gives what one helper trade would carry (swamp paste,
// an unlit torch, Ardougne teleport runes), sets Plague City complete for the
// Ardougne teleport and Firemaking 99 (so the stick rub cannot fail; at 30 it
// succeeds 77% of the time), casts Ardougne teleport from Lumbridge and plays
// the quest. Bailey is skipped: his only job is to hand out the torch.
// Run: bash docs/speedrun/scripts/quest-smallskill-lab.sh <bot> docs/speedrun/scripts/quest-smallskill-seaslug.ts

import { runScript } from '../../../sdk/runner';
import type { BotSDK } from '../../../sdk/index';
import type { BotWorldState } from '../../../sdk/types';
import { act, castTeleport, clickWalk, invOp, pickup, slotOf, talkTo, walkTo, type TalkOptions } from '../../../speedrun/lib/act';
import { converse } from '../../../speedrun/lib/converse';
import { currentTick, waitTicks, waitUntil, type Pred } from '../../../speedrun/lib/wait';
import { invCount, messagesSince, pos, skillXp } from '../../../speedrun/lib/world';
import { Recorder, type Segment } from '../../../speedrun/lab/record';
import { cheat, clearInventory, getvar, give, mustTele, setStats, setvar } from '../../../speedrun/lab/setup';

// Loc ids and tiles from server/content/maps/m43_51.jm2 (quest-smallskill-locate.ts).
// The platform's ground floor is server level 0, its upper floor level 1.
const LADDER_UP = { x: 2784, z: 3286, id: 2517 };   // slugladder
const LADDER_DOWN = { x: 2784, z: 3286, id: 1746 }; // laddertop
const KWALL = { x: 2764, z: 3287, id: 2519 };       // kennithwall
const PANEL = { x: 2765, z: 3288, id: 2518 };       // loosepanel
const CRANE = { x: 2768, z: 3286, id: 2520 };       // fishingcrane, used from z >= 3289 (quest_seaslug.rs2:97)
const KDOOR: [number, number, number] = [2764, 3285, 1530]; // loc_1530, the room in front of Kennith's wall
const GDOOR: [number, number, number] = [2765, 3277, 1533]; // loc_1533, the room with the broken glass
/** Ardougne teleport's landing tile (skill_magic/configs/magic_spells.dbrow tele_coord). */
const ARDOUGNE = { x: 2661, z: 3301 };
const XP_RATE = 25; // server/engine/src/util/WorldConfig.ts:102
/** Chapter cards and the quest scroll are closed as a player would; a choice no pattern answers ends the talk. */
const DLG: TalkOptions = { idle: 3, closeModals: true, unmatched: 'stop' };

const stage = (sdk: BotSDK) => getvar(sdk, 'seaslugquest');
const lvl = (l: number): Pred => s => pos(s).level === l;
/** A game message matching `re` has arrived since now. */
const msgFromNow = (sdk: BotSDK, re: RegExp): Pred => {
    const t = currentTick(sdk);
    return s => messagesSince(s, t, re).length > 0;
};

/**
 * Cast Ardougne teleport as one recorded row. A freshly created lab account drops
 * its first casts (the spellbook is not live yet): then staff-teleport to the
 * landing tile and book the 4 ticks measured in primitives.md section 4.
 */
async function teleport(sdk: BotSDK, rec: Recorder, label: string): Promise<Segment> {
    const r = await castTeleport(sdk, 'ardougne');
    if (r.ok) return rec.add({ name: `${label} ardougne teleport`, ticks: r.ticks, ...(r.resends ? { note: 'recast once' } : {}) });
    await mustTele(sdk, ARDOUGNE.x, ARDOUGNE.z);
    return rec.add({ name: `${label} ardougne teleport`, ticks: 4, note: 'FALLBACK staff tele; 4 ticks from primitives.md' });
}

/**
 * Get to (tx, tz) through the door at (dx, dz), which the client cannot see on a
 * bridged floor. Walks to the outside tile, tries the target, and only clicks
 * the door if that fails (a click on an open door would close it). Run inside
 * one segment, so the whole crossing is one row; returns its note.
 */
async function viaDoor(sdk: BotSDK, out: [number, number], door: [number, number, number], target: [number, number]): Promise<string> {
    await clickWalk(sdk, out[0], out[1], { maxTicks: 40 });
    let b = await clickWalk(sdk, target[0], target[1], { maxTicks: 6 });
    let opened = false;
    if (!b.ok) {
        opened = true;
        await sdk.sendInteractLoc(door[0], door[1], door[2], 1);
        await waitTicks(sdk, 2);
        b = await clickWalk(sdk, target[0], target[1], { maxTicks: 12 });
    }
    return `via door (${door[0]},${door[1]}) to (${target[0]},${target[1]}), ${opened ? 'opened it' : 'already open'}${b.ok ? '' : '; FAILED at ' + JSON.stringify(pos(sdk))}`;
}

await runScript(async ({ bot, sdk }) => {
    const rec = new Recorder(sdk, 'sea_slug');
    const walk = (label: string, x: number, z: number, tol: number) =>
        rec.seg(label, async () => {
            const w = await walkTo(bot, sdk, x, z, tol);
            return w.ok ? undefined : `FAILED ${w.message}`;
        });
    const cwalk = (label: string, x: number, z: number, tol = 0) =>
        rec.seg(label, async () => {
            const w = await clickWalk(sdk, x, z, { tol });
            return w.ok ? undefined : `TIMEOUT at ${JSON.stringify(w.at)}`;
        });
    const talk = (label: string, npc: RegExp, choices: RegExp[] = [], opts: TalkOptions = {}) =>
        rec.seg(label, async () => {
            rec.interact();
            const r = rec.dialogue(await talkTo(sdk, npc, choices, { ...DLG, ...opts }));
            return r.ok ? `approach ${r.firstTick - r.startTick}` : `${r.reason}`;
        });
    /**
     * Click loc `loc` (option 1) by id at its tile, without a scan: the client's loc
     * scan mislabels the platform's bridged floors. Answers any dialogue it opens;
     * the segment ends where `done` first holds, or where that dialogue closes.
     */
    const useLoc = (label: string, loc: { x: number; z: number; id: number }, done: Pred, opts: { maxTicks?: number; idle?: number } = {}) =>
        rec.seg(label, async () => {
            rec.interact();
            const conv = converse(sdk, [], { ...DLG, idle: opts.idle ?? 3, openTicks: 12 });
            const r = await act(sdk, () => sdk.sendInteractLoc(loc.x, loc.z, loc.id, 1), s => done(s) || s.dialog.isOpen, { maxTicks: opts.maxTicks ?? 60 });
            if (r.ok) rec.mark();
            const d = rec.dialogue(await conv);
            return r.ok ? (d.ok ? undefined : d.reason) : 'TIMEOUT';
        });
    const door = (label: string, out: [number, number], d: [number, number, number], target: [number, number]) => rec.seg(label, () => viaDoor(sdk, out, d, target));

    await clearInventory(sdk);
    await setvar(sdk, 'seaslugquest', 0);
    await setvar(sdk, 'elenaquest', 30);
    await setStats(sdk, { magic: 99, firemaking: 99, fishing: 1, hitpoints: 60 });
    for (const [o, n] of [['swamppaste', 1], ['torch_unlit', 1], ['lawrune', 4], ['waterrune', 4]] as const) await give(sdk, o, n);
    await mustTele(sdk, 3222, 3218);
    await waitTicks(sdk, 6); // a teleport cast straight after ::setstat magic is dropped
    await cheat(sdk, '~energy', 1);
    await waitTicks(sdk, 2);
    const xp0 = skillXp(sdk, 'fishing');
    const T0 = currentTick(sdk);

    // Witchaven: Caroline, then Holgart twice (the second talk sails).
    await teleport(sdk, rec, '1a');
    await walk('1b walk to Caroline', 2717, 3303, 1);
    await talk('2 Caroline start', /^Caroline$/i, [/how do I get there/]);
    console.log('stage', await stage(sdk));
    await talk('3 Holgart, ask for the boat', /^Holgart$/i);
    console.log('stage', await stage(sdk));
    await talk('4 Holgart, paste and sail', /^Holgart$/i, [/lets do it/i], { idle: 6, until: s => pos(s).x > 2760 && !s.dialog.isOpen });
    console.log('stage', await stage(sdk), pos(sdk));

    // Platform, first visit: glass and damp sticks, dry them, then Kennith upstairs.
    // The glass is in the west room behind the door at (2765,3277); open it from the pier tile beside it.
    await door('5a-b into the glass room', [2766, 3277], GDOOR, [2765, 3278]);
    await rec.seg('5c take the broken glass', async () => {
        rec.interact();
        return (await pickup(sdk, /^broken glass$/i)).ok ? undefined : 'TIMEOUT';
    });
    await cwalk('5d walk to damp sticks', 2784, 3289);
    await rec.seg('5e take the damp sticks', async () => {
        rec.interact();
        return (await pickup(sdk, /^damp sticks$/i)).ok ? undefined : 'TIMEOUT';
    });
    await rec.seg('5f dry the sticks (glass on sticks)', async () => {
        rec.interact();
        const conv = converse(sdk, [], { ...DLG, openTicks: 6 });
        const r = await act(sdk, () => sdk.sendUseItemOnItem(slotOf(sdk, /^broken glass$/i), slotOf(sdk, /^damp sticks$/i)), (s: BotWorldState) => invCount(s, /^dry sticks$/i) > 0, { maxTicks: 30 });
        if (r.ok) rec.mark();
        rec.dialogue(await conv);
        return r.ok ? undefined : 'TIMEOUT';
    });
    await cwalk('6a walk to the ladder', LADDER_UP.x, LADDER_UP.z - 1);
    await useLoc('6a climb up', LADDER_UP, lvl(1));
    await door('into the room by Kennith\'s wall 1', [2765, 3285], KDOOR, [KWALL.x, KWALL.z - 1]);
    await useLoc('6b Kennith 1 (through the wall)', KWALL, () => false, { maxTicks: 40 });
    console.log('stage', await stage(sdk), pos(sdk));
    await cwalk('walk to the ladder', LADDER_DOWN.x, LADDER_DOWN.z - 1, 1);
    await useLoc('6c climb down', LADDER_DOWN, lvl(0));

    // Holgart takes you to Kent's island.
    await cwalk('7a walk to Holgart (the npc click routes badly on the bridged floor)', 2782, 3277, 1);
    await talk('7 Holgart on the platform, sail to the island', /^Holgart$/i, [], { idle: 6, until: s => pos(s).z > 3310 && !s.dialog.isOpen });
    console.log('stage', await stage(sdk), pos(sdk));
    await talk('8 Kent', /^Kent$/i, [], { idle: 6 });
    console.log('stage', await stage(sdk));
    await talk('9 Holgart on the island, back to the platform', /^Holgart$/i, [], { idle: 6, until: s => pos(s).z < 3300 && !s.dialog.isOpen });
    console.log('stage', await stage(sdk), pos(sdk));

    // Light the torch, then Kennith, the panel, Kennith again and the crane.
    await rec.seg('10 rub the sticks', async () => {
        rec.interact();
        // No re-send: the rub animation holds the player still, and a second rub would restart it.
        const r = await invOp(sdk, /^dry sticks$/i, /rub/i, s => invCount(s, /^lit torch$|^torch$/i) > 0 && invCount(s, /unlit torch/i) === 0, { resendEvery: 0, maxTicks: 20 });
        return r.ok ? undefined : 'TIMEOUT';
    });
    console.log('stage', await stage(sdk), sdk.getState()!.inventory.map(i => i.name));
    await cwalk('11a walk to the ladder', LADDER_UP.x, LADDER_UP.z - 1);
    await useLoc('11b climb up with the torch', LADDER_UP, lvl(1));
    await door('into the room by Kennith\'s wall 2', [2765, 3285], KDOOR, [KWALL.x, KWALL.z - 1]);
    await useLoc('11b Kennith 2 (through the wall)', KWALL, () => false, { maxTicks: 40 });
    console.log('stage', await stage(sdk));
    await cwalk('walk to the panel', PANEL.x + 1, PANEL.z);
    await useLoc('12 kick the loose panel', PANEL, msgFromNow(sdk, /opening big enough/i), { maxTicks: 20, idle: 1 });
    console.log('stage', await stage(sdk), 'panel done', (await stage(sdk)) === 9);
    await door('into the room by Kennith\'s wall 3', [2765, 3285], KDOOR, [KWALL.x, KWALL.z - 1]);
    await useLoc('13 Kennith 3 (through the wall)', KWALL, () => false, { maxTicks: 40 });
    console.log('stage', await stage(sdk));
    await cwalk('14a stand north of the crane', CRANE.x, CRANE.z + 4); // its footprint blocks z 3286-3289
    await useLoc('14b crane', CRANE, msgFromNow(sdk, /row boat waiting below/i), { maxTicks: 20, idle: 1 });
    console.log('stage', await stage(sdk));
    await cwalk('walk to the ladder', LADDER_DOWN.x, LADDER_DOWN.z - 1, 1);
    await useLoc('15a climb down', LADDER_DOWN, lvl(0));
    await cwalk('15b walk to Holgart', 2782, 3277, 1);
    await talk('15b Holgart, back to shore', /^Holgart$/i, [], { idle: 6, until: s => pos(s).x < 2760 && !s.dialog.isOpen });
    console.log('stage', await stage(sdk), pos(sdk));
    await walk('16a walk to Caroline', 2717, 3303, 1);
    await talk('16b Caroline, reward', /^Caroline$/i);
    await waitUntil(sdk, s => skillXp(s, 'fishing') > xp0, { maxTicks: 20 });
    const gained = skillXp(sdk, 'fishing') - xp0;
    console.log('stage', await stage(sdk), 'fishing xp gained', gained, '=', gained / XP_RATE, 'base');
    console.log('wall ticks start->finish', currentTick(sdk) - T0);
    rec.report();
}, { timeout: 900_000 });
