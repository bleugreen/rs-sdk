// Walks the troll-chain travel legs on a local server and times each one
// (docs/speedrun/scripts/quest-troll-lab.sh). Quest varps are set with
// ::setvar so every door and obstacle opens as it would at that point of the
// quest; fights and dialogue are timed elsewhere (quest-troll-fights.ts) or
// costed from read page counts.
//
//   bun docs/speedrun/scripts/quest-troll-walk.ts <bot> [leg ...]
//
// Walking uses bot.walkTo, which the timing-primitives child measured at about
// 0.57 ticks per route tile against 0.5 for chained clicks (primitives.md §2),
// so these figures are about 13% pessimistic on the walking part. Each loc
// action clicks the nearest loc of the given ids and waits for the expected
// arrival. Agility is set to 99 so the rockslides (stat_random 160/300 at
// quest_troll.rs2:15 -> upass_obstacles.rs2:22) never fail here; failure costs
// come from quest-troll-obstacles.ts.
import { runScript } from '../../../sdk/runner';
import type { BotSDK } from '../../../sdk/index';
import type { BotActions } from '../../../sdk/actions';
import { cheat, tele, give, now, pos, waitUntil, waitTicks, result } from './quest-troll-lib';

type P = { x: number; z: number; level: number };
type Act =
    | { walk: [number, number, number?] }
    | { loc: number[]; near?: [number, number]; until: (p: P) => boolean; op?: number }
    | { tele: [number, number, number?] }
    | { cheat: string }
    | { scan: true };

const LEGS: Record<string, Act[]> = {
    // Troll Stronghold, out: Death Plateau rocks -> arena -> pass -> Trollheim -> stronghold door
    ts_out: [
        { cheat: 'setvar troll_quest 20' }, { cheat: 'setvar troll_varbit 0' },
        { tele: [2880, 3593] },
        { loc: [3723], until: p => p.z >= 3596 },
        { walk: [2896, 3618, 0] },
        { loc: [3782, 3783], until: p => p.x >= 2898 },
        { walk: [2916, 3628, 0] },
        { loc: [3785, 3786], until: p => p.z >= 3630 },
        { walk: [2903, 3643, 1] },
        { loc: [3757], until: p => p.z > 9000 },
        { walk: [2907, 10035, 1] },
        { loc: [3758], until: p => p.z < 9000 },
        { walk: [2913, 3672, 0] }, { walk: [2913, 3688, 0] },
        { walk: [2839, 3690, 1] },
        { loc: [3771], until: p => p.level === 2 },
    ],
    // Inside: level 2 arrival -> north stairs -> prison -> Godric's cell -> secret exit
    ts_in: [
        { cheat: 'setvar troll_quest 30' },
        { tele: [2837, 10090, 2] },
        { walk: [2843, 10107, 1] },
        { loc: [3789], near: [2843, 10108], until: p => p.level === 1 },
        { walk: [2847, 10107, 0] },
        { loc: [3780], until: p => p.x >= 2849 },
        { walk: [2851, 10107, 0] },
        { loc: [3789], near: [2852, 10107], until: p => p.level === 0 },
        { walk: [2833, 10079, 1] },
        { walk: [2823, 10049, 1] },
        { loc: [3761], until: p => p.z < 9000 },
    ],
    // Secret exit -> Sherpa path rockslides -> stile -> Dunstan
    secret_to_dunstan: [
        { cheat: 'setvar troll_quest 40' },
        { tele: [2827, 3646] },
        { walk: [2821, 3636, 0] },
        { loc: [3748], near: [2821, 3635], until: p => p.z <= 3634 },
        { walk: [2833, 3629, 0] },
        { loc: [3748], near: [2833, 3628], until: p => p.z <= 3627 },
        { walk: [2856, 3613, 0] },
        { loc: [3748], near: [2856, 3612], until: p => p.z <= 3611 },
        { walk: [2817, 3564, 0] },
        { loc: [3730], until: p => p.z <= 3562 },
        { walk: [2919, 3573, 1] },
    ],
    // Burthorpe stile -> rockslides -> secret door -> Ug (troll_quest complete)
    stile_to_ug: [
        { cheat: 'setvar troll_quest 50' },
        { tele: [2817, 3561] },
        { loc: [3730], until: p => p.z >= 3564 },
        { walk: [2856, 3611, 0] },
        { loc: [3748], near: [2856, 3612], until: p => p.z >= 3613 },
        { walk: [2833, 3627, 0] },
        { loc: [3748], near: [2833, 3628], until: p => p.z >= 3629 },
        { walk: [2821, 3634, 0] },
        { loc: [3748], near: [2821, 3635], until: p => p.z >= 3636 },
        { walk: [2827, 3646, 1] },
        { loc: [3762], until: p => p.z > 9000 },
        { walk: [2851, 10061, 1] },
        { loc: [3788], until: p => p.level === 1 },
        { walk: [2827, 10065, 1] },
    ],
    // Arrg's arena (where his fight leaves you) -> west exit -> rocks -> secret door
    arena_to_secret: [
        { cheat: 'setvar troll_quest 50' },
        { tele: [2914, 3611] },
        { walk: [2898, 3618, 0] },
        { loc: [3782, 3783], until: p => p.x <= 2896 },
        { walk: [2880, 3622, 0] },
        { loc: [3790, 3791], near: [2879, 3622], until: p => p.x <= 2877 },
        { walk: [2861, 3626, 0] },
        { loc: [3790, 3791], near: [2860, 3626], until: p => p.x <= 2858 },
        { walk: [2833, 3627, 0] },
        { loc: [3748], near: [2833, 3628], until: p => p.z >= 3629 },
        { walk: [2821, 3634, 0] },
        { loc: [3748], near: [2821, 3635], until: p => p.z >= 3636 },
        { walk: [2827, 3646, 1] },
        { loc: [3762], until: p => p.z > 9000 },
    ],
    // Trollweiss: stronghold top door -> Trollheim ice cave -> crevasse -> sled 1 -> flower -> sled 2 -> Rellekka
    trollweiss: [
        { cheat: 'setvar troll_quest 50' }, { cheat: 'setvar troll_love 25' },
        { cheat: 'give trollromance_toboggon_waxed 1' },
        { tele: [2840, 3690] },
        { walk: [2820, 3742, 1] },
        { loc: [5007], until: p => p.z > 9000 },
        { walk: [2772, 10232, 1] },
        { loc: [5025], until: p => p.z < 9000 },
        { walk: [2772, 3836, 1] },
        { scan: true },
        { loc: [5015], until: p => p.z <= 3800 },
        { walk: [2781, 3784, 1] },
        { loc: [5006], op: 2, until: () => false },
        { walk: [2785, 3772, 1] },
        { loc: [5015], until: p => p.z <= 3725 },
        { scan: true },
        { loc: [5012], until: p => p.z > 9000 },
        { scan: true },
        { loc: [5014], until: p => p.z < 9000 && p.x < 2760 },
    ],
    // Games necklace arrival (primitives.md §4: about 2208,4941) -> way out
    games_room: [
        { tele: [2208, 4941] },
        { scan: true },
    ],
};

async function doLoc(bot: BotActions, sdk: BotSDK, a: Extract<Act, { loc: number[] }>) {
    const locs = (await sdk.scanNearbyLocs(12)).filter(l => a.loc.includes(l.id) && (!a.near || (Math.abs(l.x - a.near[0]) <= 1 && Math.abs(l.z - a.near[1]) <= 1)))
        .sort((x, y) => x.distance - y.distance);
    const l = locs[0];
    if (!l) return { ok: false, why: 'no loc' };
    if (a.loc.includes(5015)) {
        // the waxed sled is wielded from the inventory inside the sled zone (quest_troll_love.rs2:112-129)
        const sled = sdk.getInventory().find(i => /sled/i.test(i.name));
        if (sled) { await sdk.sendUseItem(sled.slot, 2); await waitTicks(sdk, 2); }
    }
    await sdk.sendInteractLoc(l.x, l.z, l.id, a.op ?? 1);
    const r = await waitUntil(sdk, s => a.until(pos(s)), 60);
    if (!r) { await waitTicks(sdk, 4); return { ok: a.until(pos(sdk.getState())), why: `at ${JSON.stringify(pos(sdk.getState()))}`, loc: `${l.id}@${l.x},${l.z}` }; }
    return { ok: true, loc: `${l.id}@${l.x},${l.z}` };
}

await runScript(async ({ bot, sdk }) => {
    await bot.skipTutorial().catch(() => {});
    await cheat(sdk, 'setstat agility 99');
    await cheat(sdk, 'setstat hitpoints 99');
    await cheat(sdk, 'setvar death_equiproom 80');
    await give(sdk, 'death_climbingboots');
    await bot.equipItem(/climbing boots/i).catch(e => console.log('boots', e?.message ?? e));
    const want = process.argv.slice(3);
    for (const [name, acts] of Object.entries(LEGS)) {
        if (want.length && !want.includes(name)) continue;
        let total = 0;
        const rows: string[] = [];
        for (const a of acts) {
            const t0 = now(sdk);
            const p0 = pos(sdk.getState());
            let note = '';
            if ('cheat' in a) { await cheat(sdk, a.cheat); continue; }
            if ('tele' in a) { await tele(sdk, a.tele[0], a.tele[1], a.tele[2] ?? 0); continue; }
            if ('scan' in a) {
                const ls = (await sdk.scanNearbyLocs(12)).filter(l => l.options.length && !/^(Rocks?|Tree|Bush)$/.test(l.name));
                console.log(`  scan at ${JSON.stringify(pos(sdk.getState()))}: ${ls.slice(0, 14).map(l => `${l.id}:${l.name}@${l.x},${l.z}[${l.options.join('|')}]`).join(' ')}`);
                continue;
            }
            if ('walk' in a) {
                const [x, z, tol = 0] = a.walk;
                const r = await bot.walkTo(x, z, tol, { timeout: 120_000 }).catch(e => ({ success: false, message: String(e) }));
                note = `walk ${x},${z} ${r.success ? 'ok' : 'FAIL ' + (r as { message?: string }).message}`;
            } else if ('loc' in a) {
                const r = await doLoc(bot, sdk, a);
                note = `loc ${a.loc.join('/')} ${r.ok ? 'ok' : 'FAIL ' + r.why} ${r.loc ?? ''}`;
            }
            const dt = now(sdk) - t0;
            total += dt;
            const p1 = pos(sdk.getState());
            rows.push(`${dt}`);
            console.log(`  ${name}: ${note} | ${p0.x},${p0.z},${p0.level} -> ${p1.x},${p1.z},${p1.level} | ${dt} ticks`);
        }
        result(name, { ticks: total, steps: rows.join('+') });
    }
}, { timeout: 1_800_000, printState: false });
