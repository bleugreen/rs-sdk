// Per-landing-tile ticks for the teleport legs L24c (Varrock teleport, walk-on to 3211,3425) and
// T21-22 (Lumbridge teleport, run to 3241,3248), through runLeg as the run casts them. The tables
// in docs/speedrun/research/run-transitions.md section 10 come from this script.
//
//   WEB_PORT=9780 WEB_MANAGEMENT_PORT=9781 HISCORES_WEB_PORT=9782 NODE_PORT=44780 AGENT_PORT=8780 \
//     NODE_TICKRATE=300 bash speedrun/lab/lab.sh <bot> 'speedrun/lab/measure-landings.ts:<L24c,T21-22>:<casts>'
//
// Each cast starts from START, outside both landing squares: runLeg resumes at the first hop the
// player is not yet past, so a cast started inside a teleport's own landing square skips the
// teleport and times only the walk. One `RESULT cast {...}` line per cast (landing tile, ticks,
// cast and walk ticks), then `RESULT table` per leg: per-tile means, the mean over casts (the
// engine's own landing distribution) and the mean over the tiles seen.

import { runScript } from '../../sdk/runner';
import { legById, runLeg } from '../runner/legs';
import { SPELLS } from '../lib/travel';
import { waitTicks, waitUntil } from '../lib/wait';
import { give, mustTele, setStats } from './setup';

const [, , , idsArg = 'L24c,T21-22', castsArg = '40'] = process.argv;
const casts = Number(castsArg);
/** Draynor: inside neither landing square nor either leg's end, so runLeg never skips the teleport. */
const START = { x: 3093, z: 3243 };
const result = (name: string, v: unknown) => console.log(`RESULT ${name} ${JSON.stringify(v)}`);

await runScript(async ({ bot, sdk }) => {
    const island = () => { const p = sdk.getState()?.player; return !!p && p.worldX > 3040 && p.worldX < 3160 && p.worldZ > 3040 && p.worldZ < 3140; };
    if (island()) { await bot.skipTutorial(); await waitUntil(sdk, () => !island(), { maxTicks: 40 }); }
    await setStats(sdk, { magic: 99, hitpoints: 99 });
    await give(sdk, 'airrune', 1000); await give(sdk, 'lawrune', 500); await give(sdk, 'earthrune', 500); await give(sdk, 'firerune', 500);
    for (const id of idsArg.split(',')) {
        const leg = legById(id);
        const spell = leg.def.hops[0]!.kind === 'teleport' ? (leg.def.hops[0] as { spell: keyof typeof SPELLS }).spell : null;
        if (!spell) throw new Error(`${id} does not open with a teleport`);
        const landingArea = SPELLS[spell].landing;
        const rows: Array<{ tile: string; ticks: number; cast: number; walk: number }> = [];
        for (let c = 0; c < casts; c++) {
            try {
                await mustTele(sdk, START.x, START.z, 0);
                await waitTicks(sdk, 2);
                // Assigned only in the state callback, so the initialiser carries the full type: a plain
                // `= null` narrows `landed` to null for the compiler, and to never at the read below.
                let landed = null as { x: number; z: number } | null;
                const off = sdk.onStateUpdate(s => {
                    const p = s.player;
                    if (!landed && p && Math.abs(p.worldX - landingArea.x) <= (landingArea.tol ?? 2) && Math.abs(p.worldZ - landingArea.z) <= (landingArea.tol ?? 2) && (Math.abs(p.worldX - START.x) > 5 || Math.abs(p.worldZ - START.z) > 5)) landed = { x: p.worldX, z: p.worldZ };
                });
                const r = await runLeg(leg.def, { sdk, bot });
                off();
                if (!r) throw new Error('already at the destination');
                const tile = landed ? `${landed.x},${landed.z}` : '?';
                const row = { tile, ticks: r.ticks, cast: r.segments[0]?.ticks ?? -1, walk: r.segments[1]?.ticks ?? -1 };
                rows.push(row);
                result('cast', { id, c, ...row, clicks: r.clicks, ok: r.ok });
            } catch (e) {
                result('cast', { id, c, error: e instanceof Error ? e.message : String(e) });
            }
        }
        const by = new Map<string, number[]>();
        for (const r of rows) by.set(r.tile, [...(by.get(r.tile) ?? []), r.ticks]);
        const tiles = [...by.entries()].sort().map(([tile, t]) => ({ tile, n: t.length, mean: Math.round((t.reduce((a, b) => a + b, 0) / t.length) * 10) / 10, min: Math.min(...t), max: Math.max(...t) }));
        const all = rows.map(r => r.ticks);
        const tileMeans = tiles.map(t => t.mean);
        result('table', { id, spell, casts: rows.length, tilesSeen: tiles.length, meanOverCasts: Math.round((all.reduce((a, b) => a + b, 0) / all.length) * 100) / 100, meanOverTiles: Math.round((tileMeans.reduce((a, b) => a + b, 0) / tileMeans.length) * 100) / 100, min: Math.min(...all), max: Math.max(...all), castTicks: [...new Set(rows.map(r => r.cast))], tiles });
    }
}, { timeout: 3600_000, printState: false });
