// Server tick health as one logged-in client sees it, to log beside a timing
// measurement: per minute, the state publication intervals (p50, p90, max) and the
// catch-ups (an interval under 150 ms right after one over 350 ms, i.e. the server
// overran and two frames arrived together; the rule speedrun/lib/programs.ts uses).
// A measurement taken in a minute with catch-ups says more about the server than about
// the path being measured. Read-only: it attaches as an observer to a bot that is
// already logged in behind a gateway, and sends nothing.
//
//   GATEWAY_URL=ws://127.0.0.1:8476 PASSWORD=... bun speedrun/lab/tick-health.ts cairn_h75 300
import { BotSDK } from '../../sdk';

const [account, secs = '300'] = process.argv.slice(2);
if (!account) throw new Error('usage: tick-health.ts <account> [seconds]');

const sdk = new BotSDK({
    botUsername: account,
    password: process.env.PASSWORD ?? '',
    gatewayUrl: process.env.GATEWAY_URL ?? 'ws://127.0.0.1:8476',
    connectionMode: 'observe',
    autoLaunchBrowser: false
});
await sdk.connect();

const pct = (xs: number[], p: number) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))]! : null);
let minute = { start: Date.now(), gaps: [] as number[], catchUps: 0 };
const flush = () => {
    const g = minute.gaps;
    console.log(
        `TICKHEALTH ${JSON.stringify({ account, from: new Date(minute.start).toISOString(), to: new Date().toISOString(), frames: g.length, p50: pct(g, 0.5), p90: pct(g, 0.9), max: g.length ? Math.max(...g) : null, catchUps: minute.catchUps })}`
    );
    minute = { start: Date.now(), gaps: [], catchUps: 0 };
};

let lastTick = -1;
let lastAt = 0;
let prevGap = 0;
sdk.onStateUpdate(st => {
    if (st.tick === lastTick) return;
    lastTick = st.tick;
    const now = Date.now();
    if (lastAt) {
        const gap = now - lastAt;
        if (gap < 150 && prevGap > 350) minute.catchUps++;
        minute.gaps.push(gap);
        prevGap = gap;
    }
    lastAt = now;
    if (now - minute.start >= 60_000) flush();
});

// A measurement usually ends before the window does: report the partial minute on the way out.
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => {
        flush();
        process.exit(0);
    });
}

await Bun.sleep(Number(secs) * 1000);
flush();
process.exit(0);
