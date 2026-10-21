// Monk's Friend end to end on the lab server (docs/speedrun/quests/monks_friend.md).
// Resets %drunkmonkquest, gives what one helper trade would carry (a jug of water,
// logs, Ardougne teleport runes), sets Plague City complete for the teleport,
// casts Ardougne teleport from Lumbridge and plays the quest.
// Run: bash docs/speedrun/scripts/quest-smallskill-lab.sh <bot> docs/speedrun/scripts/quest-smallskill-drunkmonk.ts

import { runScript } from '../../../sdk/runner';
import type { BotSDK } from '../../../sdk/index';
import { castTeleport, opLoc, pickup, talkTo, walkTo, type TalkOptions } from '../../../speedrun/lib/act';
import { currentTick, waitTicks, waitUntil } from '../../../speedrun/lib/wait';
import { invCount, pos, skillXp } from '../../../speedrun/lib/world';
import { Recorder, type Segment } from '../../../speedrun/lab/record';
import { cheat, clearInventory, getvar, give, mustTele, setStats, setvar } from '../../../speedrun/lab/setup';

const OMAD = { x: 2604, z: 3209 };
const CEDRIC = { x: 2614, z: 3259 };   // he wanders the forest north of the monastery
const STONES = { x: 2561, z: 3222 };   // ^blanket_ladder_coord (quest_drunkmonk.constant:1)
const BLANKET = { x: 2570, z: 9604 };  // childs_blanket ground spawn (maps/m40_150.jm2)
/** Ardougne teleport's landing tile (skill_magic/configs/magic_spells.dbrow tele_coord). */
const ARDOUGNE = { x: 2661, z: 3301 };
const XP_RATE = 25; // server/engine/src/util/WorldConfig.ts:102
/** Chapter cards and the quest scroll are closed as a player would; a choice no pattern answers ends the talk. */
const DLG: TalkOptions = { idle: 3, closeModals: true, unmatched: 'stop' };
const stage = (sdk: BotSDK) => getvar(sdk, 'drunkmonkquest');

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

await runScript(async ({ bot, sdk }) => {
    const rec = new Recorder(sdk, 'monks_friend');
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
    await setvar(sdk, 'drunkmonkquest', 0);
    await setvar(sdk, 'elenaquest', 30);
    await setStats(sdk, { magic: 99, woodcutting: 1, attack: 70, strength: 70, defence: 70, hitpoints: 70 });
    for (const [o, n] of [['jug_water', 1], ['logs', 1], ['lawrune', 4], ['waterrune', 4], ['shark', 3]] as const) await give(sdk, o, n);
    await mustTele(sdk, 3222, 3218);
    await waitTicks(sdk, 6);
    await cheat(sdk, '~energy', 1);
    const xp0 = skillXp(sdk, 'woodcutting');
    const T0 = currentTick(sdk);

    await teleport(sdk, rec, '1a');
    await walk('1b walk to Brother Omad', OMAD.x, OMAD.z, 2);
    await talk('2 Omad: start', /^Brother Omad$/i, [/Why can't you sleep/, /Can I help at all/]);
    console.log('stage', await stage(sdk));

    // The ladder only appears while you stand within 2 tiles of the stone ring (timer, quest_drunkmonk.rs2:1-6).
    await walk('3a walk to the ring of stones', STONES.x + 1, STONES.z + 1, 0);
    await rec.seg('3b wait for the ladder to appear', async () => {
        const r = await waitUntil(sdk, s => s.nearbyLocs.some(l => l.x === STONES.x && l.z === STONES.z && /ladder/i.test(l.name)), { maxTicks: 10 });
        if (r.ok) rec.mark(r.tick);
        return r.ok ? undefined : 'TIMEOUT';
    });
    await rec.seg('3c climb down', async () => {
        rec.interact();
        const r = await opLoc(sdk, { x: STONES.x, z: STONES.z, id: 1765 }, 1, s => pos(s).z > 9000, { maxTicks: 20 });
        return r.ok ? undefined : 'TIMEOUT';
    });
    await walk('4a walk to the blanket', BLANKET.x, BLANKET.z, 1);
    await rec.seg('4b take the blanket', async () => {
        rec.interact();
        const r = await pickup(sdk, /child'?s blanket/i);
        return r.ok ? undefined : 'TIMEOUT';
    });
    await walk('4c back to the ladder', 2561, 9621, 1);
    await rec.seg('4d climb up', async () => {
        rec.interact();
        const r = await opLoc(sdk, { name: /^ladder$/i, op: /climb-up/i }, /climb-up/i, s => pos(s).z < 9000, { maxTicks: 20 });
        return r.ok ? undefined : 'TIMEOUT';
    });
    console.log('hp', sdk.getState()!.player!.hp, 'pos', pos(sdk));

    await walk('5a back to Omad', OMAD.x, OMAD.z, 2);
    await talk('5b Omad: blanket', /^Brother Omad$/i);
    console.log('stage', await stage(sdk));
    await talk('5c Omad: party, find Cedric', /^Brother Omad$/i, [/Who's Brother Cedric/, /Where should I look/]);
    console.log('stage', await stage(sdk));

    await walk('6a walk to Brother Cedric', CEDRIC.x, CEDRIC.z, 3);
    await talk('6b Cedric: drunk', /^Brother Cedric$/i);
    await talk('6c Cedric: water, cart', /^Brother Cedric$/i, [/happy to/]);
    await talk('6d Cedric: logs', /^Brother Cedric$/i);
    console.log('stage', await stage(sdk));

    await walk('7a back to Omad', OMAD.x, OMAD.z, 2);
    await rec.seg('7b Omad: party to quest complete', async seg => {
        // The party is ~33 ticks of p_delay with the chat box closed, then a queued completion.
        rec.interact();
        rec.dialogue(await talkTo(sdk, /^Brother Omad$/i, [], { ...DLG, idle: 40 }));
        const done = await waitUntil(sdk, s => skillXp(s, 'woodcutting') > xp0, { maxTicks: 80 });
        if (!done.ok) return 'no quest xp';
        rec.mark(done.tick);
        return `xp at +${done.tick - seg.startTick}`;
    });
    await waitTicks(sdk, 2);
    const gained = skillXp(sdk, 'woodcutting') - xp0;
    console.log('stage', await stage(sdk), 'woodcutting xp gained', gained, '=', gained / XP_RATE, 'base; law runes', invCount(sdk, /law rune/i));
    console.log('wall ticks start->finish', currentTick(sdk) - T0);
    rec.report();
}, { timeout: 900_000 });
