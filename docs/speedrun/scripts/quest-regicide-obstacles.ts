// Isafdar obstacle crossings and the teleport out of Tirannwn, each timed from
// the click (standing on the start tile) to the observed landing tile.
//
//   bun docs/speedrun/scripts/quest-regicide-obstacles.ts <bot> <segment> [agility] [reps]
//
// Segments:
//   log        log balance 1 (2197/2201,3237) both ways (Agility 45, quest_regicide.rs2:367)
//   log3       log balance 3 (2290,3233/3238) both ways (the N-S one, :345)
//   pitfall    leaves at (2209,3203) jumped N->S and S->N (stat_random 160/300)
//   woodspring sticks at (2235,3181), Pass from the east until across, repeated (stat_random 30/155)
//   tripwire   tripwire (2220,3153): Step-over, then walking straight through
//   crossover  dense forest (2232,3148) west->east and back (Agility 56, stage >= 8)
//   teleport   Falador teleport cast at the old-camp tracker (2257,3150)

import { runScript } from '../../../sdk/runner';
import { findLoc, now, pos, result, setStats, setVar, tele, waitTicks, waitUntil } from './quest-regicide-lab';

const [segment, agiArg, repsArg] = process.argv.slice(3);
const agility = Number(agiArg ?? 56);
const reps = Number(repsArg ?? 3);

const at = (x: number, z: number) => (s: any) => s.player?.worldX === x && s.player?.worldZ === z;

await runScript(async ({ sdk }) => {
    await setStats(sdk, { agility, hitpoints: 99 });
    const hp = () => sdk.getState()?.player?.hp ?? -1;

    // Click a loc from where we stand and wait for one of the landing tiles.
    const cross = async (lx: number, lz: number, name: RegExp, op: number, lands: Array<[number, number]>, max = 40) => {
        const loc = await findLoc(sdk, lx, lz, name);
        if (!loc) throw new Error(`loc ${name} at ${lx},${lz} not found (have ${(await sdk.scanNearbyLocs(4)).map(l => `${l.name}@${l.x},${l.z}`).join(' ')})`);
        const t0 = now(sdk);
        const hp0 = hp();
        await sdk.sendInteractLoc(loc.x, loc.z, loc.id, op);
        const r = await waitUntil(sdk, s => lands.some(([x, z]) => at(x, z)(s)), max);
        return { ticks: r ? r.tick - t0 : null, end: pos(sdk.getState()), dmg: hp0 - hp() };
    };

    if (segment === 'log') {
        const rows = [];
        for (let i = 0; i < reps; i++) {
            await tele(sdk, 2196, 3237);
            rows.push({ dir: 'W->E', ...(await cross(2197, 3237, /Log balance/, 1, [[2202, 3237]])) });
            await waitTicks(sdk, 2);
            rows.push({ dir: 'E->W', ...(await cross(2201, 3237, /Log balance/, 1, [[2196, 3237]])) });
            await waitTicks(sdk, 2);
        }
        result('log1', rows);
    } else if (segment === 'log3') {
        const rows = [];
        for (let i = 0; i < reps; i++) {
            await tele(sdk, 2290, 3232);
            rows.push({ dir: 'S->N', ...(await cross(2290, 3233, /Log balance/, 1, [[2290, 3239]])) });
            await waitTicks(sdk, 2);
            rows.push({ dir: 'N->S', ...(await cross(2290, 3238, /Log balance/, 1, [[2290, 3232]])) });
            await waitTicks(sdk, 2);
        }
        result('log3', rows);
    } else if (segment === 'pitfall') {
        const rows = [];
        for (let i = 0; i < reps; i++) {
            await tele(sdk, 2209, 3205);
            rows.push({ dir: 'N->S', ...(await cross(2209, 3204, /Leaves/, 1, [[2209, 3201]])) });
            await waitTicks(sdk, 2);
            if (!at(2209, 3201)(sdk.getState())) await tele(sdk, 2209, 3201);
            rows.push({ dir: 'S->N', ...(await cross(2209, 3202, /Leaves/, 1, [[2209, 3205]])) });
            await waitTicks(sdk, 2);
        }
        result('pitfall', rows);
    } else if (segment === 'woodspring') {
        const crossings = [];
        for (let i = 0; i < reps; i++) {
            await tele(sdk, 2238, 3181);
            await waitTicks(sdk, 2);
            const t0 = now(sdk);
            const attempts = [];
            for (let a = 0; a < 15; a++) {
                const r = await cross(2235, 3181, /Sticks/, 1, [[2234, 3181], [2238, 3181], [2239, 3181]], 30);
                const ok = pos(sdk.getState()).x <= 2234;
                attempts.push({ ok, ticks: r.ticks, dmg: r.dmg });
                if (ok) break;
                // after a failure the player is thrown back east; wait for the stumble to end
                await waitUntil(sdk, s => !s.player?.animId || s.player.animId === -1, 10);
                if (pos(sdk.getState()).x !== 2238) { await sdk.sendWalk(2238, 3181, true); await waitUntil(sdk, at(2238, 3181), 10); }
            }
            crossings.push({ attempts: attempts.length, ticks: now(sdk) - t0, detail: attempts });
            result('woodspring-crossing', crossings[crossings.length - 1]);
        }
        result('woodspring', { agility, crossings: crossings.map(c => ({ attempts: c.attempts, ticks: c.ticks })) });
    } else if (segment === 'tripwire') {
        const rows = [];
        for (let i = 0; i < reps; i++) {
            await tele(sdk, 2220, 3152);
            await waitTicks(sdk, 2);
            rows.push({ how: 'step-over S->N', ...(await cross(2220, 3153, /Tripwire/, 1, [[2220, 3154]])) });
            await waitTicks(sdk, 4);
            await tele(sdk, 2220, 3151);
            await waitTicks(sdk, 2);
            const t0 = now(sdk);
            const hp0 = hp();
            await sdk.sendWalk(2220, 3156, true);
            let r = await waitUntil(sdk, s => (s.player?.worldZ ?? 0) >= 3154, 20);
            const pushed = pos(sdk.getState());
            // the trigger stops the walk (p_stopaction); click on to the target
            await sdk.sendWalk(2220, 3156, true);
            const r2 = await waitUntil(sdk, at(2220, 3156), 20);
            rows.push({ how: 'walk-through S->N (5 tiles)', acrossAt: r ? r.tick - t0 : null, pushedTo: pushed, arrive: r2 ? r2.tick - t0 : null, dmg: hp0 - hp() });
            void r;
            await waitTicks(sdk, 6);
            await setStats(sdk, { hitpoints: 99 });
        }
        result('tripwire', rows);
    } else if (segment === 'crossover') {
        await setVar(sdk, 'regicide_quest', 9); // >= spoken_tracker2, and past the guard spawn
        const rows = [];
        for (let i = 0; i < reps; i++) {
            await tele(sdk, 2231, 3149);
            rows.push({ dir: 'W->E', ...(await cross(2232, 3148, /Dense forest/, 1, [[2234, 3149]])) });
            await waitTicks(sdk, 2);
            rows.push({ dir: 'E->W', ...(await cross(2232, 3148, /Dense forest/, 1, [[2231, 3149]])) });
            await waitTicks(sdk, 2);
        }
        result('crossover', rows);
    } else if (segment === 'teleport') {
        const rows = [];
        for (let i = 0; i < reps; i++) {
            await tele(sdk, 2257, 3151);
            await waitTicks(sdk, 2);
            const t0 = now(sdk);
            await sdk.sendClickComponent(1170); // magic:falador_teleport
            const r = await waitUntil(sdk, s => Math.abs((s.player?.worldX ?? 0) - 2965) < 8 && Math.abs((s.player?.worldZ ?? 0) - 3378) < 8, 20);
            rows.push({ ticks: r ? r.tick - t0 : null, end: pos(sdk.getState()), msgs: sdk.getState()?.gameMessages.slice(-2).map(m => m.text) });
        }
        result('teleport-from-isafdar', rows);
    }
}, { timeout: 900_000 });
