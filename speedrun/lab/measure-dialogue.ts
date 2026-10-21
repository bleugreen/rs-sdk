// Dialogue: ticks per page with read-then-act (`advance`), and continueBurst
// with k=5 and k=10, on Carla's opening (West Ardougne): a run of pure
// continue pages, then a three-way choice. Ticks start on the first page.

import { advance, classifyPage, continueBurst } from '../lib/dialogue';
import { closeSession, openSession } from '../lib/session';
import { formatReport, report } from '../lib/ticks';
import { waitTicks, waitUntil } from '../lib/wait';
import { arg, botArg, labLog, result, sample } from './common';
import { CARLA, tele } from './setup';

const n = Number(arg('n', '3'));
const session = await openSession(botArg());
const { sdk, bot } = session;
const log = labLog('dialogue');

if (!(await tele(sdk, CARLA.x, CARLA.z))) throw new Error('tele to Carla failed');

async function open() {
    const r = await bot.talkTo(/^Carla$/i);
    if (!r.success) throw new Error(`talkTo Carla: ${r.message}`);
    const w = await waitUntil(sdk, s => classifyPage(s.dialog) === 'continue' && !s.dialog.isWaiting, { maxTicks: 10 });
    if (!w.ok) throw new Error('no first page');
}

/** Advance through the remaining continue pages, answer the choice, finish. */
async function finish(): Promise<number> {
    let pages = 0;
    for (;;) {
        const s = sdk.getState()!;
        if (!s.dialog.isOpen) {
            const w = await waitUntil(sdk, st => st.dialog.isOpen, { maxTicks: 3 });
            if (!w.ok) return pages;
        }
        const r = await advance(sdk, { choose: /easier/i, maxTicks: 5 });
        if (!r.ok) return pages;
        if (r.kind === 'continue') pages++;
    }
}

// Explore once: count the continue pages before the choice.
await open();
let before = 0;
for (;;) {
    const r = await advance(sdk, { maxTicks: 5 });
    if (r.kind !== 'continue') break;
    before++;
    const w = await waitUntil(sdk, s => !s.dialog.isWaiting || !s.dialog.isOpen, { maxTicks: 5 });
    if (!w.ok || classifyPage(w.state.dialog) === 'choice') break;
}
await finish();
result('carla pages before choice', { pages: before });
await waitTicks(sdk, 2);

for (let i = 0; i < n; i++) {
    await open();
    let pages = 0;
    const t0 = sdk.getState()!.tick;
    await sample(log, session, `advance x${before} (read-then-act)`, async () => {
        for (let p = 0; p < before; p++) {
            const r = await advance(sdk, { maxTicks: 5 });
            if (!r.ok || r.kind !== 'continue') return { ok: false, reason: r.reason ?? r.kind };
            pages++;
        }
        const w = await waitUntil(sdk, s => classifyPage(s.dialog) === 'choice', { maxTicks: 5 });
        return { ok: w.ok };
    });
    result('ticks per page (advance)', { pages, ticks: sdk.getState()!.tick - t0 });
    await finish();
    await waitTicks(sdk, 2);

    for (const k of [5, Math.min(10, before)]) {
        await open();
        const r = await sample(log, session, `continueBurst k=${k}`, () => continueBurst(sdk, k));
        result(`continueBurst k=${k} detail`, r);
        await finish();
        await waitTicks(sdk, 2);
    }
}

console.log(formatReport(report(log.rows)));
console.log(`log: ${log.path}`);
await closeSession(session);
process.exit(0);
