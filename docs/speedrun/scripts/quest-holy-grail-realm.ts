// Holy Grail: the first visit to the Fisher Realm, from blowing the magic
// whistle at the Karamja crossing to blowing it again to leave.
//
//   bun docs/speedrun/scripts/quest-holy-grail-realm.ts <bot> [att str def hp] [pray]
//
// Measures, in server ticks: the whistle crossing, the fisherman's dialogue
// (option 2 spawns the Grail bell by the castle), the Black Knight Titan fight
// with Excalibur worn (attack click to the death teleport past him), the walk
// to the bell, ringing it beside a maiden (teleports you inside the castle),
// the staircase up to the Fisher King, his dialogue (sets %grail 4 -> 8), and
// the whistle back to Karamja. `pray` turns on Protect from Melee for the
// fight (needs 43 Prayer). Defaults: 70/70/70, 70 hp, rune armour.

import { runScript } from '../../../sdk/runner';
import * as L from './quest-lab';

const args = process.argv.slice(3).filter(a => !a.startsWith('-'));
const nums = args.filter(a => /^\d+$/.test(a)).map(Number);
const [att, str, def, hp] = [0, 1, 2, 3].map(i => nums[i] ?? 70);
const pray = args.includes('pray');

await runScript(async ({ bot, sdk }) => {
    await bot.dismissBlockingUI();
    await L.setStats(sdk, { attack: att, strength: str, defence: def, hitpoints: hp, prayer: pray ? 70 : 1 });
    await sdk.waitForTicks(3);
    for (const item of sdk.getInventory()) await sdk.sendDropItem(item.slot);
    await sdk.waitForTicks(2);
    const gear = ['excalibur', 'rune_full_helm', 'rune_chainbody', 'rune_platelegs', 'rune_kiteshield', 'amulet_of_strength'];
    for (const g of gear) {
        const named = (i: { name: string }) => i.name.toLowerCase().replace(/ /g, '_') === g;
        if (sdk.getEquipment().some(named)) continue;
        await L.cheat(sdk, `give ${g} 1`, 1);
        await L.waitUntil(sdk, () => sdk.getInventory().some(named), 10);
        const r = await bot.equipItem(sdk.getInventory().find(named)!);
        if (!r.success) throw new Error(`could not equip ${g}: ${r.message}`);
    }
    await L.cheat(sdk, 'give magic_whistle 1', 1);
    await L.cheat(sdk, 'give swordfish 20', 2);
    await sdk.sendSetCombatStyle(1); // Excalibur "slash": aggressive
    await L.cheat(sdk, 'setvar grail 4'); // ^grail_spoken_crone
    await L.tele(sdk, 2741, 3235, 0); // inside the crossing zone 0_42_50_52_34..55_37
    await sdk.waitForTicks(2);
    const out: Record<string, unknown> = { stats: `${att}/${str}/${def}, ${hp} hp`, protectFromMelee: pray };

    // Whistle in.
    let t0 = L.tick(sdk);
    await sdk.sendUseItem(sdk.findInventoryItem(/Magic whistle/i)!.slot, 1);
    const arrived = await L.waitUntil(sdk, () => L.pos(sdk).z > 4600, 30);
    out.whistleIn = arrived === null ? null : arrived - t0;
    out.arrivedAt = L.pos(sdk);
    await sdk.waitForTicks(2);

    // Fisherman: option 2 drops the Grail bell at 0_43_73_10_22.
    t0 = L.tick(sdk);
    await bot.talkTo(/Fisherman/);
    const fisher = await L.talkThrough(sdk, [/get into the castle/i]);
    out.fisherman = { ticks: fisher.ticks, pages: fisher.pages, options: fisher.options, clickToClose: L.tick(sdk) - t0 - 3 };

    // Black Knight Titan.
    const titan = sdk.findNearbyNpc(/Black Knight Titan/)!;
    if (pray) await bot.activatePrayer('protect_from_melee');
    const hpStart = sdk.getState()!.player!.hp;
    let minHp = hpStart;
    let eaten = 0;
    let levelUps = 0;
    const fightStart = L.tick(sdk);
    await bot.attack(titan);
    let won = false;
    while (L.tick(sdk) - fightStart < 1500) {
        const s = sdk.getState()!;
        if (s.player!.worldX < 2791) { won = true; break; } // the death script teleports you past him
        if (s.player!.isDead) break;
        minHp = Math.min(minHp, s.player!.hp);
        if (s.dialog.isOpen) {
            levelUps++;
            await bot.dismissBlockingUI();
            const again = sdk.findNearbyNpc(/Black Knight Titan/);
            if (again) await bot.attack(again);
            continue;
        }
        if (s.player!.hp < s.player!.maxHp * 0.5 && sdk.countInventoryItems(/Swordfish/) > 0) {
            await bot.eatFood(/Swordfish/);
            eaten++;
            const again = sdk.findNearbyNpc(/Black Knight Titan/);
            if (again) await bot.attack(again);
        }
        await sdk.waitForStateUpdate();
    }
    if (pray) await bot.deactivateAllPrayers();
    out.titan = { won, ticks: L.tick(sdk) - fightStart, hpStart, minHp, eaten, levelUps, landedAt: L.pos(sdk) };
    if (!won) throw new Error(`Titan fight failed: ${JSON.stringify(out)}`);
    await sdk.waitForTicks(2);

    // Walk to the bell, take it, ring it beside a maiden.
    t0 = L.tick(sdk);
    const walk = await L.timedWalk(sdk, bot, 2762, 4694, 0);
    const bell = sdk.findGroundItem(/Grail bell/i);
    if (bell) await bot.pickupItem(bell);
    await L.waitUntil(sdk, () => sdk.countInventoryItems(/Grail bell/i) > 0, 20);
    out.walkToBell = { ...walk, withPickup: L.tick(sdk) - t0 };
    const bellItem = sdk.findInventoryItem(/Grail bell/i);
    if (!bellItem) {
        throw new Error(`no Grail bell; ground: ${JSON.stringify((await sdk.scanGroundItems(15)).map(g => [g.name, g.x, g.z]))}; so far ${JSON.stringify(out)}; fisher ${fisher.transcript.join(' / ')}`);
    }
    t0 = L.tick(sdk);
    await sdk.sendUseItem(bellItem.slot, 1);
    const ring = await L.talkThrough(sdk, []);
    out.ringBell = { ticks: ring.ticks, pages: ring.pages, clickToClose: L.tick(sdk) - t0 - 3, insideAt: L.pos(sdk) };

    // Up to the Fisher King.
    t0 = L.tick(sdk);
    const stairs = (await sdk.scanNearbyLocs(12)).filter(l => l.options.some(o => /Climb-up/.test(o)));
    stairs.sort((a, b) => a.distance - b.distance);
    await bot.interactLoc(stairs[0]!, 'Climb-up');
    await L.waitUntil(sdk, () => L.pos(sdk).level === 1, 40);
    out.stairsUp = { ticks: L.tick(sdk) - t0, via: `${stairs[0]!.name}@${stairs[0]!.x},${stairs[0]!.z}` };
    await sdk.waitForTicks(2);
    t0 = L.tick(sdk);
    await bot.talkTo(/Fisher King/);
    const king = await L.talkThrough(sdk, [/You don't look too well/]);
    out.fisherKing = { ticks: king.ticks, pages: king.pages, options: king.options, clickToClose: L.tick(sdk) - t0 - 3, grail: await L.getVar(sdk, 'grail') };

    // Whistle out.
    t0 = L.tick(sdk);
    await sdk.sendUseItem(sdk.findInventoryItem(/Magic whistle/i)!.slot, 1);
    const back = await L.waitUntil(sdk, () => L.pos(sdk).z < 4000, 30);
    out.whistleOut = { ticks: back === null ? null : back - t0, at: L.pos(sdk) };
    L.report('Holy Grail: first Fisher Realm visit', out);
}, { timeout: 900_000, printState: false });
