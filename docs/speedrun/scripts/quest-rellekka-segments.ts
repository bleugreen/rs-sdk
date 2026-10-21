// Fremennik Trials: the dialogue and puzzle segments, each measured from
// standing next to its NPC or loc (travel is costed from route tiles in
// fremennik_trials.md; the merchant chain, bard and drinking trials and the
// Draugen have their own scripts).
//
//   bun docs/speedrun/scripts/quest-rellekka-segments.ts <bot> [segment...]
//
// Segments: start (Brundt), councillors (the first talk with each of the seven,
// accepting each trial), maze (Swensen's maze, ladder to ladder plus his
// dialogue), seer (Peer's house: riddle, combination lock, the puzzle inside,
// out through the second door), finish (Brundt with seven votes).
// Staging uses ::setvar on %viking and %viking_bits (quest_viking.constant).

import { runScript } from '../../../sdk/runner';
import * as L from './quest-rellekka-lib';

const all = ['start', 'councillors', 'maze', 'seer', 'finish'];
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
        } else if (seg === 'seer') {
            results.seer = await seer();
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

    // Peer's house (viking_peer.rs2). Ground floor (level 0): entry door
    // (2631,3667), exit door (2636,3667), mural (2634,3663), ladders up at
    // (2631,3663) and (2636,3663). Upper floor (level 2): cupboard (2629,3660),
    // tap (2629,3661), drain (2629,3662), range (2629,3663), chest with jug
    // (2635,3660), scale chest (2632,3665), bookcase (2634,3665), frozen table
    // (2638,3665), unicorn head (2632,3660), bull head (2634,3660), trapdoor
    // down at (2631,3663).
    async function seer(): Promise<Record<string, unknown>> {
        const r: Record<string, unknown> = {};
        const steps: Array<[string, number | null]> = [];
        await L.cheat(sdk, 'setvar viking 1');
        await L.cheat(sdk, `setvar viking_bits ${L.BITS.peerStarted | (Math.floor(Math.random() * 6) << 3)}`);
        await L.tele(sdk, 2631, 3668, 0);
        await sdk.waitForTicks(3);
        const T0 = L.tick(sdk);
        const step = async (name: string, fn: () => Promise<unknown>, done: () => boolean, max = 40) => {
            const t = await L.timed(sdk, fn, done, max);
            steps.push([name, t]);
            if (t === null) throw new Error(`seer step ${name} timed out at ${JSON.stringify(L.pos(sdk))}`);
            if (sdk.getState()!.dialog.isOpen) await L.finishDialogue(sdk);
        };
        const has = (re: RegExp) => () => L.invCount(sdk, re) > 0;
        const useOn = async (item: RegExp, x: number, z: number) => {
            const loc = await L.findLoc(sdk, x, z);
            const it = sdk.findInventoryItem(item);
            if (!it) throw new Error(`no ${item} in inventory`);
            await sdk.sendUseItemOnLoc(it.slot, loc.x, loc.z, loc.id);
        };
        const itemOnItem = async (a: RegExp, b: RegExp) => {
            const ia = sdk.findInventoryItem(a);
            const ib = sdk.findInventoryItem(b);
            if (!ia || !ib) throw new Error(`missing ${a} or ${b}`);
            await sdk.sendUseItemOnItem(ia.slot, ib.slot);
        };
        const op = async (x: number, z: number, opt: string) => {
            const loc = await L.findLoc(sdk, x, z, opt);
            await bot.interactLoc(loc, opt);
        };

        // 1. Riddle: read it (two message boxes), the lock interface then opens.
        let riddleText = '';
        const d0 = L.tick(sdk);
        await op(2631, 3667, 'Open');
        let pages = 0;
        while (L.tick(sdk) - d0 < 60) {
            const d = sdk.getState()!.dialog;
            if (d.isOpen && !d.isWaiting) {
                const txt = [d.text ?? '', ...(d.allComponents ?? []).map(c => c.text)].join(' ');
                riddleText += ` ${txt}`;
                if (d.options.some(o => /Read the riddle/.test(o.text))) await sdk.clickDialogByText(/Read the riddle/);
                else { await sdk.sendClickDialog(0); pages++; }
                await sdk.waitForStateUpdate();
                await sdk.waitForStateUpdate();
                continue;
            }
            if (sdk.getState()!.interface?.isOpen && /most powerful|rings|stolen|cannot die|crushes|bread/.test(riddleText) && !d.isOpen) break;
            await sdk.waitForStateUpdate();
        }
        steps.push(['riddle read', L.tick(sdk) - d0]);
        const answer = /most powerful/.test(riddleText) ? 'MIND' : /rings the older/.test(riddleText) ? 'TREE' : /stolen/.test(riddleText) ? 'LIFE'
            : /cannot die/.test(riddleText) ? 'FIRE' : /crushes mountains/.test(riddleText) ? 'TIME' : /bread/.test(riddleText) ? 'WIND' : null;
        r.answer = answer;
        r.riddlePages = pages;
        if (!answer) throw new Error(`riddle not recognised: ${riddleText.slice(0, 200)}`);
        // 2. Combination lock: com_47..54 are -/+ per wheel, com_57 submits
        // (viking_peer.rs2:340-385). Component id = 10052 + N (interface.pack).
        const c0 = L.tick(sdk);
        let clicks = 0;
        for (let w = 0; w < 4; w++) {
            const target = answer.charCodeAt(w) - 65;
            const up = target;
            const down = 26 - target;
            const [n, comp] = up <= down ? [up, 10052 + 48 + 2 * w] : [down, 10052 + 47 + 2 * w];
            for (let i = 0; i < n; i++) { await sdk.sendClickComponent(comp); clicks++; }
        }
        await sdk.sendClickComponent(10052 + 57);
        clicks++;
        const solved = await L.waitUntil(sdk, () => (sdk.getState()!.gameMessages ?? []).slice(-5).some(m => /solved the riddle/.test(m.text)), 120);
        steps.push([`lock (${clicks} clicks)`, solved === null ? null : solved - c0]);
        if (solved === null) throw new Error('riddle not solved');
        // 3. Through the door with an empty inventory.
        await step('enter', () => op(2631, 3667, 'Open'), () => L.pos(sdk).z <= 3666);
        // 4. Upstairs: collect, cook, combine, measure water.
        await step('ladder up', () => op(2631, 3663, 'Climb-up'), () => L.pos(sdk).level === 2);
        await step('cupboard open', () => op(2629, 3660, 'Open'), async () => false as never, 6).catch(() => {});
        steps.pop();
        await step('cupboard open+search', () => op(2629, 3660, 'Search'), has(/Bucket/), 30);
        await step('chest open', () => op(2635, 3660, 'Open'), () => true, 2).catch(() => {});
        await L.waitUntil(sdk, () => false, 3);
        await step('chest search', () => op(2635, 3660, 'Search'), has(/Jug/), 30);
        await step('unicorn head', () => op(2632, 3660, 'Study'), has(/Red disk/), 30);
        await step('bull head', () => op(2634, 3660, 'Study'), has(/Wooden disk/), 30);
        await step('bookcase', () => op(2634, 3665, 'Search'), has(/Red herring/), 30);
        await step('herring on range', () => useOn(/Red herring/, 2629, 3663), has(/Red goop|Sticky red goop/), 30);
        await step('goop on disk', () => itemOnItem(/goop/i, /Wooden disk/), () => L.invCount(sdk, /Red disk/) >= 2, 10);
        await step('bucket on tap', () => useOn(/Bucket/, 2629, 3661), () => sdk.getInventory().some(i => /Bucket/.test(i.name) && /5/.test(i.name) || /Full bucket/.test(i.name)), 15).catch(e => steps.push(['tap note', String(e)]) as never);
        r.inventoryAfterTap = sdk.getInventory().map(i => i.name);
        results.seerPartial = { steps, r };
        // The remaining water and vase steps depend on item names seen above;
        // they are completed by quest-rellekka-seer.ts once the names are known.
        r.steps = steps;
        r.totalSoFar = L.tick(sdk) - T0;
        return r;
    }
}, { timeout: 1_800_000, printState: false });
