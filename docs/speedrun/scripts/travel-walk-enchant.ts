// Travel lab (docs/speedrun/research/travel-and-overhead.md, rows 1 and 2).
//
//   LAB_BLOCK=travel NODE_TICKRATE=300 bash docs/speedrun/scripts/lab.sh <bot> docs/speedrun/scripts/travel-walk-enchant.ts
//
// Phase 1 (row 1): on a fresh account, time the SDK's tutorial skip from the first observed tick
// to arrival off Tutorial Island. The SDK porcelain reacts to published state, so this is an upper
// bound on the skip's counted ticks.
//
// Phase 2 (row 2): does a run keep its speed while the player enchants rings? The engine moves a
// delayed player (Player.processInteraction -> updateMovement has no `delayed` check) and
// OPHELDT clears only the interaction (Player.clearPendingAction), so it should. Three modes on the
// same 60-tile run west along the Lumbridge-Draynor road, two runs each:
//   base     one run click, no casts
//   cast     one run click, Lvl-4 Enchant on a diamond ring every 3 observed ticks
//   reclick  as cast, but each burst is [run click to the destination, cast]
// Prints RESULT lines with ticks from click to arrival, tiles walked and casts landed.
import { runScript } from '../../../sdk/runner';
import type { BotSDK } from '../../../sdk/index';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tick = (sdk: BotSDK) => sdk.getState()?.tick ?? -1;
const pos = (sdk: BotSDK) => {
    const p = sdk.getState()?.player;
    return { x: p?.worldX ?? -1, z: p?.worldZ ?? -1 };
};
const cheb = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
const result = (name: string, v: unknown) => console.log(`RESULT ${name} ${JSON.stringify(v)}`);

async function nextTick(sdk: BotSDK, t = tick(sdk)): Promise<number> {
    const deadline = Date.now() + 15_000;
    while (tick(sdk) <= t) {
        if (Date.now() > deadline) throw new Error(`server ticks stopped arriving at ${t}`);
        await sleep(2);
    }
    return tick(sdk);
}
async function waitTicks(sdk: BotSDK, n: number) {
    const target = tick(sdk) + n;
    while (tick(sdk) < target) await nextTick(sdk);
}
async function cheat(sdk: BotSDK, cmd: string) {
    await sdk.sendSay(`::${cmd}`);
    await waitTicks(sdk, 2);
}
async function tele(sdk: BotSDK, x: number, z: number) {
    await cheat(sdk, `tele 0,${x >> 6},${z >> 6},${x & 63},${z & 63}`);
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline && cheb(pos(sdk), { x, z }) > 0) await sleep(20);
    await waitTicks(sdk, 2);
}

const ENCHANT_DIAMOND = 1180; // Lvl-4 Enchant component (magic-cadence-spells.ts on rs/28)
const A = { x: 3200, z: 3226 }; // open ground, quest-primitives-movement.ts (rs/3)
const D = { x: A.x - 60, z: A.z }; // one click reaches 60 tiles here (primitives.md section 2)

await runScript(async ({ bot, sdk }) => {
    // ---- Phase 1: tutorial skip on a fresh account
    const s0 = tick(sdk);
    const p0 = pos(sdk);
    const r = await bot.skipTutorial().catch((e: any) => ({ success: false, message: String(e?.message ?? e) }));
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline && cheb(pos(sdk), { x: 3222, z: 3222 }) > 3) await sleep(20);
    result('tutorial.skip', { from: p0, to: pos(sdk), ticks: tick(sdk) - s0, ok: r.success, msg: r.message, inventory: sdk.getInventory().map((i) => i.name) });

    // ---- Phase 2: run while enchanting
    await cheat(sdk, '~clearinv inv');
    await cheat(sdk, '~clearinv worn');
    // Magic 57 so level-up dialogs pop mid-run; combat 99 so the road's goblins neither attack nor
    // draw a retaliation that would stop the walk (the first run of this script lost walks to it).
    await cheat(sdk, 'setstat magic 57');
    for (const s of ['attack', 'strength', 'defence', 'hitpoints']) await cheat(sdk, `setstat ${s} 99`);

    const rows: Record<string, unknown[]> = { base: [], cast: [], reclick: [] };
    for (const mode of ['base', 'cast', 'reclick'] as const) {
        for (let run = 0; run < 2; run++) {
            await cheat(sdk, '~clearinv inv');
            await cheat(sdk, 'give cosmicrune 100');
            await cheat(sdk, 'give earthrune 1000');
            await cheat(sdk, 'give diamond_ring 25');
            await tele(sdk, A.x, A.z);
            if (cheb(pos(sdk), A) !== 0) throw new Error(`tele to start failed: at ${JSON.stringify(pos(sdk))}`);
            const xp0 = sdk.getSkill('Magic')!.experience;
            const trail: { t: number; x: number; z: number; xp: number }[] = [];
            let t = tick(sdk);
            const tClick = t;
            await sdk.sendWalk(D.x, D.z, true);
            let k = 0;
            let castsSent = 0;
            while (tick(sdk) - tClick < 80) {
                t = await nextTick(sdk, t);
                const p = pos(sdk);
                trail.push({ t: t - tClick, x: p.x, z: p.z, xp: (sdk.getSkill('Magic')!.experience - xp0) / 25 });
                if (cheb(p, D) === 0) break;
                k++;
                if (mode !== 'base' && k % 3 === 1) {
                    const ring = sdk.getInventory().find((i) => /^diamond ring$/i.test(i.name));
                    if (ring) {
                        if (mode === 'reclick') await sdk.sendWalk(D.x, D.z, true);
                        await sdk.sendSpellOnItem(ring.slot, ENCHANT_DIAMOND);
                        castsSent++;
                    }
                }
            }
            const end = trail[trail.length - 1]!;
            let tiles = 0;
            const hist: Record<number, number> = {};
            for (let i = 1; i < trail.length; i++) {
                const d = cheb(trail[i]!, trail[i - 1]!);
                tiles += d;
                hist[d] = (hist[d] ?? 0) + 1;
            }
            const gains = trail.filter((row, i) => i > 0 && row.xp > trail[i - 1]!.xp).map((row) => row.t);
            const out = { mode, run, arrived: cheb(end, D) === 0, ticks: end.t, endAt: { x: end.x, z: end.z }, tiles, stepHistogram: hist, castsSent, castsLanded: Math.round(end.xp / 67), xpTicks: gains };
            rows[mode]!.push(out);
            result(`walkenchant.${mode}`, out);
        }
    }
    result('walkenchant.summary', Object.fromEntries(Object.entries(rows).map(([m, rs]) => [m, rs.map((x: any) => ({ ticks: x.ticks, arrived: x.arrived, casts: x.castsLanded }))])));
}, { timeout: 900_000 });
