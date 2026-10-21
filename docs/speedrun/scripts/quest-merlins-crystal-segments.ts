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
import * as L from './quest-arthur-lab';

const all = ['camelot', 'crate', 'candle', 'lady', 'beggar', 'altar', 'thrantax', 'crystal', 'reward'];
const picked = process.argv.slice(3).filter(a => !a.startsWith('-'));
const segments = picked.length ? picked : all;

const dlg = (d: L.DialogueResult) => ({ ticks: d.ticks, pages: d.pages, options: d.options, clicks: d.pages + d.options });

await runScript(async ({ bot, sdk }) => {
    await bot.dismissBlockingUI();
    const results: Record<string, unknown> = {};
    const ensure = async (name: string, count = 1) => {
        if (sdk.countInventoryItems(new RegExp(`^${name.replace(/_/g, ' ')}$`, 'i')) < count) {
            await L.cheat(sdk, `give ${name} ${count}`, 2);
        }
    };
    const talk = async (npc: RegExp, choices: RegExp[]) => {
        await L.waitUntil(sdk, () => sdk.findNearbyNpc(npc) !== null, 20);
        const t0 = L.tick(sdk);
        const r = await bot.talkTo(npc);
        if (!r.success) throw new Error(`talk ${npc}: ${r.message}`);
        const d = await L.talkThrough(sdk, choices);
        return { ...dlg(d), clickToClose: L.tick(sdk) - t0 - 3 };
    };

    for (const seg of segments) {
        if (seg === 'camelot') {
            await L.cheat(sdk, 'setvar grail 0');
            await L.cheat(sdk, 'setvar arthur 0');
            await L.tele(sdk, 2764, 3513, 0);
            const arthur = await talk(/King Arthur/, [/Knight of the Round Table/]);
            const v1 = await L.getVar(sdk, 'arthur');
            const gawain = await talk(/Sir Gawain/, [/how Merlin got trapped/i, /Thank you for the information/]);
            const v2 = await L.getVar(sdk, 'arthur');
            await L.tele(sdk, 2759, 3513, 1);
            const lancelot = await talk(/Sir Lancelot/, [/stronghold/i]);
            const v3 = await L.getVar(sdk, 'arthur');
            results.camelot = { arthur, gawain, lancelot, varps: [v1, v2, v3] };
        } else if (seg === 'crate') {
            await L.cheat(sdk, 'setvar arthur 3');
            await L.tele(sdk, 2801, 3444, 0);
            const crate = (await sdk.scanNearbyLocs(5)).find(l => l.x === 2801 && l.z === 3442);
            const t0 = L.tick(sdk);
            await bot.interactLoc(crate!, 'Hide-in');
            const d = await L.talkThrough(sdk, [/^Yes/]);
            results.crate = { ...dlg(d), clickToLanded: L.tick(sdk) - t0 - 3, landedAt: L.pos(sdk) };
        } else if (seg === 'candle') {
            await L.cheat(sdk, 'setvar arthur 4');
            await L.cheat(sdk, 'setvar excalibur_components_progress 0');
            await L.tele(sdk, 2800, 3441, 0);
            const ask = await talk(/Candle maker/i, [/black candles/i]);
            await ensure('bucket_wax');
            await ensure('tinderbox');
            const trade = await talk(/Candle maker/i, [/./]);
            const gotCandle = sdk.countInventoryItems(/^Black candle$/i);
            const t0 = L.tick(sdk);
            const tinder = sdk.findInventoryItem(/^Tinderbox$/i)!;
            const candle = sdk.findInventoryItem(/^Black candle$/i)!;
            await sdk.sendUseItemOnItem(tinder.slot, candle.slot);
            const lit = await L.waitUntil(sdk, () => sdk.countInventoryItems(/^Lit black candle$/i) > 0, 30);
            results.candle = { ask, trade, gotCandle, lightTicks: lit === null ? null : lit - t0 };
        } else if (seg === 'lady') {
            await L.cheat(sdk, 'setvar arthur 4');
            // She only offers Excalibur to a player who owns none (lady_of_the_lake.rs2:4).
            if (sdk.getEquipment().some(e => /^Excalibur$/i.test(e.name))) await bot.unequipItem(/^Excalibur$/i);
            await sdk.waitForTicks(1);
            for (const it of sdk.getInventory().filter(i => /^Excalibur$/i.test(i.name))) await sdk.sendDropItem(it.slot);
            await sdk.waitForTicks(2);
            await L.tele(sdk, 2924, 3403, 0);
            const lady = await talk(/Lady of the Lake/, [/seek the sword Excalibur/i]);
            results.lady = { lady, progress: await L.getVar(sdk, 'excalibur_components_progress') };
        } else if (seg === 'beggar') {
            await L.cheat(sdk, 'setvar arthur 4');
            await L.cheat(sdk, 'setvar excalibur_components_progress 4'); // excalibur_started bit
            await ensure('bread');
            await L.tele(sdk, 3016, 3245, 0);
            const door = (await sdk.scanNearbyLocs(6)).find(l => l.x === 3016 && l.z === 3246);
            const t0 = L.tick(sdk);
            await bot.interactLoc(door!, 'Open');
            const d = await L.talkThrough(sdk, [/Yes certainly/i]);
            results.beggar = { ...dlg(d), clickToClose: L.tick(sdk) - t0 - 3, excalibur: sdk.countInventoryItems(/^Excalibur$/i) };
        } else if (seg === 'altar') {
            await L.cheat(sdk, 'setvar arthur 4');
            await L.tele(sdk, 3239, 3606, 0);
            const altar = (await sdk.scanNearbyLocs(6)).find(l => /Chaos altar/i.test(l.name) && l.options.includes('Check'));
            const t0 = L.tick(sdk);
            await bot.interactLoc(altar!, 'Check');
            const d = await L.talkThrough(sdk, []);
            results.altar = { ...dlg(d), clickToClose: L.tick(sdk) - t0 - 3, progress: await L.getVar(sdk, 'excalibur_components_progress') };
        } else if (seg === 'thrantax') {
            await L.cheat(sdk, 'setvar arthur 4');
            await L.cheat(sdk, 'setvar excalibur_components_progress 1'); // chaos altar words learned
            await ensure('lit_black_candle');
            await ensure('bat_bones');
            await L.tele(sdk, 2780, 3515, 0); // ^camelot_magic_symbol
            const t0 = L.tick(sdk);
            // Raw drop packet: the quest script intercepts the drop (opheld5), so
            // bot.dropItem would wait for a ground item that never appears.
            await sdk.sendDropItem(sdk.findInventoryItem(/^Bat bones$/i)!.slot);
            const d = await L.talkThrough(sdk, [/^Snarthon Candtrick Termanto$/]);
            results.thrantax = { ...dlg(d), clickToClose: L.tick(sdk) - t0 - 3, arthur: await L.getVar(sdk, 'arthur') };
        } else if (seg === 'crystal') {
            await L.cheat(sdk, 'setvar arthur 5');
            await ensure('excalibur');
            await L.tele(sdk, 2767, 3491, 2);
            const crystal = (await sdk.scanNearbyLocs(6)).find(l => /Giant crystal/i.test(l.name));
            const t0 = L.tick(sdk);
            await bot.useItemOnLoc(sdk.findInventoryItem(/^Excalibur$/i)!, crystal!);
            const d = await L.talkThrough(sdk, []);
            results.crystal = { ...dlg(d), clickToClose: L.tick(sdk) - t0 - 3, arthur: await L.getVar(sdk, 'arthur') };
        } else if (seg === 'reward') {
            await L.cheat(sdk, 'setvar arthur 6');
            await L.cheat(sdk, 'setvar grail 0'); // any %grail > 0 sends Arthur down his Holy Grail branch
            await L.tele(sdk, 2764, 3513, 0);
            const arthur = await talk(/King Arthur/, []);
            results.reward = { arthur, arthurVarp: await L.getVar(sdk, 'arthur') };
        }
        console.log(seg, JSON.stringify(results[seg]));
    }
    L.report("Merlin's Crystal segments", results);
}, { timeout: 900_000, printState: false });
