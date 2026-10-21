// Holy Grail: every segment outside the first Fisher Realm visit (that one is
// quest-holy-grail-realm.ts), each measured from standing next to its NPC or
// loc. Travel between segments is done with ::tele and costed separately in
// docs/speedrun/quests/holy_grail.md.
//
//   bun docs/speedrun/scripts/quest-holy-grail-segments.ts <bot> [segment...]
//
// Segments, in quest order: start (King Arthur), merlin (workshop door and
// Merlin), boatout (Port Sarim monk to Entrana, gangplank included), priest
// (High Priest; the crone spawns and talks in the same dialogue), boatback
// (Entrana monk to Port Sarim, gangplank included), galahad (holy table
// napkin), whistles (Draynor Manor door and the two whistles it spawns),
// percival (goblin village sacks), realm2 (healed realm: whistle in, castle,
// two staircases, take the Grail, whistle out), reward (King Arthur).

import { runScript } from '../../../sdk/runner';
import type { BotWorldState } from '../../../sdk/types';
import { act, openDoor, opLoc, pickup, slotOf, talkTo, walkTo } from '../../../speedrun/lib/act';
import { converse, type ConverseResult } from '../../../speedrun/lib/converse';
import type { OptionPattern } from '../../../speedrun/lib/dialogue';
import { currentTick, waitTicks, waitUntil } from '../../../speedrun/lib/wait';
import { invCount, pos, type LocQuery, type OpPattern } from '../../../speedrun/lib/world';
import { result } from '../../../speedrun/lab/record';
import { clearInventory, dropMatching, ensureItem, getvar, mustTele, setvar } from '../../../speedrun/lab/setup';

const all = ['start', 'merlin', 'boatout', 'priest', 'boatback', 'galahad', 'whistles', 'percival', 'realm2', 'reward'];
const picked = process.argv.slice(3).filter(a => !a.startsWith('-'));
const segments = picked.length ? picked : all;

/** Ticks from the first page to the dialogue closing, and its clicks. */
const dlg = (d: ConverseResult) => ({ ticks: d.opened ? d.endTick - d.firstTick : 0, pages: d.pages, options: d.options, clicks: d.pages + d.options });

await runScript(async ({ bot, sdk }) => {
    await bot.dismissBlockingUI();
    const results: Record<string, unknown> = {};
    process.on('exit', () => { if (!results.done) result('holy-grail-segments-partial', results); });

    const talk = async (npc: RegExp, choices: OptionPattern[]) => {
        const r = await talkTo(sdk, npc, choices, { keep: true, findTicks: 20 });
        if (!r.opened) throw new Error(`talk ${npc}: no dialogue opened`);
        return { ...dlg(r), total: r.ticks };
    };
    /** Click a loc whose option opens a dialogue, and answer it. */
    const locDialog = async (q: LocQuery, op: OpPattern, choices: OptionPattern[] = []) => {
        await opLoc(sdk, q, op, s => s.dialog.isOpen, { maxTicks: 30 });
        const d = await converse(sdk, choices, { keep: true });
        if (!d.opened) throw new Error(`${String(op)} on ${JSON.stringify(q)}: no dialogue opened`);
        return d;
    };
    const climb = async (op: 'Climb-up' | 'Climb-down', toLevel: number) => {
        const r = await opLoc(sdk, { op, radius: 20 }, op, s => pos(s).level === toLevel, { maxTicks: 60 });
        return { ticks: r.ticks, via: `${r.loc.name}@${r.loc.x},${r.loc.z}` };
    };
    const whistle = (there: (s: BotWorldState) => boolean) =>
        act(sdk, () => sdk.sendUseItem(slotOf(sdk, /Magic whistle/i), 1), there, { maxTicks: 30 });
    // The monk's dialogue closes during the voyage (set_sail's p_delay), so
    // arrival is detected by position: on the destination ship's deck (level 1).
    const sail = async (monk: RegExp, choices: OptionPattern[], landed: (s: BotWorldState) => boolean) => {
        const t0 = currentTick(sdk);
        const d = await talkTo(sdk, monk, choices, { keep: true, idle: 2, maxTicks: 60 });
        if (!d.opened) throw new Error(`talk ${monk}: no dialogue opened`);
        await waitUntil(sdk, s => pos(s).level === 1 && landed(s), { maxTicks: 60 });
        const onDeck = currentTick(sdk) - t0;
        const arrival = await converse(sdk, [], { idle: 1 }); // "The ship arrives at ..."
        const shape = dlg(d);
        shape.pages += arrival.pages;
        shape.clicks += arrival.pages;
        const t1 = currentTick(sdk);
        await opLoc(sdk, { op: 'Cross', radius: 10 }, 'Cross', s => pos(s).level === 0 && landed(s), { maxTicks: 30 });
        return { ...shape, clickToDeck: onDeck, gangplank: currentTick(sdk) - t1, total: currentTick(sdk) - t0, at: pos(sdk) };
    };

    for (const seg of segments) {
        if (seg === 'start') {
            await setvar(sdk, 'arthur', 7);
            await setvar(sdk, 'grail', 0);
            await mustTele(sdk, 2764, 3513, 0);
            results.start = { ...(await talk(/King Arthur/, [/Tell me of this quest/, /I'd enjoy trying that/])), grail: await getvar(sdk, 'grail') };
        } else if (seg === 'merlin') {
            await setvar(sdk, 'grail', 2);
            await mustTele(sdk, 2764, 3504, 1); // outside the workshop door 1_43_54_12_47
            const door = await openDoor(sdk, 2764, 3503); // spawns Merlin inside (quest_grail.rs2:9)
            if (!door.ok) throw new Error('workshop door did not open');
            const merlin = await talk(/Merlin/, [/Thank you for the advice/]);
            results.merlin = { doorTicks: door.ticks, merlin, grail: await getvar(sdk, 'grail') };
        } else if (seg === 'boatout') {
            await clearInventory(sdk);
            await mustTele(sdk, 3046, 3236, 0);
            results.boatout = await sail(/Monk of Entrana/, [/I'm ready to go/], s => pos(s).x < 2900);
        } else if (seg === 'priest') {
            await setvar(sdk, 'grail', 3);
            await mustTele(sdk, 2851, 3347, 0);
            results.priest = { ...(await talk(/High Priest/, [/Ok, I will go searching/])), grail: await getvar(sdk, 'grail') };
        } else if (seg === 'boatback') {
            await mustTele(sdk, 2834, 3335, 0);
            results.boatback = await sail(/Monk of Entrana/, [/I'm ready to go/], s => pos(s).x > 3000);
        } else if (seg === 'galahad') {
            await setvar(sdk, 'grail', 4);
            await dropMatching(sdk, [/napkin/i]);
            await mustTele(sdk, 2612, 3476, 0);
            results.galahad = { ...(await talk(/^Galahad$/, [/I seek an item from the realm/])), napkin: invCount(sdk, /napkin/i) };
        } else if (seg === 'whistles') {
            await ensureItem(sdk, 'holy_table_napkin', /^Holy table napkin$/i);
            await dropMatching(sdk, [/Magic whistle/i]);
            await mustTele(sdk, 3105, 3364, 2); // where the manor staircase lands
            const t0 = currentTick(sdk);
            const spawned = (s: BotWorldState) => s.groundItems.some(g => /Magic whistle/i.test(g.name));
            await opLoc(sdk, { x: 3106, z: 3361, op: 'Open', radius: 5 }, 'Open', spawned, { maxTicks: 10 });
            const doorTicks = currentTick(sdk) - t0;
            for (let i = 0; i < 2; i++) await pickup(sdk, /Magic whistle/i, { maxTicks: 15 });
            results.whistles = { doorTicks, total: currentTick(sdk) - t0, whistles: invCount(sdk, /Magic whistle/i) };
        } else if (seg === 'percival') {
            await setvar(sdk, 'grail', 8);
            await ensureItem(sdk, 'magic_whistle', /^Magic whistle$/i, 2);
            await mustTele(sdk, 2959, 3506, 0);
            const t0 = currentTick(sdk);
            const d = await locDialog({ x: 2960, z: 3507, radius: 5 }, 'Open', [/Your father wishes to speak to you/]);
            results.percival = { ...dlg(d), total: d.endTick - t0, grail: await getvar(sdk, 'grail'), whistlesLeft: invCount(sdk, /Magic whistle/i) };
        } else if (seg === 'realm2') {
            await setvar(sdk, 'grail', 9);
            await ensureItem(sdk, 'magic_whistle', /^Magic whistle$/i);
            await dropMatching(sdk, [/Holy grail/i]);
            await mustTele(sdk, 2741, 3235, 0);
            const r: Record<string, unknown> = {};
            const w = await whistle(s => pos(s).z > 4600);
            r.whistleIn = w.ok ? w.ticks : null;
            r.arrivedAt = pos(sdk);
            await waitTicks(sdk, 1);
            r.walkToStairs = await walkTo(bot, sdk, 2648, 4684, 1);
            r.stairs1 = await climb('Climb-up', 1);
            await waitTicks(sdk, 1);
            r.at1 = pos(sdk);
            r.stairs2 = await climb('Climb-up', 2);
            await waitTicks(sdk, 1);
            r.at2 = pos(sdk);
            const grail = await pickup(sdk, /Holy grail/i, { maxTicks: 30 });
            r.takeGrail = grail.ticks;
            const back = await whistle(s => pos(s).z < 4000);
            r.whistleOut = back.ok ? back.ticks : null;
            results.realm2 = r;
        } else if (seg === 'reward') {
            await setvar(sdk, 'grail', 9);
            await ensureItem(sdk, 'holy_grail', /^Holy grail$/i);
            await mustTele(sdk, 2764, 3513, 0);
            const arthur = await talk(/King Arthur/, []);
            await waitTicks(sdk, 3);
            results.reward = { arthur, grail: await getvar(sdk, 'grail') };
        }
        console.log(seg, JSON.stringify(results[seg]));
    }
    results.done = true;
    result('holy-grail-segments', results);
}, { timeout: 900_000, printState: false });
