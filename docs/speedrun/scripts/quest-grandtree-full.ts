// The Grand Tree, played on the lab server and timed step by step
// (docs/speedrun/quests/grand_tree.md). Segments A..P follow the quest; each
// can be started on its own (the script jumps %grandtree with ::setvar, gives
// the items earlier segments would have handed over, and teleports to where the
// previous segment ends). Long walks are walked for real with run on and
// ::~energy topped up, so the walking figures are the infinite-run case.
// Run: bun docs/speedrun/scripts/quest-grandtree-full.ts <botname> [first=A] [last=P]
// Assumes quest-gnome-setup.ts has run (70/70/70, Agility 25, Prayer 43, Magic 59)
// and Tree Gnome Village is complete (%treequest 9) for the spirit trees and Elkoy.

import { runScript } from '../../../sdk/runner';
import { act, castTeleport, opLoc, slotOf, talkTo, walkTo, wield } from '../../../speedrun/lib/act';
import { fight } from '../../../speedrun/lib/combat';
import { converse, type ConverseResult } from '../../../speedrun/lib/converse';
import type { OptionPattern } from '../../../speedrun/lib/dialogue';
import type { ItemPattern } from '../../../speedrun/lib/items';
import { pathTiles } from '../../../speedrun/lib/paths';
import { currentTick, waitTicks, waitUntil, type Pred } from '../../../speedrun/lib/wait';
import { at, findLoc, invCount, invItem, messagesSince, pos } from '../../../speedrun/lib/world';
import { Recorder } from '../../../speedrun/lab/record';
import { cheat, clearInventory, getvar, give, mustTele, setvar } from '../../../speedrun/lab/setup';

const FIRST = (process.argv[3] ?? 'A').toUpperCase();
const LAST = (process.argv[4] ?? 'P').toUpperCase();

const lvl = (l: number): Pred => s => pos(s).level === l;

// Tree door (2464,3492): scripted, forcemoves two tiles north or south.
const DOOR = { x: 2464, z: 3492 };

// The rock is under one of 15 roots (daconia_coords.enum), chosen at random.
const ROOTS: Record<number, [number, number]> = {
    1: [2456, 9886], 2: [2457, 9881], 3: [2455, 9874], 4: [2443, 9878], 5: [2439, 9881],
    6: [2444, 9893], 7: [2452, 9893], 8: [2465, 9891], 9: [2468, 9890], 10: [2467, 9896],
    11: [2473, 9897], 12: [2481, 9904], 13: [2485, 9885], 14: [2490, 9889], 15: [2467, 9872],
};

// Starting mid-quest: stage, items and position each segment expects.
const STARTS: Record<string, { stage: number; items?: Array<[string, number]>; at: [number, number, number?] }> = {
    A: { stage: 0, at: [2461, 3444] },
    B: { stage: 10, items: [['grandtree_barksample', 1], ['grandtree_translationbook', 1]], at: [2464, 3497] },
    C: { stage: 20, items: [['grandtree_translationbook', 1], ['grandtree_scroll', 1]], at: [2677, 3087, 1] },
    D: { stage: 30, items: [['grandtree_translationbook', 1]], at: [2466, 3496] },
    E: { stage: 40, at: [2477, 3463, 1] },
    F: { stage: 50, at: [2466, 3496] },
    G: { stage: 60, at: [2465, 3496, 3] },
    H: { stage: 70, items: [['grandtree_journal', 1]], at: [2476, 3464, 1] },
    I: { stage: 80, at: [2466, 3496, 3] },
    J: { stage: 90, items: [['grandtree_order', 1]], at: [2999, 3043] },
    K: { stage: 100, at: [2465, 3496, 3] },
    L: { stage: 110, items: [['grandtree_invasionplans', 1]], at: [2482, 3463, 1] },
    M: { stage: 120, items: [['grandtree_twigt', 1], ['grandtree_twigu', 1], ['grandtree_twigz', 1], ['grandtree_twigo', 1]], at: [2466, 3496] },
    N: { stage: 130, at: [2487, 3465, 2] },
    O: { stage: 140, at: [2491, 9865] },
    P: { stage: 150, at: [2464, 9895] },
};
const ORDER = 'ABCDEFGHIJKLMNOP';

await runScript(async ({ bot, sdk }) => {
    const rec = new Recorder(sdk, 'grand_tree');
    const energy = () => cheat(sdk, '~energy', 1);

    // Counts and walk-up time of a conversation; with `done`, a conversation that never opened is timed to `done`.
    const dialogueRow = async (r: ConverseResult, done?: Pred): Promise<string | undefined> => {
        rec.dialogue(r);
        if (r.firstTick >= 0) rec.note(`approach ${r.firstTick - r.startTick}`);
        if (done && !r.opened) {
            const w = await waitUntil(sdk, done, { maxTicks: 30 });
            if (!w.ok) return 'TIMEOUT';
            rec.mark(w.tick);
        }
        return r.ok ? undefined : r.reason;
    };
    const walk = (name: string, x: number, z: number, tol: number) => rec.seg(name, async () => {
        const p = pos(sdk);
        const est = pathTiles(p.level, p.x, p.z, x, z);
        const w = await walkTo(bot, sdk, x, z, tol);
        return `${est.tiles} path tiles${w.ok ? '' : ' FAILED ' + w.message}`;
    });
    // Talk to an NPC; `done` (a scripted walk or teleport after the last page) ends the segment when it lands.
    const talk = (name: string, npc: RegExp, choices: OptionPattern[], idle: number, done?: Pred) => rec.seg(name, async () => {
        const r = await talkTo(sdk, npc, choices, { idle, maxTicks: 600, unmatched: 'stop', closeModals: true, ...(done ? { until: done } : {}) });
        rec.interact(r.clicks);
        return dialogueRow(r, done);
    });
    // Click the loc at (x, z) and wait for `done`; a dropped click is re-sent.
    const locStep = (name: string, x: number, z: number, op: RegExp, done: Pred, maxTicks = 20) => rec.seg(name, async () => {
        const r = await opLoc(sdk, { x, z, op }, op, done, { maxTicks });
        rec.interact(1 + r.resends);
        return r.ok ? undefined : 'TIMEOUT';
    });
    // Click the loc at (x, z) and answer the dialogue it opens (a spirit tree, a gate with a password, a cutscene).
    const locTalk = (name: string, x: number, z: number, op: RegExp, choices: OptionPattern[], idle: number, done?: Pred) => rec.seg(name, async () => {
        const conv = converse(sdk, choices, { idle, openTicks: 60, maxTicks: 600, unmatched: 'stop', closeModals: true, ...(done ? { until: done } : {}) });
        await opLoc(sdk, { x, z, op }, op);
        rec.interact();
        return dialogueRow(await conv, done);
    });
    // Use an inventory item on the loc at (x, z), timed to `done` or the end of the page it opens, whichever is later.
    const useOnLoc = (name: string, item: ItemPattern, x: number, z: number, done: Pred, maxTicks = 40) => rec.seg(name, async () => {
        const loc = await findLoc(sdk, { x, z });
        if (!loc) throw new Error(`no loc at (${x},${z})`);
        const slot = slotOf(sdk, item);
        const conv = converse(sdk, [], { idle: 3, openTicks: 15, closeModals: true, unmatched: 'stop' });
        const r = await act(sdk, () => sdk.sendUseItemOnLoc(slot, loc.x, loc.z, loc.id), done, { maxTicks });
        rec.interact(1 + r.resends);
        rec.mark();
        const d = await conv;
        if (d.opened) rec.dialogue(d);
        return r.ok ? undefined : 'TIMEOUT';
    });

    const enterTree = async (label: string) => {
        await walk(`${label} walk to Grand Tree door`, 2465, 3490, 1);
        await locStep(`${label} door in`, DOOR.x, DOOR.z, /^open$/i, s => pos(s).z >= 3493);
    };
    const leaveTree = async (label: string) => {
        await walk(`${label} walk to door`, 2465, 3494, 0);
        await locStep(`${label} door out`, DOOR.x, DOOR.z, /^open$/i, s => pos(s).z <= 3491);
    };
    const treeLadderUp = async (label: string) => {
        for (const l of [0, 1, 2]) await locStep(`${label} ladder ${l}->${l + 1}`, 2466, 3495, /^climb-up$/i, lvl(l + 1));
    };
    const treeLadderDown = async (label: string) => {
        for (const l of [3, 2, 1]) await locStep(`${label} ladder ${l}->${l - 1}`, 2466, 3495, /^climb-down$/i, lvl(l - 1));
    };
    const gloughUp = async (label: string) => {
        await walk(`${label} walk to Glough's ladder`, 2476, 3464, 1);
        await locStep(`${label} Glough's ladder up`, 2476, 3463, /^climb-up$/i, lvl(1));
    };
    const gloughDown = (label: string) => locStep(`${label} Glough's ladder down`, 2476, 3463, /^climb-down$/i, lvl(0));
    const villageToStronghold = (label: string) =>
        locTalk(`${label} village spirit tree -> stronghold`, 2543, 3168, /talk/i, [/Where can I go/, /Gnome stronghold/], 3, at(2461, 3444, 0, 4));

    const st = STARTS[FIRST];
    if (!st) throw new Error(`no start for segment ${FIRST}`);
    await clearInventory(sdk);
    await give(sdk, 'rune_scimitar', 1);
    await give(sdk, 'shark', 12);
    await setvar(sdk, 'treequest', 9);
    await setvar(sdk, 'grandtree', st.stage);
    for (const [o, n] of st.items ?? []) await give(sdk, o, n);
    await mustTele(sdk, st.at[0], st.at[1], st.at[2] ?? 0);
    if (invItem(sdk, /scimitar/i)) await wield(sdk, /scimitar/i);
    await energy();
    const T0 = currentTick(sdk);
    const runs = (seg: string) => ORDER.indexOf(seg) >= ORDER.indexOf(FIRST) && ORDER.indexOf(seg) <= ORDER.indexOf(LAST);
    const check = async (seg: string) => console.log(`-- after ${seg}: grandtree=${await getvar(sdk, 'grandtree')} pos=${JSON.stringify(pos(sdk))} t=${currentTick(sdk) - T0}`);

    if (runs('A')) {
        // King Narnode: the cutscene takes you down his trapdoor and back up.
        await enterTree('A1');
        await talk('A2 Narnode start (trapdoor cutscene)', /^King Narnode Shareen$|^King Narnode$/i, [/seem worried/, /happy to help/], 25, at(2464, 3497, 0, 0));
        await check('A');
    }
    if (runs('B')) {
        // To Hazelmere on foot: the stronghold spirit tree refuses until the quest is done.
        await energy();
        await leaveTree('B1');
        await walk('B2 walk to stronghold gate', 2461, 3386, 1);
        await locStep('B3 gate', 2459, 3383, /^open$/i, s => pos(s).z <= 3382);
        await energy();
        await walk('B4 walk to Hazelmere ladder', 2677, 3088, 1);
        await locStep('B5 ladder up', 2677, 3087, /^climb-up$/i, lvl(1));
        await talk('B6 Hazelmere', /^Hazelmere$/i, [], 3);
        await check('B');
    }
    if (runs('C')) {
        // Back via Elkoy's maze jump, the railing and the village spirit tree.
        await energy();
        await locStep('C1 ladder down', 2677, 3087, /^climb-down$/i, lvl(0));
        await walk('C2 walk to maze entrance', 2504, 3193, 1);
        await talk('C3 Elkoy jump in', /^Elkoy$/i, [/Yes please/], 3);
        await locStep('C4 railing', 2515, 3161, /squeeze/i, s => pos(s).z >= 3161);
        await walk('C5 walk to village spirit tree', 2543, 3169, 1);
        await villageToStronghold('C6');
        await enterTree('C7');
        await talk('C8 Narnode translation', /^King Narnode/i, [/I think so/, /None of the above/, /None of the above/, /King's seal/, /gave the man Daconia/, /kill the tree/], 3);
        await check('C');
    }
    if (runs('D')) {
        await leaveTree('D1');
        await gloughUp('D2');
        await talk('D3 Glough', /^Glough$/i, [], 3);
        await check('D');
    }
    if (runs('E')) {
        await gloughDown('E1');
        await enterTree('E2');
        await talk('E3 Narnode', /^King Narnode/i, [], 3);
        await check('E');
    }
    if (runs('F')) {
        await walk('F1 walk to ladder', 2466, 3496, 0);
        await treeLadderUp('F2');
        await talk('F3 Charlie', /^Charlie$/i, [], 3);
        await check('F');
    }
    if (runs('G')) {
        await treeLadderDown('G1');
        await leaveTree('G2');
        await gloughUp('G3');
        await locStep('G4 open cupboard', 2476, 3465, /^open$/i, s => s.nearbyLocs.some(l => l.x === 2476 && l.z === 3465 && l.optionsWithIndex.some(o => /search/i.test(o.text))));
        await locTalk('G5 search cupboard', 2476, 3465, /search/i, [], 2, s => invCount(s, /journal/i) > 0);
        await check('G');
    }
    if (runs('H')) {
        // Glough calls the guards: walk, jail, Charlie, Narnode lets you out.
        await talk('H1 Glough -> jail -> released', /^Glough$/i, [], 20);
        await check('H');
    }
    if (runs('I')) {
        await talk('I1 glider pilot -> crash', /^Gnome pilot$/i, [/Karamja/], 8);
        await energy();
        await walk('I2 walk to shipyard gate', 2943, 3041, 1);
        await locTalk('I3 gate + password', 2945, 3041, /^open$/i, [/Glough sent me/, /^Ka\.$/, /^Lu\.$/, /^Min\.$/], 3, s => pos(s).x >= 2945);
        await walk('I4 walk to foreman', 2998, 3043, 2);
        await talk('I5 foreman', /^Foreman$/i, [/no longer with us/, /worm holes/, /^Anita/], 20);
        await check('I');
    }
    if (runs('J')) {
        // Back to the stronghold: Varrock teleport, young spirit tree, village tree. Arriving by
        // spirit tree skips the gate guards (gnome_gate.rs2:13) and Femi's cart.
        await give(sdk, 'lawrune', 1);
        await give(sdk, 'airrune', 3);
        await give(sdk, 'firerune', 1);
        await rec.seg('J1 Varrock teleport', async () => {
            const r = await castTeleport(sdk, 'varrock', 20);
            rec.interact(1 + r.resends);
            return r.ok ? undefined : 'TIMEOUT';
        });
        await energy();
        await walk('J2 walk to Varrock young tree', 3177, 3505, 1);
        await locTalk('J3 young tree -> village', 3177, 3506, /talk/i, [/Yes please/], 3, at(2542, 3169, 0, 4));
        await villageToStronghold('J4');
        await enterTree('J5');
        await walk('J6 walk to ladder', 2466, 3496, 0);
        await treeLadderUp('J7');
        await talk('J8 Charlie', /^Charlie$/i, [], 3);
        await check('J');
    }
    if (runs('K')) {
        await treeLadderDown('K1');
        await leaveTree('K2');
        await energy();
        await walk('K3 walk to Anita stairs', 2389, 3511, 1);
        await locStep('K4 stairs up', 2389, 3512, /^climb-up$/i, lvl(1));
        await talk('K5 Anita (key)', /^Anita$/i, [], 3);
        await locStep('K6 stairs down', 2389, 3513, /^climb-down$/i, lvl(0));
        await energy();
        await gloughUp('K7');
        await useOnLoc('K8 key on chest', /Glough's key/i, 2482, 3462, s => invCount(s, /invasion plans/i) > 0);
        await check('K');
    }
    if (runs('L')) {
        await gloughDown('L1');
        await enterTree('L2');
        await talk('L3 Narnode (twigs)', /^King Narnode/i, [], 3);
        await check('L');
    }
    if (runs('M')) {
        await leaveTree('M1');
        await gloughUp('M2');
        await locStep('M3 climb tree (Agility 25)', 2484, 3464, /^climb-up$/i, lvl(2));
        const twigs: Array<[number, number]> = [[789, 2485], [790, 2486], [791, 2487], [792, 2488]];
        for (const [id, x] of twigs) {
            const before = invCount(sdk, /^twigs$/i);
            await useOnLoc(`M4 twig ${id} on pillar (${x},3467)`, id, x, 3467, s => invCount(s, /^twigs$/i) < before, 20);
        }
        await check('M');
    }
    if (runs('N')) {
        await bot.activatePrayer('protect_from_melee');
        await locTalk('N1 trapdoor + Glough cutscene', 2487, 3464, /^open$/i, [], 4);
        // The demon only fights the player Glough summoned it for (grandtree_black_demon.rs2:1-13).
        const f = await fight(sdk, /^Black demon$/i, { eatBelow: 40, prayer: 'protect_from_melee', maxTicks: 1500 });
        rec.add({ name: `N2 black demon (${f.end})`, ticks: f.ticks, levelUps: f.levelUps, note: `damage taken ${f.taken}, food ${f.eats}, died ${f.died}` });
        await bot.deactivateAllPrayers();
        await check('N');
    }
    if (runs('O')) {
        await energy();
        await walk('O1 walk to Narnode (underground)', 2464, 9895, 1);
        await talk('O2 Narnode + guards', /^King Narnode/i, [], 12);
        await check('O');
    }
    if (runs('P')) {
        // Here we go straight to the rock's root and time one search; quest-gnome-routes.ts gives the
        // expected search route.
        const v = await getvar(sdk, 'daconia_rock_root');
        console.log('daconia_rock_root', v);
        // One empty search first, to time a root without the rock: click to its game message.
        const [ex, ez] = ROOTS[v === 10 ? 8 : 10]!;
        await rec.seg('P1 search an empty root', async () => {
            const t0 = currentTick(sdk);
            const r = await opLoc(sdk, { x: ex, z: ez, op: /search/i }, /search/i, s => messagesSince(s, t0 + 1, /root|interesting|nothing/i).length > 0, { maxTicks: 30 });
            rec.interact(1 + r.resends);
            return r.ok ? undefined : 'TIMEOUT';
        });
        const [rx, rz] = ROOTS[v ?? 1]!;
        await locTalk(`P2 search root ${v}`, rx, rz, /search/i, [], 2, s => invCount(s, /daconia/i) > 0);
        await walk('P3 walk back to Narnode', 2464, 9895, 1);
        await talk('P4 Narnode finish', /^King Narnode/i, [], 6);
        await waitTicks(sdk, 3);
        await check('P');
    }
    console.log('wall ticks', currentTick(sdk) - T0);
    rec.report();
}, { timeout: 1_800_000 });
