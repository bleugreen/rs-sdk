// In-page packet latency probe: the host gate's walk trial (speedrun/lib/hostgate.ts
// `probeOnTime`), issued from the decoded-tick hook instead of through the gateway.
//
// On a fresh label c the player walks one tile. The server processes the walk and
// steps the player in the same tick, so the new position shows at label c+1 if the
// packet made it and at c+2 or later if it was late. Trials alternate between the
// start tile and a neighbour, each sent on the label that showed the previous step,
// and the probe ends on the tile it started from. Latency 1 on every trial is what a
// reactive program needs from the page; this measures exactly that path.
//
// The result carries the raw per-trial latencies; speedrun/lib turns them into the
// gate's summary (summarizeProbe) so both paths are read by one function.

import type { ProgramParams, TickProgram } from './types.js';
import { num } from './util.js';

const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export interface InPageProbeResult {
    path: 'in-page';
    trials: number;
    /** Per counted trial: label of the step minus label sent (1 = on time; maxWait+1 = lost). */
    latencies: number[];
    onTime: number;
    lost: number;
    /** Trials per latency, e.g. {1: 60}. */
    counts: Record<number, number>;
    /** Labels from the probe's start to its end. */
    ticks: number;
    /** Wall ms between consecutive decoded ticks while probing. */
    tickMs: number[];
    home: [number, number];
    reason?: string;
}

export function createProbe(params: ProgramParams): TickProgram {
    const trials = num(params.trials, 20, 'trials');
    const maxWait = num(params.maxWait, 8, 'maxWait');
    const dirs = params.dirs === undefined
        ? [...NEIGHBOURS]
        : (params.dirs as unknown[]).map(d => {
            if (!Array.isArray(d) || d.length !== 2) throw new Error('dirs must be [[dx, dz], ...]');
            return [Number(d[0]), Number(d[1])] as const;
        });

    let home: [number, number] | null = null;
    let startTick = 0;
    let dir = 0;
    let dirProven = false; // a step toward or from the current neighbour has been seen
    let lost = 0;
    let returning = false;
    let pending: { label: number; from: string } | null = null;
    let lastMs = 0;
    const latencies: number[] = [];
    const tickMs: number[] = [];

    const result = (endTick: number, reason?: string): InPageProbeResult => {
        const counts: Record<number, number> = {};
        for (const l of latencies) counts[l] = (counts[l] ?? 0) + 1;
        return {
            path: 'in-page',
            trials: latencies.length,
            latencies: [...latencies],
            onTime: latencies.filter(l => l <= 1).length,
            lost,
            counts,
            ticks: endTick - startTick,
            tickMs: [...tickMs],
            home: home ?? [0, 0],
            ...(reason ? { reason } : {})
        };
    };
    let lastTick = 0;

    return {
        snapshot: () => result(lastTick, 'stopped'),
        onTick(ctx) {
            const s = ctx.state;
            lastTick = ctx.tick;
            if (!s.player) return ctx.fault('not in game');
            if (!home) {
                home = [s.player.worldX, s.player.worldZ];
                startTick = ctx.tick;
                lastMs = ctx.nowMs;
            } else {
                tickMs.push(Math.round(ctx.nowMs - lastMs));
                lastMs = ctx.nowMs;
            }
            const homeKey = `${home[0]},${home[1]}`;
            const pos = `${s.player.worldX},${s.player.worldZ}`;
            const walk = (x: number, z: number) => {
                if (ctx.send({ type: 'walkTo', x, z, running: false }, `walk ${x},${z}`)) pending = { label: ctx.tick, from: pos };
                else pending = null;
            };
            if (pending) {
                const dt = ctx.tick - pending.label;
                if (pos !== pending.from) {
                    if (!returning) {
                        latencies.push(dt);
                        ctx.count(dt <= 1 ? 'onTime' : 'late');
                        ctx.gauge('trials', latencies.length);
                    }
                    ctx.progress();
                    dirProven = true;
                    pending = null;
                } else if (dt > maxWait) {
                    pending = null;
                    if (returning) return ctx.done(result(ctx.tick, 'could not walk back to the start tile'));
                    if (dirProven) {
                        latencies.push(maxWait + 1);
                        lost++;
                        ctx.count('lost');
                    } else if (++dir >= dirs.length) {
                        return ctx.done(result(ctx.tick, 'no walkable neighbour'));
                    }
                    ctx.progress();
                } else return;
            }
            if (latencies.length >= trials) {
                if (pos === homeKey) return ctx.done(result(ctx.tick));
                returning = true;
                return walk(home[0], home[1]);
            }
            if (!dirs.length) return ctx.done(result(ctx.tick, 'no walkable neighbour'));
            const [dx, dz] = dirs[dir]!;
            if (pos === homeKey) walk(home[0] + dx, home[1] + dz);
            else walk(home[0], home[1]);
        }
    };
}
