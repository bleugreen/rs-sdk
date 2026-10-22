// S25a demo acceptance (STEP-MANIFEST.md entry 10, "Acceptance, demo"): smithing.ts on a throwaway
// SCORED stand-in against rs/188's anvil role (speedrun/helpers/anvil.ts, which needs #179) on a
// throwaway helper, on the demo server. No staff commands: both accounts start fresh, and the
// helper's bars and hammer come from its own bank.
//
// Run from a checkout on the fleet host (credentials in bots/<name>/bot.env), in phases:
//   bun speedrun/lab/smithing-demo.ts helper --helper=<h> [--hammer] [--from=<g1>,<g2>,...] [--want='Bronze bar:10']
//       <h> out of the tutorial; with --hammer buys one at the Varrock general store; then at
//       Varrock west bank takes one trade from each named giver in turn (only from that giver),
//       banks everything and logs out. Prints AT_BANK once it stands there.
//   ... the helper's anvil role under speedrun/helpers/standalone.ts
//       ({account: <h>, role: 'anvil', final: true, options: {restock: {kind: 'bank'}, scope: {step: 'S25a', family: 'anvil'}}}), whose
//       cue directory is <runDir>/rc-cue.
//   bun speedrun/lab/smithing-demo.ts scored --scored=<s> --helper=<h> --cue=<runDir>/rc-cue
//       [--until=52] [--bars=bronze_bar] [--cap=25]
//       <s> out of the tutorial to the anvil tile through the demo relay; publishes cue.json and
//       seq 0, runs the module's steps (one trade per inventory of `cap` bars), prints the
//       per-inventory turnaround table, and logs out cleanly.

import type { Bar } from '../skills/smithing';
import { CueWriter } from '../helpers/altar-cue';
import { BANKS } from '../helpers/buyer';
import { waitForPlayer } from '../helpers/wine';
import { depositAll } from '../lib/bank';
import { closeSession, logoutClean, openSession, type Session } from '../lib/session';
import { formatReport, report } from '../lib/ticks';
import { travelTo } from '../lib/toll-gate';
import { receiveFrom } from '../lib/trade';
import { waitTicks, waitUntil } from '../lib/wait';
import { levelForXp } from '../lib/xp';
import { runSteps } from '../runner/step';
import { onTutorialIsland } from '../lib/world';
import { firstAnnouncement, inventoryTable, routePlan, PLAN_DEFAULTS, SCORED_TILE, smithingXp, steps, type AnvilPlanMsg, type InventoryReport } from '../skills/smithing';
import { arg, labLog, result } from './common';

const mode = process.argv[2];
/** Beside the Varrock general store's shopkeeper (buyer.ts SHOPS.varrockGeneral). */
const VARROCK_GENERAL = { x: 3217, z: 3413 };
const log = (m: string, d?: Record<string, unknown>) => console.log(`demo: ${m}${d ? ` ${JSON.stringify(d)}` : ''}`);

async function login(name: string): Promise<Session> {
    const s = await openSession(name, { launch: true, readyTimeoutMs: 180_000 });
    for (let i = 0; i < 30 && onTutorialIsland(s.sdk.getState()?.player); i++) {
        if (i === 0) log('skipping the tutorial', { account: name });
        await s.bot.skipTutorial();
        await waitTicks(s.sdk, 2);
    }
    if (onTutorialIsland(s.sdk.getState()?.player)) throw new Error(`${name}: could not leave the tutorial`);
    return s;
}

async function logout(s: Session): Promise<void> {
    const r = await logoutClean(s);
    result('logout', { account: s.name, ok: r.ok, latencyTicks: r.latencyTicks, ...(r.ok ? {} : { reason: (r as { reason?: string }).reason }) });
    await closeSession(s);
}

if (mode === 'helper') {
    const s = await login(arg('helper', ''));
    if (arg('hammer', '0') !== '0' && !s.sdk.getState()!.inventory.some(i => /^hammer$/i.test(i.name))) {
        const store = await travelTo(s.bot, s.sdk, VARROCK_GENERAL, { tolerance: 2, log });
        if (!store.ok) throw new Error(`travel to the Varrock general store: ${store.reason}`);
        const shop = await s.bot.openShop(/^shop (keeper|assistant)$/i);
        if (!shop.success) throw new Error(`openShop: ${shop.message}`);
        // A fresh account carries its starter kit but no coins: the general store buys any of it.
        const coins = () => s.sdk.getState()!.inventory.filter(i => /^coins$/i.test(i.name)).reduce((a, i) => a + i.count, 0);
        log('at the store', { coins: coins(), inventory: s.sdk.getState()!.inventory.map(i => `${i.count} ${i.name}`) });
        for (const item of [/^bronze sword$/i, /^bronze dagger$/i, /^wooden shield$/i, /^shortbow$/i, /^bronze axe$/i]) {
            if (coins() >= 10) break;
            if (!s.sdk.getState()!.inventory.some(i => item.test(i.name))) continue;
            const sold = await s.bot.sellToShop(item, 1);
            log('sold', { item: String(item), success: sold.success, coins: coins() });
        }
        const bought = await s.bot.buyFromShop(/^hammer$/i, 1);
        result('hammer', { success: bought.success, message: bought.message });
        await s.bot.closeShop();
        if (!bought.success) throw new Error('could not buy a hammer');
    }
    const travel = await travelTo(s.bot, s.sdk, BANKS.varrockWest, { tolerance: 3, log });
    if (!travel.ok) throw new Error(`travel to Varrock west bank: ${travel.reason}`);
    console.log('AT_BANK');
    const [wantName, wantN] = arg('want', 'Bronze bar:10').split(':');
    const want = [{ item: new RegExp(`^${wantName}$`, 'i'), amount: Number(wantN) }];
    for (const from of arg('from', '').split(',').filter(Boolean)) {
        console.log(`WAITING ${from}`);
        // receiveFrom needs the giver in view: it reports player_not_found rather than waiting.
        if (!(await waitForPlayer(s.sdk, from, Number(arg('waitMinutes', '20')) * 60_000))) {
            result('received', { from, ok: false, items: [], reason: 'giver never came into view' });
            continue;
        }
        const r = await receiveFrom(s.sdk, from, { want, openTimeoutMs: 120_000 });
        result('received', { from, ok: r.ok, items: r.received.map(i => `${i.count} ${i.name}`), ...(r.reason ? { reason: r.reason } : {}) });
    }
    const opened = await s.bot.openBank();
    if (!opened.success) throw new Error(`openBank: ${opened.message}`);
    await depositAll(s.sdk);
    await waitUntil(s.sdk, st => st.inventory.length === 0, { maxTicks: 10 });
    result('banked', { bank: s.sdk.getState()!.bank.items.map(i => `${i.count} ${i.name}`) });
    await s.bot.closeBank();
    await logout(s);
    process.exit(0);
}

if (mode !== 'scored') throw new Error('usage: smithing-demo.ts helper|scored ...');

const helperName = arg('helper', '');
const cueDir = arg('cue', '');
if (!helperName || !cueDir) throw new Error('scored needs --helper and --cue');
const untilLevel = Number(arg('until', '52'));
const plan = { bars: arg('bars', 'bronze_bar').split(',') as Bar[], cap: Number(arg('cap', String(PLAN_DEFAULTS.cap))) };

const s = await login(arg('scored', ''));
const xp0 = smithingXp(s.sdk.getState()!);
const route = routePlan(xp0, { ...PLAN_DEFAULTS, ...plan, untilLevel });
result('plan', { fromLevel: levelForXp(xp0), untilLevel, ...plan, inventories: route.map(i => i.segs.map(g => `${g.count} ${g.product.id}`).join(' + ')) });
const travel = await travelTo(s.bot, s.sdk, SCORED_TILE, { tolerance: 2, log });
if (!travel.ok) throw new Error(`travel to the anvil: ${travel.reason}`);

// The run's job (run.ts): cue.json naming SCORED by hash, and seq 0, before the anvil.
const anvilPath = '../helpers/anvil.ts';
const { writeAnvilPlan } = (await import(anvilPath)) as { writeAnvilPlan: (dir: string, m: AnvilPlanMsg) => unknown };
const st0 = s.sdk.getState()!;
new CueWriter(cueDir, st0.player!.name, { step: 'S25a', family: 'anvil' }).write({ beacons: [{ tick: st0.tick, ms: Date.now() }], turns: [] });
const announced: AnvilPlanMsg[] = [];
const announce = (m: AnvilPlanMsg) => { announced.push(m); writeAnvilPlan(cueDir, m); };
const tickLog = labLog('smithing-demo');
const first = firstAnnouncement(st0, `${tickLog.runId}/pre`, { untilLevel, plan });
if (!first) throw new Error('nothing to make');
announce(first);
const staged = await waitUntil(s.sdk, st => st.gameMessages.some(m => /wishes to trade with you/i.test(m.text)), { maxTicks: Number(arg('stageTicks', '900')) });
if (!staged.ok) throw new Error('the helper did not request within the staging window');

// --timeline=1: SCORED's view of every frame while a trade is open or just closed, printed at the
// end (also when a step throws), for trades the server ends without a decline from either side.
const timeline: string[] = [];
let seenMsgs = 0;
let lastTradeTick = -1;
const unsub = arg('timeline', '0') === '0' ? null : s.sdk.onStateUpdate(st => {
    const msgs = st.gameMessages.slice(seenMsgs).map(m => m.text);
    seenMsgs = st.gameMessages.length;
    const t = st.trade;
    if (t?.isOpen) lastTradeTick = st.tick;
    if (!t?.isOpen && st.tick - lastTradeTick > 3 && !msgs.length) return;
    const offer = (o: { name: string; count: number }[]) => o.map(i => `${i.count} ${i.name}`).join('+') || '-';
    const tr = t?.isOpen ? `${t.screen} mine[${offer(t.myOffer)}]${t.myAccepted ? '✓' : ''} theirs[${offer(t.theirOffer)}]${t.partnerAccepted ? '✓' : ''}` : 'closed';
    timeline.push(`${st.tick} free ${28 - st.inventory.length} at ${st.player?.worldX},${st.player?.worldZ} modal ${st.modalOpen ? st.modalInterface : '-'} if ${st.interface?.isOpen ? st.interface.interfaceId : '-'} dialog ${st.dialog.isOpen ? 'open' : '-'} trade ${tr}${msgs.length ? ` msgs: ${msgs.join(' | ')}` : ''}`);
});
if (unsub) {
    // Each trade-side action: the tick it was sent and the tick its result came back.
    const sdkAny = s.sdk as unknown as Record<string, (...a: unknown[]) => Promise<{ success?: boolean; message?: string }>>;
    for (const name of ['sendInteractPlayer', 'sendClickComponent', 'sendClickComponentWithOption', 'sendCloseModal']) {
        const orig = sdkAny[name]!.bind(s.sdk);
        sdkAny[name] = async (...a: unknown[]) => {
            const sent = s.sdk.getState()?.tick ?? -1;
            const r = await orig(...a);
            timeline.push(`${sent} SEND ${name}(${a.map(x => JSON.stringify(x)).join(',')}) -> ${s.sdk.getState()?.tick ?? -1} ${r?.success === false ? 'FAIL ' : ''}${r?.message ?? ''}`);
            return r;
        };
    }
}
const printTimeline = () => { if (unsub) console.log(`\n-- SCORED timeline (${timeline.length} frames)\n${timeline.slice(-150).join('\n')}`); };

const reports: InventoryReport[] = [];
const list = steps({ giver: helperName, supply: 'helper', untilLevel, plan, announce, onInventory: r => reports.push(r), log });
const t0 = s.sdk.getState()!.tick;
try {
    await runSteps(s, list, { log: tickLog, c: {}, shouldStop: () => false });
} catch (e) {
    printTimeline();
    console.log(`\n${inventoryTable(reports)}`);
    console.log(`steps failed: ${e instanceof Error ? e.message : String(e)}; inventory: ${s.sdk.getState()!.inventory.map(i => `${i.count} ${i.name}`).join(', ')}`);
    await logout(s);
    process.exit(1);
}
printTimeline();
const t1 = s.sdk.getState()!.tick;

console.log(`\n${inventoryTable(reports)}`);
const turn = reports.map(r => r.turnaround).filter((x): x is number => x !== null);
result('smithing demo', {
    scored: s.name, helper: helperName, untilLevel, ...plan,
    inventories: reports.length, ticks: t1 - t0, ledgerTotal: report(tickLog.rows).totalTicks,
    turnaround: { values: turn, mean: turn.length ? Math.round((turn.reduce((a, b) => a + b, 0) / turn.length) * 100) / 100 : null },
    tradeRetries: reports.reduce((a, r) => a + Math.max(0, r.tries - 1), 0),
    clickResends: reports.reduce((a, r) => a + r.resends, 0),
    announcements: announced.length,
    finalInventory: s.sdk.getState()!.inventory.map(i => i.name),
});
console.log(formatReport(report(tickLog.rows)));
console.log(`log: ${tickLog.path}`);
await logout(s);
process.exit(0);
