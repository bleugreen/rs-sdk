// Doors, gates, trapdoors, ladders and stairs: ticks from click to effect,
// standing next to the loc and from a few tiles away (walk-to included).
// Run: bun docs/speedrun/scripts/quest-primitives-locs.ts <botname>
//
// Effects are observed in published state: a climb is a position/level change
// (PLAYER_INFO), a door opening is a loc change, which the stock lite client
// publishes one tick late (it publishes on PLAYER_INFO, before the tick's zone
// updates are decoded).

import { runScript } from '../../../sdk/runner';
import type { BotSDK } from '../../../sdk/index';
import type { BotWorldState, NearbyLoc } from '../../../sdk/types';
import { mustTele } from '../../../speedrun/lab/setup';
import { result, stats } from '../../../speedrun/lab/record';
import { currentTick, waitTicks, waitUntil } from '../../../speedrun/lib/wait';
import { chebyshev, locMatches, opIndex, pos, type Tile } from '../../../speedrun/lib/world';

/**
 * The nearest published loc offering `op`, within 2 tiles of `near` when
 * given: an opened door swings off its tile and a trapdoor changes id, so the
 * effect is judged on a small window rather than one tile. Synchronous on a
 * published state, for use inside a wait predicate.
 */
function locNear(s: BotWorldState, name: RegExp, op: RegExp, near?: { x: number; z: number }): NearbyLoc | undefined {
    return s.nearbyLocs
        .filter(l => locMatches(l, { name, op }) && (!near || chebyshev(l, near) <= 2))
        .sort((a, b) => a.distance - b.distance)[0];
}

/** One raw click: the primitive being timed. */
async function clickLoc(sdk: BotSDK, loc: NearbyLoc, op: RegExp) {
    await sdk.sendInteractLoc(loc.x, loc.z, loc.id, opIndex(loc, op)!);
}

/** Click `op` on the loc and time until `done` holds. */
async function timeLoc(sdk: BotSDK, start: { x: number; z: number; level?: number }, name: RegExp, op: RegExp, done: (s: BotWorldState, p0: Tile) => boolean, near?: { x: number; z: number }) {
    await mustTele(sdk, start.x, start.z, start.level ?? 0);
    await waitTicks(sdk, 2);
    const s0 = sdk.getState()!;
    const loc = locNear(s0, name, op, near);
    if (!loc) return { error: `no ${name} with ${op} near ${JSON.stringify(start)}` };
    const p0 = pos(s0);
    const t0 = currentTick(sdk);
    await clickLoc(sdk, loc, op);
    const r = await waitUntil(sdk, s => done(s, p0), { maxTicks: 40 });
    return { loc: `${loc.name}@${loc.x},${loc.z}`, dist: loc.distance, ticks: r.ok ? r.tick - t0 : null, end: pos(r.ok ? r.state : sdk) };
}

const levelChanged = (s: BotWorldState, p0: Tile) => pos(s).level !== p0.level || Math.abs(pos(s).z - p0.z) > 1000;

await runScript(async ({ sdk }) => {
    const out: Record<string, unknown[]> = {};
    const rec = (k: string, v: unknown) => { (out[k] ??= []).push(v); console.log(k, JSON.stringify(v)); };

    // Lumbridge castle kitchen trapdoor (3209,3216): Open, then Climb-down to the cellar.
    const TRAP = { x: 3209, z: 3216 };
    for (const start of [{ x: 3210, z: 3216 }, { x: 3210, z: 3212 }]) {
        for (let i = 0; i < 2; i++) {
            // make sure it is closed: a fresh open trapdoor resets itself after a while; just try both
            await mustTele(sdk, start.x, start.z);
            await waitTicks(sdk, 2);
            const closed = locNear(sdk.getState()!, /trapdoor/i, /^open$/i, TRAP);
            if (closed) {
                const t0 = currentTick(sdk);
                await clickLoc(sdk, closed, /^open$/i);
                const r = await waitUntil(sdk, st => !!locNear(st, /trapdoor/i, /climb-down/i, TRAP), { maxTicks: 30 });
                rec('trapdoor.open', { from: start, ticks: r.ok ? r.tick - t0 : null });
                await mustTele(sdk, start.x, start.z);
                await waitTicks(sdk, 1);
            }
            rec('trapdoor.climbDown', await timeLoc(sdk, start, /trapdoor/i, /climb-down/i, levelChanged, TRAP));
            // cellar ladder back up
            const p = pos(sdk);
            rec('ladder.climbUp', await timeLoc(sdk, { x: p.x, z: p.z }, /ladder/i, /climb-up/i, levelChanged));
        }
    }

    // Lumbridge castle spiral staircase, ground floor (3205,3208 area): Climb-up, then Climb-down from level 1.
    for (const start of [{ x: 3206, z: 3210 }, { x: 3210, z: 3210 }]) {
        for (let i = 0; i < 2; i++) {
            rec('stairs.climbUp', await timeLoc(sdk, start, /staircase/i, /climb-up/i, levelChanged));
            const p = pos(sdk);
            rec('stairs.climbDown', await timeLoc(sdk, { x: p.x, z: p.z, level: p.level }, /staircase/i, /climb-down/i, levelChanged));
        }
    }

    // Doors and gates near Lumbridge: open alone, then full pass-through by bot.walkTo vs the same walk when open.
    const DOORS = [
        { tag: 'door', name: /^door$/i, scanFrom: { x: 3222, z: 3218 } },
        { tag: 'gate', name: /gate/i, scanFrom: { x: 3236, z: 3295 } },
    ];
    for (const d of DOORS) {
        await mustTele(sdk, d.scanFrom.x, d.scanFrom.z);
        await waitTicks(sdk, 3);
        const loc = locNear(sdk.getState()!, d.name, /^open$/i);
        if (!loc) { rec(`${d.tag}.error`, 'none found'); continue; }
        const L = { x: loc.x, z: loc.z };
        console.log(d.tag, 'using', loc.name, L, loc.optionsWithIndex.map(o => o.text));
        for (let i = 0; i < 3; i++) {
            await mustTele(sdk, d.scanFrom.x, d.scanFrom.z);
            await waitTicks(sdk, 2);
            const c = locNear(sdk.getState()!, d.name, /^open$/i, L);
            if (!c) { await waitTicks(sdk, 10); continue; }
            const t0 = currentTick(sdk);
            const p0 = pos(sdk);
            await clickLoc(sdk, c, /^open$/i);
            const r = await waitUntil(sdk, st => !locNear(st, d.name, /^open$/i, L), { maxTicks: 40 });
            const p1 = pos(r.ok ? r.state : sdk);
            rec(`${d.tag}.open`, { loc: L, startDist: c.distance, from: p0, standAt: p1, ticks: r.ok ? r.tick - t0 : null });
            // close it again for the next round
            const o = locNear(sdk.getState()!, d.name, /^close$/i);
            if (o) { await clickLoc(sdk, o, /^close$/i); await waitTicks(sdk, 3); }
        }
    }
    for (const [k, v] of Object.entries(out)) {
        const ticks = (v as any[]).map(x => x?.ticks).filter((x: any) => typeof x === 'number');
        result(`locs.${k}`, { samples: v, ticks: stats(ticks) });
    }
}, { timeout: 600_000 });
