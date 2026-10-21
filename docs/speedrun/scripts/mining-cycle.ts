// Measures the iron mining cycle from one standing tile.
//
//   bun docs/speedrun/scripts/mining-cycle.ts <bot> [--stand 3295,3310] [--level 99]
//       [--ores 60] [--drop each|none] [--pick rune_pickaxe] [--mode predict|react]
//
// Stands on --stand, mines whichever cardinally adjacent iron rock is live, and logs
// the tick (state.tick: one per PLAYER_INFO, i.e. per server tick) at which each
// mining xp change is observed. Gaps between those ticks are the cycle.
//
// The lite client publishes state when PLAYER_INFO arrives, and the server writes
// PLAYER_INFO before the same tick's zone, inventory and stat updates
// (World.ts processClientsOut). So xp and depletion from server tick R are first
// seen in the state for tick R+1.
//   --mode react    clicks the next rock once the xp is observed (loses that tick).
//   --mode predict  clicks the next rock on the predicted roll tick (click + 3 with a
//                   rune pickaxe), without waiting for the xp. Switching rocks on a
//                   roll tick costs nothing even if the roll failed: the new rock's
//                   first swing sets the same next roll tick (mining.rs2:76-79).
// --drop each drops ore in the same tick as the next rock click.
// --drop mid drops one junk item (bread, shrimps, ...) on the tick after each click
//   without re-clicking: the drop's clearPendingAction (OpHeldHandler.ts) should cancel
//   the pending roll. --drop midclick re-clicks the same rock in that tick.
import { runScript } from '../../../sdk/runner';
import type { BotWorldState } from '../../../sdk/types';
import { arg, dropMatching, liveRock, mineOp, miningXp, nextTick, setup, summarize } from './mining-lib';

const [sx, sz] = arg('stand', '3295,3310').split(',').map(Number) as [number, number];
const LEVEL = Number(arg('level', '99'));
const ORES = Number(arg('ores', '60'));
const DROP = arg('drop', 'each');
const PICK = arg('pick', 'rune_pickaxe');
const MODE = arg('mode', 'predict');
const RATE: Record<string, number> = { bronze_pickaxe: 7, iron_pickaxe: 6, steel_pickaxe: 5, mithril_pickaxe: 4, adamant_pickaxe: 3, rune_pickaxe: 2 };
const ROLL_AFTER_CLICK = (RATE[PICK] ?? 2) + 1; // packet lands next tick, roll mining_rate later
const ADJ = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => [sx + dx!, sz + dz!] as [number, number]);
const same = (a: [number, number] | null, b: [number, number]) => !!a && a[0] === b[0] && a[1] === b[1];

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
    let rollTick = -1; // observed tick on which the server rolls for `target`
    let lastXpTick = -1;
    let midDrops = 0;
    let lostRolls = 0;

    const click = (st: BotWorldState, p: [number, number]) => {
        const loc = liveRock(st, p[0], p[1])!;
        if (DROP === 'each') dropMatching(sdk, st, /ore$|^uncut/i, 4);
        sdk.sendInteractLoc(loc.x, loc.z, loc.id, mineOp(loc)).catch(() => {});
        target = p;
        clickTick = st.tick;
        // A click sent on observed tick c is processed on server tick c+1, whose first swing
        // schedules the roll for c+1+rate. Clicking the next rock on that tick's observation
        // (c+1+rate) lands it on the tick after the roll.
        rollTick = st.tick + ROLL_AFTER_CLICK;
    };

    while (ticks.length < ORES && midDrops < ORES * 3) {
        s = await nextTick(sdk, s.tick);
        if (s.dialog.isOpen) sdk.sendClickDialog(0).catch(() => {});
        const xp = miningXp(s);
        if (xp > lastXp) {
            ticks.push(s.tick);
            xps.push(xp - lastXp);
            log.push(`t=${s.tick} +${xp - lastXp} click->xp=${s.tick - clickTick}`);
            lastXp = xp;
            lastXpTick = s.tick;
        }
        if ((DROP === 'mid' || DROP === 'midclick') && target && s.tick === clickTick + 1) {
            const junk = s.inventory.find(i => !/pickaxe/i.test(i.name));
            if (junk) sdk.sendDropItem(junk.slot).catch(() => {});
            const loc = liveRock(s, target[0], target[1]);
            if (DROP === 'midclick' && loc) sdk.sendInteractLoc(loc.x, loc.z, loc.id, mineOp(loc)).catch(() => {});
            midDrops++;
        }
        if (DROP === 'mid' && target && s.tick > rollTick + 2 && liveRock(s, target[0], target[1])) {
            // the roll never came: count it and start over on any live rock
            lostRolls++;
            target = null;
        }
        if (MODE === 'predict') {
            // On the roll tick (or later, if we had nothing live then), move to another live rock.
            if (target === null || s.tick >= rollTick) {
                const other = ADJ.find(p => !same(target, p) && liveRock(s, p[0], p[1]));
                if (other) click(s, other);
                else if (target && s.tick > rollTick && !liveRock(s, target[0], target[1])) target = null;
            }
        } else {
            if (target && (lastXpTick === s.tick || !liveRock(s, target[0], target[1]))) target = null;
            if (!target) {
                const next = ADJ.find(p => liveRock(s, p[0], p[1]));
                if (next) click(s, next);
            }
        }
    }
    console.log(log.join('\n'));
    summarize(`iron, stand ${sx},${sz}, level ${LEVEL}, ${PICK}, mode=${MODE}, drop=${DROP}`, ticks, xps);
    const inv = (sdk.getState() as BotWorldState).inventory.filter(i => /ore$/i.test(i.name)).length;
    console.log(`ore left in inventory: ${inv}; mid-cycle drops ${midDrops}, rolls lost ${lostRolls}`);
}, { timeout: 30 * 60_000 });
