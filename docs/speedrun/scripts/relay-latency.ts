// tickmanip-latency.ts with per-trial timestamps, for the hop breakdown in
// docs/speedrun/research/demo-latency.md (run by sdk-path-latency.sh with TRACE=1).
//
//   RELAY_TRIALS_OUT=path bun docs/speedrun/scripts/relay-latency.ts [--trials=60]
//
// Same trial as tickmanip-latency.ts (on a fresh tick label c, walk one tile; the step shows at
// c+1 if the packet made the next tick). Writes one JSON object per trial: label, the wall time
// the SDK listener saw the state, the wall time sendWalk was called, and the ticks taken.
import { appendFileSync } from 'node:fs';
import { runScript } from '../../../sdk/runner';

const N = Number(process.argv.find(a => a.startsWith('--trials='))?.split('=')[1] ?? 60);
const OUT = process.env.RELAY_TRIALS_OUT;
const now = () => performance.timeOrigin + performance.now();

await runScript(async ({ bot, sdk }) => {
    await bot.skipTutorial();
    await sdk.waitForTicks(2);
    const p0 = sdk.getState()!.player!;
    const home: [number, number] = [p0.worldX, p0.worldZ];
    const ticks: number[] = [];
    let pending: { label: number; from: string; seen: number; sent: number } | null = null;
    let lastTick = -1;
    await new Promise<void>(resolve => {
        const un = sdk.onStateUpdate(s => {
            if (!s?.inGame || !s.player || s.tick === lastTick) return;
            const seen = now();
            lastTick = s.tick;
            const pos = `${s.player.worldX},${s.player.worldZ}`;
            if (pending) {
                const moved = pos !== pending.from;
                if (moved || s.tick - pending.label > 6) {
                    const k = moved ? s.tick - pending.label : 99;
                    ticks.push(k);
                    if (OUT) appendFileSync(OUT, JSON.stringify({ label: pending.label, seen: pending.seen, sent: pending.sent, ticks: k, landedSeen: seen }) + '\n');
                    pending = null;
                }
                return;
            }
            if (ticks.length >= N) { un(); resolve(); return; }
            if (s.tick % 3 !== 0) return;
            const x = s.player.worldX === home[0] ? home[0] + 1 : home[0];
            pending = { label: s.tick, from: pos, seen, sent: now() };
            sdk.sendWalk(x, home[1], false).catch(() => {});
        });
    });
    const h: Record<number, number> = {};
    for (const v of ticks) h[v] = (h[v] ?? 0) + 1;
    console.log(`latency in ticks: ${JSON.stringify(h)} (${N} trials)`);
}, { timeout: 10 * 60_000, printState: false });
