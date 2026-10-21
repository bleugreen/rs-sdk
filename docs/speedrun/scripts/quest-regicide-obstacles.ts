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
//   gate       Arandar gate from the south and the north side at stages 11 and 13

import { runScript } from '../../../sdk/runner';
import { converse } from '../../../speedrun/lib/converse';
import { currentTick, waitTicks, waitUntil } from '../../../speedrun/lib/wait';
import { at, findLoc, pos } from '../../../speedrun/lib/world';
import { result } from '../../../speedrun/lab/record';
import { mustTele, setStats, setvar } from '../../../speedrun/lab/setup';

const [segment, agiArg, repsArg] = process.argv.slice(3);
const agility = Number(agiArg ?? 56);
const reps = Number(repsArg ?? 3);

await runScript(async ({ sdk }) => {
    await setStats(sdk, { agility, hitpoints: 99 });
    const hp = () => sdk.getState()?.player?.hp ?? -1;

    // Click a loc from where we stand and wait for one of the landing tiles.
    // The log balances are level-1 locs over bridge tiles; the client's scan only
    // lists the player's plane, so they are addressed by config id (loc.pack).
    const LOG_IDS: Record<string, number> = { '2197,3237': 3931, '2201,3237': 3931, '2259,3250': 3932, '2263,3250': 3932, '2290,3233': 3933, '2290,3238': 3933 };
    const cross = async (lx: number, lz: number, name: RegExp, op: number, lands: Array<[number, number]>, max = 40) => {
        const fixed = LOG_IDS[`${lx},${lz}`];
        const loc = fixed ? { x: lx, z: lz, id: fixed } : await findLoc(sdk, { x: lx, z: lz, name });
        if (!loc) throw new Error(`loc ${name} at ${lx},${lz} not found (have ${(await sdk.scanNearbyLocs(4)).map(l => `${l.name}@${l.x},${l.z}`).join(' ')})`);
        const t0 = currentTick(sdk);
        const hp0 = hp();
        await sdk.sendInteractLoc(loc.x, loc.z, loc.id, op);
        const r = await waitUntil(sdk, s => lands.some(([x, z]) => at(x, z)(s)), { maxTicks: max });
        return { ticks: r.ok ? r.tick - t0 : null, end: pos(sdk), dmg: hp0 - hp() };
    };

    if (segment === 'log') {
        const rows = [];
        for (let i = 0; i < reps; i++) {
            await mustTele(sdk, 2196, 3237);
            rows.push({ dir: 'W->E', ...(await cross(2197, 3237, /Log balance/, 1, [[2202, 3237]])) });
            await waitTicks(sdk, 3);
            rows.push({ dir: 'E->W', ...(await cross(2201, 3237, /Log balance/, 1, [[2196, 3237]])) });
            await waitTicks(sdk, 3);
        }
        result('log1', rows);
    } else if (segment === 'log3') {
        const rows = [];
        for (let i = 0; i < reps; i++) {
            await mustTele(sdk, 2290, 3232);
            rows.push({ dir: 'S->N', ...(await cross(2290, 3233, /Log balance/, 1, [[2290, 3239]])) });
            await waitTicks(sdk, 2);
            rows.push({ dir: 'N->S', ...(await cross(2290, 3238, /Log balance/, 1, [[2290, 3232]])) });
            await waitTicks(sdk, 2);
        }
        result('log3', rows);
    } else if (segment === 'pitfall') {
        const rows = [];
        for (let i = 0; i < reps; i++) {
            await mustTele(sdk, 2209, 3205);
            rows.push({ dir: 'N->S', ...(await cross(2209, 3204, /Leaves/, 1, [[2209, 3201]])) });
            await waitTicks(sdk, 2);
            if (!at(2209, 3201)(sdk.getState()!)) await mustTele(sdk, 2209, 3201);
            rows.push({ dir: 'S->N', ...(await cross(2209, 3202, /Leaves/, 1, [[2209, 3205]])) });
            await waitTicks(sdk, 2);
        }
        result('pitfall', rows);
    } else if (segment === 'woodspring') {
        const crossings = [];
        for (let i = 0; i < reps; i++) {
            await mustTele(sdk, 2238, 3181);
            await waitTicks(sdk, 2);
            const t0 = currentTick(sdk);
            const attempts = [];
            for (let a = 0; a < 15; a++) {
                const loc = await findLoc(sdk, { x: 2235, z: 3181, name: /Sticks/ });
                if (!loc) throw new Error('no sticks at 2235,3181');
                const ta = currentTick(sdk);
                const hp0 = hp();
                await sdk.sendInteractLoc(loc.x, loc.z, loc.id, 1);
                // Success: forcemove to 2234. Failure: weakqueue p_walk onto the trigger
                // tile 2237, the softtimer springs the trap and agility_exactmove throws
                // the player back to 2238 with 8 damage (quest_regicide.rs2:79-134).
                let left = false;
                const r = await waitUntil(sdk, s => {
                    const x = s.player?.worldX ?? 9999;
                    if (x === 2237 || x === 2236) left = true;
                    return x <= 2234 || (left && x === 2238) || hp() < hp0;
                }, { maxTicks: 20 });
                const ok = pos(sdk).x <= 2234;
                if (ok) { attempts.push({ ok, ticks: r.ok ? r.tick - ta : null, dmg: hp0 - hp() }); break; }
                const back = await waitUntil(sdk, at(2238, 3181), { maxTicks: 15 });
                attempts.push({ ok, failSeenAt: r.ok ? r.tick - ta : null, backAt: back.ok ? back.tick - ta : null, dmg: hp0 - hp() });
                if (!back.ok) await mustTele(sdk, 2238, 3181);
            }
            crossings.push({ attempts: attempts.length, ticks: currentTick(sdk) - t0, detail: attempts });
            result('woodspring-crossing', crossings[crossings.length - 1]);
        }
        result('woodspring', { agility, crossings: crossings.map(c => ({ attempts: c.attempts, ticks: c.ticks })) });
    } else if (segment === 'tripwire') {
        const rows = [];
        for (let i = 0; i < reps; i++) {
            await mustTele(sdk, 2220, 3152);
            await waitTicks(sdk, 2);
            rows.push({ how: 'step-over S->N', ...(await cross(2220, 3153, /Tripwire/, 1, [[2220, 3154]])) });
            await waitTicks(sdk, 4);
            await mustTele(sdk, 2220, 3151);
            await waitTicks(sdk, 2);
            const t0 = currentTick(sdk);
            const hp0 = hp();
            await sdk.sendWalk(2220, 3156, true);
            const r = await waitUntil(sdk, s => (s.player?.worldZ ?? 0) >= 3154, { maxTicks: 20 });
            const pushed = pos(sdk);
            // the trigger stops the walk (p_stopaction); click on to the target
            await sdk.sendWalk(2220, 3156, true);
            const r2 = await waitUntil(sdk, at(2220, 3156), { maxTicks: 20 });
            rows.push({ how: 'walk-through S->N (5 tiles)', acrossAt: r.ok ? r.tick - t0 : null, pushedTo: pushed, arrive: r2.ok ? r2.tick - t0 : null, dmg: hp0 - hp() });
            await waitTicks(sdk, 6);
            await setStats(sdk, { hitpoints: 99 });
        }
        result('tripwire', rows);
    } else if (segment === 'crossover') {
        await setvar(sdk, 'regicide_quest', 9); // >= spoken_tracker2, and past the guard spawn
        const rows = [];
        for (let i = 0; i < reps; i++) {
            await mustTele(sdk, 2231, 3149);
            // landing shows after 2 ticks, but the script holds p_delay(3) after the
            // exactmove; time until the player can act again by clicking straight back.
            const a = await cross(2232, 3148, /Dense forest/, 1, [[2234, 3149]]);
            const tBack = currentTick(sdk);
            let b: number | null = null;
            for (let k = 0; k < 8 && b === null; k++) {
                const loc = await findLoc(sdk, { x: 2232, z: 3148, name: /Dense forest/ });
                if (!loc) throw new Error('no dense forest at 2232,3148');
                await sdk.sendInteractLoc(loc.x, loc.z, loc.id, 1);
                const r = await waitUntil(sdk, at(2231, 3149), { maxTicks: 3 });
                if (r.ok) b = r.tick;
            }
            rows.push({ dir: 'W->E', ...a, backLandedAfter: b !== null ? b - tBack : null });
            await waitTicks(sdk, 6);
        }
        result('crossover', rows);
    } else if (segment === 'gate') {
        // Arandar gate (overpass_gate_left/right at 2384/2386,3334): opens if
        // %regicide_quest > 12 or the player stands south of it (z < 3334),
        // regicide_arandar_gate_guard.rs2:5. Try both sides at stage 11 and 13.
        const rows = [];
        for (const stage of [11, 13]) {
            await setvar(sdk, 'regicide_quest', stage);
            for (const [sz, side] of [[3333, 'south'], [3335, 'north']] as const) {
                await mustTele(sdk, 2385, sz);
                await waitTicks(sdk, 3);
                const gate = (await sdk.scanNearbyLocs(4)).find(l => /gate/i.test(l.name) && l.options.length > 0);
                if (!gate) { rows.push({ stage, side, error: 'gate not found' }); continue; }
                const t0 = currentTick(sdk);
                await sdk.sendInteractLoc(gate.x, gate.z, gate.id, 1);
                const r = await waitUntil(sdk, s => Math.abs((s.player?.worldZ ?? 0) - sz) >= 2 || s.dialog.isOpen, { maxTicks: 12 });
                const d = sdk.getState()!.dialog;
                rows.push({ stage, side, gate: `${gate.name}@${gate.x},${gate.z}`, ticks: r.ok ? r.tick - t0 : null, end: pos(sdk), dialog: d.isOpen ? (d.text ?? '').slice(0, 60) : '' });
                // The guard's refusal: answer it through so the next try starts clean.
                if (d.isOpen) await converse(sdk, [], { unmatched: 'first' });
            }
        }
        result('arandar-gate', rows);
    } else if (segment === 'teleport') {
        const rows = [];
        for (let i = 0; i < reps; i++) {
            await mustTele(sdk, 2257, 3151);
            await waitTicks(sdk, 2);
            const t0 = currentTick(sdk);
            await sdk.sendClickComponent(1170); // magic:falador_teleport
            const r = await waitUntil(sdk, s => Math.abs((s.player?.worldX ?? 0) - 2965) < 8 && Math.abs((s.player?.worldZ ?? 0) - 3378) < 8, { maxTicks: 20 });
            rows.push({ ticks: r.ok ? r.tick - t0 : null, end: pos(sdk), msgs: sdk.getState()?.gameMessages.slice(-2).map(m => m.text) });
        }
        result('teleport-from-isafdar', rows);
    }
}, { timeout: 900_000 });
