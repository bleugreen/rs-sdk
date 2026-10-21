// Level-up: ticks from the level-up chat appearing to the chat being gone,
// with the watcher vs the stock dismissal (bot.dismissBlockingUI, which is
// what stock gathering loops run when their wait sees a blocker). That span is
// the gathering stall per level. ::advancestat woodcutting 15 shows the
// level-up page plus the Oak-trees unlock page; level 16 shows one page.

import type { BotWorldState } from '../../sdk/types';
import { startLevelUpWatcher } from '../lib/levelup';
import { closeSession, openSession } from '../lib/session';
import { formatReport, report } from '../lib/ticks';
import { waitTicks, waitUntil } from '../lib/wait';
import { arg, botArg, labLog, result } from './common';
import { cheat } from './setup';

const n = Number(arg('n', '3'));
const session = await openSession(botArg());
const { sdk, bot } = session;
const log = labLog('levelup');

async function trial(level: number, mode: 'watcher' | 'stock') {
    await waitUntil(sdk, s => !s.dialog.isOpen, { maxTicks: 20 });
    await waitTicks(sdk, 2);
    let openTick = -1;
    let pages = 0;
    let lastPage: string | undefined;
    const unsub = sdk.onStateUpdate((s: BotWorldState) => {
        if (s.dialog.isOpen && openTick < 0) openTick = s.tick;
        if (s.dialog.isOpen && s.dialog.pageId !== lastPage) {
            lastPage = s.dialog.pageId;
            pages++;
        }
    });
    const watcher = mode === 'watcher' ? startLevelUpWatcher(sdk) : null;
    await cheat(sdk, `advancestat woodcutting ${level}`);
    const opened = await waitUntil(sdk, s => s.dialog.isOpen, { maxTicks: 10 });
    if (!opened.ok) throw new Error('no level-up chat');
    if (mode === 'stock') await bot.dismissBlockingUI();
    const closed = await waitUntil(sdk, s => !s.dialog.isOpen, { maxTicks: 20 });
    watcher?.stop();
    unsub();
    const ticks = closed.tick - openTick;
    const step = `level-up ${level} dismissal (${mode})`;
    log.append({ v: 1, runId: log.runId, account: session.name, sessionId: session.sessionId, step, startTick: openTick, endTick: closed.tick, ticks, wallMs: 0, ok: closed.ok, tickMs: 300, at: new Date().toISOString(), meta: { pages } });
    result(step, { ticks, pages, ok: closed.ok, dismissed: watcher?.dismissed });
}

for (let i = 0; i < n; i++) {
    for (const level of [15, 16]) {
        await trial(level, 'watcher');
        await trial(level, 'stock');
    }
}

console.log(formatReport(report(log.rows)));
console.log(`log: ${log.path}`);
await closeSession(session);
process.exit(0);
