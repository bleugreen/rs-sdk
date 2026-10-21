// Lab check: what Chrome's background throttling does to in-page reactions.
//
//   bun docs/speedrun/scripts/tickprog-throttle.ts [--debug-port=9396] [--long-ms=360000]
//
// Attaches to the tab tickprog-tab.ts opened, runs the in-page probe continuously as a
// reaction meter (one walk trial per tick), and walks the window through: visible,
// minimised 30 s, hidden behind another tab 30 s, covered by another window 30 s,
// minimised for --long-ms (default 6 min, past Chrome's 5-minute intensive
// throttling), each followed by a visible stretch. Per phase it prints the trials
// on the next tick against those late, and the page's game-loop rate and frame
// arrival-to-decision time from the program's status.
import puppeteer, { type Page } from 'puppeteer';

const flag = (name: string, def: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? def;
const longMs = Number(flag('long-ms', '360000'));
const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${flag('debug-port', '9396')}`, defaultViewport: null });
const page = (await browser.pages()).find(p => p.url().includes('/bot'));
if (!page) throw new Error('no /bot tab on that DevTools port');
const cdp = await page.target().createCDPSession();
const { windowId } = (await cdp.send('Browser.getWindowForTarget')) as { windowId: number };
const setWindow = (windowState: 'minimized' | 'normal') => cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState } });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

type Snap = { onTime: number; late: number; lost: number; loops: { last: number; p10Last10s: number; min: number }; react: { p50: number; p90: number; max: number }; vis: string; phase: string };
const snap = (p: Page): Promise<Snap> => p.evaluate(() => {
    const w = window as unknown as Record<string, any>;
    const s = w.rsPrograms.status();
    return { onTime: s.counters.onTime ?? 0, late: s.counters.late ?? 0, lost: s.counters.lost ?? 0, loops: s.loops, react: s.react, vis: document.visibilityState, phase: s.phase };
});

await page.evaluate(() => (window as unknown as Record<string, any>).rsPrograms.start('probe', { trials: 1_000_000, stallTicks: 100_000 }));
const phase = async (name: string, ms: number, enter: () => Promise<unknown>, leave: () => Promise<unknown>) => {
    const before = await snap(page);
    await enter();
    await sleep(ms);
    // read while still in the phase: the loop statistics cover the last 10 s
    const during = await snap(page).catch(() => null);
    await leave();
    await sleep(3000);
    const after = await snap(page);
    const d = (k: 'onTime' | 'late' | 'lost') => after[k] - before[k];
    console.log(`${name.padEnd(34)} ${(ms / 1000).toFixed(0).padStart(4)} s  trials on time ${d('onTime')}, late ${d('late')}, lost ${d('lost')}  ` +
        (during ? `| in phase: visibility ${during.vis}, loops/s last ${during.loops.last} p10(10 s) ${during.loops.p10Last10s}` : '| no status during the phase') +
        `  | run: loops/s min ${after.loops.min}, arrival-to-decision p50 ${after.react.p50} p90 ${after.react.p90} max ${after.react.max} ms`);
};
const none = async () => {};
let other: Page | null = null;
let cover: string | null = null;

console.log(`throttle check at ${new Date().toISOString()}`);
await phase('visible', 20_000, none, none);
await phase('minimised', 30_000, () => setWindow('minimized'), () => setWindow('normal'));
await phase('hidden behind another tab', 30_000, async () => { other = await browser.newPage(); await other.bringToFront(); }, async () => { await other?.close(); await page.bringToFront(); });
await phase('covered by another window', 30_000, async () => {
    cover = ((await cdp.send('Target.createTarget', { url: 'about:blank', newWindow: true })) as { targetId: string }).targetId;
}, async () => { if (cover) await cdp.send('Target.closeTarget', { targetId: cover }); await page.bringToFront(); });
await phase('visible', 20_000, none, none);
await phase(`minimised (long)`, longMs, () => setWindow('minimized'), () => setWindow('normal'));
await phase('visible', 20_000, none, none);
await page.evaluate(() => (window as unknown as Record<string, any>).rsPrograms.stop());
browser.disconnect();
process.exit(0);
