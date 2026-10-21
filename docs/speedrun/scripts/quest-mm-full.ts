// Monkey Madness, played on the lab server and timed step by step
// (docs/speedrun/quests/monkey_madness.md). Segments follow the quest; each can
// be started on its own: the script sets %mm_main and the sub-varbits
// (quest_mm.varbit) to the values the previous segments leave, gives the items
// they would have handed over, and teleports to where they end.
// Run: bun docs/speedrun/scripts/quest-mm-full.ts <botname> [first=A] [last=Z]
// Assumes quest-gnome-setup.ts (70/70/70, Prayer 43, Magic 59) and sets
// %treequest 9 and %grandtree 160 (Tree Gnome Village and The Grand Tree done).

import { runScript } from '../../../sdk/runner';
import { opLoc, talkTo, walkTo } from '../../../speedrun/lib/act';
import { converse, type ConverseResult } from '../../../speedrun/lib/converse';
import type { OptionPattern } from '../../../speedrun/lib/dialogue';
import { pathTiles } from '../../../speedrun/lib/paths';
import { currentTick, waitTicks, waitUntil, type Pred } from '../../../speedrun/lib/wait';
import { at, findNpc, pos } from '../../../speedrun/lib/world';
import { Recorder } from '../../../speedrun/lab/record';
import { clearInventory, getvar, give, mustTele, setvar } from '../../../speedrun/lab/setup';

const FIRST = (process.argv[3] ?? 'A').toUpperCase();
const LAST = (process.argv[4] ?? 'Z').toUpperCase();
const ORDER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const lvl = (l: number): Pred => s => pos(s).level === l;
const GLIDER_GANDIUS = 824; // glidermap:com_21 (server/content/pack/interface.pack)
const GLIDER_TA_QUIR_PRIW = 825; // glidermap:com_22
// reinitialisation_puzzle:com_3. Moving a tile needs OPHELD5, sent by sendUseItem
// with this component. sendClickComponentWithOption sends INV_BUTTON5 instead,
// which has no trigger here and moves nothing.
const PUZZLE_TILES = 11130;

// Quest state each segment starts from (varp/varbit name -> value), its items, and its tile.
type Start = { vars: Record<string, number>; items?: Array<[string, number]>; at: [number, number, number?] };
const STARTS: Record<string, Start> = {
    A: { vars: { mm_main: 0, mm_gnomes: 0, mm_monkeys: 0, mm_flags: 0, mm_misc: 0 }, at: [2465, 3496] },
    B: { vars: { mm_main: 1, mm_narnode: 3 }, items: [['mm_gnome_royal_seal', 1]], at: [2465, 3496] },
    C: { vars: { mm_main: 1, mm_narnode: 3, mm_caranock: 3 }, items: [['mm_gnome_royal_seal', 1]], at: [2956, 3024] },
    D: { vars: { mm_main: 1, mm_narnode: 7, mm_caranock: 3 }, items: [['mm_gnome_royal_seal', 1], ['mm_narnode_orders', 1]], at: [2465, 3496] },
    E: { vars: { mm_main: 1, mm_narnode: 7, mm_caranock: 3, mm_daero: 4, mm_daero_option_bit_one: 1, mm_daero_option_bit_two: 1, mm_daero_option_bit_three: 1 }, items: [['mm_gnome_royal_seal', 1]], at: [2393, 9892] },
    F: { vars: { mm_main: 2, mm_narnode: 7, mm_caranock: 3, mm_daero: 6 }, items: [['mm_gnome_royal_seal', 1]], at: [2649, 4508] },
    G: { vars: { mm_main: 2, mm_narnode: 7, mm_caranock: 3, mm_daero: 7, mm_waydar: 0, mm_lumdo: 0 }, items: [['mm_gnome_royal_seal', 1]], at: [2893, 2726] },
};

await runScript(async ({ bot, sdk }) => {
    const rec = new Recorder(sdk, 'monkey_madness');
    const runs = (seg: string) => ORDER.indexOf(seg) >= ORDER.indexOf(FIRST) && ORDER.indexOf(seg) <= ORDER.indexOf(LAST);
    const T0 = currentTick(sdk);
    const check = async (seg: string) => console.log(`-- after ${seg}: mm_main=${await getvar(sdk, 'mm_main')} mm_gnomes=${await getvar(sdk, 'mm_gnomes')} pos=${JSON.stringify(pos(sdk))} t=${currentTick(sdk) - T0}`);

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
    // Talk to an NPC. Chapter cards are closed, except where the conversation opens the glider map
    // (closeModals false); `done` (a scripted flight or cutscene) ends the segment when it lands.
    const talk = (name: string, npc: RegExp, choices: OptionPattern[], o: { idle?: number; done?: Pred; closeModals?: boolean } = {}) => rec.seg(name, async () => {
        const r = await talkTo(sdk, npc, choices, { idle: o.idle ?? 3, maxTicks: 600, unmatched: 'stop', closeModals: o.closeModals ?? true, ...(o.done ? { until: o.done } : {}) });
        rec.interact(r.clicks);
        return dialogueRow(r, o.done);
    });
    // Click the loc at (x, z) and wait for `done`; a dropped click is re-sent.
    const locStep = (name: string, x: number, z: number, op: RegExp, done: Pred, maxTicks = 20) => rec.seg(name, async () => {
        const r = await opLoc(sdk, { x, z, op }, op, done, { maxTicks });
        rec.interact(1 + r.resends);
        return r.ok ? undefined : 'TIMEOUT';
    });
    // Click the loc at (x, z) and answer the dialogue it opens.
    const locTalk = (name: string, x: number, z: number, op: RegExp, choices: OptionPattern[], o: { idle?: number; done?: Pred } = {}) => rec.seg(name, async () => {
        const conv = converse(sdk, choices, { idle: o.idle ?? 3, openTicks: 60, maxTicks: 600, unmatched: 'stop', closeModals: true, ...(o.done ? { until: o.done } : {}) });
        await opLoc(sdk, { x, z, op }, op);
        rec.interact();
        return dialogueRow(await conv, o.done);
    });
    // Click a glider map destination and wait for the landing; the segment runs from waiting for the map.
    const glide = (name: string, component: number, landed: Pred) => rec.seg(name, async () => {
        await waitUntil(sdk, s => s.modalOpen, { maxTicks: 10 });
        await sdk.sendClickComponent(component);
        rec.interact();
        const r = await waitUntil(sdk, landed, { maxTicks: 20 });
        if (!r.ok) return 'TIMEOUT';
        rec.mark(r.tick);
    });
    const treeLadder = async (from: number, to: number, label: string) => {
        const step = to > from ? 1 : -1;
        for (let l = from; l !== to; l += step) {
            await locStep(`${label} ladder ${l}->${l + step}`, 2466, 3495, step > 0 ? /^climb-up$/i : /^climb-down$/i, lvl(l + step));
        }
    };

    {
        const st = STARTS[FIRST];
        if (!st) throw new Error(`no start for segment ${FIRST}`);
        // Leave whatever an earlier run left open.
        await sdk.sendCloseModal();
        await sdk.sendWalk(pos(sdk).x, pos(sdk).z, true);
        await waitTicks(sdk, 2);
        await clearInventory(sdk);
        await setvar(sdk, 'treequest', 9);
        await setvar(sdk, 'grandtree', 160);
        for (const [k, v] of Object.entries(st.vars)) await setvar(sdk, k, v);
        for (const [o, n] of st.items ?? []) await give(sdk, o, n);
        await mustTele(sdk, st.at[0], st.at[1], st.at[2] ?? 0);
        await waitTicks(sdk, 2);
    }

    if (runs('A')) {
        // King Narnode starts the quest and hands over the royal seal; a chapter card follows.
        await talk('A1 Narnode start', /^King Narnode Shareen$/i, [/^Yes$/], { idle: 4 });
        await check('A');
    }
    if (runs('B')) {
        // Gnome Air from the top of the Grand Tree to Gandius (Karamja), then Caranock.
        await walk('B1 walk to ladder', 2466, 3496, 0);
        await treeLadder(0, 3, 'B2');
        await talk('B3 pilot', /^Gnome pilot$/i, [/take me on the glider/], { idle: 2, closeModals: false });
        await glide('B4 glider map click -> landed', GLIDER_GANDIUS, s => pos(s).z < 3100 && pos(s).level === 0);
        console.log('landed at', JSON.stringify(pos(sdk)));
        // The glider lands south of the shipyard; the west gate opens after the worker sees the seal.
        await walk('B5 walk to shipyard gate', 2943, 3041, 1);
        await locTalk('B6 gate: show the seal', 2945, 3041, /^open$/i, [], { idle: 8, done: s => pos(s).x >= 2945 });
        await walk('B7 walk to Caranock', 2956, 3024, 1);
        await talk('B8 Caranock', /Caranock$/i, []);
        await check('B');
    }
    if (runs('C')) {
        await walk('C1 walk to Gandius glider', 2970, 2974, 2);
        await talk('C2 pilot', /^Gnome pilot$/i, [/take me on the glider/], { idle: 2, closeModals: false });
        await glide('C3 glider map click -> landed', GLIDER_TA_QUIR_PRIW, at(2465, 3501, 3, 6));
        await treeLadder(3, 0, 'C4');
        await talk('C5 Narnode report + orders', /^King Narnode Shareen$/i, [], { idle: 6 });
        await check('C');
    }
    if (runs('D')) {
        // Daero is on the first floor of the Grand Tree. His menu offers "Leave" only after all
        // three topics have been opened once (mm_daero.rs2:129-133).
        await walk('D1 walk to ladder', 2466, 3496, 0);
        await treeLadder(0, 1, 'D2');
        await walk('D3 walk to Daero', 2484, 3487, 1);
        await talk('D4 Daero orders -> hangar', /^Daero$/i, [/journey/, /Return to previous/, /10th squad/, /Return to previous/, /Caranock/, /Return to previous/, /^Leave/, /Who is it/], { idle: 8, done: at(2393, 9892, 0, 3) });
        await check('D');
    }
    if (runs('E')) {
        await talk('E1 Daero + Waydar intro', /^Daero$/i, [], { idle: 4 });
        // Reinitialisation. The lab stands in for Glough's 200,000-coin fix (mm_glough.rs2:28-29),
        // which leaves the puzzle one move from solved (mm_puzzle.rs2:33-34,73-75): the gap is next
        // to slot 24, so clicking slot 24 solves it. A bot solving the full scramble needs about
        // 63 moves at 5 per tick (quest-mm-puzzle-sim.ts); the open and the cutscene are the same.
        await setvar(sdk, 'mm_hangar_puzzle_complete', 1);
        await locStep('E2 open control panel', 2394, 9883, /./, s => s.modalOpen);
        await rec.seg('E3 last tile -> rumble -> hangar cutscene -> powered hangar', async () => {
            await sdk.sendUseItem(24, 5, PUZZLE_TILES);
            rec.interact();
            const r = await waitUntil(sdk, at(2649, 4507, 0, 3), { maxTicks: 60 });
            if (!r.ok) return 'TIMEOUT';
            rec.mark(r.tick);
        });
        await check('E');
    }
    if (runs('F')) {
        await walk('F1 walk to Daero', 2648, 4512, 1);
        await talk('F2 Daero: reinitialised', /^Daero$/i, [], { idle: 4 });
        await talk('F3 Waydar: fly to Crash Island', /^Waydar$/i, [/^Yes$/], { idle: 4, closeModals: false, done: at(2893, 2725, 0, 4) });
        await check('F');
    }
    if (runs('G')) {
        await talk('G1 Waydar on Crash Island', /^Waydar$/i, []);
        await talk('G2 Lumdo', /^Lumdo$/i, []);
        {
            const l = findNpc(sdk, /^Lumdo$/i);
            console.log('Lumdo distance before G3:', l?.distance, l ? `${l.x},${l.z}` : 'not visible');
        }
        // Waydar orders Lumdo to ferry you (Lumdo must be within 10 tiles, mm_waydar.rs2:82); the chapter 2 cutscene follows and ends on Ape Atoll.
        await talk('G3 Waydar -> cutscene -> Ape Atoll', /^Waydar$/i, [/cannot convince Lumdo/], { idle: 12, done: at(2801, 2707, 0, 4) });
        await check('G');
    }
    console.log('wall ticks', currentTick(sdk) - T0);
    rec.report();
}, { timeout: 1_800_000 });
