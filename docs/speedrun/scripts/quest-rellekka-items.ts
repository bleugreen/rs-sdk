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
import { act, opLoc, slotOf, talkTo, walkTo } from '../../../speedrun/lib/act';
import { converse, dialogueRuns } from '../../../speedrun/lib/converse';
import type { OptionPattern } from '../../../speedrun/lib/dialogue';
import { currentTick, waitTicks, waitUntil } from '../../../speedrun/lib/wait';
import { findLoc, findNpc, invCount, pos, type StateLike } from '../../../speedrun/lib/world';
import { result } from '../../../speedrun/lab/record';
import { clearInventory, getvar, give, mustTele, setStats, setvar } from '../../../speedrun/lab/setup';
const REVELLER_STARTED = 1 << 12; // quest_viking.constant
const olafStage = (stage: number) => stage << 20;

const bard = ['lalli1', 'askeladden', 'lalli2', 'cauldron', 'lalli3', 'tree', 'lyre', 'spin', 'string', 'altar', 'perform'];
const drink = ['salesman', 'workman', 'light', 'pipe', 'keg', 'swap', 'contest'];
const picked = process.argv.slice(3).filter(a => !a.startsWith('-'));
const pieces = picked.length ? picked : [...bard, ...drink];

type Check = (s?: StateLike) => boolean;

await runScript(async ({ bot, sdk }) => {
    const res: Record<string, Record<string, unknown>> = {};
    process.on('exit', () => result('rellekka-items', res));
    await bot.dismissBlockingUI();
    await clearInventory(sdk);
    await setStats(sdk, { woodcutting: 40, crafting: 40, fletching: 25 });
    await setvar(sdk, 'viking', 1);
    const bits = (v: number) => setvar(sdk, 'viking_bits', v);
    const has = (re: RegExp): Check => (s = sdk) => invCount(s, re) > 0;
    /** Answer the dialogue that opened (if one did) a tick after the effect. */
    const dlg = async () => {
        await waitTicks(sdk, 1);
        if (!sdk.getState()?.dialog.isOpen) return { pages: 0, options: 0, runs: '' };
        const d = await converse(sdk, [/^Yes$/], { keep: true, idle: 2, maxTicks: 300 });
        return { pages: d.pages, options: d.options, runs: dialogueRuns(d.transcript) };
    };
    const locAt = async (x: number, z: number, name?: RegExp) => {
        const loc = await findLoc(sdk, { x, z, radius: 15, ...(name ? { name } : {}) });
        if (!loc) throw new Error(`no loc at ${x},${z} (near ${JSON.stringify(pos(sdk))})`);
        return loc;
    };
    const op = (x: number, z: number, option: string, name?: RegExp) => opLoc(sdk, { x, z, radius: 15, ...(name ? { name } : {}) }, option);
    const useOnLoc = async (item: RegExp, x: number, z: number, name?: RegExp) => {
        const loc = await locAt(x, z, name);
        await sdk.sendUseItemOnLoc(slotOf(sdk, item), loc.x, loc.z, loc.id);
    };
    const onItem = (a: RegExp, b: RegExp) => sdk.sendUseItemOnItem(slotOf(sdk, a), slotOf(sdk, b));
    // One click, never re-sent: a repeated skilling click restarts the action.
    const piece = async (name: string, fn: () => Promise<unknown>, done: Check, max = 60) => {
        const t0 = currentTick(sdk);
        const first = await act(sdk, fn, s => done(s) || s.dialog.isOpen, { maxTicks: max, resendEvery: 0 });
        const d = await dlg();
        if (!done()) await waitUntil(sdk, s => done(s), { maxTicks: 20 });
        res[name] = { ticks: currentTick(sdk) - t0 - (d.pages + d.options > 0 ? 2 : 0), firstEffect: first.ok ? first.ticks : null, pages: d.pages, options: d.options, runs: d.runs, ok: done() };
        console.log(name, JSON.stringify(res[name]));
    };
    const talk = async (name: string, re: RegExp, choices: OptionPattern[], done?: Check) => {
        const t = await talkTo(sdk, re, choices, { keep: true, idle: 2, findTicks: 20 });
        if (!t.opened) throw new Error(`${name}: no dialogue opened (at ${JSON.stringify(pos(sdk))})`);
        res[name] = { ticks: t.ticks, pages: t.pages, options: t.options, runs: dialogueRuns(t.transcript), ok: done ? done() : true };
        console.log(name, JSON.stringify(res[name]));
    };

    for (const p of pieces) {
        if (p === 'lalli1') {
            await bits(olafStage(1));
            await mustTele(sdk, 2771, 3621, 0);
            await talk(p, /Lalli/, [/Other human/]);
        } else if (p === 'askeladden') {
            await bits(olafStage(2));
            await mustTele(sdk, 2659, 3661, 0);
            await talk(p, /Askeladden/, [], has(/Pet rock/));
        } else if (p === 'lalli2') {
            await bits(olafStage(3));
            if (!has(/Pet rock/)()) await give(sdk, 'vt_useless_rock');
            await mustTele(sdk, 2771, 3621, 0);
            await talk(p, /Lalli/, []);
        } else if (p === 'cauldron') {
            await bits(olafStage(4));
            for (const o of ['cabbage', 'potato', 'onion']) await give(sdk, o);
            if (!has(/Pet rock/)()) await give(sdk, 'vt_useless_rock');
            await mustTele(sdk, 2771, 3622, 0);
            const t0 = currentTick(sdk);
            let pages = 0;
            for (const it of [/Pet rock/, /Cabbage/, /Potato/, /Onion/]) {
                const n = invCount(sdk, it);
                await useOnLoc(it, 2772, 3623);
                await waitUntil(sdk, s => invCount(s, it) < n || s.dialog.isOpen, { maxTicks: 20 });
                pages += (await dlg()).pages;
            }
            const v = await getvar(sdk, 'viking_bits');
            res[p] = { ticks: currentTick(sdk) - t0, pages, olaf: v === null ? null : (v >> 20) & 7 };
            console.log(p, JSON.stringify(res[p]));
        } else if (p === 'lalli3') {
            await bits(olafStage(5));
            await mustTele(sdk, 2771, 3621, 0);
            await talk(p, /Lalli/, [], has(/Golden fleece/));
        } else if (p === 'tree') {
            await give(sdk, 'adamant_axe');
            await mustTele(sdk, 2737, 3637, 0);
            await piece(p, () => op(2738, 3638, 'Cut-branch'), has(/^Branch$/));
        } else if (p === 'lyre') {
            await give(sdk, 'knife');
            if (!has(/^Branch$/)()) await give(sdk, 'viking_musical_tree_branch');
            await piece(p, () => onItem(/Knife/, /^Branch$/), has(/Unstrung lyre/));
        } else if (p === 'spin') {
            if (!has(/Golden fleece/)()) await give(sdk, 'viking_golden_fleece');
            await mustTele(sdk, 2712, 3471, 1);
            await piece(p, () => useOnLoc(/Golden fleece/, 2711, 3471, /Spinning wheel/i), has(/Golden wool/));
        } else if (p === 'string') {
            if (!has(/Unstrung lyre/)()) await give(sdk, 'viking_unstrung_lyre');
            if (!has(/Golden wool/)()) await give(sdk, 'viking_golden_wool');
            await piece(p, () => onItem(/Golden wool/, /Unstrung lyre/), has(/^Lyre$/));
        } else if (p === 'altar') {
            await bits(olafStage(5));
            if (!has(/^Lyre$/)()) await give(sdk, 'viking_strung_lyre');
            await give(sdk, 'raw_shark');
            await mustTele(sdk, 2626, 3599, 0);
            await piece(p, () => useOnLoc(/Raw shark/, 2626, 3598), has(/Enchanted lyre/));
        } else if (p === 'perform') {
            await bits(olafStage(5));
            if (!has(/Enchanted lyre/)()) await give(sdk, 'viking_enchanted_strung_lyre');
            await mustTele(sdk, 2668, 3683, 0);
            await waitTicks(sdk, 2);
            const t0 = currentTick(sdk);
            await op(2667, 3683, 'Open', /Door/);
            await waitUntil(sdk, s => pos(s).x <= 2666 || s.dialog.isOpen, { maxTicks: 20 });
            const bouncer = await dlg();
            const door = currentTick(sdk) - t0;
            await walkTo(bot, sdk, 2661, 3683, 0);
            const walk = currentTick(sdk) - t0 - door;
            const p0 = currentTick(sdk);
            await sdk.sendUseItem(slotOf(sdk, /Enchanted lyre/), 1);
            await waitUntil(sdk, s => s.dialog.isOpen, { maxTicks: 60 });
            const olaf = await dlg();
            const vik = await getvar(sdk, 'viking');
            res[p] = { doorTicks: door, bouncerPages: bouncer.pages, walkToStage: walk, playToEnd: currentTick(sdk) - p0, olafPages: olaf.pages, viking: vik, at: pos(sdk) };
            console.log(p, JSON.stringify(res[p]));
        } else if (p === 'salesman') {
            await bits(REVELLER_STARTED);
            await give(sdk, 'coins', 250);
            await mustTele(sdk, 2696, 3495, 0);
            await talk(p, /Poison Salesman/, [/Fremennik Trials/, /^Yes$/], has(/Low alcohol keg/));
        } else if (p === 'workman') {
            await give(sdk, 'beer');
            await mustTele(sdk, 2656, 3592, 0);
            const t0 = currentTick(sdk);
            const w = findNpc(sdk, /Council workman/);
            if (!w) throw new Error(`no council workman near ${JSON.stringify(pos(sdk))}`);
            await sdk.sendUseItemOnNpc(slotOf(sdk, /^Beer$/), w.index);
            await waitUntil(sdk, s => s.dialog.isOpen, { maxTicks: 30 });
            const d = await dlg();
            res[p] = { ticks: currentTick(sdk) - t0 - 2, pages: d.pages, options: d.options, runs: d.runs, ok: has(/Strange object/)() };
            console.log(p, JSON.stringify(res[p]));
        } else if (p === 'light') {
            if (!has(/Strange object/)()) await give(sdk, 'viking_firecracker');
            await give(sdk, 'tinderbox');
            await piece(p, () => onItem(/Tinderbox/, /^Strange object/), has(/Lit strange object/));
        } else if (p === 'pipe') {
            await bits(REVELLER_STARTED);
            if (!has(/Lit strange object/)()) await give(sdk, 'viking_firecracker_lit');
            await mustTele(sdk, 2663, 3675, 0);
            await piece(p, () => op(2663, 3674, 'Put-inside'), s => !has(/Lit strange object/)(s));
        } else if (p === 'keg') {
            await mustTele(sdk, 2660, 3677, 0);
            await waitTicks(sdk, 2);
            const keg = sdk.findGroundItem(/Keg of beer/);
            if (!keg) throw new Error(`no keg of beer near ${JSON.stringify(pos(sdk))}`);
            await piece(p, () => sdk.sendPickup(keg.x, keg.z, keg.id), has(/Keg of beer/));
        } else if (p === 'swap') {
            await bits(REVELLER_STARTED | 1); // firecracker placed
            if (!has(/Keg of beer/)()) await give(sdk, 'viking_beerkeg');
            if (!has(/Low alcohol keg/)()) await give(sdk, 'viking_low_alcahol_beerkeg');
            await piece(p, () => onItem(/Low alcohol keg/, /Keg of beer/), s => !has(/Low alcohol keg/)(s));
        } else if (p === 'contest') {
            await bits(REVELLER_STARTED | 4); // keg swapped
            if (!has(/Keg of beer/)()) await give(sdk, 'viking_beerkeg');
            await mustTele(sdk, 2661, 3672, 0);
            await talk(p, /Manni/, [/^Yes$/]);
            await waitTicks(sdk, 4);
            const more = await dlg();
            const r = res[p]!;
            r.queuedPages = more.pages;
            r.viking = await getvar(sdk, 'viking');
            console.log(p, JSON.stringify(r));
        }
    }
}, { timeout: 1_800_000, printState: false });
