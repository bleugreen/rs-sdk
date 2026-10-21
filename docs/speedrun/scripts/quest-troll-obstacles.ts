// Times the troll-chain climbing obstacles and tests the Trollheim rockslide
// bypass, on a local server (docs/speedrun/scripts/quest-troll-lab.sh).
//
//   bun docs/speedrun/scripts/quest-troll-obstacles.ts <bot> <agility> [crossings=10]
//
// For each obstacle the bot stands on one side and clicks the nearest loc of
// the obstacle's ids, alternating sides. A crossing is timed from the click to
// the tick the player's observed tile settles (unchanged for 2 ticks) or, on a
// failure, to the fall message plus settling. Failure = the server's
// "You fall" / "slip back" message. Obstacles (loc ids from pack/loc.pack,
// tiles from the m44_56..m45_57 maps):
//   rockslide   troll_climbingrocks 3748 at 2910,3686-3687 (Trollheim, Agility 15,
//               quest_troll.rs2:1-15 -> upass rockslide_obstacle, stat_random 160/300)
//   dp_rocks    death_climbingrocks 3723 bottom / 3722 top at 2880-2881,3594-3595
//               (climbing boots worn, quest_death.rs2:159-177, no failure roll)
//   rocks_2860  troll_climbingrocks_top/bottom 3790/3791 at 2859-2860,3626-3627
//   rocks_2878  troll_climbingrocks_top/bottom 3790/3791 at 2878-2879,3622-3623
//               (quest_troll.rs2:17-72, stat_random 170/253)
//   shortcut_n  troll_mountain_shortcut 3803/3804 at 2885,3683-3684
//   shortcut_s  troll_mountain_shortcut 3803/3804 at 2887-2888,3661
//               (quest_troll.rs2:136-195, stat_random 170/253)
// Bypass: walk from the pass exit (2908,3654) along x=2913 to 2913,3690, which
// the offline pathfinder claims is open beside the rockslide.
import { runScript } from '../../../sdk/runner';
import type { BotSDK } from '../../../sdk/index';
import { cheat, tele, give, now, pos, waitUntil, waitTicks, lastMessages, stats, result } from './quest-troll-lib';

const [, , , agilityArg = '15', nArg = '10'] = process.argv;
const AGILITY = parseInt(agilityArg);
const N = parseInt(nArg);

interface Obstacle { name: string; ids: number[]; start: [number, number]; radius: number }
const OBSTACLES: Obstacle[] = [
    { name: 'rockslide', ids: [3748], start: [2910, 3685], radius: 3 },
    { name: 'dp_rocks', ids: [3722, 3723], start: [2880, 3593], radius: 3 },
    { name: 'rocks_2860', ids: [3790, 3791], start: [2861, 3626], radius: 3 },
    { name: 'rocks_2878', ids: [3790, 3791], start: [2880, 3622], radius: 3 },
    { name: 'shortcut_n', ids: [3803, 3804], start: [2884, 3683], radius: 3 },
    { name: 'shortcut_s', ids: [3803, 3804], start: [2886, 3661], radius: 3 },
];

const FAIL = /fall and hurt|slip back/i;

async function crossOnce(sdk: BotSDK, ob: Obstacle, msgBase: number) {
    const s0 = sdk.getState()!;
    const p0 = pos(s0);
    const locs = (await sdk.scanNearbyLocs(ob.radius + 2)).filter(l => ob.ids.includes(l.id)).sort((a, b) => a.distance - b.distance);
    const loc = locs[0];
    if (!loc) return { error: `no loc near ${p0.x},${p0.z}` };
    const hp0 = s0.player!.hp;
    const t0 = now(sdk);
    await sdk.sendInteractLoc(loc.x, loc.z, loc.id, 1);
    // settle: position unchanged for 3 ticks after having moved, or 12 ticks without moving
    let last = p0, lastMove = t0, moved = false;
    for (;;) {
        await waitTicks(sdk, 1);
        const s = sdk.getState()!;
        const p = pos(s);
        if (p.x !== last.x || p.z !== last.z) { moved = true; lastMove = s.tick; last = p; }
        if (moved && s.tick - lastMove >= 3) break;
        if (s.tick - t0 >= 14) break;
    }
    const s1 = sdk.getState()!;
    const msgs = (s1.gameMessages ?? []).slice(msgBase).map(m => m.text);
    const failed = msgs.some(m => FAIL.test(m));
    return {
        loc: `${loc.id}@${loc.x},${loc.z}`, from: `${p0.x},${p0.z}`, to: `${last.x},${last.z}`,
        ticks: lastMove - t0, failed, moved, hpLost: hp0 - s1.player!.hp, msgs: msgs.filter(m => !/^You climb onto|^\.\.\.and step/.test(m)).slice(-2),
    };
}

await runScript(async ({ bot, sdk }) => {
    await bot.skipTutorial().catch(() => {});
    await cheat(sdk, `setstat agility ${AGILITY}`);
    await cheat(sdk, 'setstat hitpoints 99');
    await cheat(sdk, 'setvar troll_quest 10');
    await cheat(sdk, 'setvar death_equiproom 80');
    await give(sdk, 'death_climbingboots');
    await bot.equipItem(/climbing boots/i).catch(e => console.log('equip boots:', e?.message ?? e));

    // Bypass test
    await tele(sdk, 2908, 3654);
    for (const [x, z] of [[2911, 3664], [2913, 3672], [2913, 3680], [2913, 3688], [2912, 3690]]) {
        await sdk.sendWalk(x, z, true);
        await waitUntil(sdk, s => { const p = pos(s); return p.x === x && p.z === z; }, 20);
        console.log(`bypass walk -> ${x},${z}: at ${JSON.stringify(pos(sdk.getState()))}`);
    }
    const bp = pos(sdk.getState());
    result('bypass', { reached: bp.z >= 3688, at: bp });

    for (const ob of OBSTACLES) {
        await cheat(sdk, 'setstat hitpoints 99');
        await tele(sdk, ob.start[0], ob.start[1]);
        const runs: Array<Record<string, unknown>> = [];
        for (let i = 0; i < N; i++) {
            const base = (sdk.getState()!.gameMessages ?? []).length;
            const r = await crossOnce(sdk, ob, base);
            console.log(`${ob.name} ${i + 1}`, JSON.stringify(r));
            runs.push(r);
            if ('error' in r) break;
            await waitTicks(sdk, 1);
        }
        const ok = runs.filter(r => !r.error && !r.failed && r.moved);
        const bad = runs.filter(r => !r.error && r.failed);
        result(`${ob.name}-ag${AGILITY}`, {
            attempts: runs.filter(r => !r.error).length, failures: bad.length,
            successTicks: stats(ok.map(r => r.ticks as number)), failTicks: stats(bad.map(r => r.ticks as number)),
            failHp: stats(bad.map(r => r.hpLost as number)),
        });
    }
    console.log('messages:', lastMessages(sdk.getState(), 5));
}, { timeout: 1_800_000, printState: false });
