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
import * as L from './quest-rellekka-lib';

const all = ['start', 'councillors', 'maze', 'finish'];
const picked = process.argv.slice(3).filter(a => !a.startsWith('-'));
const segments = picked.length ? picked : all;

await runScript(async ({ bot, sdk }) => {
    const results: Record<string, unknown> = {};
    process.on('exit', () => { if (!results.done) L.report('Fremennik segments (partial)', results); });
    const strip = (t: L.Talk) => ({ ticks: t.ticks, pages: t.pages, options: t.options, runs: t.runs });

    for (const seg of segments) {
        await L.clearInv(sdk, bot);
        if (seg === 'start') {
            await L.cheat(sdk, 'setvar viking 0');
            await L.cheat(sdk, 'setvar viking_bits 0');
            await L.tele(sdk, 2660, 3670, 0);
            const t = await L.talk(sdk, bot, /Brundt/, [/Do you have any quests/, /Yes, I am interested/, /I want to become a Fremennik/]);
            results.start = { ...strip(t), viking: await L.getVar(sdk, 'viking'), transcript: t.transcript };
        } else if (seg === 'councillors') {
            await L.cheat(sdk, 'setvar viking 1');
            await L.cheat(sdk, 'setvar viking_bits 0');
            const yes = [/^Yes$/, /What's a Draugen/];
            const list: Array<[string, RegExp, number, number, RegExp[]]> = [
                ['manni', /Manni/, 2661, 3672, yes],
                ['sigli', /Sigli/, 2660, 3654, yes],
                ['swensen', /Swensen/, 2646, 3661, yes],
                ['thorvald', /Thorvald/, 2666, 3692, yes],
                ['peer', /Peer the Seer/, 2634, 3669, yes],
                ['olaf', /Olaf/, 2672, 3683, yes],
                ['sigmund', /Sigmund/, 2641, 3681, yes]
            ];
            const r: Record<string, unknown> = {};
            for (const [name, re, x, z, ch] of list) {
                await L.tele(sdk, x, z, 0);
                await sdk.waitForTicks(2);
                r[name] = strip(await L.talk(sdk, bot, re, ch));
                console.log(name, JSON.stringify(r[name]));
            }
            r.bits = await L.getVar(sdk, 'viking_bits');
            results.councillors = r;
        } else if (seg === 'maze') {
            await L.cheat(sdk, 'setvar viking 1');
            await L.cheat(sdk, `setvar viking_bits ${L.BITS.swensenStarted}`);
            await L.tele(sdk, 2645, 3658, 0);
            await sdk.waitForTicks(2);
            const r: Record<string, unknown> = {};
            const t0 = L.tick(sdk);
            const top = await L.findLoc(sdk, 2644, 3657, 'Climb-down');
            await bot.interactLoc(top, 'Climb-down');
            await L.waitUntil(sdk, () => L.pos(sdk).z > 9000, 20);
            r.ladderDown = L.tick(sdk) - t0;
            // The seven fixed portals (viking_hallifred.rs2:248-287), in order.
            const portals: Array<[number, number]> = [[2631, 10002], [2639, 10015], [2656, 10004], [2665, 10018], [2630, 10023], [2656, 10037], [2666, 10029]];
            const legs: number[] = [];
            for (const [x, z] of portals) {
                const p0 = L.tick(sdk);
                const before = L.pos(sdk);
                const portal = await L.findLoc(sdk, x, z, 'Use', 20);
                await bot.interactLoc(portal, 'Use');
                await L.waitUntil(sdk, () => Math.abs(L.pos(sdk).x - before.x) + Math.abs(L.pos(sdk).z - before.z) > 8, 40);
                await sdk.waitForTicks(1);
                legs.push(L.tick(sdk) - p0);
            }
            r.portals = legs;
            const e0 = L.tick(sdk);
            const exit = await L.findLoc(sdk, 2665, 10037, 'Climb-up');
            await bot.interactLoc(exit, 'Climb-up');
            await L.waitUntil(sdk, () => L.pos(sdk).z < 4000, 20);
            r.exitLadder = L.tick(sdk) - e0;
            const d = await L.finishDialogue(sdk);
            r.dialogue = { pages: d.pages, options: d.options, runs: d.runs };
            r.total = L.tick(sdk) - t0 - 2;
            r.viking = await L.getVar(sdk, 'viking');
            results.maze = r;
        } else if (seg === 'finish') {
            await L.cheat(sdk, 'setvar viking 8');
            await L.tele(sdk, 2660, 3670, 0);
            const t = await L.talk(sdk, bot, /Brundt/, [/Ask about becoming/]);
            await sdk.waitForTicks(3);
            const more = await L.finishDialogue(sdk); // the new-name page from the completion queue
            results.finish = { ...strip(t), extraPages: more.pages, viking: await L.getVar(sdk, 'viking'), transcript: t.transcript };
        }
        console.log(seg, JSON.stringify(results[seg]));
    }
    results.done = true;
    L.report('Fremennik segments', results);
}, { timeout: 1_800_000, printState: false });
