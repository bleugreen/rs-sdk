// S00 on the browser client, traced: one fresh account through skills/start.ts's tutorialSkip, with
// every published state and every send S00 makes recorded, so a skip that fails can be read tick by
// tick (which send went out when, what it returned, what the engine did next).
//
//   LAB_RUNNERS=0 speedrun/lab/lab.sh <freshbot> speedrun/lab/measure-s00.ts[:--throttle=N[:--throttle-at=login|click]]
//
// Launches its own headless Chrome (CDP on WEB_PORT+7) and logs the tab in with the password in the
// query (lab only). `--throttle=N` slows the tab's CPU N-fold through CDP, from login (the default)
// or from the "Yes please." click. Prints `S00 {...}` (the summary) and, when the skip failed or a
// send was re-sent, `S00TRACE` lines (one per published state from the first state to the end).
// The whole trace goes to $LAB_LOG/s00-<bot>.json.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BotWorldState } from '../../sdk/types';
import { classifyPage } from '../lib/dialogue';
import { openSession } from '../lib/session';
import { atSpawn, hasStarterKit, PLAYER_KIT } from '../skills/start';
import { arg, botArg } from './common';
import { launchLabBrowser } from './browser';
import { leaveTutorial } from './setup';

const bot = botArg();
const throttle = Number(arg('throttle', '1'));
const throttleAt = arg('throttle-at', 'login');
const chrome = await launchLabBrowser(bot, { cdpPort: Number(process.env.WEB_PORT ?? '9300') + 7 });

async function throttleTab(): Promise<void> {
    for (const p of await chrome.browser.pages()) if (p.url().includes('/bot')) await p.emulateCPUThrottling(throttle);
}

const t0 = Date.now();
const session = await openSession(bot, { client: 'browser', launch: true, insecureQueryLogin: true });
const openMs = Date.now() - t0;
if (throttle > 1 && throttleAt === 'login') await throttleTab();
const sdk = session.sdk as unknown as Record<string, unknown> & { onStateUpdate(f: (s: BotWorldState) => void): () => void; getState(): BotWorldState | null };

/** One published state, compact: what tells a dropped click from a slow one. */
function row(s: BotWorldState) {
    const g = s.nearbyNpcs.find(n => /^runescape guide$/i.test(n.name));
    const d = s.dialog;
    const ext = s as BotWorldState & { sceneReady?: boolean; player: (BotWorldState['player'] & { teleportTick?: number | null }) | null };
    return {
        ms: Date.now() - t0,
        tick: s.tick,
        rev: s.revision,
        at: s.player ? `${s.player.worldX},${s.player.worldZ},${s.player.level}` : null,
        anim: s.player?.animId ?? -1,
        modal: s.modalOpen ? s.modalInterface : null,
        page: d.isOpen ? `${classifyPage(d)}:${d.pageId ?? '?'}${d.isWaiting ? ':waiting' : ''}:${d.options.length}` : null,
        guide: g ? `${g.index}@${g.tileX ?? g.x},${g.tileZ ?? g.z}` : null,
        rejected: s.opFeedback?.opRejectedCount,
        flagUnset: s.opFeedback?.lastMapFlagUnsetTick,
        msgs: s.gameMessages.slice(-2).map(m => `${m.tick}:${m.text}`),
        ...(ext.sceneReady !== undefined ? { sceneReady: ext.sceneReady } : {}),
        ...(ext.player?.teleportTick !== undefined ? { teleportTick: ext.player.teleportTick } : {}),
    };
}

const states: ReturnType<typeof row>[] = [];
const first = sdk.getState();
if (first) states.push(row(first));
sdk.onStateUpdate(s => states.push(row(s)));

type Send = { method: string; args: unknown[]; tick: number; ms: number; result?: unknown; resultMs?: number };
const sends: Send[] = [];
for (const method of ['sendAcceptCharacterDesign', 'sendInteractNpc', 'sendClickDialog', 'clickDialogByText']) {
    const f = (sdk[method] as (...a: unknown[]) => Promise<unknown>).bind(sdk);
    sdk[method] = async (...args: unknown[]) => {
        const rec: Send = { method, args: args.map(a => (a instanceof RegExp ? String(a) : a)), tick: sdk.getState()?.tick ?? -1, ms: Date.now() - t0 };
        sends.push(rec);
        if (method === 'clickDialogByText' && throttle > 1 && throttleAt === 'click') await throttleTab();
        const r = await f(...args);
        rec.result = r && typeof r === 'object' ? { success: (r as { success?: unknown }).success, reason: (r as { reason?: unknown }).reason, message: (r as { message?: unknown }).message } : r;
        rec.resultMs = Date.now() - t0;
        return r;
    };
}

const firstTick = first?.tick ?? -1;
const startedDesign = !!first && first.modalOpen && first.modalInterface === PLAYER_KIT;
let error: string | null = null;
const skipStart = Date.now() - t0;
try {
    await leaveTutorial(session);
} catch (e) {
    error = (e as Error).message;
}
const skipEnd = Date.now() - t0;
// A few more states, so a late reply after a failure is on the record.
await new Promise(r => setTimeout(r, 2000));

const firstOf = (pred: (r: ReturnType<typeof row>) => boolean, fromTick = -Infinity) => states.find(r => r.tick > fromTick && pred(r))?.tick ?? null;
const talk = sends.find(s => s.method === 'sendInteractNpc');
const cont = sends.find(s => s.method === 'sendClickDialog');
const talks = sends.filter(s => s.method === 'sendInteractNpc').length;
const conts = sends.filter(s => s.method === 'sendClickDialog').length;
const last = sdk.getState();
const summary = {
    bot, throttle, throttleAt, ok: error === null, error, openMs, skipMs: skipEnd - skipStart,
    firstTick, startedDesign, talks, conts,
    talkTick: talk?.tick ?? null, talkResult: talk?.result ?? null, talkResultMs: talk && talk.resultMs !== undefined ? talk.resultMs - talk.ms : null,
    pageTick: firstOf(r => r.page !== null && !r.page.includes('waiting')),
    contTick: cont?.tick ?? null, contResult: cont?.result ?? null,
    choiceTick: firstOf(r => !!r.page?.startsWith('choice')),
    landedTick: firstOf(r => r.at === '3222,3222,0'),
    landedOk: !!last && atSpawn(last) && hasStarterKit(last),
    sends: sends.map(s => `${s.method}@${s.tick}${s.result && typeof s.result === 'object' && (s.result as { success?: unknown }).success === false ? `:${(s.result as { reason?: unknown }).reason}` : ''}`),
};
console.log(`S00 ${JSON.stringify(summary)}`);
if (error !== null || talks > 1 || conts > 1) for (const r of states) console.log(`S00TRACE ${JSON.stringify(r)}`);
if (process.env.LAB_LOG) writeFileSync(join(process.env.LAB_LOG, `s00-${bot}.json`), JSON.stringify({ summary, sends, states }, null, 1));
await chrome.kill();
process.exit(0);
