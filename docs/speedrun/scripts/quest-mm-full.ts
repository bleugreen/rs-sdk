// Monkey Madness, played on the lab server and timed step by step
// (docs/speedrun/quests/monkey_madness.md). Segments follow the quest; each can
// be started on its own: the script sets %mm_main and the sub-varbits
// (quest_mm.varbit) to the values the previous segments leave, gives the items
// they would have handed over, and teleports to where they end.
// Run: bun docs/speedrun/scripts/quest-mm-full.ts <botname> [first=A] [last=Z]
// Assumes quest-gnome-setup.ts (70/70/70, Prayer 43, Magic 59) and sets
// %treequest 9 and %grandtree 160 (Tree Gnome Village and The Grand Tree done).

import { runScript } from '../../../sdk/runner';
import type { BotSDK } from '../../../sdk/index';
import {
    cheat, dialogue, getvar, give, invCount, locOpAt, locTalkAt, now, pos, Recorder, setvar, talk, tele,
    useOnLocAt, waitTicks, waitUntil, walk, type Pred, type StepRecord,
} from './quest-gnome-lib';

const FIRST = (process.argv[3] ?? 'A').toUpperCase();
const LAST = (process.argv[4] ?? 'Z').toUpperCase();
const ORDER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const lvl = (l: number): Pred => s => pos(s).level === l;
const near = (x: number, z: number, r = 3, l = 0): Pred => s => {
    const p = pos(s);
    return p.level === l && Math.abs(p.x - x) <= r && Math.abs(p.z - z) <= r;
};
const GLIDER_GANDIUS = 824; // glidermap:com_21 (server/content/pack/interface.pack)
const GLIDER_TA_QUIR_PRIW = 825; // glidermap:com_22

// Quest state each segment starts from (varp/varbit name -> value), its items, and its tile.
type Start = { vars: Record<string, number>; items?: Array<[string, number]>; at: [number, number, number?] };
const STARTS: Record<string, Start> = {
    A: { vars: { mm_main: 0, mm_gnomes: 0, mm_monkeys: 0, mm_flags: 0, mm_misc: 0 }, at: [2465, 3496] },
    B: { vars: { mm_main: 1, mm_narnode: 3 }, items: [['mm_gnome_royal_seal', 1]], at: [2465, 3496] },
    C: { vars: { mm_main: 1, mm_narnode: 3, mm_caranock: 3 }, items: [['mm_gnome_royal_seal', 1]], at: [2956, 3024] },
    D: { vars: { mm_main: 1, mm_narnode: 7, mm_caranock: 3 }, items: [['mm_gnome_royal_seal', 1], ['mm_narnode_orders', 1]], at: [2465, 3496] },
    E: { vars: { mm_main: 1, mm_narnode: 7, mm_caranock: 3, mm_daero: 4, mm_daero_option_bit_one: 1, mm_daero_option_bit_two: 1, mm_daero_option_bit_three: 1 }, items: [['mm_gnome_royal_seal', 1]], at: [2393, 9892] },
    F: { vars: { mm_main: 1, mm_narnode: 7, mm_caranock: 3, mm_daero: 7 }, items: [['mm_gnome_royal_seal', 1]], at: [2893, 2726] },
};

await runScript(async ({ bot, sdk }) => {
    const rec = new Recorder('monkey_madness');
    const add = (r: StepRecord, label: string) => rec.add(r, label);
    const runs = (seg: string) => ORDER.indexOf(seg) >= ORDER.indexOf(FIRST) && ORDER.indexOf(seg) <= ORDER.indexOf(LAST);
    const T0 = now(sdk);
    const check = async (seg: string) => console.log(`-- after ${seg}: mm_main=${await getvar(sdk, 'mm_main')} mm_gnomes=${await getvar(sdk, 'mm_gnomes')} pos=${JSON.stringify(pos(sdk.getState()))} t=${now(sdk) - T0}`);
    // Click a glider map destination and wait for the landing.
    const glide = async (component: number, landed: Pred, label: string) => {
        const t0 = now(sdk);
        await waitUntil(sdk, s => s.modalOpen, 10);
        await sdk.sendClickComponent(component);
        const r = await waitUntil(sdk, landed, 20);
        add({ name: `glider map click -> landed`, ticks: (r?.tick ?? NaN) - t0 }, label);
    };
    const treeLadder = async (from: number, to: number, label: string) => {
        for (let l = from; l !== to; l += to > from ? 1 : -1) {
            const op = to > from ? /^climb-up$/i : /^climb-down$/i;
            add(await locOpAt(sdk, 2466, 3495, op, lvl(l + (to > from ? 1 : -1)), 20), `${label} ladder ${l}->${l + (to > from ? 1 : -1)}`);
        }
    };

    {
        const st = STARTS[FIRST];
        if (!st) throw new Error(`no start for segment ${FIRST}`);
        await cheat(sdk, '~clearinv');
        await setvar(sdk, 'treequest', 9);
        await setvar(sdk, 'grandtree', 160);
        for (const [k, v] of Object.entries(st.vars)) await setvar(sdk, k, v);
        for (const [o, n] of st.items ?? []) await give(sdk, o, n);
        await tele(sdk, st.at[0], st.at[1], st.at[2] ?? 0);
        await waitTicks(sdk, 2);
    }

    if (runs('A')) {
        // King Narnode starts the quest and hands over the royal seal; a chapter card follows.
        add(await talk(sdk, /^King Narnode Shareen$/i, [/^Yes$/], { idle: 4 }), 'A1 Narnode start');
        await check('A');
    }
    if (runs('B')) {
        // Gnome Air from the top of the Grand Tree to Gandius (Karamja), then Caranock.
        add(await walk(bot, sdk, 2466, 3496, 0), 'B1 walk to ladder');
        await treeLadder(0, 3, 'B2');
        add(await talk(sdk, /^Gnome pilot$/i, [/take me on the glider/], { idle: 2 }), 'B3 pilot');
        await glide(GLIDER_GANDIUS, s => pos(s).z < 3100 && pos(s).level === 0, 'B4');
        console.log('landed at', JSON.stringify(pos(sdk.getState())));
        add(await walk(bot, sdk, 2956, 3024, 1), 'B5 walk to Caranock');
        add(await talk(sdk, /^Caranock$/i, [], { idle: 3 }), 'B6 Caranock');
        await check('B');
    }
    if (runs('C')) {
        add(await walk(bot, sdk, 2970, 2974, 2), 'C1 walk to Gandius glider');
        add(await talk(sdk, /^Gnome pilot$/i, [/take me on the glider/], { idle: 2 }), 'C2 pilot');
        await glide(GLIDER_TA_QUIR_PRIW, near(2465, 3501, 6, 3), 'C3');
        await treeLadder(3, 0, 'C4');
        add(await talk(sdk, /^King Narnode Shareen$/i, [], { idle: 6 }), 'C5 Narnode report + orders');
        await check('C');
    }
    if (runs('D')) {
        // Daero is on the first floor of the Grand Tree. His menu offers "Leave" only after all
        // three topics have been opened once (mm_daero.rs2:129-133).
        add(await walk(bot, sdk, 2466, 3496, 0), 'D1 walk to ladder');
        await treeLadder(0, 1, 'D2');
        add(await walk(bot, sdk, 2484, 3487, 1), 'D3 walk to Daero');
        add(await talk(sdk, /^Daero$/i, [/journey/, /Return to previous/, /10th squad/, /Return to previous/, /Caranock/, /Return to previous/, /^Leave/, /Who is it/], { idle: 8, done: near(2393, 9892, 3) }), 'D4 Daero orders -> hangar');
        await check('D');
    }
    if (runs('E')) {
        add(await talk(sdk, /^Daero$/i, [], { idle: 4 }), 'E1 Daero + Waydar intro');
        await check('E');
    }
    console.log('wall ticks', now(sdk) - T0);
    rec.summary();
    void dialogue; void invCount; void locTalkAt; void useOnLocAt; void (null as unknown as BotSDK);
}, { timeout: 1_800_000 });
