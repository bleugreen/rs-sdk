// Lab check: does an adult blue dragon take a player near it as a target, and hit it, when the
// player never attacks? The cowardly hunt (all.hunt: type=player, find_newmode=opplayer2) says it
// should within huntrange 4 (blue_dragon) once neither side has fought for 8 ticks (Npc.ts
// huntPlayers). That decides whether walking to a drop is ever safe (docs/speedrun/helpers/dragons.md).
//
//   git apply speedrun/lab/npc-target-trace.patch
//   LAB_NPC_TRACE=blue_dragon speedrun/lab/lab.sh <bot> 'speedrun/lab/measure-hunt.ts:--trials=3'
//
// Each trial teleports from the safe tile to a tile d tiles north of a living adult's footprint,
// stands there --ticks ticks (or until hit), then teleports back, heals with ::setstat and waits
// out the 8-tick combat timers. RESULT lines: TRIAL per trial (engine target, hits, distances), then
// SUMMARY. The engine's NPCTRACE lines (target, mode, hunt state per change) are read live.
import { existsSync, readFileSync } from 'node:fs';
import type { BotWorldState, NearbyNpc } from '../../sdk/types';
import { footprintDistance, SAFE_TILE, type Tile } from '../helpers/dragons';
import { openSession } from '../lib/session';
import { waitTicks } from '../lib/wait';
import { arg, botArg, result } from './common';
import { leaveTutorial, setstat, tele } from './setup';

const trials = Number(arg('trials', '3'));
const standTicks = Number(arg('ticks', '16'));
const distances = arg('distances', '6,5,4,3,2').split(',').map(Number);
const me = botArg().toLowerCase();

const session = await openSession(botArg());
const { sdk } = session;
await leaveTutorial(session);

// A combat-70 account like a demo helper at the tile: it must survive one dragonfire (max 50).
for (const [skill, lv] of [['attack', 40], ['strength', 40], ['defence', 40], ['hitpoints', 70], ['magic', 75]] as const) await setstat(sdk, skill, lv);
for (const i of sdk.getState()?.inventory ?? []) await sdk.sendDropItem(i.slot);
await sdk.sendClickComponent(151); // auto-retaliate off: the player never fights back
if (!(await tele(sdk, SAFE_TILE.x, SAFE_TILE.z))) throw new Error('tele to the safe tile failed');
await waitTicks(sdk, 20);

// ---- engine trace, read live ----
const engineLog = `${process.env.LAB_LOG ?? ''}/engine.log`;
let logOffset = existsSync(engineLog) ? readFileSync(engineLog).length : 0;
interface Trace { tick: number; nid: number; x: number; z: number; sx: number; sz: number; target: string | null; op: number; hunt: number; active: boolean }
function newTraces(): Trace[] {
    if (!existsSync(engineLog)) return [];
    const buf = readFileSync(engineLog);
    const text = buf.subarray(logOffset).toString();
    logOffset = buf.length;
    return text.split('\n').filter(l => l.startsWith('NPCTRACE ')).map(l => JSON.parse(l.slice(9)) as Trace);
}
result('engine trace', { engineLog, present: existsSync(engineLog), traces: newTraces().length });

const pos = (s: BotWorldState | null | undefined): Tile => ({ x: s?.player?.worldX ?? 0, z: s?.player?.worldZ ?? 0 });
const sw = (n: NearbyNpc): Tile => ({ x: n.tileX ?? n.x, z: n.tileZ ?? n.z });
const adults = () => (sdk.getState()?.nearbyNpcs ?? []).filter(n => /^blue dragon$/i.test(n.name) && n.hp !== 0);

const outcomes: { d: number; targeted: boolean; hit: boolean }[] = [];
for (const d of distances) {
    for (let t = 0; t < trials; t++) {
        const adult = adults()[t % Math.max(1, adults().length)];
        if (!adult) { result('no adult in view', { d, t }); await waitTicks(sdk, 10); continue; }
        const a = sw(adult);
        const tile = { x: a.x + 1, z: a.z + 3 + d }; // d tiles north of the footprint's top row
        newTraces();
        await tele(sdk, tile.x, tile.z);
        const start = sdk.getState()?.tick ?? 0;
        const hpStart = sdk.getState()?.player?.hp ?? 0;
        let lastHp = hpStart;
        const hits: { tick: number; lost: number }[] = [];
        const targetedBy = new Map<number, number>();
        const samples: unknown[] = [];
        for (let k = 0; k < standTicks; k++) {
            await waitTicks(sdk, 1);
            const s = sdk.getState();
            const hp = s?.player?.hp ?? 0;
            if (hp < lastHp) hits.push({ tick: s?.tick ?? 0, lost: lastHp - hp });
            lastHp = hp;
            for (const tr of newTraces()) if (tr.target?.toLowerCase() === me && !targetedBy.has(tr.nid)) targetedBy.set(tr.nid, tr.tick);
            samples.push({ tick: s?.tick, at: pos(s), hp, adults: adults().map(n => ({ i: n.index, sw: sw(n), d: footprintDistance(pos(s), sw(n), 4), target: n.targetIndex, inCombat: n.inCombat })) });
            if (hits.length || hp < 40) break;
        }
        await tele(sdk, SAFE_TILE.x, SAFE_TILE.z);
        const o = { d, targeted: targetedBy.size > 0, hit: hits.length > 0 };
        outcomes.push(o);
        result('TRIAL', { ...o, trial: t, adult: { index: adult.index, sw: a }, tile, standFrom: start, hits, targetedBy: [...targetedBy].map(([nid, tick]) => ({ nid, tick, after: tick - start })), samples });
        await setstat(sdk, 'hitpoints', 70);
        await waitTicks(sdk, 25); // the hunt's 8-tick combat checks and the dragon's reset
    }
}
const by = distances.map(d => ({ d, trials: outcomes.filter(o => o.d === d).length, targeted: outcomes.filter(o => o.d === d && o.targeted).length, hit: outcomes.filter(o => o.d === d && o.hit).length }));
result('SUMMARY', { by });
process.exit(0);
