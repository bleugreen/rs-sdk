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
import { at, now, pos, result, stats, tele, waitTicks, waitUntil } from './quest-primitives-lib';

function findLoc(s: BotWorldState, name: RegExp, op: RegExp, near?: { x: number; z: number }): NearbyLoc | undefined {
    return s.nearbyLocs
        .filter(l => name.test(l.name) && l.optionsWithIndex.some(o => op.test(o.text)))
        .filter(l => !near || (Math.abs(l.x - near.x) <= 2 && Math.abs(l.z - near.z) <= 2))
        .sort((a, b) => a.distance - b.distance)[0];
}

async function clickLoc(sdk: BotSDK, loc: NearbyLoc, op: RegExp) {
    const o = loc.optionsWithIndex.find(x => op.test(x.text))!;
    await sdk.sendInteractLoc(loc.x, loc.z, loc.id, o.opIndex);
}

/** Click `op` on the loc and time until `done` holds. */
async function timeLoc(sdk: BotSDK, start: { x: number; z: number; level?: number }, name: RegExp, op: RegExp, done: (s: BotWorldState, p0: ReturnType<typeof pos>) => boolean, near?: { x: number; z: number }) {
    await tele(sdk, start.x, start.z, start.level ?? 0);
    await waitTicks(sdk, 2);
    const s0 = sdk.getState()!;
    const loc = findLoc(s0, name, op, near);
    if (!loc) return { error: `no ${name} with ${op} near ${JSON.stringify(start)}` };
    const p0 = pos(s0);
    const t0 = now(sdk);
    await clickLoc(sdk, loc, op);
    const r = await waitUntil(sdk, s => done(s, p0), 40);
    return { loc: `${loc.name}@${loc.x},${loc.z}`, dist: loc.distance, ticks: r ? r.tick - t0 : null, end: pos(r?.state ?? sdk.getState()) };
}

const moved = (s: BotWorldState, p0: ReturnType<typeof pos>) => { const p = pos(s); return p.level !== p0.level || Math.abs(p.z - p0.z) > 1000 || Math.abs(p.x - p0.x) + Math.abs(p.z - p0.z) > 2; };
const levelChanged = (s: BotWorldState, p0: ReturnType<typeof pos>) => pos(s).level !== p0.level || Math.abs(pos(s).z - p0.z) > 1000;

await runScript(async ({ bot, sdk }) => {
    const out: Record<string, unknown[]> = {};
    const rec = (k: string, v: unknown) => { (out[k] ??= []).push(v); console.log(k, JSON.stringify(v)); };

    // Lumbridge castle kitchen trapdoor (3209,3216): Open, then Climb-down to the cellar.
    const TRAP = { x: 3209, z: 3216 };
    for (const start of [{ x: 3210, z: 3216 }, { x: 3210, z: 3212 }]) {
        for (let i = 0; i < 2; i++) {
            // make sure it is closed: a fresh open trapdoor resets itself after a while; just try both
            await tele(sdk, start.x, start.z);
            await waitTicks(sdk, 2);
            let s = sdk.getState()!;
            const closed = findLoc(s, /trapdoor/i, /^open$/i, TRAP);
            if (closed) {
                const t0 = now(sdk);
                await clickLoc(sdk, closed, /^open$/i);
                const r = await waitUntil(sdk, st => !!findLoc(st, /trapdoor/i, /climb-down/i, TRAP), 30);
                rec('trapdoor.open', { from: start, ticks: r ? r.tick - t0 : null });
                await tele(sdk, start.x, start.z);
                await waitTicks(sdk, 1);
            }
            rec('trapdoor.climbDown', await timeLoc(sdk, start, /trapdoor/i, /climb-down/i, levelChanged, TRAP));
            // cellar ladder back up
            const p = pos(sdk.getState());
            rec('ladder.climbUp', await timeLoc(sdk, { x: p.x, z: p.z }, /ladder/i, /climb-up/i, levelChanged));
        }
    }

    // Lumbridge castle spiral staircase, ground floor (3205,3208 area): Climb-up, then Climb-down from level 1.
    for (const start of [{ x: 3206, z: 3210 }, { x: 3210, z: 3210 }]) {
        for (let i = 0; i < 2; i++) {
            rec('stairs.climbUp', await timeLoc(sdk, start, /staircase/i, /climb-up/i, levelChanged));
            const p = pos(sdk.getState());
            rec('stairs.climbDown', await timeLoc(sdk, { x: p.x, z: p.z, level: p.level }, /staircase/i, /climb-down/i, levelChanged));
        }
    }

    // Doors and gates near Lumbridge: open alone, then full pass-through by bot.walkTo vs the same walk when open.
    const DOORS = [
        { tag: 'door', name: /^door$/i, scanFrom: { x: 3222, z: 3218 } },
        { tag: 'gate', name: /gate/i, scanFrom: { x: 3236, z: 3295 } },
    ];
    for (const d of DOORS) {
        await tele(sdk, d.scanFrom.x, d.scanFrom.z);
        await waitTicks(sdk, 3);
        const loc = findLoc(sdk.getState()!, d.name, /^open$/i);
        if (!loc) { rec(`${d.tag}.error`, 'none found'); continue; }
        const L = { x: loc.x, z: loc.z };
        console.log(d.tag, 'using', loc.name, L, loc.optionsWithIndex.map(o => o.text));
        for (let i = 0; i < 3; i++) {
            await tele(sdk, d.scanFrom.x, d.scanFrom.z);
            await waitTicks(sdk, 2);
            const c = findLoc(sdk.getState()!, d.name, /^open$/i, L);
            if (!c) { await waitTicks(sdk, 10); continue; }
            const t0 = now(sdk);
            const p0 = pos(sdk.getState());
            await clickLoc(sdk, c, /^open$/i);
            const r = await waitUntil(sdk, st => !findLoc(st, d.name, /^open$/i, L), 40);
            const p1 = pos(r?.state ?? sdk.getState());
            rec(`${d.tag}.open`, { loc: L, startDist: c.distance, from: p0, standAt: p1, ticks: r ? r.tick - t0 : null });
            // close it again for the next round
            const o = findLoc(sdk.getState()!, d.name, /^close$/i);
            if (o) { await clickLoc(sdk, o, /^close$/i); await waitTicks(sdk, 3); }
        }
    }
    for (const [k, v] of Object.entries(out)) {
        const ticks = (v as any[]).map(x => x?.ticks).filter((x: any) => typeof x === 'number');
        result(`locs.${k}`, { samples: v, ticks: stats(ticks) });
    }
}, { timeout: 600_000 });
