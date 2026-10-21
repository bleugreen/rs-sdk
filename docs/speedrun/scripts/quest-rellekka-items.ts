// Fremennik Trials: Olaf's bard trial and Manni's drinking trial, piece by
// piece, each measured from standing next to its NPC or loc (travel between
// the pieces is costed from route tiles in fremennik_trials.md).
//
//   bun docs/speedrun/scripts/quest-rellekka-items.ts <bot> [piece...]
//
// Bard (viking_olaf.rs2, viking_troll.rs2, viking_askelapen.rs2):
//  lalli1 ("Other human?"), askeladden (pet rock), lalli2 (with the rock),
//  cauldron (rock, cabbage, potato, onion), lalli3 (golden fleece), tree (cut a
//  branch, Woodcutting 40 and an axe), lyre (knife on branch, Crafting 40),
//  spin (fleece on the Seers' Village spinning wheel), string (wool on the
//  unstrung lyre, Fletching 25), altar (raw shark on Fossegrimen's altar),
//  perform (backstage door, stage, play the lyre).
// Drinking (viking_reveller.rs2, poison_salesman.rs2, vt_council_workman.rs2):
//  salesman (buy the low alcohol keg), workman (beer for the strange object),
//  light (tinderbox on it), pipe (lit object into the longhall pipe), keg (take
//  the keg of beer), swap (low alcohol keg on it), contest (Manni).

import { runScript } from '../../../sdk/runner';
import * as L from './quest-rellekka-lib';

const bard = ['lalli1', 'askeladden', 'lalli2', 'cauldron', 'lalli3', 'tree', 'lyre', 'spin', 'string', 'altar', 'perform'];
const drink = ['salesman', 'workman', 'light', 'pipe', 'keg', 'swap', 'contest'];
const picked = process.argv.slice(3).filter(a => !a.startsWith('-'));
const pieces = picked.length ? picked : [...bard, ...drink];

await runScript(async ({ bot, sdk }) => {
    const res: Record<string, unknown> = {};
    process.on('exit', () => L.report('Fremennik items', res));
    await L.clearInv(sdk, bot);
    await L.setStats(sdk, { woodcutting: 40, crafting: 40, fletching: 25 });
    await L.cheat(sdk, 'setvar viking 1');
    const bits = async (v: number) => L.cheat(sdk, `setvar viking_bits ${v}`);
    const has = (re: RegExp) => () => L.invCount(sdk, re) > 0;
    const dlg = async () => {
        await sdk.waitForTicks(1);
        return sdk.getState()!.dialog.isOpen ? L.finishDialogue(sdk, [/^Yes$/]) : { pages: 0, options: 0, runs: '' };
    };
    const useOnLoc = async (item: RegExp, x: number, z: number, name?: RegExp) => {
        const loc = await L.findLoc(sdk, x, z, undefined, 15, name);
        await sdk.sendUseItemOnLoc(sdk.findInventoryItem(item)!.slot, loc.x, loc.z, loc.id);
    };
    const onItem = async (a: RegExp, b: RegExp) => sdk.sendUseItemOnItem(sdk.findInventoryItem(a)!.slot, sdk.findInventoryItem(b)!.slot);
    const piece = async (name: string, fn: () => Promise<unknown>, done: () => boolean, max = 60) => {
        const t0 = L.tick(sdk);
        await fn();
        const t = await L.waitUntil(sdk, () => done() || sdk.getState()!.dialog.isOpen, max);
        const d = await dlg();
        if (!done()) await L.waitUntil(sdk, done, 20);
        res[name] = { ticks: L.tick(sdk) - t0 - (d.pages + d.options > 0 ? 2 : 0), firstEffect: t === null ? null : t - t0, pages: d.pages, options: d.options, runs: d.runs, ok: done() };
        console.log(name, JSON.stringify(res[name]));
    };
    const talk = async (name: string, re: RegExp, choices: RegExp[], done?: () => boolean) => {
        const t = await L.talk(sdk, bot, re, choices);
        res[name] = { ticks: t.ticks, pages: t.pages, options: t.options, runs: t.runs, ok: done ? done() : true };
        console.log(name, JSON.stringify(res[name]));
    };

    for (const p of pieces) {
        if (p === 'lalli1') {
            await bits(L.BITS.olaf(1));
            await L.tele(sdk, 2771, 3621, 0);
            await talk(p, /Lalli/, [/Other human/]);
        } else if (p === 'askeladden') {
            await bits(L.BITS.olaf(2));
            await L.tele(sdk, 2659, 3661, 0);
            await talk(p, /Askeladden/, [], has(/Pet rock/));
        } else if (p === 'lalli2') {
            await bits(L.BITS.olaf(3));
            if (!has(/Pet rock/)()) await L.give(sdk, 'vt_useless_rock');
            await L.tele(sdk, 2771, 3621, 0);
            await talk(p, /Lalli/, []);
        } else if (p === 'cauldron') {
            await bits(L.BITS.olaf(4));
            for (const o of ['cabbage', 'potato', 'onion']) await L.give(sdk, o);
            if (!has(/Pet rock/)()) await L.give(sdk, 'vt_useless_rock');
            await L.tele(sdk, 2771, 3622, 0);
            const t0 = L.tick(sdk);
            let pages = 0;
            for (const it of [/Pet rock/, /Cabbage/, /Potato/, /Onion/]) {
                const n = L.invCount(sdk, it);
                await useOnLoc(it, 2772, 3623);
                await L.waitUntil(sdk, () => L.invCount(sdk, it) < n || sdk.getState()!.dialog.isOpen, 20);
                const d = await dlg();
                pages += d.pages;
            }
            res[p] = { ticks: L.tick(sdk) - t0, pages, olaf: ((await L.getVar(sdk, 'viking_bits'))! >> 20) & 7 };
            console.log(p, JSON.stringify(res[p]));
        } else if (p === 'lalli3') {
            await bits(L.BITS.olaf(5));
            await L.tele(sdk, 2771, 3621, 0);
            await talk(p, /Lalli/, [], has(/Golden fleece/));
        } else if (p === 'tree') {
            await L.give(sdk, 'adamant_axe');
            await L.tele(sdk, 2737, 3637, 0);
            await piece(p, () => L.opLoc(sdk, 2738, 3638, 'Cut-branch'), has(/^Branch$/));
        } else if (p === 'lyre') {
            await L.give(sdk, 'knife');
            if (!has(/^Branch$/)()) await L.give(sdk, 'viking_musical_tree_branch');
            await piece(p, () => onItem(/Knife/, /^Branch$/), has(/Unstrung lyre/));
        } else if (p === 'spin') {
            if (!has(/Golden fleece/)()) await L.give(sdk, 'viking_golden_fleece');
            await L.tele(sdk, 2712, 3471, 1);
            await piece(p, () => useOnLoc(/Golden fleece/, 2711, 3471, /Spinning wheel/i), has(/Golden wool/));
        } else if (p === 'string') {
            if (!has(/Unstrung lyre/)()) await L.give(sdk, 'viking_unstrung_lyre');
            if (!has(/Golden wool/)()) await L.give(sdk, 'viking_golden_wool');
            await piece(p, () => onItem(/Golden wool/, /Unstrung lyre/), has(/^Lyre$/));
        } else if (p === 'altar') {
            await bits(L.BITS.olaf(5));
            if (!has(/^Lyre$/)()) await L.give(sdk, 'viking_strung_lyre');
            await L.give(sdk, 'raw_shark');
            await L.tele(sdk, 2626, 3599, 0);
            await piece(p, () => useOnLoc(/Raw shark/, 2626, 3598), has(/Enchanted lyre/));
        } else if (p === 'perform') {
            await bits(L.BITS.olaf(5));
            if (!has(/Enchanted lyre/)()) await L.give(sdk, 'viking_enchanted_strung_lyre');
            await L.tele(sdk, 2668, 3683, 0);
            await sdk.waitForTicks(2);
            const t0 = L.tick(sdk);
            await L.opLoc(sdk, 2667, 3683, 'Open', /Door/);
            await L.waitUntil(sdk, () => L.pos(sdk).x <= 2666 || sdk.getState()!.dialog.isOpen, 20);
            const bouncer = await dlg();
            const door = L.tick(sdk) - t0;
            await bot.walkTo(2661, 3683, 0);
            const walk = L.tick(sdk) - t0 - door;
            const p0 = L.tick(sdk);
            await sdk.sendUseItem(sdk.findInventoryItem(/Enchanted lyre/)!.slot, 1);
            await L.waitUntil(sdk, () => sdk.getState()!.dialog.isOpen, 60);
            const olaf = await dlg();
            const vik = await L.getVar(sdk, 'viking');
            res[p] = { doorTicks: door, bouncerPages: bouncer.pages, walkToStage: walk, playToEnd: L.tick(sdk) - p0, olafPages: olaf.pages, viking: vik, at: L.pos(sdk) };
            console.log(p, JSON.stringify(res[p]));
        } else if (p === 'salesman') {
            await bits(L.BITS.revellerStarted);
            await L.give(sdk, 'coins', 250);
            await L.tele(sdk, 2696, 3495, 0);
            await talk(p, /Poison Salesman/, [/Fremennik Trials/, /^Yes$/], has(/Low alcohol keg/));
        } else if (p === 'workman') {
            await L.give(sdk, 'beer');
            await L.tele(sdk, 2656, 3592, 0);
            const t0 = L.tick(sdk);
            const w = sdk.findNearbyNpc(/Council workman/)!;
            await sdk.sendUseItemOnNpc(sdk.findInventoryItem(/^Beer$/)!.slot, w.index);
            await L.waitUntil(sdk, () => sdk.getState()!.dialog.isOpen, 30);
            const d = await dlg();
            res[p] = { ticks: L.tick(sdk) - t0 - 2, pages: d.pages, options: d.options, runs: d.runs, ok: has(/Strange object/)() };
            console.log(p, JSON.stringify(res[p]));
        } else if (p === 'light') {
            if (!has(/Strange object/)()) await L.give(sdk, 'viking_firecracker');
            await L.give(sdk, 'tinderbox');
            await piece(p, () => onItem(/Tinderbox/, /^Strange object/), has(/Lit strange object/));
        } else if (p === 'pipe') {
            await bits(L.BITS.revellerStarted);
            if (!has(/Lit strange object/)()) await L.give(sdk, 'viking_firecracker_lit');
            await L.tele(sdk, 2663, 3675, 0);
            await piece(p, () => L.opLoc(sdk, 2663, 3674, 'Put-inside'), () => !has(/Lit strange object/)());
        } else if (p === 'keg') {
            await L.tele(sdk, 2660, 3677, 0);
            await sdk.waitForTicks(2);
            const keg = sdk.findGroundItem(/Keg of beer/)!;
            await piece(p, () => sdk.sendPickup(keg.x, keg.z, keg.id), has(/Keg of beer/));
        } else if (p === 'swap') {
            await bits(L.BITS.revellerStarted | 1); // firecracker placed
            if (!has(/Keg of beer/)()) await L.give(sdk, 'viking_beerkeg');
            if (!has(/Low alcohol keg/)()) await L.give(sdk, 'viking_low_alcahol_beerkeg');
            await piece(p, () => onItem(/Low alcohol keg/, /Keg of beer/), () => !has(/Low alcohol keg/)());
        } else if (p === 'contest') {
            await bits(L.BITS.revellerStarted | 4); // keg swapped
            if (!has(/Keg of beer/)()) await L.give(sdk, 'viking_beerkeg');
            await L.tele(sdk, 2661, 3672, 0);
            await talk(p, /Manni/, [/^Yes$/]);
            await sdk.waitForTicks(4);
            const more = await dlg();
            (res[p] as Record<string, unknown>).queuedPages = more.pages;
            (res[p] as Record<string, unknown>).viking = await L.getVar(sdk, 'viking');
            console.log(p, JSON.stringify(res[p]));
        }
    }
}, { timeout: 1_800_000, printState: false });
