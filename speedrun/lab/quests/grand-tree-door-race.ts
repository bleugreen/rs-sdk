// The S11b demo failure in the lab: another player has just opened a Grand Tree door when SCORED
// reaches it (gnome_gate.rs2 open_tree_door turns that door into its open form, no ops, for 6 ticks).
//
//   LAB_RUNNERS=0 LAB_BOTS="gtrival1 gtrival2" speedrun/lab/lab.sh <bot> \
//     'speedrun/lab/quests/grand-tree-door-race.ts:--from=D:--runs=3:--launch:--rivals=gtrival1'
//
// The Grand Tree lab's flags (lab/quests/grand-tree.ts, run.ts) plus:
//   --rivals=a[,b]  lab bots that open the doors just before the segment starts, from the side SCORED is
//                   not on: the first the left door (2464,3492), the second the right one (2466,3492).
// Use a segment that reaches the door within the 6 ticks: D (out, 2 tiles from the door) or A (in, at it).
// Each run prints DOOR lines, the doors as SCORED's own client shows them, tick by tick until it is through.

import type { BotWorldState } from '../../../sdk/types';
import { closeSession, openSession, type Session } from '../../lib/session';
import { waitUntil } from '../../lib/wait';
import { findLoc, opIndex, pos } from '../../lib/world';
import { arg } from '../common';
import { leaveTutorial, mustTele } from '../setup';
import { grandTree } from './grand-tree';
import { labMain } from './run';

const OPEN = /^open$/i;
/** The two doors (map m38_54: treedoorl, treedoorr), as the module's TILES names them. */
const DOORS = [{ x: 2464, z: 3492 }, { x: 2466, z: 3492 }] as const;
/** Where each rival stands to open its door without a step: the doorway tile beside it, per side. */
const RIVAL_TILES = { outside: [{ x: 2465, z: 3491 }, { x: 2466, z: 3491 }], inside: [{ x: 2465, z: 3493 }, { x: 2466, z: 3493 }] } as const;

const names = arg('rivals', '').split(',').filter(Boolean).slice(0, 2);
if (!names.length) throw new Error('--rivals=<bot>[,<bot>] is required');
let rivals: Session[] | null = null;

const doorShowsOpen = (s: BotWorldState, d: { x: number; z: number }) => s.nearbyLocs.some(l => l.x === d.x && l.z === d.z && opIndex(l, OPEN) !== undefined);
const doorLine = (s: BotWorldState) => DOORS.map((d, i) => `${i ? 'R' : 'L'}=${doorShowsOpen(s, d) ? 'closed' : 'OPEN'}`).join(' ');

await labMain({
    ...grandTree,
    title: `${grandTree.title}, door race (${names.length} rival${names.length > 1 ? 's' : ''})`,
    async prepare(session, f) {
        await grandTree.prepare?.(session, f);
        if (!rivals) {
            rivals = [];
            for (const n of names) {
                const r = await openSession(n, { launch: true });
                await leaveTutorial(r);
                rivals.push(r);
            }
        }
        const scored = session.sdk;
        const inside = pos(scored).z >= 3493;
        const tiles = inside ? RIVAL_TILES.outside : RIVAL_TILES.inside;
        for (const [i, r] of rivals.entries()) await mustTele(r.sdk, tiles[i]!.x, tiles[i]!.z, 0);
        // An earlier run's crossing may still hold a door open.
        await waitUntil(scored, s => rivals!.every((_, i) => doorShowsOpen(s, DOORS[i]!)), { maxTicks: 10 });
        const t0 = scored.getState()!.tick;
        for (const [i, r] of rivals.entries()) {
            const door = await findLoc(r.sdk, { x: DOORS[i]!.x, z: DOORS[i]!.z, op: OPEN });
            if (!door) throw new Error(`rival ${r.name}: no door with Open at (${DOORS[i]!.x},${DOORS[i]!.z}) from ${JSON.stringify(pos(r.sdk))}`);
            await r.sdk.sendInteractLoc(door.x, door.z, door.id, opIndex(door, OPEN)!);
        }
        const opened = await waitUntil(scored, s => rivals!.every((_, i) => !doorShowsOpen(s, DOORS[i]!)), { maxTicks: 6 });
        if (!opened.ok) throw new Error(`the rivals' door clicks did not show on SCORED's client within 6 ticks (${doorLine(scored.getState()!)})`);
        const tOpen = scored.getState()!.tick;
        console.log(`RACE ${f.letter}: SCORED ${inside ? 'inside' : 'outside'} at ${JSON.stringify(pos(scored))}; rivals clicked t=${t0}, SCORED sees ${doorLine(scored.getState()!)} at t=${tOpen}`);
        let last = '';
        const off = scored.onStateUpdate(s => {
            const p = pos(s);
            const line = `${doorLine(s)} scored=${p.x},${p.z},${p.level}`;
            if (line !== last) console.log(`DOOR t=${s.tick} (+${s.tick - tOpen}) ${line}`);
            last = line;
            if ((inside ? p.z <= 3491 : p.z >= 3493) || s.tick - tOpen > 40) off();
        });
    },
});
for (const r of rivals ?? []) await closeSession(r);
process.exit(0);
