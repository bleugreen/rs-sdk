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
// (`idle`: no movement, no new message, no dialogue for 3 ticks, which is when
// the next click can act). The idle figure, minus the 3-tick settle, is the
// cost of the attempt. Prints one line per attempt and a RESULT line.

import { runScript } from '../../../sdk/runner';
import * as L from './quest-arthur-lab';

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
    // The client keeps a capped message list, so collect new messages by identity.
    const seen = new Set<string>();
    const log: string[] = [];
    const keyOf = (m: { tick: number; text: string; observationId?: number }) => `${m.tick}|${m.observationId ?? ''}|${m.text}`;
    for (const m of sdk.getState()?.gameMessages ?? []) seen.add(keyOf(m));
    sdk.onStateUpdate(st => {
        for (const m of st.gameMessages ?? []) {
            const k = keyOf(m);
            if (!seen.has(k)) { seen.add(k); log.push(m.text); }
        }
    });
    const msgs = () => log;
    const since = (n: number) => log.slice(n);
    const idle = async (max = 60) => {
        let still = 0;
        let last = L.pos(sdk);
        let lastMsgs = msgs().length;
        for (let i = 0; i < max; i++) {
            await sdk.waitForTicks(1);
            const p = L.pos(sdk);
            const s = sdk.getState()!;
            if (s.dialog.isOpen) {
                if (L.isLevelUpDialog(sdk)) await L.dismissLevelUps(sdk);
                still = 0;
                continue;
            }
            const n = msgs().length;
            still = p.x === last.x && p.z === last.z && p.level === last.level && n === lastMsgs ? still + 1 : 0;
            last = p;
            lastMsgs = n;
            if (still >= 3) return;
        }
    };
    const teleTo = async (x: number, z: number, l: number) => {
        for (let k = 0; k < 3; k++) {
            await L.tele(sdk, x, z, l);
            if (await L.waitUntil(sdk, () => { const p = L.pos(sdk); return p.x === x && p.z === z && p.level === l; }, 8) !== null) return;
            await idle();
        }
        throw new Error(`could not teleport to ${x},${z},${l}`);
    };
    const ensure = async (name: string, re: RegExp) => {
        if (sdk.countInventoryItems(re) < 1 && !sdk.getEquipment().some(e => re.test(e.name))) {
            await L.cheat(sdk, `give ${name} 1`, 2);
            await L.waitUntil(sdk, () => sdk.countInventoryItems(re) >= 1, 10);
        }
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
                if (!sdk.getEquipment().some(e => /^Shortbow$/i.test(e.name))) await bot.equipItem(/^Shortbow$/i);
                await ensure('litarrow', /^Bronze fire arrows$/i);
                if (!sdk.getEquipment().some(e => /fire arrows/i.test(e.name))) await bot.equipItem(/^Bronze fire arrows$/i);
                await idle();
                await sdk.sendInteractLoc(2443, 9718, 3340, 1);
            },
        },
        ropeswing: {
            stat: 'agility', roll: [100, 410], ok: /skillfully swing across/, fail: /fall in to the darkness/, start: [2462, 9699, 0], reset: true,
            act: async () => {
                await ensure('rope', /^Rope$/i);
                await sdk.waitForTicks(5); // the rock is "being used" for 5 ticks after each swing
                await sdk.sendUseItemOnLoc(sdk.findInventoryItem(/^Rope$/i)!.slot, 2460, 9699, 2276);
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
                await L.talkThrough(sdk, [/give it a go/i], { settleTicks: 1 });
            },
        },
    };
    const spec = specs[obstacle];
    if (!spec) throw new Error(`unknown obstacle ${obstacle}`);

    await bot.dismissBlockingUI();
    await L.cheat(sdk, `setstat ${spec.stat} ${level}`, 2);
    await L.cheat(sdk, 'setstat hitpoints 99', 2);
    // Koftik's insanity scene would follow a bridge fall (upass_obstacles.rs2:381-386); %upass 5 keeps
    // the cavern scripts in their mid-quest branches.
    await L.cheat(sdk, `setvar ibanmulti ${(1 << 11) | (1 << 17)}`);
    await L.cheat(sdk, 'setvar upass 5');
    await idle();
    await teleTo(...spec.start);

    const rows: Array<{ ok: boolean | null; msg: number; idle: number }> = [];
    for (let i = 0; i < attempts; i++) {
        if ((sdk.getState()?.player?.hp ?? 99) < 50) await L.cheat(sdk, 'setstat hitpoints 99', 2);
        const p = L.pos(sdk);
        const onStart = Math.abs(p.x - spec.start[0]) + Math.abs(p.z - spec.start[1]) <= 6 && p.level === spec.start[2];
        if (spec.reset || !onStart) await teleTo(...spec.start);
        await idle();
        const before = msgs().length;
        const t0 = L.tick(sdk);
        await spec.act(i);
        let msgTick = -1;
        let ok: boolean | null = null;
        for (let k = 0; k < 60 && ok === null; k++) {
            const m = since(before);
            if (m.some(t => spec.fail.test(t))) ok = false;
            else if (obstacle === 'ledge' ? (L.pos(sdk).x === 2374 && L.pos(sdk).z === 9638) : m.some(t => spec.ok.test(t))) ok = true;
            if (ok !== null) msgTick = L.tick(sdk) - t0;
            else await sdk.waitForTicks(1);
        }
        await idle();
        const idleTicks = L.tick(sdk) - t0 - 3;
        rows.push({ ok, msg: msgTick, idle: idleTicks });
        console.log(`attempt ${i + 1}: ${ok === null ? 'NONE' : ok ? 'ok  ' : 'FAIL'} msg=${msgTick}t idle=${idleTicks}t pos=(${L.pos(sdk).x},${L.pos(sdk).z},${L.pos(sdk).level}) hp=${sdk.getState()?.player?.hp}${ok === null ? ' ' + JSON.stringify(since(before)) : ''}`);
    }
    const okRows = rows.filter(r => r.ok === true);
    const failRows = rows.filter(r => r.ok === false);
    const med = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);
    const [low, high] = spec.roll;
    const c = Math.min(level, 99);
    const expected = Math.min(Math.floor((low * (99 - c)) / 98) + Math.floor((high * (c - 1)) / 98) + 1, 256) / 256;
    console.log(`RESULT ${obstacle} ${JSON.stringify({
        stat: spec.stat, level, attempts: rows.length, successes: okRows.length, failures: failRows.length,
        unknown: rows.length - okRows.length - failRows.length,
        measuredSuccessRate: +(okRows.length / Math.max(1, okRows.length + failRows.length)).toFixed(3), expectedSuccessRate: +expected.toFixed(3),
        successIdleMedian: med(okRows.map(r => r.idle)), failIdleMedian: med(failRows.map(r => r.idle)),
        successMsgMedian: med(okRows.map(r => r.msg)), failMsgMedian: med(failRows.map(r => r.msg)),
    })}`);
}, { timeout: 3_600_000, printState: false });
