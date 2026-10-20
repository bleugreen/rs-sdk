// Brimhaven Agility Arena traps (agilityarena_zones.rs2): stepping onto a trap
// tile dives the player across the pair, so walking back and forth over a pair
// triggers it every crossing. No ticket or pillar is involved.
//   bun docs/speedrun/scripts/agility-trap.ts <bot> <spikes|pads|pads2|spikes2> <reps> [agility=99]
import { runScript } from '../../../sdk/runner';
import { XpLog, cheat, tele, pos, tick, waitTicksFor, summary, XP_RATE, agilityXp } from './agility-lib';

// Arena is map square 43_149 on plane 3 (x = 2752 + local, z = 9536 + local).
const AX = 2752, AZ = 9536;
const PAIRS: Record<string, { a: [number, number]; b: [number, number]; start: [number, number] }> = {
    // floor spikes at local (47,32),(48,32): 24 base, level 20
    spikes: { a: [AX + 47, AZ + 32], b: [AX + 48, AZ + 32], start: [AX + 46, AZ + 32] },
    spikes2: { a: [AX + 9, AZ + 37], b: [AX + 9, AZ + 38], start: [AX + 9, AZ + 36] },
    // pressure pads at local (47,21),(48,21): 26 base, level 20
    pads: { a: [AX + 47, AZ + 21], b: [AX + 48, AZ + 21], start: [AX + 46, AZ + 21] },
    pads2: { a: [AX + 47, AZ + 43], b: [AX + 48, AZ + 43], start: [AX + 46, AZ + 43] },
};

const [, , , which = 'spikes', repsA = '30', aglA = '99'] = process.argv;
const pair = PAIRS[which];
const reps = +repsA;

await runScript(async ({ sdk }) => {
    await cheat(sdk, `setstat agility ${aglA}`);
    await cheat(sdk, 'setstat hitpoints 99');
    await tele(sdk, pair.start[0], pair.start[1], 3);
    const log = new XpLog(sdk);
    const xp0 = agilityXp(sdk.getState());
    const t0 = tick(sdk);
    let fails = 0, heals = 0;
    for (let r = 0; r < reps; r++) {
        const me = pos(sdk);
        const dA = Math.max(Math.abs(me.x - pair.a[0]), Math.abs(me.z - pair.a[1]));
        const dB = Math.max(Math.abs(me.x - pair.b[0]), Math.abs(me.z - pair.b[1]));
        const target = dA <= dB ? pair.a : pair.b;
        const before = log.events.length;
        sdk.getNewChat();
        const hp0 = sdk.getState()!.player!.hp;
        await sdk.sendWalk(target[0], target[1], true);
        let failed = false;
        await waitTicksFor(sdk, s => {
            if (sdk.getNewChat().some(m => /were hit by/i.test(m.text))) failed = true;
            return failed || log.events.length > before;
        }, 30);
        if (failed) {
            fails++;
            await sdk.waitForTicks(3);
            if (sdk.getState()!.player!.hp < 40) { await cheat(sdk, 'setstat hitpoints 99'); heals++; }
            console.log(`rep ${r}: FAIL -${hp0 - sdk.getState()!.player!.hp}hp, at`, pos(sdk));
            continue;
        }
        if (log.events.length === before) { console.log(`rep ${r}: nothing happened walking to`, target, 'from', me); continue; }
        const e = log.events[before];
        // wait for the dive (exactmove) to land before the next step
        await waitTicksFor(sdk, s => s.player?.worldX !== target[0] || s.player?.worldZ !== target[1], 5);
        if (r < 6) console.log(`rep ${r}: +${e.baseGain} at tick ${e.tick}, landed`, pos(sdk));
    }
    const ticks = log.events.map(e => e.tick);
    const gaps = ticks.slice(1).map((t, i) => t - ticks[i]);
    const total = tick(sdk) - t0;
    const xp = (agilityXp(sdk.getState()) - xp0) / XP_RATE;
    log.stop();
    console.log(JSON.stringify({ trap: which, agility: +aglA, reps, drops: log.events.length, fails, labHeals: heals, hpLost: log.hpLost,
        baseXp: xp, totalTicks: total, baseXpPerTick: +(xp / total).toFixed(2), gaps: summary(gaps) }));
}, { timeout: 1_800_000, printState: false });
