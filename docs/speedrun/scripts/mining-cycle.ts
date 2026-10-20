// Measures the iron mining cycle from one standing tile.
//
//   bun docs/speedrun/scripts/mining-cycle.ts <bot> [--stand 3295,3310] [--level 99]
//       [--ores 60] [--drop each|none] [--pick rune_pickaxe]
//
// Stands on --stand, mines whichever cardinally adjacent iron rock is live, and logs
// the server tick (state.tick: one per PLAYER_INFO, i.e. per server tick) of every
// mining xp change. Each ore depletes its rock, so the next click goes to another
// adjacent live rock the tick after the xp is observed; with no live rock it waits.
// --drop each drops the ore in the same tick as the next rock click.
import { runScript } from '../../../sdk/runner';
import type { BotWorldState } from '../../../sdk/types';
import { arg, dropMatching, liveRock, mineOp, miningXp, nextTick, setup, summarize } from './mining-lib';

const [sx, sz] = arg('stand', '3295,3310').split(',').map(Number) as [number, number];
const LEVEL = Number(arg('level', '99'));
const ORES = Number(arg('ores', '60'));
const DROP = arg('drop', 'each');
const PICK = arg('pick', 'rune_pickaxe');
const ADJ = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => [sx + dx!, sz + dz!] as [number, number]);

await runScript(async ({ bot, sdk }) => {
    await bot.skipTutorial?.();
    let s: BotWorldState = await setup(sdk, { level: LEVEL, pick: PICK, x: sx, z: sz });
    console.log(`at ${s.player?.worldX},${s.player?.worldZ}; adjacent iron: ${ADJ.filter(([x, z]) => liveRock(s, x, z)).map(p => p.join(',')).join(' ')}`);

    let lastXp = miningXp(s);
    const ticks: number[] = [];
    const xps: number[] = [];
    const log: string[] = [];
    let target: [number, number] | null = null;
    let clickTick = -1;
    let lastActTick = -1;

    while (ticks.length < ORES) {
        s = await nextTick(sdk, s.tick);
        if (s.dialog.isOpen) sdk.sendClickDialog(0).catch(() => {});
        const xp = miningXp(s);
        if (xp > lastXp) {
            ticks.push(s.tick);
            xps.push(xp - lastXp);
            log.push(`t=${s.tick} +${xp - lastXp} rock=${target?.join(',')} click->xp=${s.tick - clickTick}`);
            lastXp = xp;
            target = null;
        }
        if (lastActTick === s.tick) continue;
        // Re-click if our target vanished without xp (shouldn't happen solo) or we stalled.
        if (target && (!liveRock(s, target[0], target[1]) || s.tick - clickTick > 12)) target = null;
        if (!target) {
            const next = ADJ.find(([x, z]) => liveRock(s, x, z));
            if (DROP === 'each') dropMatching(sdk, s, /ore$|^uncut/i, 4);
            if (next) {
                const loc = liveRock(s, next[0], next[1])!;
                sdk.sendInteractLoc(loc.x, loc.z, loc.id, mineOp(loc)).catch(() => {});
                target = next;
                clickTick = s.tick;
                lastActTick = s.tick;
            }
        }
    }
    console.log(log.join('\n'));
    summarize(`iron, stand ${sx},${sz}, level ${LEVEL}, drop=${DROP}`, ticks, xps);
    const inv = (sdk.getState() as BotWorldState).inventory.filter(i => /ore$/i.test(i.name)).length;
    console.log(`ore left in inventory: ${inv}`);
}, { timeout: 30 * 60_000 });
