// Fremennik Trials, Peer the Seer's house: from the first click on the entry
// door (empty inventory and equipment, Peer's trial started) to leaving by the
// exit door with %viking incremented.
//
//   bun docs/speedrun/scripts/quest-rellekka-seer.ts <bot> [runs=N]
//
// Route (viking_peer.rs2), ground floor = level 0, upper floor = level 2:
//  riddle: door (2631,3667) "Read the riddle" (two message boxes, answer is one
//    of MIND/TREE/LIFE/FIRE/TIME/WIND, random per account, lines 47 and 315-336),
//    then the combination lock (one click per letter step, +/- wraps at 26) and
//    submit; then open the door again to walk in.
//  upstairs via the ladder (2631,3663): cupboard (open, search: bucket), chest
//    (2635,3660: open, search: jug), unicorn head (red disk), bull head (wooden
//    disk), bookcase (red herring), herring on the range (goop), goop on the
//    wooden disk (second red disk); water: bucket on tap (5), bucket on jug
//    (2 + 3), jug on drain, bucket on jug (0 + 2), bucket on tap (5), bucket on
//    jug (4 + 3); 4/5ths bucket on the scale chest (vase), vase on tap.
//  downstairs into the east room via the second trapdoor (2636,3663, open it
//    first): both red disks on the mural (lid), lid on the vase.
//  upstairs again by the east room's ladder: sealed vase on the frozen table
//    (key in ice), frozen key on the range (key); down the east trapdoor; key
//    on the exit door (2636,3667).
//
// Loc clicks are raw interaction packets (opLoc without a wait): the SDK's
// interactLoc waits on its own completion heuristic, which inflates timings.

import { runScript } from '../../../sdk/runner';
import { opLoc, slotOf } from '../../../speedrun/lib/act';
import { converse } from '../../../speedrun/lib/converse';
import { currentTick, nextTick, waitTicks, waitUntil } from '../../../speedrun/lib/wait';
import { findLoc, invCount, invItem, messagesSince, pos, type StateLike } from '../../../speedrun/lib/world';
import { result } from '../../../speedrun/lab/record';
import { clearInventory, getvar, mustTele, setvar } from '../../../speedrun/lab/setup';
const PEER_STARTED = 1 << 18; // quest_viking.constant

const runs = Number(process.argv.slice(3).find(a => a.startsWith('runs='))?.slice(5) ?? 1);
const RIDDLES = ['MIND', 'TREE', 'LIFE', 'FIRE', 'TIME', 'WIND'] as const;

type Check = (s?: StateLike) => boolean;

await runScript(async ({ bot, sdk }) => {
    const all: unknown[] = [];
    process.on('exit', () => result('rellekka-seer', { partial: all.length < runs, runs: all }));
    for (let run = 0; run < runs; run++) {
        // Opened cupboards, chests and trapdoors revert after 300-500 ticks;
        // let them, so every run starts from the same state.
        if (run > 0) await waitTicks(sdk, 510);
        await bot.dismissBlockingUI();
        await clearInventory(sdk);
        await setvar(sdk, 'viking', 1);
        const riddle = run % 6;
        const answer = RIDDLES[riddle];
        if (!answer) throw new Error(`no riddle ${riddle}`);
        await setvar(sdk, 'viking_bits', PEER_STARTED | (riddle << 3));
        await mustTele(sdk, 2631, 3669, 0);
        const steps: Array<[string, number | null]> = [];
        const T0 = currentTick(sdk);
        let dialoguePages = 0;
        let dialogueOptions = 0;
        const finish = async () => {
            const d = await converse(sdk, [], { keep: true, idle: 2, maxTicks: 300 });
            dialoguePages += d.pages;
            dialogueOptions += d.options;
        };
        const settle = async () => {
            await waitTicks(sdk, 1);
            if (sdk.getState()?.dialog.isOpen) await finish();
        };
        // One raw click, then wait for `done`, answering any dialogue on the way.
        const step = async (name: string, fn: () => Promise<unknown>, done: Check, max = 40) => {
            const t0 = currentTick(sdk);
            await fn();
            let t: number | null = null;
            while (currentTick(sdk) - t0 < max) {
                const w = await waitUntil(sdk, s => done(s) || (s.dialog.isOpen && !s.dialog.isWaiting), { maxTicks: max - (currentTick(sdk) - t0) });
                if (!w.ok) break;
                if (done(w.state)) {
                    t = w.tick - t0;
                    break;
                }
                await finish();
            }
            steps.push([name, t]);
            if (t === null) throw new Error(`step ${name} timed out at ${JSON.stringify(pos(sdk))}; inv ${(sdk.getState()?.inventory ?? []).map(i => i.name).join(', ')}`);
            await settle();
        };
        const has = (re: RegExp, n = 1): Check => (s = sdk) => invCount(s, re) >= n;
        const op = (x: number, z: number, option: string) => opLoc(sdk, { x, z, op: option, radius: 15 }, option);
        const locAt = async (x: number, z: number, name?: RegExp) => {
            const loc = await findLoc(sdk, { x, z, radius: 15, ...(name ? { name } : {}) });
            if (!loc) throw new Error(`no loc at ${x},${z} (near ${JSON.stringify(pos(sdk))})`);
            return loc;
        };
        const useOn = async (item: RegExp, x: number, z: number, name?: RegExp) => {
            const loc = await locAt(x, z, name);
            await sdk.sendUseItemOnLoc(slotOf(sdk, item), loc.x, loc.z, loc.id);
        };
        const onItem = (a: RegExp, b: RegExp) => sdk.sendUseItemOnItem(slotOf(sdk, a), slotOf(sdk, b));
        const level = (n: number): Check => (s = sdk) => pos(s).level === n;
        // Open a cupboard or chest and wait until the opened loc (with `option`) is there.
        const openThen = async (name: string, x: number, z: number, option: string) => {
            const t0 = currentTick(sdk);
            const isOpen = () => findLoc(sdk, { x, z, op: option, radius: 15 });
            if (await isOpen()) {
                steps.push([`${name} already open`, 0]);
                return;
            }
            await op(x, z, 'Open');
            while (currentTick(sdk) - t0 < 30 && !(await isOpen())) await nextTick(sdk);
            steps.push([`${name} open`, currentTick(sdk) - t0]);
        };

        // Riddle and lock: read the riddle (its pages end when the lock modal is up).
        const r0 = currentTick(sdk);
        const riddlePages = converse(sdk, [/Read the riddle/], { keep: true, idle: 1, maxTicks: 60, until: s => s.modalOpen });
        await op(2631, 3667, 'Open');
        const rd = await riddlePages;
        steps.push([`riddle read (${rd.pages} pages, ${rd.options} option)`, (rd.opened ? rd.endTick : currentTick(sdk)) - r0]);
        const c0 = currentTick(sdk);
        let clicks = 0;
        for (let w = 0; w < 4; w++) {
            const target = answer.charCodeAt(w) - 65;
            const [n, comp] = target <= 26 - target ? [target, 10052 + 48 + 2 * w] : [26 - target, 10052 + 47 + 2 * w];
            for (let i = 0; i < n; i++) {
                await sdk.sendClickComponent(comp);
                clicks++;
            }
        }
        await sdk.sendClickComponent(10052 + 57);
        clicks++;
        const solved = await waitUntil(sdk, s => messagesSince(s, c0, /solved the riddle|failed to solve/).length > 0, { maxTicks: 200 });
        const ok = messagesSince(sdk, c0, /solved the riddle/).length > 0;
        steps.push([`lock ${answer} (${clicks} clicks, ${ok ? 'solved' : 'FAILED'})`, solved.ok ? solved.tick - c0 : null]);
        if (!ok) throw new Error('lock not solved');
        await step('enter', () => op(2631, 3667, 'Open'), (s = sdk) => pos(s).z <= 3666);

        await step('ladder up', () => op(2631, 3663, 'Climb-up'), level(2));
        await openThen('cupboard', 2629, 3660, 'Search');
        await step('cupboard search', () => op(2629, 3660, 'Search'), has(/Empty bucket/));
        await openThen('chest', 2635, 3660, 'Search');
        await step('chest search', () => op(2635, 3660, 'Search'), has(/Empty jug/));
        await step('unicorn head', () => op(2632, 3660, 'Study'), has(/Red disk/));
        await step('bull head', () => op(2634, 3660, 'Study'), has(/Wooden disk/));
        await step('bookcase', () => op(2634, 3665, 'Search'), has(/Red herring/));
        await step('herring on range', () => useOn(/Red herring/, 2629, 3663), has(/Sticky red goop/));
        await step('goop on wooden disk', () => onItem(/Sticky red goop/, /Wooden disk/), has(/Red disk/, 2));
        await step('bucket on tap', () => useOn(/Empty bucket/, 2629, 3661), has(/Full bucket/));
        await step('bucket into jug', () => onItem(/Full bucket/, /Empty jug/), has(/2\/5ths/));
        await step('jug down drain', () => useOn(/Full jug/, 2629, 3662), has(/Empty jug/));
        await step('bucket into jug', () => onItem(/2\/5ths/, /Empty jug/), has(/2\/3rds/));
        await step('bucket on tap', () => useOn(/Empty bucket/, 2629, 3661), has(/Full bucket/));
        await step('bucket into jug', () => onItem(/Full bucket/, /2\/3rds/), has(/4\/5ths/));
        await step('bucket on scale chest', () => useOn(/4\/5ths/, 2632, 3665), has(/^Vase$/));
        await step('vase on tap', () => useOn(/^Vase$/, 2629, 3661), has(/Vase of water/));
        // The ground floor is two rooms: the entry room (west, ladder up at
        // 2631,3663) and the exit room (east, mural and exit door), reached only
        // through the upper floor's second trapdoor at (2636,3663).
        await openThen('trapdoor', 2636, 3663, 'Climb-down');
        await step('trapdoor down (east room)', () => op(2636, 3663, 'Climb-down'), level(0));
        // The mural is a wall decoration; the SDK's useItemOnLoc paths to its face.
        const mural = async () => {
            const disk = invItem(sdk, /Red disk/);
            if (!disk) throw new Error('no red disk');
            return bot.useItemOnLoc(disk, await locAt(2634, 3663, /mural/i));
        };
        await step('disk on mural', mural, (s = sdk) => invCount(s, /Red disk/) <= 1);
        await step('disk on mural', mural, has(/Vase lid/));
        await step('lid on vase', () => onItem(/Vase lid/, /Vase of water/), has(/Sealed vase/));
        await step('ladder up', () => op(2636, 3663, 'Climb-up'), level(2));
        await step('vase on frozen table', () => useOn(/Sealed vase/, 2638, 3665), has(/Frozen key/));
        await step('key on range', () => useOn(/Frozen key/, 2629, 3663), has(/Seers' key/));
        // The east trapdoor stays open for 500 ticks (viking_peer.rs2:1028).
        await step('trapdoor down (east room)', () => op(2636, 3663, 'Climb-down'), level(0));
        const v0 = currentTick(sdk);
        await step('key on exit door', () => useOn(/Seers' key/, 2636, 3667, /Door/), (s = sdk) => invCount(s, /Seers' key/) === 0 && pos(s).z >= 3667, 30);
        await settle();
        const out = {
            run, answer, clicks,
            total: currentTick(sdk) - T0,
            exitToEnd: currentTick(sdk) - v0,
            dialoguePages, dialogueOptions,
            viking: await getvar(sdk, 'viking'),
            steps,
        };
        console.log('run', JSON.stringify(out));
        all.push(out);
    }
}, { timeout: 1_800_000, printState: false });
