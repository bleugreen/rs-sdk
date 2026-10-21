// Packet latency of the bot, in server ticks (docs/speedrun/skills/tick-manipulation.md).
//
//   bun docs/speedrun/scripts/tickmanip-latency.ts <bot> [--trials=60]
//
// Every predicted loop assumes a packet sent while state label c is current is processed on
// server tick c+1. This checks it directly: on a fresh state label c the bot walks one tile;
// the server processes the walk and steps the player in the same tick, so the new position
// appears at label c+1 if the packet made it, c+2 if it was a tick late. It also reports the
// wall-clock gap between state publications and how long each send took to resolve.
import { runScript } from '../../../sdk/runner';

const N = Number(process.argv.find(a => a.startsWith('--trials='))?.split('=')[1] ?? 60);

await runScript(async ({ bot, sdk }) => {
    await bot.skipTutorial();
    await sdk.waitForTicks(2);
    // Lumbridge castle courtyard, open ground
    await sdk.sendSay('::tele 0,50,50,22,18');
    await sdk.waitForTicks(6);
    const p0 = sdk.getState()!.player!;
    const home: [number, number] = [p0.worldX, p0.worldZ];
    const lat: number[] = [];
    const sendMs: number[] = [];
    const pubMs: number[] = [];
    const reactMs: number[] = [];
    let pending: { label: number; from: string } | null = null;
    let lastTick = -1;
    let lastPub = 0;
    await new Promise<void>(resolve => {
        const un = sdk.onStateUpdate(s => {
            if (!s?.inGame || !s.player || s.tick === lastTick) return;
            const now = performance.now();
            if (lastPub) pubMs.push(now - lastPub);
            lastPub = now;
            lastTick = s.tick;
            const pos = `${s.player.worldX},${s.player.worldZ}`;
            if (pending) {
                if (pos !== pending.from) { lat.push(s.tick - pending.label); pending = null; }
                else if (s.tick - pending.label > 6) { lat.push(99); pending = null; }
                return;
            }
            if (lat.length >= N) { un(); resolve(); return; }
            if (s.tick % 3 !== 0) return;
            const x = s.player.worldX === home[0] ? home[0] + 1 : home[0];
            pending = { label: s.tick, from: pos };
            const t0 = performance.now();
            reactMs.push(t0 - now);
            sdk.sendWalk(x, home[1], false).then(() => sendMs.push(performance.now() - t0)).catch(() => {});
        });
    });
    const hist = (xs: number[]) => { const h: Record<number, number> = {}; for (const v of xs) h[v] = (h[v] ?? 0) + 1; return Object.entries(h).map(([k, c]) => `${k}:${c}`).join(' '); };
    const q = (xs: number[], p: number) => { const a = [...xs].sort((u, v) => u - v); return a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))]!.toFixed(0) : '-'; };
    console.log(`latency in ticks (label of the step - label sent): ${hist(lat)}  (${N} trials)`);
    console.log(`state publication interval ms: p10 ${q(pubMs, 0.1)} p50 ${q(pubMs, 0.5)} p90 ${q(pubMs, 0.9)} max ${q(pubMs, 1)}`);
    console.log(`send resolve ms: p50 ${q(sendMs, 0.5)} p90 ${q(sendMs, 0.9)} max ${q(sendMs, 1)}`);
}, { timeout: 10 * 60_000, printState: false });
