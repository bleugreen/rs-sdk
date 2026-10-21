// Merlin's Crystal: every non-fight segment, each measured from standing next
// to its NPC or loc (travel between segments is done with ::tele and costed
// separately in docs/speedrun/quests/merlins_crystal.md).
//
//   bun docs/speedrun/scripts/quest-merlins-crystal-segments.ts <bot> [segment...]
//
// Segments: camelot (Arthur, Gawain, Lancelot), crate (Catherby crate ride to
// the keep), candle (black candle from the candle maker, then lighting it),
// lady (Lady of the Lake), beggar (Port Sarim jeweller's door, bread, Excalibur),
// altar (inscription on the chaos altar), thrantax (bat bones on the Camelot
// magic symbol), crystal (Excalibur on the giant crystal), reward (King Arthur).
// With no segment names every segment runs in quest order. The keep and the
// Sir Mordred fight are in quest-merlins-crystal-mordred.ts.

import { runScript } from '../../../sdk/runner';
import { act, opLoc, slotOf, talkTo } from '../../../speedrun/lib/act';
import { converse, type ConverseResult } from '../../../speedrun/lib/converse';
import type { OptionPattern } from '../../../speedrun/lib/dialogue';
import { currentTick } from '../../../speedrun/lib/wait';
import { findLoc, invCount, pos, worn, type LocQuery, type OpPattern } from '../../../speedrun/lib/world';
import { result } from '../../../speedrun/lab/record';
import { dropMatching, ensureItem, getvar, mustTele, setvar } from '../../../speedrun/lab/setup';

const all = ['camelot', 'crate', 'candle', 'lady', 'beggar', 'altar', 'thrantax', 'crystal', 'reward'];
const picked = process.argv.slice(3).filter(a => !a.startsWith('-'));
const segments = picked.length ? picked : all;

/** Ticks from the first page to the dialogue closing, and its clicks. */
const dlg = (d: ConverseResult) => ({ ticks: d.opened ? d.endTick - d.firstTick : 0, pages: d.pages, options: d.options, clicks: d.pages + d.options });

await runScript(async ({ bot, sdk }) => {
    await bot.dismissBlockingUI();
    const results: Record<string, unknown> = {};
    const talk = async (npc: RegExp, choices: OptionPattern[]) => {
        const r = await talkTo(sdk, npc, choices, { keep: true, findTicks: 20 });
        if (!r.opened) throw new Error(`talk ${npc}: no dialogue opened`);
        return { ...dlg(r), clickToClose: r.ticks };
    };
    /** Answer a dialogue a click has opened (or is about to open); `t0` is the click. */
    const answer = async (opened: Promise<unknown>, choices: OptionPattern[], t0: number) => {
        await opened;
        const d = await converse(sdk, choices, { keep: true });
        if (!d.opened) throw new Error(`no dialogue opened (at ${JSON.stringify(pos(sdk))})`);
        return { ...dlg(d), clickToClose: d.endTick - t0 };
    };
    const locDialog = (q: LocQuery, op: OpPattern, choices: OptionPattern[] = []) => {
        const t0 = currentTick(sdk);
        return answer(opLoc(sdk, q, op, s => s.dialog.isOpen, { maxTicks: 30 }), choices, t0);
    };

    for (const seg of segments) {
        if (seg === 'camelot') {
            await setvar(sdk, 'grail', 0);
            await setvar(sdk, 'arthur', 0);
            await mustTele(sdk, 2764, 3513, 0);
            const arthur = await talk(/King Arthur/, [/Knight of the Round Table/]);
            const v1 = await getvar(sdk, 'arthur');
            const gawain = await talk(/Sir Gawain/, [/how Merlin got trapped/i, /Thank you for the information/]);
            const v2 = await getvar(sdk, 'arthur');
            await mustTele(sdk, 2759, 3513, 1);
            const lancelot = await talk(/Sir Lancelot/, [/stronghold/i]);
            const v3 = await getvar(sdk, 'arthur');
            results.camelot = { arthur, gawain, lancelot, varps: [v1, v2, v3] };
        } else if (seg === 'crate') {
            await setvar(sdk, 'arthur', 3);
            await mustTele(sdk, 2801, 3444, 0);
            const { clickToClose, ...d } = await locDialog({ x: 2801, z: 3442, radius: 5 }, 'Hide-in', [/^Yes/]);
            results.crate = { ...d, clickToLanded: clickToClose, landedAt: pos(sdk) };
        } else if (seg === 'candle') {
            await setvar(sdk, 'arthur', 4);
            await setvar(sdk, 'excalibur_components_progress', 0);
            await mustTele(sdk, 2800, 3441, 0);
            const ask = await talk(/Candle maker/i, [/black candles/i]);
            await ensureItem(sdk, 'bucket_wax', /^Bucket of wax$/i);
            await ensureItem(sdk, 'tinderbox', /^Tinderbox$/i);
            const trade = await talk(/Candle maker/i, [/./]);
            const gotCandle = invCount(sdk, /^Black candle$/i);
            const lit = await act(
                sdk,
                () => sdk.sendUseItemOnItem(slotOf(sdk, /^Tinderbox$/i), slotOf(sdk, /^Black candle$/i)),
                s => invCount(s, /^Lit black candle$/i) > 0,
                { maxTicks: 30 }
            );
            results.candle = { ask, trade, gotCandle, lightTicks: lit.ok ? lit.ticks : null };
        } else if (seg === 'lady') {
            await setvar(sdk, 'arthur', 4);
            // She only offers Excalibur to a player who owns none (lady_of_the_lake.rs2:4).
            if (worn(sdk, /^Excalibur$/i)) await bot.unequipItem(/^Excalibur$/i);
            await dropMatching(sdk, [/^Excalibur$/i]);
            await mustTele(sdk, 2924, 3403, 0);
            const lady = await talk(/Lady of the Lake/, [/seek the sword Excalibur/i]);
            results.lady = { lady, progress: await getvar(sdk, 'excalibur_components_progress') };
        } else if (seg === 'beggar') {
            await setvar(sdk, 'arthur', 4);
            await setvar(sdk, 'excalibur_components_progress', 4); // excalibur_started bit
            await ensureItem(sdk, 'bread', /^Bread$/i);
            await mustTele(sdk, 3016, 3245, 0);
            const d = await locDialog({ x: 3016, z: 3246, radius: 6 }, 'Open', [/Yes certainly/i]);
            results.beggar = { ...d, excalibur: invCount(sdk, /^Excalibur$/i) };
        } else if (seg === 'altar') {
            await setvar(sdk, 'arthur', 4);
            await mustTele(sdk, 3239, 3606, 0);
            const d = await locDialog({ name: /Chaos altar/i, radius: 6 }, 'Check');
            results.altar = { ...d, progress: await getvar(sdk, 'excalibur_components_progress') };
        } else if (seg === 'thrantax') {
            await setvar(sdk, 'arthur', 4);
            await setvar(sdk, 'excalibur_components_progress', 1); // chaos altar words learned
            await ensureItem(sdk, 'lit_black_candle', /^Lit black candle$/i);
            await ensureItem(sdk, 'bat_bones', /^Bat bones$/i);
            await mustTele(sdk, 2780, 3515, 0); // ^camelot_magic_symbol
            const t0 = currentTick(sdk);
            // Raw drop packet: the quest script intercepts the drop (opheld5), so
            // waiting for a ground item would wait for one that never appears.
            const d = await answer(sdk.sendDropItem(slotOf(sdk, /^Bat bones$/i)), [/^Snarthon Candtrick Termanto$/], t0);
            results.thrantax = { ...d, arthur: await getvar(sdk, 'arthur') };
        } else if (seg === 'crystal') {
            await setvar(sdk, 'arthur', 5);
            await ensureItem(sdk, 'excalibur', /^Excalibur$/i);
            await mustTele(sdk, 2767, 3491, 2);
            const crystal = await findLoc(sdk, { name: /Giant crystal/i, radius: 6 });
            if (!crystal) throw new Error(`no giant crystal near ${JSON.stringify(pos(sdk))}`);
            const t0 = currentTick(sdk);
            const use = act(sdk, () => sdk.sendUseItemOnLoc(slotOf(sdk, /^Excalibur$/i), crystal.x, crystal.z, crystal.id), s => s.dialog.isOpen, { maxTicks: 30 });
            const d = await answer(use, [], t0);
            results.crystal = { ...d, arthur: await getvar(sdk, 'arthur') };
        } else if (seg === 'reward') {
            await setvar(sdk, 'arthur', 6);
            await setvar(sdk, 'grail', 0); // any %grail > 0 sends Arthur down his Holy Grail branch
            await mustTele(sdk, 2764, 3513, 0);
            const arthur = await talk(/King Arthur/, []);
            results.reward = { arthur, arthurVarp: await getvar(sdk, 'arthur') };
        }
        console.log(seg, JSON.stringify(results[seg]));
    }
    result('merlins-crystal-segments', results);
}, { timeout: 900_000, printState: false });
