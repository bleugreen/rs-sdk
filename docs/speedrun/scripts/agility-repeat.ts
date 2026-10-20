// Repeats one obstacle or shortcut in place and reports ticks between xp drops.
//   bun docs/speedrun/scripts/agility-repeat.ts <bot> <locId> <x> <z> <startX> <startZ> <plane> <reps> [agility=99]
// The loc is clicked again as soon as each xp drop is observed, from wherever
// the previous crossing left the player; a click that yields no xp within 40
// ticks is reported as not repeatable from that side.
import { runScript } from '../../../sdk/runner';
import { XpLog, cheat, tele, pos, tick, waitTicksFor, summary, XP_RATE, agilityXp } from './agility-lib';

const [, , , idA, xA, zA, sxA, szA, plA = '0', repsA = '20', aglA = '99'] = process.argv;
const [id, x, z, sx, sz, plane, reps] = [idA, xA, zA, sxA, szA, plA, repsA].map(Number);

await runScript(async ({ sdk }) => {
    await cheat(sdk, `setstat agility ${aglA}`);
    await cheat(sdk, 'setstat hitpoints 99');
    await tele(sdk, sx, sz, plane);
    const log = new XpLog(sdk);
    const t0 = tick(sdk);
    const xp0 = agilityXp(sdk.getState());
    let misses = 0;
    for (let r = 0; r < reps && misses < 3; r++) {
        const before = log.events.length;
        const from = pos(sdk);
        sdk.getNewChat({ types: [0] });
        await sdk.sendInteractLoc(x, z, id, 1);
        const ok = await waitTicksFor(sdk, () => log.events.length > before, 40);
        const msgs = sdk.getNewChat({ types: [0] }).map(m => m.text);
        if (!ok) {
            misses++;
            console.log(`rep ${r}: no xp from`, from, '->', pos(sdk), msgs.slice(-3));
            continue;
        }
        const e = log.events[before];
        console.log(`rep ${r}: +${e.baseGain} base at tick ${e.tick}, from ${from.x},${from.z} -> ${e.x},${e.z} ${msgs.slice(-1)}`);
        // let the script finish moving the player before re-clicking
        await waitTicksFor(sdk, s => !s.player || s.player.animId === -1, 6);
    }
    const ticks = log.events.map(e => e.tick);
    const gaps = ticks.slice(1).map((t, i) => t - ticks[i]);
    const xp = (agilityXp(sdk.getState()) - xp0) / XP_RATE;
    const span = ticks.length > 1 ? ticks[ticks.length - 1] - ticks[0] : NaN;
    log.stop();
    console.log(JSON.stringify({ loc: id, drops: log.events.length, baseXp: xp, gaps: summary(gaps), gapList: gaps,
        xpPerTickSteady: +((xp - (log.events[0]?.baseGain ?? 0)) / span).toFixed(2), totalTicks: tick(sdk) - t0 }));
}, { timeout: 1_800_000, printState: false });
