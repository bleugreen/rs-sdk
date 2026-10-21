// Packet latency of the bot, in server ticks (docs/speedrun/skills/tick-manipulation.md).
//
//   bun docs/speedrun/scripts/tickmanip-latency.ts <bot> [--trials=60] [--plain=4] [--miss=4] [--no-tele]
//
// A CLI over speedrun/lib/hostgate.ts `probeOnTime`: every predicted loop assumes a packet
// sent while state label c is current is processed on server tick c+1. It prints the trials
// per latency, the dominant offset, how often consecutive trials agree, the wall-clock gap
// between state publications, how long each send took to resolve, and the gate's verdict
// for a loop whose plain cycle is --plain ticks (default 4, woodcutting).
// Lab only by default: it teleports to open ground in the Lumbridge castle courtyard first
// (staff cheat); --no-tele probes where the bot stands (the demo).
import { hostname } from 'os';
import { runScript } from '../../../sdk/runner';
import { gateDecision, latencyHistogram, probeOnTime } from '../../../speedrun/lib/hostgate';

const flag = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const N = Number(flag('trials') ?? 60);
const PLAIN = Number(flag('plain') ?? 4);
const MISS = flag('miss') !== undefined ? Number(flag('miss')) : undefined;

await runScript(async ({ bot, sdk }) => {
    if (!process.argv.includes('--no-tele')) {
        await bot.skipTutorial();
        await sdk.waitForTicks(2);
        await sdk.sendSay('::tele 0,50,50,22,18');
        await sdk.waitForTicks(6);
    }
    const at = new Date().toISOString();
    const r = await probeOnTime(sdk, { trials: N });
    const q = (xs: number[], p: number) => { const a = [...xs].sort((u, v) => u - v); return a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))]!.toFixed(0) : '-'; };
    const v = gateDecision(r, { plainCycle: PLAIN, missCost: MISS });
    console.log(`probe from ${hostname()} at ${at}, server ${process.env.SERVER ?? '(bot.env)'}`);
    console.log(`latency in ticks (label of the step - label sent): ${latencyHistogram(r.latencies)}  (${r.trials} trials, ${r.lost} lost, ${r.ticks} ticks)${r.reason ? `  ${r.reason}` : ''}`);
    console.log(`on time ${r.onTime}/${r.trials}; dominant ${r.mode} ticks (${(r.modeFraction * 100).toFixed(0)}%, lead ${Math.max(0, r.mode - 1)}); consecutive trials agree ${(r.sameAsPrevious * 100).toFixed(0)}%`);
    console.log(`sequence: ${r.latencies.join('')}`);
    console.log(`gate at plain cycle ${PLAIN}: p ${v.p.toFixed(2)}, predicted knife ${v.knife.toFixed(2)} vs plain ${v.plain} -> ${v.on ? 'manipulate' : 'plain loop'}, lead ${v.lead}`);
    console.log(`state publication interval ms: p10 ${q(r.publishMs, 0.1)} p50 ${q(r.publishMs, 0.5)} p90 ${q(r.publishMs, 0.9)} max ${q(r.publishMs, 1)}`);
    console.log(`send resolve ms: p50 ${q(r.sendMs, 0.5)} p90 ${q(r.sendMs, 0.9)} max ${q(r.sendMs, 1)}`);
}, { timeout: 10 * 60_000, printState: false });
