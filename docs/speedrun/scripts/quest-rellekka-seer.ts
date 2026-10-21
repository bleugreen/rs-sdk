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

import { runScript } from '../../../sdk/runner';
import * as L from './quest-rellekka-lib';

const runs = Number(process.argv.slice(3).find(a => a.startsWith('runs='))?.slice(5) ?? 1);

await runScript(async ({ bot, sdk }) => {
    const all: unknown[] = [];
    process.on('exit', () => L.report(`Seer house (partial=${all.length < runs})`, { runs: all }));
    for (let run = 0; run < runs; run++) {
        await L.clearInv(sdk, bot);
        await L.cheat(sdk, 'setvar viking 1');
        const riddle = run % 6;
        await L.cheat(sdk, `setvar viking_bits ${L.BITS.peerStarted | (riddle << 3)}`);
        await L.tele(sdk, 2631, 3669, 0);
        await sdk.waitForTicks(3);
        const steps: Array<[string, number | null]> = [];
        const T0 = L.tick(sdk);
        let dialoguePages = 0;
        let dialogueOptions = 0;
        const settle = async () => {
            await sdk.waitForTicks(1);
            if (sdk.getState()!.dialog.isOpen) {
                const d = await L.finishDialogue(sdk);
                dialoguePages += d.pages;
                dialogueOptions += d.options;
            }
        };
        const step = async (name: string, fn: () => Promise<unknown>, done: () => boolean, max = 40) => {
            const t0 = L.tick(sdk);
            await fn();
            let t: number | null = null;
            while (L.tick(sdk) - t0 < max) {
                if (done()) { t = L.tick(sdk) - t0; break; }
                const d = sdk.getState()!.dialog;
                if (d.isOpen && !d.isWaiting) {
                    const r = await L.finishDialogue(sdk);
                    dialoguePages += r.pages;
                    dialogueOptions += r.options;
                    continue;
                }
                await sdk.waitForStateUpdate();
            }
            steps.push([name, t]);
            if (t === null) throw new Error(`step ${name} timed out at ${JSON.stringify(L.pos(sdk))}; inv ${sdk.getInventory().map(i => i.name).join(', ')}`);
            await settle();
        };
        const has = (re: RegExp, n = 1) => () => L.invCount(sdk, re) >= n;
        const op = async (x: number, z: number, opt: string) => bot.interactLoc(await L.findLoc(sdk, x, z, opt), opt);
        const useOn = async (item: RegExp, x: number, z: number, name?: RegExp) => {
            const loc = await L.findLoc(sdk, x, z, undefined, 15, name);
            const it = sdk.findInventoryItem(item);
            if (!it) throw new Error(`no ${item}`);
            await sdk.sendUseItemOnLoc(it.slot, loc.x, loc.z, loc.id);
        };
        const onItem = async (a: RegExp, b: RegExp) => {
            const ia = sdk.findInventoryItem(a);
            const ib = sdk.findInventoryItem(b);
            if (!ia || !ib) throw new Error(`missing ${a} or ${b}`);
            await sdk.sendUseItemOnItem(ia.slot, ib.slot);
        };
        const level = (n: number) => () => L.pos(sdk).level === n;
        // Open a cupboard or chest and wait until the opened loc (with `opt`) is there.
        const openThen = async (name: string, x: number, z: number, opt: string) => {
            const t0 = L.tick(sdk);
            await op(x, z, 'Open');
            while (L.tick(sdk) - t0 < 30) {
                const l = (await sdk.scanNearbyLocs(15)).find(q => q.x === x && q.z === z && q.options.includes(opt));
                if (l) break;
                await sdk.waitForStateUpdate();
            }
            steps.push([`${name} open`, L.tick(sdk) - t0]);
        };

        // Riddle and lock.
        let text = '';
        const r0 = L.tick(sdk);
        await op(2631, 3667, 'Open');
        let rp = 0;
        let ro = 0;
        while (L.tick(sdk) - r0 < 60) {
            const s = sdk.getState()!;
            const d = s.dialog;
            if (d.isOpen && !d.isWaiting) {
                text += ' ' + [d.text ?? '', ...(d.allComponents ?? []).map(c => c.text)].join(' ');
                if (d.options.some(o => /Read the riddle/.test(o.text))) { await sdk.clickDialogByText(/Read the riddle/); ro++; }
                else { await sdk.sendClickDialog(0); rp++; }
                await sdk.waitForStateUpdate();
                await sdk.waitForStateUpdate();
                continue;
            }
            if (s.modalOpen && !d.isOpen) break;
            await sdk.waitForStateUpdate();
        }
        steps.push([`riddle read (${rp} pages, ${ro} option)`, L.tick(sdk) - r0]);
        const answer = ['MIND', 'TREE', 'LIFE', 'FIRE', 'TIME', 'WIND'][riddle];
        const c0 = L.tick(sdk);
        let clicks = 0;
        for (let w = 0; w < 4; w++) {
            const target = answer.charCodeAt(w) - 65;
            const [n, comp] = target <= 26 - target ? [target, 10052 + 48 + 2 * w] : [26 - target, 10052 + 47 + 2 * w];
            for (let i = 0; i < n; i++) { await sdk.sendClickComponent(comp); clicks++; }
        }
        await sdk.sendClickComponent(10052 + 57);
        clicks++;
        const solved = await L.waitUntil(sdk, () => sdk.getState()!.gameMessages.slice(-4).some(m => /solved the riddle|failed to solve/.test(m.text)), 200);
        const ok = sdk.getState()!.gameMessages.slice(-4).some(m => /solved the riddle/.test(m.text));
        steps.push([`lock ${answer} (${clicks} clicks, ${ok ? 'solved' : 'FAILED'})`, solved === null ? null : solved - c0]);
        if (!ok) throw new Error('lock not solved');
        await step('enter', () => op(2631, 3667, 'Open'), () => L.pos(sdk).z <= 3666);

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
        const mural = async () => bot.useItemOnLoc(sdk.findInventoryItem(/Red disk/)!, await L.findLoc(sdk, 2634, 3663, undefined, 15, /mural/i));
        await step('disk on mural', mural, () => L.invCount(sdk, /Red disk/) <= 1);
        await step('disk on mural', mural, has(/Vase lid/));
        await step('lid on vase', () => onItem(/Vase lid/, /Vase of water/), has(/Sealed vase/));
        await step('ladder up', () => op(2636, 3663, 'Climb-up'), level(2));
        await step('vase on frozen table', () => useOn(/Sealed vase/, 2638, 3665), has(/Frozen key/));
        await step('key on range', () => useOn(/Frozen key/, 2629, 3663), has(/Seers' key/));
        // The east trapdoor stays open for 500 ticks (viking_peer.rs2:1028).
        await step('trapdoor down (east room)', () => op(2636, 3663, 'Climb-down'), level(0));
        const v0 = L.tick(sdk);
        await step('key on exit door', () => useOn(/Seers' key/, 2636, 3667, /Door/), () => L.invCount(sdk, /Seers' key/) === 0 && L.pos(sdk).z >= 3667, 30);
        await settle();
        const out = {
            run, answer, clicks,
            total: L.tick(sdk) - T0,
            exitToEnd: L.tick(sdk) - v0,
            dialoguePages, dialogueOptions,
            viking: await L.getVar(sdk, 'viking'),
            steps
        };
        console.log('run', JSON.stringify(out));
        all.push(out);
    }
}, { timeout: 1_800_000, printState: false });
