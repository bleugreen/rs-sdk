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
import { opLoc, walkTo, wield } from '../../../speedrun/lib/act';
import { fight } from '../../../speedrun/lib/combat';
import { converse } from '../../../speedrun/lib/converse';
import { currentTick } from '../../../speedrun/lib/wait';
import { findLoc, pos, waitForNpc } from '../../../speedrun/lib/world';
import { result } from '../../../speedrun/lab/record';
import { clearInventory, getvar, give, mustTele, setStats, setvar } from '../../../speedrun/lab/setup';

const args = process.argv.slice(3).filter(a => !a.startsWith('-'));
const stat = (i: number) => Number(args[i] ?? 70);
const att = stat(0), str = stat(1), def = stat(2), hp = stat(3);
const weapon = args[4] ?? 'rune_scimitar';
/** The in-game name of a debug obj name: rune_full_helm is "Rune full helm". */
const display = (obj: string) => new RegExp(`^${obj.replace(/_/g, ' ')}$`, 'i');

await runScript(async ({ bot, sdk }) => {
    await bot.dismissBlockingUI();
    await clearInventory(sdk);
    await setStats(sdk, { attack: att, strength: str, defence: def, hitpoints: hp });
    for (const g of [weapon, 'rune_full_helm', 'rune_chainbody', 'rune_platelegs', 'rune_kiteshield', 'amulet_of_strength']) {
        await give(sdk, g);
        if (!(await wield(sdk, display(g))).ok) throw new Error(`could not equip ${g}`);
    }
    await give(sdk, 'swordfish', 10);
    await sdk.sendSetCombatStyle(1); // aggressive: max strength
    await setvar(sdk, 'arthur', 3);
    await mustTele(sdk, 2778, 3401, 0); // ^keep_crate_coord, where the crate ride lands

    const stairs = (op: 'Climb-up' | 'Climb-down', level: number) =>
        opLoc(sdk, { name: /Staircase/, op, radius: 15 }, op, s => pos(s).level === level, { maxTicks: 40 });

    // Up two staircases to Mordred's floor.
    let t0 = currentTick(sdk);
    await stairs('Climb-up', 1);
    await stairs('Climb-up', 2);
    const climbTicks = currentTick(sdk) - t0;
    const arrive = pos(sdk);

    // Fight until Morgan Le Faye interrupts: Mordred's death queue opens her
    // dialogue, and any page other than a level-up is hers (onDialog 'stop').
    const mordred = await waitForNpc(sdk, /Sir Mordred/, 20);
    if (!mordred) throw new Error('Sir Mordred not found');
    const hpStart = sdk.getState()!.player!.hp;
    const fightStart = currentTick(sdk);
    let firstHitTick: number | null = null;
    const f = await fight(sdk, mordred, {
        endOnTargetDeath: false,
        onDialog: 'stop',
        maxTicks: 600,
        eatBelow: sdk.getState()!.player!.maxHp * 0.4,
        food: /Swordfish/,
        onTick: (s, m) => {
            if (firstHitTick === null && m?.hp != null && m.maxHp != null && m.hp < m.maxHp) firstHitTick = s.tick;
        },
    });
    if (f.end !== 'dialog') throw new Error(`the Mordred fight ended ${f.end}, not on Morgan Le Faye's dialogue: ${JSON.stringify(f)}`);
    const morgan = await converse(sdk, [/Tell me how to untrap Merlin/, /OK I will go do all that/i], { keep: true });
    const arthur = await getvar(sdk, 'arthur');

    // Down and out of the front door, then to the candle maker.
    t0 = currentTick(sdk);
    await stairs('Climb-down', 1);
    await stairs('Climb-down', 0);
    const downTicks = currentTick(sdk) - t0;
    t0 = currentTick(sdk);
    const door = await findLoc(sdk, { name: /Large door/, op: 'Knock-at', radius: 20 });
    if (!door) throw new Error(`no keep front door near ${JSON.stringify(pos(sdk))}`);
    await opLoc(sdk, door, 'Open', s => pos(s).x <= 2763, { maxTicks: 60 });
    const doorTicks = currentTick(sdk) - t0;
    const outside = pos(sdk);
    const walk = await walkTo(bot, sdk, 2800, 3440, 1);

    console.log(`Merlin's Crystal keep segment at ${att}/${str}/${def}, ${hp} hp, ${weapon}`);
    result('merlins-crystal-keep', {
        climbTwoStaircasesTicks: climbTicks,
        arrivedAt: arrive,
        fightTicksClickToMorgan: f.ticks,
        ticksToFirstDamage: firstHitTick === null ? null : firstHitTick - fightStart,
        hpStart,
        minHp: f.minHp,
        foodEaten: f.eats,
        levelUpDialogsDismissed: f.levelUps,
        attacks: f.attacks,
        morganDialogue: { ticks: morgan.opened ? morgan.endTick - morgan.firstTick : 0, pages: morgan.pages, options: morgan.options },
        arthurVarpAfter: arthur,
        downTwoStaircasesTicks: downTicks,
        frontDoorTicks: doorTicks,
        outsideAt: outside,
        walkToCandleMaker: walk,
    });
}, { timeout: 600_000, printState: false });
