// S25a local acceptance (STEP-MANIFEST.md entry 10): the module's own steps on the lab engine,
// with a stand-in anvil helper that speaks the agreed H5 protocol (skills/smithing.ts
// ANVIL_CONTRACT): it stages each announced inventory with ::give, keeps a trade request
// standing, gives with lib/trade give() and takes back whatever SCORED offers. rs/188's
// speedrun/helpers/anvil.ts replaces it on the run.
//
//   LAB_HELPERS=<helper> speedrun/lab/lab.sh <scored> 'speedrun/lab/smithing-accept.ts:--helper=<helper>[:--from=1:--until=99]'
//   ... 'speedrun/lab/smithing-accept.ts:--supply=bank:--from=88:--until=90'   (the bank fallback; no helper)
//
// --role=anvil runs rs/188's H5 role (speedrun/helpers/anvil.ts, standalone, bank restock with
// lab stock) on <helper> instead of the stand-in: this script publishes cue.json (SCORED's name
// hash) and wires the module's announce to writeAnvilPlan in a fresh cue directory, as run.ts does.
// It needs rs/188's PR #179 on the branch: anvil.ts itself, and the ANY_OFFER export it imports
// from lib/trade.ts.
//
// The scored stand-in starts at --from with no hammer (the first trade brings it), on the
// anvil tile. With the helper, seq 0 is announced and staged before the first step starts:
// the manifest's "helper staged" best case. Reports total ticks (runSteps' rows: steps plus
// boundaries) to the target level and with the final hand-back, and the per-inventory
// turnaround (last xp -> next make click).

import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import type { BotWorldState } from '../../sdk/types';
import { CueWriter } from '../helpers/altar-cue';
import { depositAll } from '../lib/bank';
import { closeSession, openSession, type Session } from '../lib/session';
import { formatReport, report } from '../lib/ticks';
import { give, receiveFrom, sameName, tradeOf } from '../lib/trade';
import { nextTick, waitTicks, waitUntil } from '../lib/wait';
import { levelForXp, xpForLevel } from '../lib/xp';
import { runSteps } from '../runner/step';
import {
    BARS, firstAnnouncement, HELPER_TILE, inventoryTable, resolveOptions, routePlan, SCORED_TILE, smithingXp, steps, type AnvilPlanMsg, type Bar, type InventoryReport,
} from '../skills/smithing';
import { arg, botArg, labLog, result } from './common';
import { cheat, tele, VARROCK_WEST_BANK } from './setup';

const supply = arg('supply', 'helper') as 'helper' | 'bank';
const from = Number(arg('from', '1'));
const until = Number(arg('until', '99'));
const helperName = arg('helper', '');
if (supply === 'helper' && !helperName) throw new Error('--helper=<bot> is required with supply helper');
const realRole = arg('role', 'standin') === 'anvil';
if (realRole && supply !== 'helper') throw new Error('--role=anvil needs supply helper');

const scored = await openSession(botArg());
// The real role logs in on its own (bots/<helper>/bot.env), so this script holds no helper session.
const helper = supply === 'helper' && !realRole ? await openSession(helperName, { pathfinding: false }) : null;
const log = labLog(`smithing-${supply}`);
const NAMES: Record<string, string> = { hammer: 'Hammer', ...Object.fromEntries(Object.entries(BARS).map(([k, v]) => [k, v.name])) };

// ---------------------------------------------------------------- setup (staff cheats, untimed)

async function fresh(s: Session): Promise<void> {
    await cheat(s.sdk, 'setvar tutorial 1000');
    await cheat(s.sdk, '~clearinv inv');
    await waitUntil(s.sdk, st => st.inventory.length === 0, { maxTicks: 10 });
}

await fresh(scored);
await cheat(scored.sdk, `setstat smithing ${from}`);
await waitUntil(scored.sdk, st => levelForXp(smithingXp(st)) === from, { maxTicks: 10 });

if (supply === 'bank') {
    // Stock the bank with the plan's bars (noted, deposited, so the bank holds them unnoted) and the hammer.
    if (!(await tele(scored.sdk, VARROCK_WEST_BANK.x, VARROCK_WEST_BANK.z))) throw new Error('tele to the bank failed');
    const o = resolveOptions({ supply: 'bank', untilLevel: until });
    const need: Partial<Record<Bar, number>> = {};
    for (const inv of routePlan(smithingXp(scored.sdk.getState()!), o.plan)) for (const [b, n] of Object.entries(inv.bars) as [Bar, number][]) need[b] = (need[b] ?? 0) + n;
    const opened = await scored.bot.openBank();
    if (!opened.success) throw new Error(`openBank: ${opened.message}`);
    await depositAll(scored.sdk);
    for (const [b, n] of Object.entries(need)) await cheat(scored.sdk, `give cert_${b} ${n! + 5}`);
    await cheat(scored.sdk, 'give hammer 1');
    await waitUntil(scored.sdk, st => st.inventory.length >= Object.keys(need).length + 1, { maxTicks: 10 });
    await depositAll(scored.sdk);
    await scored.bot.closeBank();
    result('bank stock', need);
}
if (!(await tele(scored.sdk, SCORED_TILE.x, SCORED_TILE.z))) throw new Error('tele to the anvil tile failed');

// ---------------------------------------------------------------- the stand-in helper

const scoredName = scored.sdk.getState()!.player!.name;
let plan: AnvilPlanMsg | null = null;
const announced: AnvilPlanMsg[] = [];
let announceTo: ((m: AnvilPlanMsg) => void) | null = null;
const announce = (m: AnvilPlanMsg) => {
    if (announceTo) return announceTo(m);
    announced.push(m);
    plan = m;
};
const helperLog: Array<Record<string, unknown>> = [];
let helperDone: Promise<void> = Promise.resolve();
let stagedSeq = '';

function exact(st: BotWorldState, giveMap: Record<string, number>): boolean {
    const total = Object.values(giveMap).reduce((a, n) => a + n, 0);
    if (st.inventory.length !== total) return false;
    return Object.entries(giveMap).every(([k, n]) => st.inventory.filter(i => i.name === NAMES[k] && i.count === 1).length === n);
}

async function helperLoop(h: Session): Promise<void> {
    let delivered = '';
    let lastReq = -99;
    for (;;) {
        const st = await nextTick(h.sdk);
        const p = plan;
        if (!p) continue;
        if (p.stop) return;
        const key = `${p.session}#${p.seq}`;
        if (delivered === key) continue;
        const t = tradeOf(st);
        if (t.isOpen) {
            if (!sameName(t.partner, scoredName)) { await h.sdk.sendDeclineTrade(); continue; }
            const t0 = st.tick;
            const r = p.collect
                ? await receiveFrom(h.sdk, scoredName, { maxTicks: 40 })
                : await give(h.sdk, scoredName, Object.entries(p.give).map(([k, n]) => ({ item: new RegExp(`^${NAMES[k]}$`, 'i'), n })), { expectTheirs: [{ item: /./, amount: 0 }], maxTicks: 40 });
            const gone = !p.collect && Object.keys(p.give).every(k => !h.sdk.getState()!.inventory.some(i => i.name === NAMES[k]));
            helperLog.push({ key, ok: r.ok, ticks: r.ticks, reason: r.reason, at: t0 });
            if (r.ok || gone) delivered = key;
            continue;
        }
        if (!p.collect && !exact(st, p.give)) {
            if (st.inventory.length) {
                await cheat(h.sdk, '~clearinv inv');
                await waitUntil(h.sdk, s => s.inventory.length === 0, { maxTicks: 6 });
            }
            for (const [k, n] of Object.entries(p.give)) await cheat(h.sdk, `give ${k} ${n}`);
            await waitUntil(h.sdk, s => exact(s, p.give), { maxTicks: 8 });
            continue;
        }
        stagedSeq = key;
        // Keep a request standing: re-sent every 4 ticks while no trade is open.
        if (st.tick - lastReq >= 4) {
            const target = st.nearbyPlayers.find(x => sameName(x.name, scoredName));
            if (target) {
                void h.sdk.sendTradeRequest(target.index);
                lastReq = st.tick;
            }
        }
    }
}

const runId = log.runId;
let roleProc: ReturnType<typeof Bun.spawn> | null = null;
if (realRole) {
    // Loaded by path: anvil.ts (and lib/trade.ts's ANY_OFFER, which it imports) arrive with #179.
    const anvilPath = '../helpers/anvil.ts';
    const { writeAnvilPlan } = (await import(anvilPath)) as { writeAnvilPlan: (dir: string, m: AnvilPlanMsg) => unknown };
    const cueDir = mkdtempSync(join(tmpdir(), 'anvil-cue-'));
    const s0 = scored.sdk.getState()!;
    new CueWriter(cueDir, scoredName).write({ beacons: [{ tick: s0.tick, ms: Date.now() }], turns: [] });
    const write = (m: AnvilPlanMsg) => { announced.push(m); writeAnvilPlan(cueDir, m); };
    announceTo = write;
    const first = firstAnnouncement(s0, `${runId}/pre`, { untilLevel: until });
    if (!first) throw new Error('nothing to make');
    write(first);
    const env: Record<string, string | undefined> = { ...process.env, ROLE_OPTIONS: JSON.stringify({ restock: { kind: arg('restock', 'bank'), labStock: true }, cueDir }), RC_CUE_DIR: cueDir, HELPER_LAB_TELE: '1' };
    for (const k of ['BOT_USERNAME', 'PASSWORD', 'SERVER', 'GATEWAY_URL', 'SHOW_CHAT']) delete env[k];
    roleProc = Bun.spawn(['bun', 'speedrun/helpers/anvil.ts', helperName], { cwd: resolve(import.meta.dir, '../..'), env, stdout: 'inherit', stderr: 'inherit' });
    // A throw here must not leave the role holding the lab's output pipe.
    const proc = roleProc;
    process.on('exit', () => proc.kill());
    result('anvil role', { helper: helperName, cueDir, restock: arg('restock', 'bank') });
    // Staged: the role's request reaches SCORED (it requests only once seq 0 is in its inventory).
    const staged = await waitUntil(scored.sdk, st => st.gameMessages.some(m => /wishes to trade with you/i.test(m.text)), { maxTicks: Number(arg('stageTicks', '400')) });
    if (!staged.ok) throw new Error('the anvil role did not request within the staging window');
}
if (helper) {
    if (!(await tele(helper.sdk, HELPER_TILE.x, HELPER_TILE.z))) throw new Error('tele to the helper tile failed');
    await fresh(helper);
    const first = firstAnnouncement(scored.sdk.getState()!, `${runId}/pre`, { untilLevel: until });
    if (!first) throw new Error('nothing to make');
    announce(first);
    helperDone = helperLoop(helper).catch(e => { console.error('helper loop:', e); });
    const staged = await waitUntil(scored.sdk, () => stagedSeq === `${first.session}#0`, { maxTicks: 60 });
    if (!staged.ok) throw new Error('the helper did not stage seq 0');
    await waitTicks(scored.sdk, 4); // its request stands
}

// ---------------------------------------------------------------- the run

const reports: InventoryReport[] = [];
const list = steps({ giver: helperName || undefined, supply, untilLevel: until, announce, onInventory: r => reports.push(r), log: (m, d) => console.log(`smithing: ${m} ${d ? JSON.stringify(d) : ''}`) });
const t0 = scored.sdk.getState()!.tick;
let reachedTick = -1;
const target = xpForLevel(until);
// Per-tick timeline (--timeline=1): what SCORED's client showed between ticks, for slow turnarounds.
const timeline = new Map<number, string>();
const wantTimeline = arg('timeline', '0') !== '0';
const timelineAll = arg('timeline', '0') === 'all';
const unsub = scored.sdk.onStateUpdate(s => {
    if (reachedTick < 0 && smithingXp(s) >= target) reachedTick = s.tick;
    if (!wantTimeline) return;
    const msgs = s.gameMessages.filter(m => m.tick >= s.tick - 1).map(m => m.text).join(' | ');
    timeline.set(s.tick, `xp ${smithingXp(s)} dialog ${s.dialog.isOpen ? (s.dialog.isWaiting ? 'waiting' : 'open') : '-'} modal ${s.modalOpen ? s.modalInterface : '-'} if ${s.interface?.isOpen ? s.interface.interfaceId : '-'} trade ${s.trade?.isOpen ? s.trade.screen : '-'}${msgs ? ` msgs: ${msgs}` : ''}`);
});
await runSteps(scored, list, { log, c: {}, shouldStop: () => false });
unsub();
const t1 = scored.sdk.getState()!.tick;
plan = { session: 'end', seq: 0, give: {}, stop: true };
await helperDone;
if (roleProc) {
    // The module's last announcement is stop; the role exits on it.
    const exited = await Promise.race([roleProc.exited.then(c => `exit ${c}`), Bun.sleep(30_000).then(() => 'still running')]);
    if (exited === 'still running') roleProc.kill();
    result('anvil role end', { exited });
}

// ---------------------------------------------------------------- report

const turn = reports.map(r => r.turnaround).filter((x): x is number => x !== null);
const hist: Record<number, number> = {};
for (const x of turn) hist[x] = (hist[x] ?? 0) + 1;
const mean = turn.length ? turn.reduce((a, b) => a + b, 0) / turn.length : NaN;
console.log(`\n${inventoryTable(reports)}`);
if (wantTimeline) {
    for (const r of reports.filter(x => x.turnaround !== null && (timelineAll || x.turnaround > 10))) {
        console.log(`\n-- seq ${r.seq}: last xp ${r.prevLastXp} -> click ${r.firstClick}`);
        for (let t = r.prevLastXp - 1; t <= r.firstClick; t++) console.log(`   ${t}: ${timeline.get(t) ?? '(no frame)'}`);
    }
}
const total = report(log.rows).totalTicks;
result('smithing acceptance', {
    supply, from, until, inventories: reports.length,
    ticksToLevel: reachedTick >= 0 ? reachedTick - t0 : null,
    ticksWithHandBack: t1 - t0,
    ledgerTotal: total,
    turnaround: { mean: Math.round(mean * 100) / 100, max: Math.max(...turn), min: Math.min(...turn), histogram: hist, over10: turn.filter(x => x > 10).length },
    tradeRetries: reports.reduce((a, r) => a + Math.max(0, r.tries - 1), 0),
    clickResends: reports.reduce((a, r) => a + r.resends, 0),
    announcements: announced.length,
    helperTrades: helperLog.length,
    helperFailures: helperLog.filter(x => !x.ok),
    finalInventory: scored.sdk.getState()!.inventory.map(i => i.name),
});
console.log(formatReport(report(log.rows)));
console.log(`log: ${log.path}`);
await closeSession(scored);
if (helper) await closeSession(helper);
process.exit(0);
