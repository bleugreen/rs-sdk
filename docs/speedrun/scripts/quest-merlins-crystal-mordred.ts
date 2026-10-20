// Merlin's Crystal: the keep segment, from landing out of Arhein's crate to
// leaving the keep by its front door and reaching the Catherby candle maker.
//
//   bun docs/speedrun/scripts/quest-merlins-crystal-mordred.ts <bot> [att str def hp] [weapon]
//
// Measures, in server ticks: the two staircases up to Sir Mordred, the fight
// (attack click to Morgan Le Faye's interrupt dialogue), her dialogue (sets
// %arthur 3 -> 4), the walk down and out through the front door, and the walk
// to the candle maker. Defaults: 70/70/70, 70 hp, rune scimitar, rune armour.

import { runScript } from '../../../sdk/runner';
import * as L from './quest-lab';

const args = process.argv.slice(3).filter(a => !a.startsWith('-'));
const [att, str, def, hp] = [0, 1, 2, 3].map(i => Number(args[i] ?? 70));
const weapon = args[4] ?? 'rune_scimitar';

await runScript(async ({ bot, sdk }) => {
    await bot.dismissBlockingUI();
    await L.setStats(sdk, { attack: att, strength: str, defence: def, hitpoints: hp });
    for (const item of sdk.getInventory()) await bot.dropItem(item, 'all');
    const gear = [weapon, 'rune_full_helm', 'rune_platebody', 'rune_platelegs', 'rune_kiteshield', 'amulet_of_strength'];
    for (const g of gear) {
        if (!sdk.getEquipment().some(e => e.name.toLowerCase().replace(/ /g, '_') === g)) {
            await L.cheat(sdk, `give ${g} 1`, 1);
            const it = sdk.getInventory().find(i => i.name.toLowerCase().replace(/ /g, '_') === g);
            if (it) await bot.equipItem(it);
        }
    }
    await L.cheat(sdk, 'give swordfish 10', 1);
    await sdk.sendSetCombatStyle(1); // aggressive: max strength
    await L.cheat(sdk, 'setvar arthur 3');
    await L.tele(sdk, 2778, 3401, 0); // ^keep_crate_coord, where the crate ride lands
    await sdk.waitForTicks(2);

    // Up two staircases to Mordred's floor.
    let t0 = L.tick(sdk);
    const s1 = (await sdk.scanNearbyLocs(15)).find(l => /Staircase/.test(l.name) && l.options.includes('Climb-up'));
    await bot.interactLoc(s1!, 'Climb-up');
    await L.waitUntil(sdk, () => L.pos(sdk).level === 1, 40);
    const s2 = (await sdk.scanNearbyLocs(15)).find(l => /Staircase/.test(l.name) && l.options.includes('Climb-up'));
    await bot.interactLoc(s2!, 'Climb-up');
    await L.waitUntil(sdk, () => L.pos(sdk).level === 2, 40);
    const climbTicks = L.tick(sdk) - t0;
    const arrive = L.pos(sdk);

    // Fight until Morgan Le Faye interrupts (Mordred's death queue opens her dialogue).
    const mordred = sdk.findNearbyNpc(/Sir Mordred/);
    if (!mordred) throw new Error('Sir Mordred not found');
    const hpStart = sdk.getState()!.player!.hp;
    t0 = L.tick(sdk);
    await bot.attack(mordred);
    let firstHitTick: number | null = null;
    let eaten = 0;
    let minHp = hpStart;
    while (L.tick(sdk) - t0 < 600) {
        const s = sdk.getState()!;
        if (s.dialog.isOpen) break;
        const m = s.nearbyNpcs.find(n => /Sir Mordred/.test(n.name));
        if (firstHitTick === null && m && m.hp !== null && m.maxHp !== null && m.hp < m.maxHp) firstHitTick = s.tick;
        minHp = Math.min(minHp, s.player!.hp);
        if (s.player!.hp < s.player!.maxHp * 0.4) {
            await bot.eatFood(/Swordfish/);
            eaten++;
            const again = sdk.findNearbyNpc(/Sir Mordred/);
            if (again) await bot.attack(again);
        }
        await sdk.waitForStateUpdate();
    }
    const fightTicks = L.tick(sdk) - t0;
    const morgan = await L.talkThrough(sdk, [/Tell me how to untrap Merlin/, /OK I will go do all that/i]);
    const arthur = await L.getVar(sdk, 'arthur');

    // Down and out of the front door, then to the candle maker.
    t0 = L.tick(sdk);
    const d2 = (await sdk.scanNearbyLocs(15)).find(l => /Staircase/.test(l.name) && l.options.includes('Climb-down'));
    await bot.interactLoc(d2!, 'Climb-down');
    await L.waitUntil(sdk, () => L.pos(sdk).level === 1, 40);
    const d1 = (await sdk.scanNearbyLocs(15)).find(l => /Staircase/.test(l.name) && l.options.includes('Climb-down'));
    await bot.interactLoc(d1!, 'Climb-down');
    await L.waitUntil(sdk, () => L.pos(sdk).level === 0, 40);
    const downTicks = L.tick(sdk) - t0;
    t0 = L.tick(sdk);
    const door = (await sdk.scanNearbyLocs(20)).find(l => /Large door/.test(l.name) && l.options.includes('Knock-at'));
    await bot.interactLoc(door!, 'Open');
    await L.waitUntil(sdk, () => L.pos(sdk).x < 2763, 60);
    const doorTicks = L.tick(sdk) - t0;
    const outside = L.pos(sdk);
    const walk = await L.timedWalk(sdk, bot, 2800, 3440, 1);

    L.report(`Merlin's Crystal keep segment at ${att}/${str}/${def}, ${hp} hp, ${weapon}`, {
        climbTwoStaircasesTicks: climbTicks,
        arrivedAt: arrive,
        fightTicksClickToMorgan: fightTicks,
        ticksToFirstDamage: firstHitTick === null ? null : firstHitTick - t0,
        hpStart,
        minHp,
        foodEaten: eaten,
        morganDialogue: { ticks: morgan.ticks, pages: morgan.pages, options: morgan.options },
        arthurVarpAfter: arthur,
        downTwoStaircasesTicks: downTicks,
        frontDoorTicks: doorTicks,
        outsideAt: outside,
        walkToCandleMaker: walk
    });
}, { timeout: 600_000, printState: false });
