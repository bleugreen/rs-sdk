// Holy Grail: the first visit to the Fisher Realm, from blowing the magic
// whistle at the Karamja crossing to blowing it again to leave.
//
//   bun docs/speedrun/scripts/quest-holy-grail-realm.ts <bot> [att str def hp] [pray] [weapon=<obj>] [swap=<hp>]
//
// Route (the river south of the arrival point is impassable, so the fisherman
// is only reachable past the Titan): whistle in, kill the Black Knight Titan
// (attack click to the death teleport past him), walk to the fisherman, his
// dialogue (option 2 spawns the Grail bell by the castle), walk to the bell and
// take it, ring it beside a maiden (teleports you inside the castle), the
// staircase up to the Fisher King, his dialogue (sets %grail to 8), and the
// whistle back to Karamja.
//
// The Titan only checks that Excalibur is worn when his hitpoints reach zero
// (black_knight_titan.rs2:30). With weapon=<obj> the fight is done with that
// weapon and Excalibur is wielded once his hitpoints fall to `swap` (default 30)
// or below. `pray` turns on Protect from Melee (needs 43 Prayer).
// Defaults: 70/70/70, 70 hp, Excalibur throughout, rune armour.

import { runScript } from '../../../sdk/runner';
import * as L from './quest-lab';

const args = process.argv.slice(3).filter(a => !a.startsWith('-'));
const nums = args.filter(a => /^\d+$/.test(a)).map(Number);
const [att, str, def, hp] = [0, 1, 2, 3].map(i => nums[i] ?? 70);
const pray = args.includes('pray');
const weapon = args.find(a => a.startsWith('weapon='))?.slice(7) ?? 'excalibur';
const swapAt = Number(args.find(a => a.startsWith('swap='))?.slice(5) ?? 30);
const objName = (i: { name: string }) => i.name.toLowerCase().replace(/ /g, '_');

await runScript(async ({ bot, sdk }) => {
    await bot.dismissBlockingUI();
    await L.setStats(sdk, { attack: att, strength: str, defence: def, hitpoints: hp, prayer: pray ? 70 : 1 });
    await sdk.waitForTicks(3);
    for (const e of sdk.getEquipment()) if (objName(e) === 'excalibur' || objName(e) === weapon) await bot.unequipItem(e.name);
    await sdk.waitForTicks(1);
    for (const item of sdk.getInventory()) await sdk.sendDropItem(item.slot);
    await sdk.waitForTicks(2);
    const gear = [weapon, 'rune_full_helm', 'rune_chainbody', 'rune_platelegs', 'rune_kiteshield', 'amulet_of_strength'];
    for (const g of gear) {
        const named = (i: { name: string }) => objName(i) === g;
        if (sdk.getEquipment().some(named)) continue;
        await L.cheat(sdk, `give ${g} 1`, 1);
        await L.waitUntil(sdk, () => sdk.getInventory().some(named), 10);
        const r = await bot.equipItem(sdk.getInventory().find(named)!);
        if (!r.success) throw new Error(`could not equip ${g}: ${r.message}`);
    }
    if (weapon !== 'excalibur') await L.cheat(sdk, 'give excalibur 1', 1);
    await L.cheat(sdk, 'give magic_whistle 1', 1);
    await L.cheat(sdk, 'give swordfish 20', 2);
    await sdk.sendSetCombatStyle(1); // aggressive
    await L.cheat(sdk, 'setvar grail 4'); // ^grail_spoken_crone
    await L.tele(sdk, 2741, 3235, 0); // inside the crossing zone 0_42_50_52_34..55_37
    await sdk.waitForTicks(2);
    const out: Record<string, unknown> = {};
    process.on('exit', () => { if (!out.done) L.report('Holy Grail realm visit (partial)', out); });
    Object.assign(out, { stats: `${att}/${str}/${def}, ${hp} hp`, weapon, swapAt: weapon === 'excalibur' ? null : swapAt, protectFromMelee: pray });

    // Whistle in.
    let t0 = L.tick(sdk);
    await sdk.sendUseItem(sdk.findInventoryItem(/Magic whistle/i)!.slot, 1);
    const arrived = await L.waitUntil(sdk, () => L.pos(sdk).z > 4600, 30);
    out.whistleIn = arrived === null ? null : arrived - t0;
    out.arrivedAt = L.pos(sdk);
    await sdk.waitForTicks(2);

    // Black Knight Titan.
    await L.waitUntil(sdk, () => sdk.findNearbyNpc(/Black Knight Titan/) !== null, 20);
    if (pray) await bot.activatePrayer('protect_from_melee');
    const hpStart = sdk.getState()!.player!.hp;
    let minHp = hpStart;
    let eaten = 0;
    let levelUps = 0;
    let swappedAtTick: number | null = null;
    let swappedAtTitanHp: number | null = null;
    let reheals = 0;
    let lastTitanHp = 142;
    const fightStart = L.tick(sdk);
    await bot.attack(sdk.findNearbyNpc(/Black Knight Titan/)!);
    let won = false;
    while (L.tick(sdk) - fightStart < 1500) {
        const s = sdk.getState()!;
        if (s.player!.worldX < 2791) { won = true; break; } // the death script teleports you past him
        if (s.player!.isDead) break;
        minHp = Math.min(minHp, s.player!.hp);
        const titan = s.nearbyNpcs.find(n => /Black Knight Titan/.test(n.name));
        if (s.dialog.isOpen) {
            if (!L.isLevelUpDialog(sdk)) {
                // "Puny mortal... INVINCIBLE": the kill landed without Excalibur.
                reheals++;
                await L.talkThrough(sdk, []);
            } else {
                levelUps++;
                await L.dismissLevelUps(sdk);
            }
            if (titan) await bot.attack(titan);
            continue;
        }
        if (titan?.hp != null) {
            if (titan.hp > lastTitanHp + 50) reheals++;
            lastTitanHp = titan.hp;
        }
        if (swappedAtTick === null && weapon !== 'excalibur' && titan?.hp != null && titan.hp <= swapAt) {
            const ex = sdk.findInventoryItem(/^Excalibur$/i);
            if (ex) {
                swappedAtTick = L.tick(sdk) - fightStart;
                swappedAtTitanHp = titan.hp;
                await bot.equipItem(ex);
                await bot.attack(titan);
                continue;
            }
        }
        if (s.player!.hp < s.player!.maxHp * 0.5 && sdk.countInventoryItems(/Swordfish/) > 0) {
            await bot.eatFood(/Swordfish/);
            eaten++;
            if (titan) await bot.attack(titan);
        }
        await sdk.waitForStateUpdate();
    }
    if (pray) await bot.deactivateAllPrayers();
    out.titan = { won, ticks: L.tick(sdk) - fightStart, hpStart, minHp, eaten, levelUps, reheals, swappedAtTick, swappedAtTitanHp, landedAt: L.pos(sdk) };
    if (!won) throw new Error(`Titan fight failed: ${JSON.stringify(out)}`);
    await sdk.waitForTicks(2);

    // Fisherman, on the south bank.
    t0 = L.tick(sdk);
    const toFisher = await L.timedWalk(sdk, bot, 2802, 4704, 1);
    const talk = await bot.talkTo(/Fisherman/);
    if (!talk.success) throw new Error(`fisherman: ${talk.message}`);
    const fisher = await L.talkThrough(sdk, [/get into the castle/i]);
    out.fisherman = { walk: toFisher, ticks: fisher.ticks, pages: fisher.pages, options: fisher.options, total: L.tick(sdk) - t0 - 3 };

    // Walk to the bell, take it, ring it beside a maiden.
    t0 = L.tick(sdk);
    const walk = await L.timedWalk(sdk, bot, 2762, 4694, 0);
    const bell = sdk.findGroundItem(/Grail bell/i);
    if (bell) await bot.pickupItem(bell);
    await L.waitUntil(sdk, () => sdk.countInventoryItems(/Grail bell/i) > 0, 20);
    out.walkToBell = { ...walk, withPickup: L.tick(sdk) - t0 };
    const bellItem = sdk.findInventoryItem(/Grail bell/i);
    if (!bellItem) throw new Error(`no Grail bell; so far ${JSON.stringify(out)}`);
    t0 = L.tick(sdk);
    await sdk.sendUseItem(bellItem.slot, 1);
    const ring = await L.talkThrough(sdk, []);
    out.ringBell = { ticks: ring.ticks, pages: ring.pages, total: L.tick(sdk) - t0 - 3, insideAt: L.pos(sdk) };

    // Up to the Fisher King.
    t0 = L.tick(sdk);
    const stairs = (await sdk.scanNearbyLocs(20)).filter(l => l.options.some(o => /Climb-up/.test(o)));
    stairs.sort((a, b) => a.distance - b.distance);
    await bot.interactLoc(stairs[0]!, 'Climb-up');
    await L.waitUntil(sdk, () => L.pos(sdk).level === 1, 40);
    out.stairsUp = { ticks: L.tick(sdk) - t0, via: `${stairs[0]!.name}@${stairs[0]!.x},${stairs[0]!.z}`, at: L.pos(sdk) };
    await sdk.waitForTicks(2);
    // The King's room is behind two doors (2766,4684 and 2766,4688), which
    // close again on a timer: open whichever closed door is nearest until the
    // talk-to path goes through.
    t0 = L.tick(sdk);
    let doorsOpened = 0;
    let kt = await bot.talkTo(/Fisher King/);
    while (!kt.success && doorsOpened < 4) {
        const door = (await sdk.scanNearbyLocs(10))
            .filter(l => l.name === 'Door' && l.options.includes('Open'))
            .sort((a, b) => a.distance - b.distance)[0];
        if (!door) break;
        await bot.openDoor(door);
        doorsOpened++;
        kt = await bot.talkTo(/Fisher King/);
    }
    if (!kt.success) throw new Error(`fisher king: ${kt.message}`);
    out.toKing = { ticks: L.tick(sdk) - t0, doorsOpened };
    t0 = L.tick(sdk);
    const king = await L.talkThrough(sdk, [/You don't look too well/]);
    out.fisherKing = { ticks: king.ticks, pages: king.pages, options: king.options, total: L.tick(sdk) - t0 - 3, grail: await L.getVar(sdk, 'grail') };

    // Whistle out.
    t0 = L.tick(sdk);
    await sdk.sendUseItem(sdk.findInventoryItem(/Magic whistle/i)!.slot, 1);
    const back = await L.waitUntil(sdk, () => L.pos(sdk).z < 4000, 30);
    out.whistleOut = { ticks: back === null ? null : back - t0, at: L.pos(sdk) };
    out.done = true;
    L.report('Holy Grail: first Fisher Realm visit', out);
}, { timeout: 900_000, printState: false });
