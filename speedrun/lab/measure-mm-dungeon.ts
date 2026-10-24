// Monkey Madness: the Ape Atoll dungeon at the route's levels (Defence 1,
// ~42 HP), human (as in segments K and P). Walks ladder -> Zooknock -> ladder
// with bot.walkTo, eating a shark below `--eat` HP, and reports per pass the
// damage taken, food eaten, lowest HP, poison messages, deaths and run energy.
// Half the runs drink an antipoison first. Closes the dungeon half of
// quests/README.md open item (a).
//
//   speedrun/lab/lab.sh <bot> speedrun/lab/measure-mm-dungeon.ts:--runs=3:--anti=2

import { openSession } from '../lib/session';
import { waitTicks, waitUntil } from '../lib/wait';
import { ROUTE_LEVELS } from './quests/monkey-madness';
import { arg, botArg, result } from './common';
import { cheat, give, setstat, tele } from './setup';

const runs = Number(arg('runs', '3'));
const anti = Number(arg('anti', '2'));
const eatBelow = Number(arg('eat', '20'));
const session = await openSession(botArg());
const { sdk, bot } = session;

const LADDER = { x: 2763, z: 9103 };
const ZOOKNOCK = { x: 2804, z: 9145 };

async function prepare(antipoison: boolean) {
    await cheat(sdk, '~clearinv inv');
    await waitTicks(sdk, 1);
    for (const [k, v] of Object.entries(ROUTE_LEVELS)) await setstat(sdk, k, v);
    await cheat(sdk, 'setvar mm_main 3');
    await give(sdk, ['shark'], 12);
    if (antipoison) await give(sdk, ['4doseantipoison']);
    await cheat(sdk, '~energy');
    if (!(await tele(sdk, LADDER.x, LADDER.z))) throw new Error('tele to the dungeon ladder failed');
    if (antipoison) {
        const p = sdk.getState()!.inventory.find(i => /antipoison/i.test(i.name))!;
        await sdk.sendUseItem(p.slot, p.optionsWithIndex.find(o => /drink/i.test(o.text))?.opIndex ?? 1);
        await waitTicks(sdk, 2);
    }
}

async function pass(to: { x: number; z: number }, leg: string, antipoison: boolean, run: number) {
    const s0 = sdk.getState()!;
    let lost = 0, eats = 0, lastEat = -99, minHp = s0.player!.hp, died = false;
    let prevHp = s0.player!.hp;
    const poison0 = s0.gameMessages.filter(m => /poison/i.test(m.text)).length;
    const stop = sdk.onStateUpdate(s => {
        const p = s.player;
        if (!p) return;
        if (p.hp < prevHp) lost += prevHp - p.hp;
        prevHp = p.hp;
        minHp = Math.min(minHp, p.hp);
        if (p.isDead || p.hp === 0) died = true;
        if (p.hp < eatBelow && s.tick - lastEat >= 3) {
            const f = s.inventory.find(i => /shark/i.test(i.name));
            if (f) {
                lastEat = s.tick;
                eats++;
                void sdk.sendUseItem(f.slot, f.optionsWithIndex.find(o => /eat/i.test(o.text))?.opIndex ?? 1);
            }
        }
    });
    const r = await bot.walkTo(to.x, to.z, 2);
    // walkTo stops when an eat interrupts it: resume until arrived.
    for (let i = 0; i < 6 && !died; i++) {
        const p = sdk.getState()!.player!;
        if (Math.max(Math.abs(p.worldX - to.x), Math.abs(p.worldZ - to.z)) <= 2) break;
        await bot.walkTo(to.x, to.z, 2);
    }
    stop();
    const s1 = sdk.getState()!;
    const poison = s1.gameMessages.filter(m => /poison/i.test(m.text)).length - poison0;
    result('mm_dungeon', { leg, run, antipoison, ok: r.success, ticks: s1.tick - s0.tick, lost, eats, minHp, died, poisonMsgs: poison, hpEnd: s1.player?.hp, energy: [s0.player?.runEnergy, s1.player?.runEnergy] });
    return !died;
}

for (let run = 0; run < runs + anti; run++) {
    const antipoison = run >= runs;
    await prepare(antipoison);
    if (!(await pass(ZOOKNOCK, 'ladder->zooknock', antipoison, run))) continue;
    await pass({ x: LADDER.x, z: LADDER.z + 1 }, 'zooknock->ladder', antipoison, run);
}
process.exit(0);
