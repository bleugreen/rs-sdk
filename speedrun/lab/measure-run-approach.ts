// The run toggle and an interaction approach (lib/run-mode.ts):
//   speedrun/lab/lab.sh srlab1 speedrun/lab/measure-run-approach.ts:--n=3
//
// From one start tile, op-click the same tree 8-15 tiles away ("Chop down";
// no axe needed, only the approach is measured) with the toggle off, then on,
// `n` times each. An op-click carries no ctrl-run flag, so the toggle alone
// decides the pace: about N ticks for N tiles walking, about N/2 running.
// Reported per attempt: ticks from the click's tick to the tick of the last
// step, and the tiles stepped (summed per tick, so detours count).

import type { BotWorldState, NearbyLoc } from '../../sdk/types';
import { ensureRun, ensureRunOn, runIsOn } from '../lib/run-mode';
import { closeSession, openSession } from '../lib/session';
import { waitTicks, waitUntil } from '../lib/wait';
import { onTutorialIsland } from '../lib/world';
import { arg, botArg, result } from './common';
import { tele } from './setup';

const n = Number(arg('n', '3'));
/** Start tiles to try, in order, until one has a tree 8-15 tiles away. */
const STARTS = [
    { x: 3175, z: 3232 },
    { x: 3190, z: 3245 },
    { x: 3222, z: 3240 },
    { x: 3160, z: 3220 },
];

const session = await openSession(botArg(), { pathfinding: false });
const { sdk } = session;
if (onTutorialIsland(sdk.getState()?.player)) {
    const r = await session.bot.skipTutorial();
    if (!r.success) throw new Error(`skipTutorial: ${r.message}`);
    await waitTicks(sdk, 5);
    await ensureRunOn(sdk);
}

const chop = (l: NearbyLoc) => l.optionsWithIndex.find(o => /chop/i.test(o.text));
let start: { x: number; z: number } | null = null;
let tree: NearbyLoc | null = null;
for (const s of STARTS) {
    if (!(await tele(sdk, s.x, s.z))) continue;
    await waitTicks(sdk, 3);
    const here = sdk.getState()!.player!;
    const far = sdk.getState()!.nearbyLocs
        .filter(l => chop(l))
        .map(l => ({ l, d: Math.max(Math.abs(l.x - here.worldX), Math.abs(l.z - here.worldZ)) }))
        .filter(c => c.d >= 8 && c.d <= 15)
        .sort((a, b) => b.d - a.d)[0];
    if (far) {
        start = { x: here.worldX, z: here.worldZ };
        tree = far.l;
        break;
    }
}
if (!start || !tree) throw new Error('no tree 8-15 tiles from any start tile');
const op = chop(tree)!.opIndex;
result('setup', { start, tree: { name: tree.name, id: tree.id, x: tree.x, z: tree.z }, chebyshev: Math.max(Math.abs(tree.x - start.x), Math.abs(tree.z - start.z)) });

interface Approach { mode: 'walk' | 'run'; ticks: number; tiles: number; stepTicks: number; toggle: boolean | null }

async function approach(running: boolean): Promise<Approach> {
    await tele(sdk, start!.x, start!.z);
    await waitTicks(sdk, 3);
    await ensureRun(sdk, running);
    await waitTicks(sdk, 1);
    const s0 = sdk.getState()!;
    let last = { x: s0.player!.worldX, z: s0.player!.worldZ };
    let lastMoveTick = s0.tick;
    let tiles = 0;
    let stepTicks = 0;
    const track = (s: BotWorldState) => {
        const p = s.player;
        if (!p) return;
        const d = Math.max(Math.abs(p.worldX - last.x), Math.abs(p.worldZ - last.z));
        if (d > 0) {
            tiles += d;
            stepTicks++;
            lastMoveTick = s.tick;
            last = { x: p.worldX, z: p.worldZ };
        }
    };
    const unsub = sdk.onStateUpdate(track);
    await sdk.sendInteractLoc(tree!.x, tree!.z, tree!.id, op);
    // Done once the player has moved and then stood still for 4 ticks.
    await waitUntil(sdk, s => tiles > 0 && s.tick - lastMoveTick >= 4, { maxTicks: 60, after: s0.tick });
    unsub();
    return { mode: running ? 'run' : 'walk', ticks: lastMoveTick - s0.tick, tiles, stepTicks, toggle: runIsOn(s0) };
}

const rows: Approach[] = [];
for (let i = 0; i < n; i++) {
    for (const running of [false, true]) {
        const a = await approach(running);
        rows.push(a);
        result('approach', a);
    }
}
for (const mode of ['walk', 'run'] as const) {
    const m = rows.filter(r => r.mode === mode);
    const mean = (f: (r: Approach) => number) => +(m.reduce((s, r) => s + f(r), 0) / m.length).toFixed(2);
    result(`summary ${mode}`, { n: m.length, ticks: mean(r => r.ticks), tiles: mean(r => r.tiles), tilesPerTick: +(mean(r => r.tiles) / mean(r => r.ticks)).toFixed(2) });
}
await ensureRunOn(sdk);
await closeSession(session);
process.exit(0);
