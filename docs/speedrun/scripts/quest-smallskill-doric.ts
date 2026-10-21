// Doric's Quest end to end on the lab server (docs/speedrun/quests/dorics_quest.md).
// Resets %doricquest, gives what one helper trade would carry (6 clay, 4 copper
// ore, 2 iron ore, Falador teleport runes), casts Falador teleport from Lumbridge
// and plays the quest the way the scored account would.
// Run: bash docs/speedrun/scripts/quest-smallskill-lab.sh <bot> docs/speedrun/scripts/quest-smallskill-doric.ts

import { runScript } from '../../../sdk/runner';
import type { BotSDK } from '../../../sdk/index';
import { castTeleport, talkTo, walkTo, type TalkOptions } from '../../../speedrun/lib/act';
import { pathTiles } from '../../../speedrun/lib/paths';
import { currentTick, waitTicks, waitUntil } from '../../../speedrun/lib/wait';
import { pos, skillXp } from '../../../speedrun/lib/world';
import { Recorder, type Segment } from '../../../speedrun/lab/record';
import { cheat, clearInventory, getvar, give, mustTele, setStats, setvar } from '../../../speedrun/lab/setup';

const DORIC = { x: 2952, z: 3451 };
/** Falador teleport's landing tile (skill_magic/configs/magic_spells.dbrow tele_coord). */
const FALADOR = { x: 2965, z: 3378 };
const XP_RATE = 25; // server/engine/src/util/WorldConfig.ts:102
/** Chapter cards and the quest scroll are closed as a player would; a choice no pattern answers ends the talk. */
const DLG: TalkOptions = { idle: 3, closeModals: true, unmatched: 'stop' };

/**
 * Cast Falador teleport as one recorded row. A freshly created lab account drops
 * its first casts (the spellbook is not live yet): then staff-teleport to the
 * landing tile and book the 4 ticks measured in primitives.md section 4.
 */
async function teleport(sdk: BotSDK, rec: Recorder, label: string): Promise<Segment> {
    const r = await castTeleport(sdk, 'falador');
    if (r.ok) return rec.add({ name: `${label} falador teleport`, ticks: r.ticks, ...(r.resends ? { note: 'recast once' } : {}) });
    await mustTele(sdk, FALADOR.x, FALADOR.z);
    return rec.add({ name: `${label} falador teleport`, ticks: 4, note: 'FALLBACK staff tele; 4 ticks from primitives.md' });
}

await runScript(async ({ bot, sdk }) => {
    const rec = new Recorder(sdk, 'dorics_quest');
    const walk = (label: string, x: number, z: number, tol: number) =>
        rec.seg(label, async () => {
            const w = await walkTo(bot, sdk, x, z, tol);
            return w.ok ? undefined : `FAILED ${w.message}`;
        });
    const talk = (label: string, npc: RegExp, choices: RegExp[] = []) =>
        rec.seg(label, async () => {
            rec.interact();
            const r = rec.dialogue(await talkTo(sdk, npc, choices, DLG));
            return r.ok ? `approach ${r.firstTick - r.startTick}` : `${r.reason}`;
        });

    await clearInventory(sdk);
    await setvar(sdk, 'doricquest', 0);
    await setStats(sdk, { magic: 99, mining: 1 });
    for (const [o, n] of [['clay', 6], ['copper_ore', 4], ['iron_ore', 2], ['lawrune', 5], ['airrune', 15], ['waterrune', 5]] as const) await give(sdk, o, n);
    await mustTele(sdk, 3222, 3218);
    await waitTicks(sdk, 6); // a teleport cast straight after ::setstat magic is dropped
    await cheat(sdk, '~energy', 1);
    await waitTicks(sdk, 2);
    const xp0 = skillXp(sdk, 'mining');
    const T0 = currentTick(sdk);

    const tp = await teleport(sdk, rec, '1a');
    const p1 = pos(sdk);
    const route = pathTiles(0, p1.x, p1.z, DORIC.x, DORIC.z);
    await walk(`1b walk to Doric (pathfinder ${route.tiles} tiles)`, DORIC.x, DORIC.z, 2);
    await talk('2 Doric start', /^Doric$/i, [/use your anvils/, /Yes, I will get you materials/]);
    console.log('doricquest', await getvar(sdk, 'doricquest'));
    await talk('3 Doric hand-in', /^Doric$/i);
    await waitUntil(sdk, s => skillXp(s, 'mining') > xp0, { maxTicks: 20 });
    const gained = skillXp(sdk, 'mining') - xp0;
    console.log('doricquest', await getvar(sdk, 'doricquest'), 'mining xp gained', gained, '=', gained / XP_RATE, 'base; teleport', tp.ticks);
    console.log('wall ticks start->finish', currentTick(sdk) - T0);
    rec.report();
}, { timeout: 300_000 });
