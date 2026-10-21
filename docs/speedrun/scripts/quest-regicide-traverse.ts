// Walk a whole Isafdar leg end to end on the live server, following the route
// from quest-regicide-graph.ts (walking stretches plus scripted crossings), and
// time it. Any dialogue that opens on the way (Idris at stage 2) is answered.
//
//   bun docs/speedrun/scripts/quest-regicide-traverse.ts <bot> <leg> [agility] [runs]
//
// Legs (from -> to, stage used, cross-overs allowed?):
//   e1-first   temple exit -> Lord Iorwerth, stage 2 (Idris interrupts), no cross-overs
//   iorwerth-tracker / tracker-iorwerth   stage 4, no cross-overs
//   camp-iorwerth   inside Tyras's camp -> Iorwerth, stage 10, cross-overs
//   e2-guard   temple exit -> lazy guard, stage 11, cross-overs
//   e2-back    catapult landing -> Iorwerth, stage 12, cross-overs
//
// Walking: clicks a route tile at most 10 tiles ahead and re-clicks within 3
// tiles of it, so the client's own routefinder (which does not know the trap
// tiles) cannot wander onto a pitfall or a woodspring trigger.

import { runScript } from '../../../sdk/runner';
import { points, solve, type Crossing } from './quest-regicide-graph';
import { routeTiles } from './quest-regicide-routes';
import { findLoc, getVar, now, pos, result, setStats, setVar, talkThrough, tele, waitTicks, waitUntil } from './quest-regicide-lab';

type P = [number, number];
const [leg, agiArg, runsArg] = process.argv.slice(3);
const agility = Number(agiArg ?? 56);
const runs = Number(runsArg ?? 1);

const LEGS: Record<string, { from: P; to: P; stage: number; x: boolean; viaExit?: boolean }> = {
    'e1-first': { from: points.templeExit, to: points.iorwerth, stage: 2, x: false, viaExit: true },
    'iorwerth-tracker': { from: points.iorwerth, to: points.tracker, stage: 4, x: false },
    'tracker-iorwerth': { from: points.tracker, to: points.iorwerth, stage: 5, x: false },
    'camp-iorwerth': { from: points.tyrasCampInside, to: points.iorwerth, stage: 10, x: true },
    'e2-guard': { from: points.templeExit, to: points.lazyGuard, stage: 11, x: true, viaExit: true },
    'e2-back': { from: points.catapultLanding, to: points.iorwerth, stage: 12, x: true },
};
const LOG_LOC: Record<string, [number, number, number]> = {
    '2196,3237': [2197, 3237, 3931], '2202,3237': [2201, 3237, 3931],
    '2258,3250': [2259, 3250, 3932], '2264,3250': [2263, 3250, 3932],
    '2290,3232': [2290, 3233, 3933], '2290,3239': [2290, 3238, 3933],
};

await runScript(async ({ sdk }) => {
    const spec = LEGS[leg];
    if (!spec) throw new Error(`unknown leg ${leg}`);
    const route = solve(spec.from, spec.to, spec.x);
    if (!route) throw new Error('no route');
    await setStats(sdk, { agility, hitpoints: 99 });
    const here = () => pos(sdk.getState());
    const isAt = (p: P) => here().x === p[0] && here().z === p[1];
    let dialoguePages = 0, dialogueTicks = 0;
    const handleDialog = async () => {
        if (!sdk.getState()!.dialog.isOpen) return false;
        const t = now(sdk);
        for (let k = 0; k < 6; k++) {
            const d = await talkThrough(sdk, [/./], { settleTicks: 3 });
            if (d.pages + d.options === 0) break;
            dialoguePages += d.pages + d.options;
            // the Idris ambush opens a second batch a few ticks later
            const more = await waitUntil(sdk, s => s.dialog.isOpen, 8);
            if (!more) break;
        }
        dialogueTicks += now(sdk) - t;
        return true;
    };

    const walkTo = async (dest: P) => {
        const r = routeTiles(0, here().x, here().z, dest[0], dest[1]);
        const tiles = r.tiles;
        if (tiles.length === 0) return;
        let idx = 0;
        let stuck = 0;
        for (let guard = 0; guard < 200 && !isAt(dest); guard++) {
            if (await handleDialog()) continue;
            const p = here();
            // advance idx to the route tile we are on (or nearest ahead)
            for (let j = idx; j < tiles.length; j++) if (tiles[j][0] === p.x && tiles[j][1] === p.z) { idx = j + 1; break; }
            const tgt = tiles[Math.min(idx + 9, tiles.length - 1)];
            await sdk.sendWalk(tgt[0], tgt[1], true);
            const moved = await waitUntil(sdk, s => {
                const q = pos(s);
                if (s.dialog.isOpen) return true;
                return Math.max(Math.abs(q.x - tgt[0]), Math.abs(q.z - tgt[1])) <= 3 || (q.x === dest[0] && q.z === dest[1]);
            }, 12);
            if (!moved) { stuck++; if (stuck > 6) throw new Error(`stuck walking at ${JSON.stringify(here())} toward ${tgt}`); } else stuck = 0;
        }
    };

    const crossOnce = async (c: Crossing, start: P, end: P) => {
        let lx: number, lz: number, id: number | undefined;
        if (c.kind === 'log') { [lx, lz, id] = LOG_LOC[`${start[0]},${start[1]}`]; }
        else if (c.kind === 'pitfall') { lx = start[0] + Math.sign(end[0] - start[0]); lz = start[1] + Math.sign(end[1] - start[1]); }
        else { const m = c.note.match(/\((\d+),(\d+)\)/)!; lx = Number(m[1]); lz = Number(m[2]); }
        if (id === undefined) {
            const loc = await findLoc(sdk, lx, lz);
            if (!loc) throw new Error(`no loc at ${lx},${lz} for ${c.note}`);
            id = loc.id;
        }
        await sdk.sendInteractLoc(lx, lz, id, 1);
        return waitUntil(sdk, () => isAt(end), 12);
    };

    const out = [];
    for (let run = 0; run < runs; run++) {
        await setVar(sdk, 'regicide_quest', spec.stage);
        await setVar(sdk, 'regicide_bits', 0);
        await setStats(sdk, { hitpoints: 99 });
        if (spec.viaExit) {
            await tele(sdk, 2313, 9623, 0);
            await waitTicks(sdk, 2);
            const exit = await findLoc(sdk, 2312, 9623);
            await sdk.sendInteractLoc(2312, 9623, exit!.id, 1);
            await waitUntil(sdk, s => (s.player?.worldZ ?? 9999) < 4000, 15);
        } else {
            await tele(sdk, spec.from[0], spec.from[1], 0);
            await waitTicks(sdk, 2);
        }
        dialoguePages = 0; dialogueTicks = 0;
        const t0 = now(sdk);
        const counts: Record<string, number> = {};
        const crossTicks: Array<[string, number]> = [];
        let woodFails = 0;
        for (const step of route.steps) {
            const end: P = step.at.split(',').map(Number) as P;
            if (step.how === 'walk') { await walkTo(end); continue; }
            const c = step.cross!;
            const start = step.start!;
            if (!isAt(start)) await walkTo(start);
            const tc = now(sdk);
            let ok = null;
            for (let a = 0; a < 15 && !ok; a++) {
                if (await handleDialog()) { if (!isAt(start)) await walkTo(start); }
                const hp0 = sdk.getState()!.player!.hp;
                ok = await crossOnce(c, start, step.end!);
                if (!ok) {
                    if (sdk.getState()!.player!.hp < hp0 && c.kind === 'woodspring') woodFails++;
                    await waitTicks(sdk, 1);
                    if (!isAt(start) && !isAt(step.end!)) await walkTo(start);
                }
            }
            if (!ok) throw new Error(`failed to cross ${c.note}`);
            counts[c.kind] = (counts[c.kind] ?? 0) + 1;
            crossTicks.push([c.kind, now(sdk) - tc]);
        }
        const total = now(sdk) - t0;
        const r = { leg, run, agility, routeTiles: route.tiles, crossings: counts, total, dialoguePages, dialogueTicks, woodspringFails: woodFails, crossTicks, stage: await getVar(sdk, 'regicide_quest') };
        out.push(r);
        result('traverse', r);
    }
}, { timeout: 1_800_000 });
