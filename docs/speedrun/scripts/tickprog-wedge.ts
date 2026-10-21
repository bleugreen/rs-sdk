// Lab check: a wedged browser tab is still detected while an in-page program runs.
//
//   bun docs/speedrun/scripts/tickprog-wedge.ts <bot> [--debug-port=9396] [--wedge-ms=20000]
//
// Attaches to the tab tickprog-tab.ts opened (its DevTools port), starts the
// speedrun/lib watchdog and a long in-page program, then blocks the page's main
// thread over CDP. Reports how long after the wedge the program awaiter rejects and
// the watchdog returns its first relaunch verdict, then exits at that verdict so the
// watchdog does not open a second browser.
import puppeteer from 'puppeteer';
import { awaitProgram, startProgram } from '../../../speedrun/lib/programs';
import { openSession, startWatchdog } from '../../../speedrun/lib/session';

const bot = process.argv[2]!;
const flag = (name: string, def: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? def;
const wedgeMs = Number(flag('wedge-ms', '20000'));
const session = await openSession(bot, { client: 'browser', pathfinding: false });
const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${flag('debug-port', '9396')}`, defaultViewport: null });
const page = (await browser.pages()).find(p => p.url().includes('/bot'));
if (!page) throw new Error('no /bot tab on that DevTools port');

let wedgedAt = 0;
const since = () => (wedgedAt ? `${((Date.now() - wedgedAt) / 1000).toFixed(1)} s after the wedge` : 'BEFORE the wedge');
startWatchdog(session, {
    staleTicks: 10,
    onEvent: e => {
        console.log(`watchdog ${e.verdict} ${since()}: ${e.reason}`);
        if (e.verdict === 'relaunch') process.exit(wedgedAt ? 0 : 1);
    }
});
const run = await startProgram(session.sdk, 'probe', { trials: 10_000 });
void awaitProgram(session.sdk, run.runId)
    .then(s => console.log(`program ended ${s.phase} ${since()}`))
    .catch(e => console.log(`program awaiter rejected ${since()}: ${e.message}`));
await new Promise(r => setTimeout(r, 6000));
console.log(`program ${run.name}#${run.runId} running for 6 s, last tick ${session.lastInWorldTick}; wedging the page for ${wedgeMs} ms`);
wedgedAt = Date.now();
void page.evaluate(ms => { setTimeout(() => { const t = performance.now(); while (performance.now() - t < ms) { /* wedge */ } }, 0); }, wedgeMs);
await new Promise(r => setTimeout(r, wedgeMs + 10_000));
console.log('no relaunch verdict within the wedge');
process.exit(1);
