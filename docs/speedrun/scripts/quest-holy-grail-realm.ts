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
import type { BotWorldState } from '../../../sdk/types';
import { act, invOp, openDoor, opLoc, pickup, slotOf, talkTo, walkTo, wield } from '../../../speedrun/lib/act';
import { fight } from '../../../speedrun/lib/combat';
import { converse, type ConverseResult } from '../../../speedrun/lib/converse';
import { currentTick, waitTicks, waitUntil } from '../../../speedrun/lib/wait';
import { chebyshev, invItem, pos, waitForNpc } from '../../../speedrun/lib/world';
import { result } from '../../../speedrun/lab/record';
import { clearInventory, getvar, give, mustTele, setStats, setvar } from '../../../speedrun/lab/setup';

const args = process.argv.slice(3).filter(a => !a.startsWith('-'));
const nums = args.filter(a => /^\d+$/.test(a)).map(Number);
const stat = (i: number) => nums[i] ?? 70;
const att = stat(0), str = stat(1), def = stat(2), hp = stat(3);
const pray = args.includes('pray');
const weapon = args.find(a => a.startsWith('weapon='))?.slice(7) ?? 'excalibur';
const swapAt = Number(args.find(a => a.startsWith('swap='))?.slice(5) ?? 30);
/** The in-game name of a debug obj name: rune_full_helm is "Rune full helm". */
const display = (obj: string) => new RegExp(`^${obj.replace(/_/g, ' ')}$`, 'i');
const TITAN = /Black Knight Titan/;

/** Ticks from the first page to the dialogue closing. */
const dlgTicks = (r: ConverseResult) => (r.opened ? r.endTick - r.firstTick : 0);

await runScript(async ({ bot, sdk }) => {
    await bot.dismissBlockingUI();
    await clearInventory(sdk);
    await setStats(sdk, { attack: att, strength: str, defence: def, hitpoints: hp, prayer: pray ? 70 : 1 });
    for (const g of [weapon, 'rune_full_helm', 'rune_chainbody', 'rune_platelegs', 'rune_kiteshield', 'amulet_of_strength']) {
        await give(sdk, g);
        if (!(await wield(sdk, display(g))).ok) throw new Error(`could not equip ${g}`);
    }
    if (weapon !== 'excalibur') await give(sdk, 'excalibur');
    await give(sdk, 'magic_whistle');
    await give(sdk, 'swordfish', 20);
    await sdk.sendSetCombatStyle(1); // aggressive
    await setvar(sdk, 'grail', 4); // ^grail_spoken_crone
    await mustTele(sdk, 2741, 3235, 0); // inside the crossing zone 0_42_50_52_34..55_37
    const out: Record<string, unknown> = {};
    process.on('exit', () => { if (!out.done) result('holy-grail-realm-partial', out); });
    Object.assign(out, { stats: `${att}/${str}/${def}, ${hp} hp`, weapon, swapAt: weapon === 'excalibur' ? null : swapAt, protectFromMelee: pray });

    const whistle = (there: (s: BotWorldState) => boolean) =>
        act(sdk, () => sdk.sendUseItem(slotOf(sdk, /Magic whistle/i), 1), there, { maxTicks: 30 });

    // Whistle in.
    const arrived = await whistle(s => pos(s).z > 4600);
    out.whistleIn = arrived.ok ? arrived.ticks : null;
    out.arrivedAt = pos(sdk);
    await waitTicks(sdk, 2);

    // Black Knight Titan: attack click to the death teleport past him. At zero
    // hitpoints his death queue either teleports you past him (Excalibur worn)
    // or heals him and opens his taunt ("Puny mortal... INVINCIBLE"), so the
    // fight waits for the teleport (done) or his taunt, not the zero-hp hitsplat.
    if (!(await waitForNpc(sdk, TITAN, 20))) throw new Error(`no Black Knight Titan near ${JSON.stringify(pos(sdk))}`);
    const past = (s: BotWorldState) => (s.player?.worldX ?? 9999) < 2791;
    const hpStart = sdk.getState()!.player!.hp;
    const eatBelow = sdk.getState()!.player!.maxHp * 0.5;
    let minHp = hpStart;
    let eaten = 0;
    let levelUps = 0;
    let attacks = 0;
    let reheals = 0;
    let taunts = 0;
    let swappedAtTick: number | null = null;
    let swappedAtTitanHp: number | null = null;
    let lastTitanHp = 142;
    let won = false;
    let end = '';
    const fightStart = currentTick(sdk);
    while (currentTick(sdk) - fightStart < 1500) {
        const f = await fight(sdk, TITAN, {
            endOnTargetDeath: false,
            maxTicks: 1500 - (currentTick(sdk) - fightStart),
            findTicks: 20,
            done: past,
            onDialog: 'stop',
            eatBelow,
            food: /Swordfish/,
            ...(pray ? { prayer: 'protect_from_melee' as const } : {}),
            onTick: async (s, titan) => {
                if (titan?.hp != null) {
                    if (titan.hp > lastTitanHp + 50) reheals++;
                    lastTitanHp = titan.hp;
                }
                if (swappedAtTick === null && weapon !== 'excalibur' && titan?.hp != null && titan.hp <= swapAt && invItem(s, /^Excalibur$/i)) {
                    swappedAtTick = s.tick - fightStart;
                    swappedAtTitanHp = titan.hp;
                    await invOp(sdk, /^Excalibur$/i, /^wield$/i);
                    return true; // re-send the attack behind the swap
                }
            },
        });
        minHp = Math.min(minHp, f.minHp);
        eaten += f.eats;
        levelUps += f.levelUps;
        attacks += f.attacks;
        end = f.end;
        if (f.end === 'done') {
            won = true;
            break;
        }
        if (f.end === 'dialog') {
            taunts++;
            await converse(sdk, [], { keep: true });
            continue;
        }
        break; // died, timeout, no target
    }
    if (pray) await bot.deactivateAllPrayers();
    out.titan = { won, end, ticks: currentTick(sdk) - fightStart, hpStart, minHp, eaten, levelUps, attacks, reheals, taunts, swappedAtTick, swappedAtTitanHp, landedAt: pos(sdk) };
    if (!won) throw new Error(`Titan fight failed: ${JSON.stringify(out)}`);
    await waitTicks(sdk, 2);

    // Fisherman, on the south bank.
    let t0 = currentTick(sdk);
    const toFisher = await walkTo(bot, sdk, 2802, 4704, 1);
    const fisher = await talkTo(sdk, /Fisherman/, [/get into the castle/i], { keep: true });
    if (!fisher.opened) throw new Error(`the fisherman did not talk (at ${JSON.stringify(pos(sdk))})`);
    out.fisherman = { walk: toFisher, ticks: dlgTicks(fisher), pages: fisher.pages, options: fisher.options, total: fisher.endTick - t0 };

    // Walk to the bell, take it, ring it beside a maiden.
    t0 = currentTick(sdk);
    const walk = await walkTo(bot, sdk, 2762, 4694, 0);
    await pickup(sdk, /Grail bell/i);
    out.walkToBell = { ...walk, withPickup: currentTick(sdk) - t0 };
    if (!invItem(sdk, /Grail bell/i)) throw new Error(`no Grail bell; so far ${JSON.stringify(out)}`);
    // The bell only works with a Grail maiden within 4 tiles, Chebyshev
    // (npc_find(coord, grail_maiden, 4, 0), quest_grail.rs2:54). The maidens
    // wander inside the castle walls, so walking towards one from outside does
    // not help: stay on the bell tile and ring once one is in range.
    const maidenInRange = (s: BotWorldState) => s.nearbyNpcs.some(n => /Grail maiden/i.test(n.name) && chebyshev(n, pos(s)) <= 4);
    t0 = currentTick(sdk);
    await waitUntil(sdk, maidenInRange, { maxTicks: 100 });
    out.waitForMaiden = currentTick(sdk) - t0;
    t0 = currentTick(sdk);
    let rings = 0;
    let ring: ConverseResult | null = null;
    while (rings < 5 && pos(sdk).z > 4692) {
        await waitUntil(sdk, maidenInRange, { maxTicks: 100 });
        const conv = converse(sdk, [], { keep: true });
        await sdk.sendUseItem(slotOf(sdk, /Grail bell/i), 1);
        ring = await conv;
        rings++;
    }
    out.ringBell = { rings, ticks: ring ? dlgTicks(ring) : null, pages: ring?.pages ?? null, total: (ring?.opened ? ring.endTick : currentTick(sdk)) - t0, insideAt: pos(sdk) };
    if (pos(sdk).z > 4692) throw new Error('the bell never let us in');

    // Up to the Fisher King.
    const up = await opLoc(sdk, { op: /Climb-up/, radius: 20 }, /Climb-up/, s => pos(s).level === 1, { maxTicks: 40 });
    out.stairsUp = { ticks: up.ticks, via: `${up.loc.name}@${up.loc.x},${up.loc.z}`, at: pos(sdk) };
    await waitTicks(sdk, 2);
    // The King's room is behind two doors (2766,4684 and 2766,4688), which
    // close again on a timer: open whichever closed door is next until the
    // talk-to goes through.
    t0 = currentTick(sdk);
    let doorsOpened = 0;
    const talkKing = () => talkTo(sdk, /Fisher King/, [/You don't look too well/], { keep: true, attempts: 1, openTicks: 25 });
    let king = await talkKing();
    for (const [dx, dz] of [[2766, 4684], [2766, 4688]] as const) {
        if (king.opened) break;
        if ((await openDoor(sdk, dx, dz)).ticks > 0) doorsOpened++;
        king = await talkKing();
    }
    if (!king.opened) throw new Error(`the Fisher King did not talk (at ${JSON.stringify(pos(sdk))})`);
    out.toKing = { ticks: king.firstTick - t0, doorsOpened };
    out.fisherKing = { ticks: dlgTicks(king), pages: king.pages, options: king.options, total: dlgTicks(king), grail: await getvar(sdk, 'grail') };

    // Whistle out.
    const back = await whistle(s => pos(s).z < 4000);
    out.whistleOut = { ticks: back.ok ? back.ticks : null, at: pos(sdk) };
    out.done = true;
    result('holy-grail-realm', out);
}, { timeout: 900_000, printState: false });
