// Underground Pass: failure rates and tick costs of the random obstacles.
//
//   bun docs/speedrun/scripts/quest-underground-pass-rolls.ts <bot> <obstacle> <level> [attempts]
//
// Obstacles and the stat each one rolls (stat_random(stat, low, high), success
// when floor(low*(99-L)/98) + floor(high*(L-1)/98) + 1 > random(256), on the
// current level, PlayerOps.ts STAT_RANDOM):
//   rockslide        agility 160/300  upass_obstacles.rs2:3-31     (2460,9720)
//   bridgeshot       ranged  160/300  upass_bridge.rs2:33-87       guide rope (2443,9718)
//   ropeswing        agility 100/410  upass_obstacles.rs2:93-128   rock (2460,9699)
//   ledge            agility 200/260  upass_obstacles.rs2:246-293  (2374,9639-9644)
//   stonebridge      agility 160/300  upass_obstacles.rs2:295-328  (2380,9634)
//   collapsedbridge  agility 160/300  upass_obstacles.rs2:368-407  (2142,4562, level 1)
//   cagepick         thieving 128/400 quest_upass.rs2:226-240      (2393,9655)
//   logtrap          thieving 160/300 upass_obstacles.rs2:222-244  (2382,9668)
//   speartrap        thieving 160/300 upass_obstacles.rs2:150-174  (2435,9675)
// Each attempt is timed from the click (or the use-item) to the observed
// result: arrival on the far side, or the failure message / failure landing.
// Prints one line per attempt and a RESULT line with the counts.

import { runScript } from '../../../sdk/runner';
import type { BotSDK } from '../../../sdk/index';
import * as L from './quest-arthur-lab';

const [obstacle, levelArg, nArg] = process.argv.slice(3);
const level = Number(levelArg ?? 40);
const attempts = Number(nArg ?? 25);

const STAT: Record<string, string> = {
    rockslide: 'agility', bridgeshot: 'ranged', ropeswing: 'agility', ledge: 'agility', stonebridge: 'agility',
    collapsedbridge: 'agility', cagepick: 'thieving', logtrap: 'thieving', speartrap: 'thieving',
};
const ROLL: Record<string, [number, number]> = {
    rockslide: [160, 300], bridgeshot: [160, 300], ropeswing: [100, 410], ledge: [200, 260], stonebridge: [160, 300],
    collapsedbridge: [160, 300], cagepick: [128, 400], logtrap: [160, 300], speartrap: [160, 300],
};
const expected = (low: number, high: number, lv: number) => {
    const c = Math.min(lv, 99);
    const v = Math.floor((low * (99 - c)) / 98) + Math.floor((high * (c - 1)) / 98) + 1;
    return Math.min(v, 256) / 256;
};

const newMessages = (sdk: BotSDK, from: number) => (sdk.getState()?.gameMessages ?? []).slice(from).map(m => m.text);
const msgCount = (sdk: BotSDK) => sdk.getState()?.gameMessages.length ?? 0;

await runScript(async ({ bot, sdk }) => {
    if (!STAT[obstacle]) throw new Error(`unknown obstacle ${obstacle}`);
    await bot.dismissBlockingUI();
    await L.cheat(sdk, `setstat ${STAT[obstacle]} ${level}`, 2);
    await L.cheat(sdk, 'setstat hitpoints 99', 2);
    // Koftik's insanity scene would interrupt bridge falls (upass_obstacles.rs2:381-386).
    await L.cheat(sdk, `setvar ibanmulti ${(1 << 11) | (1 << 17)}`);
    const rows: Array<{ ok: boolean; ticks: number; note: string }> = [];

    const waitResult = async (t0: number, before: number, ok: () => boolean, fail: () => boolean, max = 40) => {
        for (let i = 0; i < max; i++) {
            await sdk.waitForTicks(1);
            if (ok()) return { ok: true, ticks: L.tick(sdk) - t0 };
            if (fail()) return { ok: false, ticks: L.tick(sdk) - t0 };
        }
        return { ok: false, ticks: -1, note: `timeout ${JSON.stringify(newMessages(sdk, before))}` };
    };
    const hasMsg = (before: number, re: RegExp) => () => newMessages(sdk, before).some(m => re.test(m));
    const at = (x: number, z: number, lv = 0) => () => {
        const p = L.pos(sdk);
        return p.x === x && p.z === z && p.level === lv;
    };
    const ensureItem = async (name: string, re: RegExp, n = 1) => {
        if (sdk.countInventoryItems(re) < n) {
            await L.cheat(sdk, `give ${name} ${n}`, 2);
            await L.waitUntil(sdk, () => sdk.countInventoryItems(re) >= n, 10);
        }
    };

    for (let i = 0; i < attempts; i++) {
        if ((sdk.getState()?.player?.hp ?? 99) < 40) await L.cheat(sdk, 'setstat hitpoints 99', 2);
        let r: { ok: boolean; ticks: number; note?: string };
        const before = msgCount(sdk);
        if (obstacle === 'rockslide') {
            if (i === 0) await L.tele(sdk, 2460, 9721, 0);
            const p = L.pos(sdk);
            const other = p.z > 9720 ? 9719 : 9721;
            const t0 = L.tick(sdk);
            await sdk.sendInteractLoc(2460, 9720, 3309, 1);
            r = await waitResult(t0, before, at(2460, other), hasMsg(before, /slip back down/));
            if (!r.ok) await sdk.waitForTicks(1);
        } else if (obstacle === 'bridgeshot') {
            if (i === 0) {
                await ensureItem('shortbow', /^Shortbow$/i);
                if (!sdk.getEquipment().some(e => /^Shortbow$/i.test(e.name))) await bot.equipItem(/^Shortbow$/i);
            }
            await L.tele(sdk, 2447, 9721, 0);
            await ensureItem('litarrow', /^Bronze fire arrows$/i);
            await bot.equipItem(/^Bronze fire arrows$/i);
            await sdk.waitForTicks(1);
            const t0 = L.tick(sdk);
            await sdk.sendInteractLoc(2443, 9718, 3340, 1);
            r = await waitResult(t0, before, at(2442, 9716), hasMsg(before, /just misses/));
        } else if (obstacle === 'ropeswing') {
            await L.tele(sdk, 2462, 9699, 0);
            await ensureItem('rope', /^Rope$/i);
            await sdk.waitForTicks(4); // the rock is "being used" for 5 ticks after a swing
            const rope = sdk.findInventoryItem(/^Rope$/i)!;
            const t0 = L.tick(sdk);
            await sdk.sendUseItemOnLoc(rope.slot, 2460, 9699, 2276);
            r = await waitResult(t0, before, at(2466, 9699), () => L.pos(sdk).z < 9660);
        } else if (obstacle === 'ledge') {
            await L.tele(sdk, 2375, 9644, 0);
            await sdk.waitForTicks(1);
            const t0 = L.tick(sdk);
            await sdk.sendInteractLoc(2374, 9644, 3238, 1);
            r = await waitResult(t0, before, at(2374, 9638), hasMsg(before, /rat pit/));
            if (!r.ok) await sdk.waitForTicks(3);
        } else if (obstacle === 'stonebridge') {
            await L.tele(sdk, 2379, 9634, 0);
            await sdk.waitForTicks(1);
            const t0 = L.tick(sdk);
            await sdk.sendInteractLoc(2380, 9634, 3276, 1);
            r = await waitResult(t0, before, at(2381, 9634), hasMsg(before, /fall off/));
            if (!r.ok) await sdk.waitForTicks(4);
        } else if (obstacle === 'collapsedbridge') {
            // bridgecollapsed1 at (2142,4562,1): crossed between (2142,4561) and (2142,4565).
            await L.tele(sdk, 2142, 4561, 1);
            await sdk.waitForTicks(1);
            const t0 = L.tick(sdk);
            await sdk.sendInteractLoc(2142, 4562, 3254, 1);
            r = await waitResult(t0, before, at(2142, 4565, 1), () => L.pos(sdk).level === 0);
        } else if (obstacle === 'cagepick') {
            if (i === 0) await L.tele(sdk, 2393, 9655, 0);
            const p = L.pos(sdk);
            const target = p.z >= 9655 ? 9654 : 9655;
            const t0 = L.tick(sdk);
            await sdk.sendInteractLoc(2393, 9655, 3266, 1);
            r = await waitResult(t0, before, at(2393, target), hasMsg(before, /fail to pick/));
            if (!r.ok) await sdk.waitForTicks(1);
        } else {
            // logtrap / speartrap: Search, a message page, then "Yes, I'll give it a go."
            const [x, z, id, sx, sz] = obstacle === 'logtrap' ? [2382, 9668, 3339, 2383, 9668] : [2435, 9675, 3234, 2435, 9676];
            await L.tele(sdk, sx, sz, 0);
            await sdk.waitForTicks(2);
            const t0 = L.tick(sdk);
            await sdk.sendInteractLoc(x, z, id, 1);
            const d = await L.talkThrough(sdk, [/give it a go/i], { settleTicks: 1 });
            r = await waitResult(t0, before, hasMsg(before, /and succeed/), hasMsg(before, /and fail/));
            r.note = `dialogue ${d.pages}p+${d.options}o`;
            await sdk.waitForTicks(6);
        }
        rows.push({ ok: r.ok, ticks: r.ticks, note: r.note ?? '' });
        console.log(`attempt ${i + 1}: ${r.ok ? 'ok  ' : 'FAIL'} ${r.ticks}t ${r.note ?? ''} hp=${sdk.getState()?.player?.hp}`);
    }
    const ok = rows.filter(r => r.ok);
    const fail = rows.filter(r => !r.ok && r.ticks >= 0);
    const med = (a: number[]) => (a.length ? [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)] : null);
    const [low, high] = ROLL[obstacle];
    console.log(`RESULT ${obstacle} ${JSON.stringify({
        stat: STAT[obstacle], level, attempts: rows.length, successes: ok.length, failures: fail.length,
        timeouts: rows.length - ok.length - fail.length,
        measuredSuccessRate: +(ok.length / rows.length).toFixed(3), expectedSuccessRate: +expected(low, high, level).toFixed(3),
        successTicksMedian: med(ok.map(r => r.ticks)), successTicks: ok.map(r => r.ticks), failTicksMedian: med(fail.map(r => r.ticks)),
    })}`);
}, { timeout: 1_800_000, printState: false });
