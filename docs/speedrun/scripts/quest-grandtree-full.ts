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
import type { BotSDK } from '../../../sdk/index';
import {
    cheat, fight, getvar, give, invCount, locOpAt, locTalkAt, now, pos, Recorder, setvar, talk, tele,
    useOnLocAt, waitTicks, waitUntil, walk, type Pred, type StepRecord,
} from './quest-gnome-lib';

const FIRST = (process.argv[3] ?? 'A').toUpperCase();
const LAST = (process.argv[4] ?? 'P').toUpperCase();

const gt = (sdk: BotSDK) => getvar(sdk, 'grandtree');
const lvl = (l: number): Pred => s => pos(s).level === l;
const near = (x: number, z: number, r = 3, l = 0): Pred => s => {
    const p = pos(s);
    return p.level === l && Math.abs(p.x - x) <= r && Math.abs(p.z - z) <= r;
};

// Tree door (2464,3492): scripted, forcemoves two tiles north or south.
const DOOR = { x: 2464, z: 3492 };

await runScript(async ({ bot, sdk }) => {
    const rec = new Recorder('grand_tree');
    const add = (r: StepRecord, label: string) => rec.add(r, label);
    const energy = () => cheat(sdk, '~energy');
    const enterTree = async (label: string) => {
        add(await walk(bot, sdk, 2465, 3490, 1), `${label} walk to Grand Tree door`);
        add(await locOpAt(sdk, DOOR.x, DOOR.z, /^open$/i, s => pos(s).z >= 3493, 20), `${label} door in`);
    };
    const leaveTree = async (label: string) => {
        add(await walk(bot, sdk, 2465, 3494, 0), `${label} walk to door`);
        add(await locOpAt(sdk, DOOR.x, DOOR.z, /^open$/i, s => pos(s).z <= 3491, 20), `${label} door out`);
    };
    const treeLadderUp = async (label: string) => {
        add(await locOpAt(sdk, 2466, 3495, /^climb-up$/i, lvl(1), 20), `${label} ladder 0->1`);
        add(await locOpAt(sdk, 2466, 3495, /^climb-up$/i, lvl(2), 20), `${label} ladder 1->2`);
        add(await locOpAt(sdk, 2466, 3495, /^climb-up$/i, lvl(3), 20), `${label} ladder 2->3`);
    };
    const treeLadderDown = async (label: string) => {
        add(await locOpAt(sdk, 2466, 3495, /^climb-down$/i, lvl(2), 20), `${label} ladder 3->2`);
        add(await locOpAt(sdk, 2466, 3495, /^climb-down$/i, lvl(1), 20), `${label} ladder 2->1`);
        add(await locOpAt(sdk, 2466, 3495, /^climb-down$/i, lvl(0), 20), `${label} ladder 1->0`);
    };
    const gloughUp = async (label: string) => {
        add(await walk(bot, sdk, 2476, 3464, 1), `${label} walk to Glough's ladder`);
        add(await locOpAt(sdk, 2476, 3463, /^climb-up$/i, lvl(1), 20), `${label} Glough's ladder up`);
    };
    const gloughDown = async (label: string) => add(await locOpAt(sdk, 2476, 3463, /^climb-down$/i, lvl(0), 20), `${label} Glough's ladder down`);
    const villageToStronghold = async (label: string) =>
        add(await locTalkAt(sdk, 2543, 3168, /talk/i, [/Where can I go/, /Gnome stronghold/], { idle: 3, done: near(2461, 3444, 4) }), `${label} village spirit tree -> stronghold`);

    // Starting mid-quest: stage, items and position each segment expects.
    const starts: Record<string, { stage: number; items?: Array<[string, number]>; at: [number, number, number?] }> = {
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
    const order = 'ABCDEFGHIJKLMNOP';
    const st = starts[FIRST];
    await cheat(sdk, '~clearinv');
    await give(sdk, 'rune_scimitar', 1);
    await give(sdk, 'shark', 12);
    await setvar(sdk, 'treequest', 9);
    await setvar(sdk, 'grandtree', st.stage);
    for (const [o, n] of st.items ?? []) await give(sdk, o, n);
    await tele(sdk, st.at[0], st.at[1], st.at[2] ?? 0);
    {
        const sc = sdk.getState()!.inventory.find(i => /scimitar/i.test(i.name));
        if (sc) await bot.equipItem(sc.name);
    }
    await energy();
    const T0 = now(sdk);
    const runs = (seg: string) => order.indexOf(seg) >= order.indexOf(FIRST) && order.indexOf(seg) <= order.indexOf(LAST);
    const check = async (seg: string) => console.log(`-- after ${seg}: grandtree=${await gt(sdk)} pos=${JSON.stringify(pos(sdk.getState()))} t=${now(sdk) - T0}`);

    if (runs('A')) {
        // King Narnode: the cutscene takes you down his trapdoor and back up.
        await enterTree('A1');
        add(await talk(sdk, /^King Narnode Shareen$|^King Narnode$/i, [/seem worried/, /happy to help/], { idle: 15, done: near(2464, 3497, 0) }), 'A2 Narnode start (trapdoor cutscene)');
        await check('A');
    }
    if (runs('B')) {
        // To Hazelmere on foot: the stronghold spirit tree refuses until the quest is done.
        await energy();
        await leaveTree('B1');
        add(await walk(bot, sdk, 2461, 3386, 1), 'B2 walk to stronghold gate');
        add(await locOpAt(sdk, 2459, 3383, /^open$/i, s => pos(s).z <= 3382, 20), 'B3 gate');
        await energy();
        add(await walk(bot, sdk, 2677, 3088, 1), 'B4 walk to Hazelmere ladder');
        add(await locOpAt(sdk, 2677, 3087, /^climb-up$/i, lvl(1), 20), 'B5 ladder up');
        add(await talk(sdk, /^Hazelmere$/i, [], { idle: 3 }), 'B6 Hazelmere');
        await check('B');
    }
    if (runs('C')) {
        // Back via Elkoy's maze jump, the railing and the village spirit tree.
        await energy();
        add(await locOpAt(sdk, 2677, 3087, /^climb-down$/i, lvl(0), 20), 'C1 ladder down');
        add(await walk(bot, sdk, 2504, 3193, 1), 'C2 walk to maze entrance');
        add(await talk(sdk, /^Elkoy$/i, [/Yes please/], { idle: 3 }), 'C3 Elkoy jump in');
        add(await locOpAt(sdk, 2515, 3161, /squeeze/i, s => pos(s).z >= 3161, 20), 'C4 railing');
        add(await walk(bot, sdk, 2543, 3169, 1), 'C5 walk to village spirit tree');
        await villageToStronghold('C6');
        await enterTree('C7');
        add(await talk(sdk, /^King Narnode/i, [/I think so/, /None of the above/, /None of the above/, /King's seal/, /gave the man Daconia/, /kill the tree/], { idle: 3 }), 'C8 Narnode translation');
        await check('C');
    }
    if (runs('D')) {
        await leaveTree('D1');
        await gloughUp('D2');
        add(await talk(sdk, /^Glough$/i, [], { idle: 3 }), 'D3 Glough');
        await check('D');
    }
    if (runs('E')) {
        await gloughDown('E1');
        await enterTree('E2');
        add(await talk(sdk, /^King Narnode/i, [], { idle: 3 }), 'E3 Narnode');
        await check('E');
    }
    if (runs('F')) {
        add(await walk(bot, sdk, 2466, 3496, 0), 'F1 walk to ladder');
        await treeLadderUp('F2');
        add(await talk(sdk, /^Charlie$/i, [], { idle: 3 }), 'F3 Charlie');
        await check('F');
    }
    if (runs('G')) {
        await treeLadderDown('G1');
        await leaveTree('G2');
        await gloughUp('G3');
        add(await locOpAt(sdk, 2476, 3465, /^open$/i, s => (s.nearbyLocs ?? []).some(l => l.x === 2476 && l.z === 3465 && l.optionsWithIndex.some(o => /search/i.test(o.text))), 20), 'G4 open cupboard');
        add(await locTalkAt(sdk, 2476, 3465, /search/i, [], { idle: 2, done: s => invCount(s, /journal/i) > 0 }), 'G5 search cupboard');
        await check('G');
    }
    if (runs('H')) {
        // Glough calls the guards: walk, jail, Charlie, Narnode lets you out.
        add(await talk(sdk, /^Glough$/i, [], { idle: 20 }), 'H1 Glough -> jail -> released');
        await check('H');
    }
    if (runs('I')) {
        add(await talk(sdk, /^Gnome pilot$/i, [/Karamja/], { idle: 8 }), 'I1 glider pilot -> crash');
        await energy();
        add(await walk(bot, sdk, 2943, 3041, 1), 'I2 walk to shipyard gate');
        add(await locTalkAt(sdk, 2945, 3041, /^open$/i, [/Glough sent me/, /^Ka\.$/, /^Lu\.$/, /^Min\.$/], { idle: 3, done: s => pos(s).x >= 2945 }), 'I3 gate + password');
        add(await walk(bot, sdk, 2998, 3043, 2), 'I4 walk to foreman');
        add(await talk(sdk, /^Foreman$/i, [/no longer with us/, /worm holes/, /^Anita/], { idle: 4 }), 'I5 foreman');
        await check('I');
    }
    if (runs('J')) {
        // Back to the stronghold: Varrock teleport, young spirit tree, village tree. Arriving by
        // spirit tree skips the gate guards (gnome_gate.rs2:13) and Femi's cart.
        await give(sdk, 'lawrune', 1);
        await give(sdk, 'airrune', 3);
        await give(sdk, 'firerune', 1);
        {
            const t0 = now(sdk);
            await sdk.sendClickComponent(1164);
            const r = await waitUntil(sdk, near(3213, 3424, 4), 20);
            add({ name: 'Varrock teleport', ticks: (r?.tick ?? NaN) - t0 }, 'J1');
        }
        await energy();
        add(await walk(bot, sdk, 3177, 3505, 1), 'J2 walk to Varrock young tree');
        add(await locTalkAt(sdk, 3177, 3506, /talk/i, [/Yes please/], { idle: 3, done: near(2542, 3169, 4) }), 'J3 young tree -> village');
        await villageToStronghold('J4');
        await enterTree('J5');
        add(await walk(bot, sdk, 2466, 3496, 0), 'J6 walk to ladder');
        await treeLadderUp('J7');
        add(await talk(sdk, /^Charlie$/i, [], { idle: 3 }), 'J8 Charlie');
        await check('J');
    }
    if (runs('K')) {
        await treeLadderDown('K1');
        await leaveTree('K2');
        await energy();
        add(await walk(bot, sdk, 2389, 3511, 1), 'K3 walk to Anita stairs');
        add(await locOpAt(sdk, 2389, 3512, /^climb-up$/i, lvl(1), 20), 'K4 stairs up');
        add(await talk(sdk, /^Anita$/i, [], { idle: 3 }), 'K5 Anita (key)');
        add(await locOpAt(sdk, 2389, 3513, /^climb-down$/i, lvl(0), 20), 'K6 stairs down');
        await energy();
        await gloughUp('K7');
        add(await useOnLocAt(sdk, /Glough's key/i, 2482, 3462, s => invCount(s, /invasion plans/i) > 0), 'K8 key on chest');
        await check('K');
    }
    if (runs('L')) {
        await gloughDown('L1');
        await enterTree('L2');
        add(await talk(sdk, /^King Narnode/i, [], { idle: 3 }), 'L3 Narnode (twigs)');
        await check('L');
    }
    if (runs('M')) {
        await leaveTree('M1');
        await gloughUp('M2');
        add(await locOpAt(sdk, 2484, 3464, /^climb-up$/i, lvl(2), 20), 'M3 climb tree (Agility 25)');
        const twigs: Array<[number, number]> = [[789, 2485], [790, 2486], [791, 2487], [792, 2488]];
        for (const [id, x] of twigs) {
            const before = invCount(sdk.getState(), /^twigs$/i);
            add(await useOnLocAt(sdk, id, x, 3467, s => invCount(s, /^twigs$/i) < before, { maxTicks: 20 }), `M4 twig ${id} on pillar (${x},3467)`);
        }
        await check('M');
    }
    if (runs('N')) {
        await bot.activatePrayer('protect_from_melee');
        {
            const t0 = now(sdk);
            const r = await locTalkAt(sdk, 2487, 3464, /^open$/i, [], { idle: 4 });
            add({ ...r, ticks: r.ticks }, 'N1 trapdoor + Glough cutscene');
            void t0;
        }
        const f = await fight(sdk, bot, /^Black demon$/i, { eatBelow: 40 });
        add({ ...f, note: `damage taken ${f.damageTaken}, food ${f.food}, died ${f.died}` }, 'N2 black demon');
        await bot.deactivateAllPrayers();
        await check('N');
    }
    if (runs('O')) {
        await energy();
        add(await walk(bot, sdk, 2464, 9895, 1), 'O1 walk to Narnode (underground)');
        add(await talk(sdk, /^King Narnode/i, [], { idle: 12 }), 'O2 Narnode + guards');
        await check('O');
    }
    if (runs('P')) {
        // The rock is under one of 15 roots (daconia_coords.enum), chosen at random. Here we go
        // straight to it and time one search; quest-gnome-routes.ts gives the expected search route.
        const roots: Record<number, [number, number]> = {
            1: [2456, 9886], 2: [2457, 9881], 3: [2455, 9874], 4: [2443, 9878], 5: [2439, 9881],
            6: [2444, 9893], 7: [2452, 9893], 8: [2465, 9891], 9: [2468, 9890], 10: [2467, 9896],
            11: [2473, 9897], 12: [2481, 9904], 13: [2485, 9885], 14: [2490, 9889], 15: [2467, 9872],
        };
        const v = await getvar(sdk, 'daconia_rock_root');
        console.log('daconia_rock_root', v);
        // One empty search first, to time a root without the rock.
        const empty = v === 10 ? roots[8] : roots[10];
        add(await locTalkAt(sdk, empty[0], empty[1], /search/i, [], { idle: 2 }), 'P1 search an empty root');
        const [rx, rz] = roots[v ?? 1];
        add(await locTalkAt(sdk, rx, rz, /search/i, [], { idle: 2, done: s => invCount(s, /daconia/i) > 0 }), `P2 search root ${v}`);
        add(await walk(bot, sdk, 2464, 9895, 1), 'P3 walk back to Narnode');
        add(await talk(sdk, /^King Narnode/i, [], { idle: 6 }), 'P4 Narnode finish');
        await waitTicks(sdk, 3);
        await check('P');
    }
    console.log('wall ticks', now(sdk) - T0);
    rec.summary();
}, { timeout: 1_800_000 });
