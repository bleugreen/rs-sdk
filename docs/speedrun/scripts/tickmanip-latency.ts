// Packet latency of the bot, in server ticks (docs/speedrun/skills/tick-manipulation.md).
//
//   bun docs/speedrun/scripts/tickmanip-latency.ts <bot> [--trials=60] [--threshold=0.95] [--no-tele]
//
// A CLI over speedrun/lib/hostgate.ts `probeOnTime`: every predicted loop assumes a packet
// sent while state label c is current is processed on server tick c+1, and every trial
// should read 1. It also reports the wall-clock gap between state publications, how long
// each send took to resolve, and the run-time gate's decision at --threshold.
// Lab only by default: it teleports to open ground in the Lumbridge castle courtyard first
// (staff cheat); --no-tele probes where the bot stands.
import { runScript } from '../../../sdk/runner';
import { DEFAULT_THRESHOLD, gateDecision, latencyHistogram, probeOnTime } from '../../../speedrun/lib/hostgate';

const flag = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const N = Number(flag('trials') ?? 60);
const THRESHOLD = Number(flag('threshold') ?? DEFAULT_THRESHOLD);

await runScript(async ({ bot, sdk }) => {
    if (!process.argv.includes('--no-tele')) {
        await bot.skipTutorial();
        await sdk.waitForTicks(2);
        await sdk.sendSay('::tele 0,50,50,22,18');
        await sdk.waitForTicks(6);
    }
    const r = await probeOnTime(sdk, { trials: N });
    const q = (xs: number[], p: number) => { const a = [...xs].sort((u, v) => u - v); return a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))]!.toFixed(0) : '-'; };
    console.log(`latency in ticks (label of the step - label sent): ${latencyHistogram(r.latencies)}  (${r.trials} trials, ${r.lost} lost, ${r.ticks} ticks)${r.reason ? `  ${r.reason}` : ''}`);
    console.log(`on time ${r.onTime}/${r.trials} = ${r.fraction.toFixed(3)}; gate at ${THRESHOLD}: ${gateDecision(r, THRESHOLD) ? 'manipulate' : 'plain loop'}`);
    console.log(`state publication interval ms: p10 ${q(r.publishMs, 0.1)} p50 ${q(r.publishMs, 0.5)} p90 ${q(r.publishMs, 0.9)} max ${q(r.publishMs, 1)}`);
    console.log(`send resolve ms: p50 ${q(r.sendMs, 0.5)} p90 ${q(r.sendMs, 0.9)} max ${q(r.sendMs, 1)}`);
}, { timeout: 10 * 60_000, printState: false });
