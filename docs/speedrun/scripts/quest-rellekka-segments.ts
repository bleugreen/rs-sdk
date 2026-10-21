// Fremennik Trials: the dialogue and puzzle segments, each measured from
// standing next to its NPC or loc (travel is costed from route tiles in
// fremennik_trials.md; the merchant chain, bard and drinking trials and the
// Draugen have their own scripts).
//
//   bun docs/speedrun/scripts/quest-rellekka-segments.ts <bot> [segment...]
//
// Segments: start (Brundt), councillors (the first talk with each of the seven,
// accepting each trial), maze (Swensen's maze, ladder to ladder plus his
// dialogue), finish (Brundt with seven votes). Peer's house is
// quest-rellekka-seer.ts.
// Staging uses ::setvar on %viking and %viking_bits (quest_viking.constant).

import { runScript } from '../../../sdk/runner';
import { opLoc, talkTo } from '../../../speedrun/lib/act';
import { converse, dialogueRuns, type ConverseResult } from '../../../speedrun/lib/converse';
import type { OptionPattern } from '../../../speedrun/lib/dialogue';
import { currentTick, waitTicks } from '../../../speedrun/lib/wait';
import { pos, type StateLike } from '../../../speedrun/lib/world';
import { result } from '../../../speedrun/lab/record';
import { clearInventory, getvar, mustTele, setvar } from '../../../speedrun/lab/setup';
const SWENSEN_STARTED = 1 << 10; // quest_viking.constant

const all = ['start', 'councillors', 'maze', 'finish'];
const picked = process.argv.slice(3).filter(a => !a.startsWith('-'));
const segments = picked.length ? picked : all;

await runScript(async ({ bot, sdk }) => {
    const results: Record<string, unknown> = {};
    process.on('exit', () => { if (!results.done) result('rellekka-segments-partial', results); });
    const strip = (t: ConverseResult) => ({ ticks: t.ticks, pages: t.pages, options: t.options, runs: dialogueRuns(t.transcript) });
    const talk = async (re: RegExp, choices: OptionPattern[]) => {
        const t = await talkTo(sdk, re, choices, { keep: true, idle: 2, findTicks: 20 });
        if (!t.opened) throw new Error(`talk ${re}: no dialogue opened (at ${JSON.stringify(pos(sdk))})`);
        return t;
    };
    const finishDialogue = () => converse(sdk, [], { keep: true, idle: 2, maxTicks: 300 });

    for (const seg of segments) {
        await bot.dismissBlockingUI();
        await clearInventory(sdk);
        if (seg === 'start') {
            await setvar(sdk, 'viking', 0);
            await setvar(sdk, 'viking_bits', 0);
            await mustTele(sdk, 2660, 3670, 0);
            const t = await talk(/Brundt/, [/Do you have any quests/, /Yes, I am interested/, /I want to become a Fremennik/]);
            results.start = { ...strip(t), viking: await getvar(sdk, 'viking'), transcript: t.transcript };
        } else if (seg === 'councillors') {
            await setvar(sdk, 'viking', 1);
            await setvar(sdk, 'viking_bits', 0);
            const yes = [/^Yes$/, /What's a Draugen/];
            const list: Array<[string, RegExp, number, number, RegExp[]]> = [
                ['manni', /Manni/, 2661, 3672, yes],
                ['sigli', /Sigli/, 2660, 3654, yes],
                ['swensen', /Swensen/, 2646, 3661, yes],
                ['thorvald', /Thorvald/, 2666, 3692, yes],
                // With Thorvald's trial started Peer first asks which topic (viking_peer.rs2:11).
                ['peer', /Peer the Seer/, 2634, 3669, [/Ask about becoming a Fremennik/, ...yes]],
                ['olaf', /Olaf/, 2672, 3683, yes],
                ['sigmund', /Sigmund/, 2641, 3681, yes],
            ];
            const r: Record<string, unknown> = {};
            for (const [name, re, x, z, ch] of list) {
                await mustTele(sdk, x, z, 0);
                await waitTicks(sdk, 2);
                r[name] = strip(await talk(re, ch));
                console.log(name, JSON.stringify(r[name]));
            }
            r.bits = await getvar(sdk, 'viking_bits');
            results.councillors = r;
        } else if (seg === 'maze') {
            await setvar(sdk, 'viking', 1);
            await setvar(sdk, 'viking_bits', SWENSEN_STARTED);
            await mustTele(sdk, 2645, 3658, 0);
            await waitTicks(sdk, 2);
            const r: Record<string, unknown> = {};
            const t0 = currentTick(sdk);
            await opLoc(sdk, { x: 2644, z: 3657, op: 'Climb-down', radius: 15 }, 'Climb-down', s => pos(s).z > 9000, { maxTicks: 20 });
            r.ladderDown = currentTick(sdk) - t0;
            // The seven fixed portals (viking_hallifred.rs2:248-287), in order.
            const portals: Array<[number, number]> = [[2631, 10002], [2639, 10015], [2656, 10004], [2665, 10018], [2630, 10023], [2656, 10037], [2666, 10029]];
            const legs: number[] = [];
            for (const [x, z] of portals) {
                const p0 = currentTick(sdk);
                const before = pos(sdk);
                const moved = (s: StateLike) => Math.abs(pos(s).x - before.x) + Math.abs(pos(s).z - before.z) > 8;
                await opLoc(sdk, { x, z, op: 'Use', radius: 20 }, 'Use', moved, { maxTicks: 40 });
                await waitTicks(sdk, 1);
                legs.push(currentTick(sdk) - p0);
            }
            r.portals = legs;
            const e0 = currentTick(sdk);
            await opLoc(sdk, { x: 2665, z: 10037, op: 'Climb-up', radius: 15 }, 'Climb-up', s => pos(s).z < 4000, { maxTicks: 20 });
            r.exitLadder = currentTick(sdk) - e0;
            const d = await finishDialogue();
            r.dialogue = { pages: d.pages, options: d.options, runs: dialogueRuns(d.transcript) };
            r.total = (d.opened ? d.endTick : currentTick(sdk)) - t0;
            r.viking = await getvar(sdk, 'viking');
            results.maze = r;
        } else if (seg === 'finish') {
            await setvar(sdk, 'viking', 8);
            await mustTele(sdk, 2660, 3670, 0);
            const t = await talk(/Brundt/, [/Ask about becoming/]);
            await waitTicks(sdk, 3);
            const more = await finishDialogue(); // the new-name page from the completion queue
            results.finish = { ...strip(t), extraPages: more.pages, viking: await getvar(sdk, 'viking'), transcript: t.transcript };
        }
        console.log(seg, JSON.stringify(results[seg]));
    }
    results.done = true;
    result('rellekka-segments', results);
}, { timeout: 1_800_000, printState: false });
