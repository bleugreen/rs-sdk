// Packet latency of the bot, in server ticks, and the host gate's verdict for one path
// (docs/speedrun/skills/tick-manipulation.md, "Run-time host gate").
//
//   bun docs/speedrun/scripts/tickmanip-latency.ts <bot> [--path=relay|direct] [--trials=60] [--no-tele] [--bot=NAME]
//       relay only:  [--plain=4] [--miss=4]
//       direct only: [--steady=60] [--edge=iad|any] [--max-connect=5] [--floor=58] [--p90=400]
//                    [--p90-pass] [--catchups=2] [--json=PATH]
//
// A CLI over speedrun/lib/hostgate.ts `probeOnTime`: every predicted loop assumes a packet
// sent while state label c is current is processed on server tick c+1. It prints the trials
// per latency, the dominant offset, how often consecutive trials agree, the tick arrival
// intervals (p50/p90/max, a 50 ms histogram, catch-ups), and the gate's verdict for the path.
//
// --path=relay (default) probes through the SDK (runner, gateway, lite client: `runScript`)
// and prints the cost model's verdict for a loop whose plain cycle is --plain ticks (default
// 4, woodcutting). Its tick intervals are state publications through the relay: reference only.
//
// --path=direct probes in this process on the engine websocket (speedrun/lib/direct.ts, no
// gateway; stop any runner logged in as the bot first). Against a remote host it first checks
// the vantage preconditions (Fly edge iad, app iad, no mesh hop, TCP connect p50 <= 5 ms)
// and, if one fails, says which and exits 2 without logging in. Then it probes, keeps reading
// ticks until --steady seconds (default 60) of arrivals are in, and prints the direct go/no-go:
// (a) on time >= 58/60, (b) tick p90 <= 400 ms (reported only; --p90-pass makes it a pass
// line), (c) <= 2 catch-ups per minute ((d), the page's loop rate, is the in-page probe's; not
// measured here). Exit 0 when the loops may start, 1 when not. Needs server/webclient's dependencies (`cd server/webclient && bun install`).
// --bot=NAME overrides <bot>: under lab.sh, whose runner holds <bot>, the direct probe logs
// in a second account. After the last trial (and on the 10-minute abort, SIGTERM, SIGINT or
// SIGHUP) it logs out and waits for the server to confirm, printing a `logout (direct):` line
// (also in --json); the exit code stays the gate's.
//
//   LAB_BLOCK=tickmanip NODE_TICKRATE=300 bash docs/speedrun/scripts/lab.sh <bot> \
//       docs/speedrun/scripts/tickmanip-latency.ts \
//       docs/speedrun/scripts/tickmanip-latency.ts:--path=direct:--bot=<second bot>
//
// Run night: run --path=direct on the run machine itself, just before the run, at the real
// player count. Steadiness read from any other machine is not evidence (demo-latency.md,
// section 9): its own path jitter looks like overruns.
//
// Lab only by default: it teleports to open ground in the Lumbridge castle courtyard first
// (staff cheat); --no-tele probes where the bot stands (the demo).
import { writeFileSync } from 'fs';
import { hostname } from 'os';
import { runScript } from '../../../sdk/runner';
import { type DirectLogoutResult, directLogoutText, openDirectSession } from '../../../speedrun/lib/direct';
import { directDecision, gateDecision, latencyHistogram, measureVantage, type ProbeResult, probeOnTime, steadinessHistogram, vantageDecision, verdictText } from '../../../speedrun/lib/hostgate';
import { loadBotEnv } from '../../../speedrun/lib/session';

const flag = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const num = (name: string) => (flag(name) !== undefined ? Number(flag(name)) : undefined);
const BOT = flag('bot') ?? process.argv.slice(2).find(a => !a.startsWith('--'));
const PATH = flag('path') ?? 'relay';
const N = Number(flag('trials') ?? 60);
const TELE = !process.argv.includes('--no-tele');
const q = (xs: number[], p: number) => {
    const a = [...xs].sort((u, v) => u - v);
    return a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))]!.toFixed(0) : '-';
};

if (PATH !== 'relay' && PATH !== 'direct') throw new Error(`--path must be relay or direct, not ${PATH}`);
if (!BOT) throw new Error('usage: tickmanip-latency.ts <bot> [--path=relay|direct] ...');

function printProbe(r: ProbeResult, server: string) {
    const s = r.steadiness;
    console.log(`probe (${r.path}) from ${hostname()} at ${new Date().toISOString()}, server ${server}`);
    console.log(`latency in ticks (label of the step - label sent): ${latencyHistogram(r.latencies)}  (${r.trials} trials, ${r.lost} lost, ${r.ticks} ticks)${r.reason ? `  ${r.reason}` : ''}`);
    console.log(`on time ${r.onTime}/${r.trials}; dominant ${r.mode} ticks (${(r.modeFraction * 100).toFixed(0)}%, lead ${Math.max(0, r.mode - 1)}); consecutive trials agree ${(r.sameAsPrevious * 100).toFixed(0)}%`);
    console.log(`sequence: ${r.latencies.join('')}`);
    console.log(
        `tick ${r.path === 'direct' ? 'arrival' : 'publication'} interval ms over ${(s.spanMs / 1000).toFixed(1)} s: p10 ${s.p10} p50 ${s.p50} p90 ${s.p90} max ${s.max};` +
            ` ${s.over350} over 350, ${s.under150} under 150, ${s.catchUps} catch-ups (${s.catchUpsPerMinute}/min)`
    );
    console.log(`tick interval histogram (50 ms buckets): ${steadinessHistogram(s) || '-'}`);
    console.log(`send resolve ms: p50 ${q(r.sendMs, 0.5)} p90 ${q(r.sendMs, 0.9)} max ${q(r.sendMs, 1)}`);
}

if (PATH === 'relay') {
    const PLAIN = Number(flag('plain') ?? 4);
    await runScript(
        async ({ bot, sdk }) => {
            if (TELE) {
                await bot.skipTutorial();
                await sdk.waitForTicks(2);
                await sdk.sendSay('::tele 0,50,50,22,18');
                await sdk.waitForTicks(6);
            }
            const r = await probeOnTime(sdk, { trials: N });
            printProbe(r, process.env.SERVER ?? '(bot.env)');
            const v = gateDecision(r, { plainCycle: PLAIN, missCost: num('miss') });
            console.log(`gate (relay) at plain cycle ${PLAIN}: ${verdictText(v)} -> ${v.on ? 'manipulate' : 'plain loop'}`);
        },
        { timeout: 10 * 60_000, printState: false }
    );
} else {
    const env = loadBotEnv(BOT);
    const host = env.SERVER ?? 'localhost';
    const local = host.startsWith('localhost') || host.startsWith('127.');
    const edge = flag('edge') ?? 'iad';
    const out: Record<string, unknown> = { bot: BOT, machine: hostname(), host, path: 'direct', startedUtc: new Date().toISOString() };
    if (local) console.log(`vantage: local engine at ${host}, preconditions not applicable`);
    else if (edge === 'any') console.log('vantage: preconditions skipped (--edge=any); this is not a run-night read');
    else {
        const reading = await measureVantage(host);
        const vv = vantageDecision(reading, { edge, app: edge, maxConnectP50Ms: num('max-connect') });
        out.vantage = { ...vv, connectMs: reading.connectMs };
        console.log(`vantage: edge ${vv.edge}, app ${vv.app}, mesh hop ${vv.meshHop ?? 'none'}, TCP connect p50 ${vv.connectP50} ms (${reading.connectMs.length} samples), ${vv.players ?? '?'} online`);
        if (!vv.ok) {
            console.log(`gate (direct): NOT PROBED, precondition failed: ${vv.failures.join('; ')}`);
            process.exit(2);
        }
    }
    const session = await openDirectSession({ host, username: env.BOT_USERNAME, password: env.PASSWORD });
    // Every way out of the probe goes through the logout (session.logout() is idempotent).
    const logOutAndExit = (code: number) => void session.logout().then(lo => console.log(`logout (direct): ${directLogoutText(lo)}`)).finally(() => process.exit(code));
    const abort = setTimeout(() => {
        console.error('tickmanip-latency: direct probe timed out after 10 minutes');
        logOutAndExit(1);
    }, 10 * 60_000);
    for (const [signal, code] of [['SIGTERM', 143], ['SIGINT', 130], ['SIGHUP', 129]] as const) process.once(signal, () => logOutAndExit(code));
    let saveJson: ((logout: DirectLogoutResult) => void) | null = null;
    try {
        await session.waitTicks(5);
        // a first login opens the character design screen (3559), which holds the walks
        if (session.client.isModalOpen() && session.client.getModalInterface() === 3559) {
            session.client.acceptCharacterDesign();
            session.client.flush();
            await session.waitTicks(2);
        }
        if (TELE) {
            session.client.say('::tele 0,50,50,22,18');
            session.client.flush();
            await session.waitTicks(6);
        }
        const r = await probeOnTime(session.sdk, { trials: N, steadyMs: Number(flag('steady') ?? 60) * 1000 });
        printProbe(r, host);
        const v = directDecision(r, { floor: num('floor'), maxTickP90Ms: num('p90'), tickP90PassLine: process.argv.includes('--p90-pass'), maxCatchUpsPerMinute: num('catchups') });
        console.log(`gate (direct): ${verdictText(v)} -> ${v.on ? 'start the in-page loops' : `do not start: ${v.failures.join('; ')}`}`);
        const json = flag('json');
        if (json) {
            const t0 = r.tickArrivals[0] ?? 0;
            const { tickArrivals, ...rest } = r;
            saveJson = logout => {
                writeFileSync(json, JSON.stringify({ ...out, result: { ...rest, tickArrivalsMs: tickArrivals.map(t => Math.round((t - t0) * 10) / 10) }, verdict: v, logout }, null, 2));
                console.log(`wrote ${json}`);
            };
        }
        process.exitCode = v.on ? 0 : 1;
    } finally {
        clearTimeout(abort);
        const logout = await session.logout();
        console.log(`logout (direct): ${directLogoutText(logout)}`);
        saveJson?.(logout);
    }
    process.exit();
}
