// Underground Pass: failure rates and tick costs of the random obstacles.
//
//   bun docs/speedrun/scripts/quest-underground-pass-rolls.ts <bot> <obstacle> <level> [attempts]
//
// Obstacles and the stat each one rolls (stat_random(stat, low, high): success
// when floor(low*(99-L)/98) + floor(high*(L-1)/98) + 1 > random(256), L the
// current level, PlayerOps.ts STAT_RANDOM):
//   rockslide        agility 160/300  upass_obstacles.rs2:3-31     (2460,9720)
//   bridgeshot       ranged  160/300  upass_bridge.rs2:33-87       guide rope (2443,9718), shot from (2446,9722)
//   ropeswing        agility 100/410  upass_obstacles.rs2:93-128   rock (2460,9699)
//   ledge            agility 200/260  upass_obstacles.rs2:246-293  (2374,9644) from (2375,9644)
//   stonebridge      agility 160/300  upass_obstacles.rs2:295-328  (2380,9634) from (2379,9634)
//   collapsedbridge  agility 160/300  upass_obstacles.rs2:368-407  (2142,4562,1) from (2142,4561,1)
//   cagepick         thieving 128/400 quest_upass.rs2:226-240      gate (2393,9655)
//   logtrap          thieving 160/300 upass_obstacles.rs2:222-244  flat rock (2382,9668)
// Each attempt starts with the player idle and is timed from the click (or
// use-item) to two points: the result message (`msg`) and the player idle again
// (`idle`: the last tick of movement, a new message or a dialogue before 3
// still ticks, which is when the next click can act). The idle figure is the
// cost of the attempt. Prints one line per attempt and a RESULT line.

import { runScript } from '../../../sdk/runner';
import { slotOf, wield } from '../../../speedrun/lib/act';
import { converse } from '../../../speedrun/lib/converse';
import { idle } from '../../../speedrun/lib/idle';
import { currentTick, waitUntil } from '../../../speedrun/lib/wait';
import { messagesSince, pos, worn } from '../../../speedrun/lib/world';
import type { BotWorldState } from '../../../sdk/types';
import { result, stats } from '../../../speedrun/lab/record';
import { ensureItem, mustTele, setstat, setvar } from '../../../speedrun/lab/setup';

const [obstacle, levelArg, nArg] = process.argv.slice(3);
const level = Number(levelArg ?? 40);
const attempts = Number(nArg ?? 25);

interface Spec {
    stat: string;
    roll: [number, number];
    ok: RegExp;
    fail: RegExp;
    start: [number, number, number];
    /** re-teleport to start before every attempt (otherwise only when off the two sides) */
    reset: boolean;
    act: (i: number) => Promise<void>;
}

await runScript(async ({ bot, sdk }) => {
    const ensure = async (name: string, re: RegExp) => {
        if (!worn(sdk, re)) await ensureItem(sdk, name, re, 1);
    };

    const specs: Record<string, Spec> = {
        rockslide: {
            stat: 'agility', roll: [160, 300], ok: /step down the other side/, fail: /slip back down/, start: [2460, 9721, 0], reset: false,
            act: async () => { await sdk.sendInteractLoc(2460, 9720, 3309, 1); },
        },
        bridgeshot: {
            stat: 'ranged', roll: [160, 300], ok: /impales the rope/, fail: /just misses/, start: [2446, 9722, 0], reset: true,
            act: async () => {
                await ensure('shortbow', /^Shortbow$/i);
                await wield(sdk, /^Shortbow$/i);
                await ensure('litarrow', /^Bronze fire arrows$/i);
                await wield(sdk, /^Bronze fire arrows$/i);
                await idle(sdk, { maxTicks: 60 });
                await sdk.sendInteractLoc(2443, 9718, 3340, 1);
            },
        },
        ropeswing: {
            stat: 'agility', roll: [100, 410], ok: /skillfully swing across/, fail: /fall in to the darkness/, start: [2462, 9699, 0], reset: true,
            act: async () => {
                await ensure('rope', /^Rope$/i);
                await sdk.waitForTicks(5); // the rock is "being used" for 5 ticks after each swing
                await sdk.sendUseItemOnLoc(slotOf(sdk, /^Rope$/i), 2460, 9699, 2276);
            },
        },
        ledge: {
            // no message on success: judged by the landing tile (2374,9638)
            stat: 'agility', roll: [200, 260], ok: /^$/, fail: /rat pit/, start: [2375, 9644, 0], reset: true,
            act: async () => { await sdk.sendInteractLoc(2374, 9644, 3238, 1); },
        },
        stonebridge: {
            stat: 'agility', roll: [160, 300], ok: /and make it/, fail: /fall off it/, start: [2379, 9634, 0], reset: true,
            act: async () => { await sdk.sendInteractLoc(2380, 9634, 3276, 1); },
        },
        collapsedbridge: {
            stat: 'agility', roll: [160, 300], ok: /cross safely/, fail: /slip and tumble/, start: [2142, 4561, 1], reset: true,
            act: async () => { await sdk.sendInteractLoc(2142, 4562, 3254, 1); },
        },
        cagepick: {
            stat: 'thieving', roll: [128, 400], ok: /manage to pick the lock/, fail: /fail to pick the lock/, start: [2393, 9655, 0], reset: false,
            act: async () => { await sdk.sendInteractLoc(2393, 9655, 3266, 1); },
        },
        logtrap: {
            stat: 'thieving', roll: [160, 300], ok: /and succeed/, fail: /and fail/, start: [2383, 9668, 0], reset: true,
            act: async () => {
                await sdk.sendInteractLoc(2382, 9668, 3339, 1);
                await converse(sdk, [/give it a go/i], { keep: true, idle: 1 });
            },
        },
    };
    const spec = obstacle ? specs[obstacle] : undefined;
    if (!spec) throw new Error(`unknown obstacle ${obstacle}`);
    const [sx, sz, sl] = spec.start;

    await bot.dismissBlockingUI();
    await setstat(sdk, spec.stat, level);
    await setstat(sdk, 'hitpoints', 99);
    // Koftik's insanity scene would follow a bridge fall (upass_obstacles.rs2:381-386); %upass 5 keeps
    // the cavern scripts in their mid-quest branches.
    await setvar(sdk, 'ibanmulti', (1 << 11) | (1 << 17));
    await setvar(sdk, 'upass', 5);
    await idle(sdk, { maxTicks: 60 });
    await mustTele(sdk, sx, sz, sl);

    const rows: Array<{ ok: boolean | null; msg: number; idle: number }> = [];
    for (let i = 0; i < attempts; i++) {
        if ((sdk.getState()?.player?.hp ?? 99) < 50) await setstat(sdk, 'hitpoints', 99);
        const p = pos(sdk);
        const onStart = Math.abs(p.x - sx) + Math.abs(p.z - sz) <= 6 && p.level === sl;
        if (spec.reset || !onStart) await mustTele(sdk, sx, sz, sl);
        await idle(sdk, { maxTicks: 60 });
        const t0 = currentTick(sdk);
        await spec.act(i);
        const outcome = (s: BotWorldState): boolean | null => {
            const m = messagesSince(s, t0);
            if (m.some(t => spec.fail.test(t))) return false;
            const q = pos(s);
            if (obstacle === 'ledge' ? q.x === 2374 && q.z === 9638 : m.some(t => spec.ok.test(t))) return true;
            return null;
        };
        const r = await waitUntil(sdk, s => outcome(s) !== null, { maxTicks: 60 });
        const ok = r.ok ? outcome(r.state) : null;
        const msgTick = r.ok ? r.tick - t0 : -1;
        const idleTicks = (await idle(sdk, { maxTicks: 60 })).last - t0;
        rows.push({ ok, msg: msgTick, idle: idleTicks });
        const q = pos(sdk);
        console.log(`attempt ${i + 1}: ${ok === null ? 'NONE' : ok ? 'ok  ' : 'FAIL'} msg=${msgTick}t idle=${idleTicks}t pos=(${q.x},${q.z},${q.level}) hp=${sdk.getState()?.player?.hp}${ok === null ? ' ' + JSON.stringify(messagesSince(sdk, t0)) : ''}`);
    }
    const okRows = rows.filter(r => r.ok === true);
    const failRows = rows.filter(r => r.ok === false);
    const med = (a: number[]) => stats(a).median; // NaN, printed as null, for no sample
    const [low, high] = spec.roll;
    const c = Math.min(level, 99);
    const expected = Math.min(Math.floor((low * (99 - c)) / 98) + Math.floor((high * (c - 1)) / 98) + 1, 256) / 256;
    result(obstacle!, {
        stat: spec.stat, level, attempts: rows.length, successes: okRows.length, failures: failRows.length,
        unknown: rows.length - okRows.length - failRows.length,
        measuredSuccessRate: +(okRows.length / Math.max(1, okRows.length + failRows.length)).toFixed(3), expectedSuccessRate: +expected.toFixed(3),
        successIdleMedian: med(okRows.map(r => r.idle)), failIdleMedian: med(failRows.map(r => r.idle)),
        successMsgMedian: med(okRows.map(r => r.msg)), failMsgMedian: med(failRows.map(r => r.msg)),
    });
}, { timeout: 3_600_000, printState: false });
