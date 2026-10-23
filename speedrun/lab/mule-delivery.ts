// Canonical banked mule delivery, not a second serving implementation.
// LAB_HELPERS=mdm01 NODE_TICKRATE=400 speedrun/lab/lab.sh mdr01 \
//   'speedrun/lab/mule-delivery.ts:--mule=mdm01'
// --rows=H1 measures initial staging separately. Default H4,H4k includes the
// real 20-ring take-back and the generated bank-return or carry-ahead path.
// Carry-ahead must retain every ring through H4k and deposit them afterward.
// All fixtures precede measurement; fresh lab accounts must have no quest unlocks.

import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { BotWorldState } from '../../sdk/types';
import { getDoorAt, isTileWalkable, isZoneAllocated } from '../../sdk/pathfinding';
import { CueWriter, writeTopUpAsk } from '../helpers/altar-cue';
import { isTopUp, role, type PackageItem } from '../helpers/mule';
import { muleFromLedger, muleRunOptions } from '../helpers/mule-ledger';
import { heldFor, readMulePreparation, readMuleReady, readyFor, worldTile, type MuleHold } from '../helpers/mule-readiness';
import { DeliveryOwner, holdCarrier } from '../runner/delivery-owner';
import { openRoleState } from '../helpers/role';
import { CueGate } from '../helpers/standalone';
import { depositAll } from '../lib/bank';
import { noteLink, objPack } from '../lib/obj-pack';
import { closeSession, isLoopbackHost, loadBotEnv, logoutClean, openSession, type Session } from '../lib/session';
import { swap } from '../lib/trade';
import { runTo, type Area } from '../lib/travel';
import { crossingsBetween } from '../lib/passages';
import { crossForDelivery } from '../helpers/delivery-cross';
import { nextTick, waitTicks, waitUntil } from '../lib/wait';
import { TILES } from '../runner/legs';
import { opIndex } from '../lib/world';
import { MANIFEST } from '../tools/slot-ledger';
import { fixtureSeedBatches, loadFixtureCatalog, planMuleDeliveryFixtures, type FixtureItem, type MuleDeliveryFixture, type RowFixtureOverrides } from './mule-delivery-fixtures';
import { arg, botArg, result } from './common';
import { cheat, clearInventory, leaveTutorial, mustTele, setStats } from './setup';

// Regional fixtures keep one receiver identity. Its bank resets and walking are
// ordinary actions, not the scored quest chain; they never pause/rebind the helper.
const regionRows: Record<string, string> = {
    east: 'H1,H4,H4k,H18,H19,H20,H21d,H22',
    west: 'H6,H4p,H7,H8,H9,H10,H12,H13,H14,H15,H16'
};
const region = arg('region', '');
if (region && !regionRows[region]) throw new Error('Unknown --region');
const ledgerFixtures = !!region || arg('fixtures', '') === 'ledger';
const rows = arg('rows', regionRows[region] ?? 'H4,H4k').split(',').filter(Boolean);
const onRequest = arg('on-request', '').split(',').filter(Boolean);
const selectedRows = [...rows, ...onRequest];
if (!ledgerFixtures && rows.join() !== 'H4,H4k' && rows.join() !== 'H1') throw new Error('Other rows require --fixtures=ledger');
const manifest = readFileSync(arg('manifest', MANIFEST), 'utf8');
const pack = objPack();
const overridesPath = arg('fixture-overrides', '');
const overrides = overridesPath ? JSON.parse(readFileSync(overridesPath, 'utf8')) as Record<string, RowFixtureOverrides> : undefined;
const itineraryPath = arg('itinerary', '');
const itineraryInput = itineraryPath ? JSON.parse(readFileSync(itineraryPath, 'utf8')) : undefined;
if (itineraryInput && (Object.keys(itineraryInput).join() !== 'rehearsal' || Object.keys(itineraryInput.rehearsal ?? {}).join() !== 'firemakingEnd'))
    throw new Error('--itinerary must contain only rehearsal.firemakingEnd');
const itinerary = itineraryInput ? { rehearsal: { firemakingEnd: worldTile(itineraryInput.rehearsal.firemakingEnd) } } : undefined;
const helperProfile = arg('profile', 'mule1');
if (!['mule1', 'h55-observed', 'h03-observed'].includes(helperProfile)) throw new Error('Unknown --profile');
const profileStats: Record<string, number> = helperProfile === 'h55-observed'
    ? { hitpoints: 90, attack: 29, defence: 27, strength: 27, magic: 99 }
    : helperProfile === 'h03-observed' ? { hitpoints: 69, attack: 85, thieving: 99 } : { hitpoints: 10 };
// Production h03 (main's brief): HP69, coins 1670 and 21 kebabs (1971) at (3213,3463,0); its bank is unknown.
const protectedInventory = helperProfile === 'h03-observed' ? [{ id: 995, count: 1670 }, { id: 1971, count: 21 }] : [];
const observedStart = { x: 3213, z: 3463, level: 0 };
const idleMs = Number(arg('idle-ms', '0'));
const idleRow = arg('idle-row', selectedRows[0] ?? '');
if (!Number.isSafeInteger(idleMs) || idleMs < 0 || idleMs > 3_600_000 || (idleMs > 0 && (!ledgerFixtures || !selectedRows.includes(idleRow))))
    throw new Error('Invalid idle fixture');
// Policy-B initial hold: the harness is the run owner, writing the hold before the helper starts.
const holdMs = Number(arg('hold-ms', '0'));
if (!Number.isSafeInteger(holdMs) || holdMs < 0 || holdMs > 14_400_000 || (holdMs > 0 && (!ledgerFixtures || selectedRows.length !== 1 || idleMs > 0)))
    throw new Error('Invalid hold fixture: one ledger row, at most 4h, never combined with --idle-ms');
const stopOnRow = arg('stop-on-row', '');
if (stopOnRow && (selectedRows.join() !== 'H20' || stopOnRow !== 'H20' || !ledgerFixtures)) throw new Error('Row-stop proof is restricted to H20-only ledger fixture');
if (helperProfile === 'h03-observed' && (selectedRows.join() !== 'H20' || (idleMs <= 600_000 && holdMs <= 600_000) || stopOnRow !== 'H20'))
    throw new Error('Observed h03 fixture requires H20-only, a >10min idle or initial hold and canonical row stop');
const recipientProfile = arg('recipient-profile', 'fresh');
if (!['fresh', 's14-exit-ranged70'].includes(recipientProfile)) throw new Error('Unknown --recipient-profile');
if (recipientProfile !== 'fresh' && !ledgerFixtures) throw new Error('Recipient exit profile requires ledger fixtures');
const recipientStats: Record<string, number> = recipientProfile === 's14-exit-ranged70' ? { hitpoints: 10, ranged: 70 } : { hitpoints: 10 };
const recipientProfileSource = recipientProfile === 's14-exit-ranged70'
    ? 'Parent-authorized LAB-only initial Ranged70: RUN-ORDER S14 65→70 and STEP-MANIFEST pre-Monkey-Madness cannon exit; other skills unchanged, no quest flags'
    : 'Fresh lab character';
const fixturePlan = ledgerFixtures ? planMuleDeliveryFixtures({ manifest, rows, onRequest, pack, overrides, itinerary }) : null;
if (arg('plan-only', '') === 'true') {
    if (!fixturePlan) throw new Error('--plan-only requires --fixtures=ledger');
    result('mule-fixture-plan', fixturePlan);
    process.exit(fixturePlan.ok ? 0 : 1);
}
if (fixturePlan && !fixturePlan.ok) {
    result('mule-fixture-unresolved', fixturePlan);
    process.exit(1);
}
const account = arg('mule', '');
if (!account || account === botArg()) throw new Error('--mule must name a separate fresh lab account');
for (const name of [account, botArg()]) {
    const env = loadBotEnv(name);
    if (!env.SERVER || !isLoopbackHost(env.SERVER)) throw new Error('Lab-only harness refuses non-loopback worlds');
}
const root = mkdtempSync(join(tmpdir(), 'mule-delivery-'));
const runId = `lab-${Date.now()}`;
const ledger = muleFromLedger(manifest, { rows, onRequest, pack });
// The planner binds only validated concrete identities, retaining canonical quantities.
const options = muleRunOptions(fixturePlan?.fixtures.map(f => f.ledger) ?? ledger, root, { deliveryRun: runId, serve: botArg(), itinerary });
const carriesNext = options.packages[0]?.carryNext === true;
// The runner's run-owner sequence (prepare, readiness, the row's delivery session), not a lab copy.
const owner = new DeliveryOwner(options.cueDir, runId, botArg(), selectedRows.map((row, i) => ({ row, account, at: options.packages[i]!.at })));
writeFileSync(join(root, 'options.json'), JSON.stringify(options, null, 2));
const maxTicks = Number(arg('max-ticks', '1200'));
if (!Number.isInteger(maxTicks) || maxTicks < 1) throw new Error('Invalid --max-ticks');
const evidence: Record<string, unknown>[] = [];
const sessions: Session[] = [];
let mule!: Session;
let scored!: Session;
let running: Promise<void> | undefined;
let roleError: unknown;
const stop = new AbortController();
let unsubscribe: (() => void) | undefined;
let cue: CueWriter | undefined;
let pass = false;
let deadlinePass: boolean | null = null;
let startTick = -1;
let h4TradeTick: number | null = null;
let h4kReadyTick: number | null = null;
let h4kTradeTick: number | null = null;
let bankBetweenTrades = false;
let maxInventorySlots = 0;
let ringDepositTick: number | null = null;
let minHp = Number.POSITIVE_INFINITY;
let previousBankRings = 0;
const handOffTicks = new Map<string, number>();
const probedRoutes = new Set<string>();
const rowTimings: Record<string, unknown>[] = [];
const expectedReady = new Map<number, Parameters<typeof readyFor>[1]>();
let lastBank = '';
let finalBankTick: number | null = null;
let removeAskListener: (() => void) | undefined;
const traceTrades = arg('trace-trades', '') === 'true';
const removeTraces: Array<() => void> = [];
let activeRow: string | null = null;
let gate: CueGate | undefined;
let gateStopped = false;
let roleCompleted = false;
let lastObservedBank: Array<{ id: number; count: number }> = [];
let idleProof: Record<string, unknown> | null = null;
let logoutProof: Awaited<ReturnType<typeof logoutClean>> | null = null;
let holdProof: Record<string, unknown> | null = null;
let holding = false;
const holdActions = new Map<string, number>();
let holdKeepAlives = 0;

async function idleBeforeArrival(index: number) {
    const expected = expectedReady.get(index)!;
    const initial = mule.sdk.getState()!;
    const held = initial.inventory.map(i => ({ id: i.id, count: i.count }));
    const worn = initial.equipment.map(i => ({ id: i.id, count: i.count }));
    const sessionId = mule.sessionId;
    const begun = Date.now();
    let samples = 0, idleHpMin = initial.player!.hp, lastTick = initial.tick, nextReport = begun;
    emit('idle-start', { row: selectedRows[index], requestedMs: idleMs, expected, sessionId, client: mule.client, snapshot: snapshot(initial) });
    while (Date.now() - begun < idleMs) {
        const s = await nextTick(mule.sdk, lastTick);
        lastTick = s.tick;
        if (roleError) throw roleError;
        const p = s.player;
        const at = expected.at;
        if (mule.sessionId !== sessionId || !s.inGame || !p || p.isDead || p.hp <= 0 || p.worldX !== at.x || p.worldZ !== at.z || p.level !== at.level)
            throw new Error('Idle helper left exact stand, session or life');
        if (s.bank.isOpen || s.trade?.isOpen || s.dialog.isOpen || s.modalOpen || s.interface?.isOpen || s.shop?.isOpen)
            throw new Error('Idle helper opened an interface');
        assertItems(s.inventory, held, 'Idle retained inventory');
        assertItems(s.equipment, worn, 'Idle retained equipment');
        const ready = readMuleReady(options.cueDir, account);
        if (!readyFor(ready, expected)) throw new Error('Idle readiness generation or freshness lost');
        idleHpMin = Math.min(idleHpMin, p.hp);
        samples++;
        if (Date.now() >= nextReport) {
            emit('idle-health', { elapsedMs: Date.now() - begun, tick: s.tick, hp: p.hp, idleHpMin, ready, samples });
            nextReport = Date.now() + 30_000;
        }
    }
    idleProof = { row: selectedRows[index], elapsedMs: Date.now() - begun, startTick: initial.tick, endTick: lastTick, samples, idleHpMin, sessionId, client: mule.client };
    emit('idle-complete', { ...idleProof, snapshot: snapshot(mule.sdk.getState()) });
}

/**
 * Every received tick of the initial hold, until --hold-ms elapses: (a) fresh generation-bound
 * held status; (b) the control unchanged and the helper on its held tile (never self-arms);
 * (c) inventory and equipment unchanged (unstaged); (d) same session, alive, no interface;
 * (e) the helper sends nothing but the role's keep-alive wait. Only awaitReady's prepare releases it.
 */
async function holdBeforePrepare(hold: MuleHold) {
    const expected = { runId, account, row: hold.row, receiver: botArg(), preparationSeq: hold.seq };
    const first = await waitUntil(mule.sdk, () => !!roleError || heldFor(readMuleReady(options.cueDir, account), expected), { maxTicks: 50 });
    if (roleError) throw roleError;
    if (!first.ok) throw new Error('hold assertion (a) failed: held status never published');
    const initial = mule.sdk.getState()!;
    const tile = { x: initial.player!.worldX, z: initial.player!.worldZ, level: initial.player!.level };
    const held = initial.inventory.map(i => ({ id: i.id, count: i.count }));
    const worn = initial.equipment.map(i => ({ id: i.id, count: i.count }));
    assertItems(held, protectedInventory, 'hold assertion (c): held helper starts with only its personal inventory');
    const sessionId = mule.sessionId;
    const begun = Date.now();
    const passes = { a: 0, b: 0, c: 0, d: 0, e: 0 };
    let lastTick = initial.tick, maxStatusAgeMs = 0, hpMin = initial.player!.hp, nextReport = begun;
    // Cadence evidence, all on this process's Date.now() (the role runs in-process and stamps with the same clock):
    // frame = harness sighting of each new SDK tick; status = the role's observedMs stamp; loop = event-loop lag.
    const cadence = { frameGapMs: [] as number[], statusGapMs: [] as number[], statusAgeMs: [] as number[], loopLagMs: [] as number[] };
    const recentStatus: Array<{ tick: number; ms: number; checkedMs: number; checkedTick: number }> = [];
    let frameTick = initial.tick, lastFrameMs = 0, lastStatusMs = 0, lagMark = Date.now();
    const unsubscribeFrames = mule.sdk.onStateUpdate(st => {
        if (st.tick <= frameTick) return;
        const at = Date.now();
        if (lastFrameMs) cadence.frameGapMs.push(at - lastFrameMs);
        lastFrameMs = at;
        frameTick = st.tick;
    });
    const lagTimer = setInterval(() => { const at = Date.now(); cadence.loopLagMs.push(at - lagMark - 100); lagMark = at; }, 100);
    const cadenceStats = () => Object.fromEntries(Object.entries(cadence).map(([name, values]) => {
        if (!values.length) return [name, null];
        const sorted = [...values].sort((x, y) => x - y);
        return [name, { n: sorted.length, min: sorted[0], median: sorted[sorted.length >> 1], p99: sorted[Math.floor(sorted.length * 0.99)], max: sorted.at(-1) }];
    }));
    // The recipient is not under test; its periodic wait keeps the client's idle timer from logging it out.
    let nextRecipientInput = begun + 240_000;
    const fail = (letter: string, why: string, s: BotWorldState): never => {
        emit('hold-failure-record', { letter, why, tick: s.tick, elapsedMs: Date.now() - begun, passes, cadence: cadenceStats(), recentStatus: recentStatus.slice(-20) });
        throw new Error(`hold assertion (${letter}) failed at ${new Date().toISOString()} after ${Date.now() - begun}ms, tick ${s.tick}: ${why}`);
    };
    holding = true;
    emit('hold-start', { hold, expected, tile, sessionId, client: mule.client, requestedMs: holdMs, snapshot: snapshot(initial) });
    try {
        while (Date.now() - begun < holdMs) {
            const s = await nextTick(mule.sdk, lastTick);
            lastTick = s.tick;
            if (roleError) throw roleError;
            const now = Date.now();
            const status = readMuleReady(options.cueDir, account);
            if (status) {
                recentStatus.push({ tick: status.tick, ms: status.ms, checkedMs: now, checkedTick: s.tick });
                if (recentStatus.length > 40) recentStatus.shift();
                if (status.ms !== lastStatusMs) { if (lastStatusMs) cadence.statusGapMs.push(status.ms - lastStatusMs); lastStatusMs = status.ms; }
                cadence.statusAgeMs.push(now - status.ms);
            }
            if (!status || !heldFor(status, expected, now)) fail('a', 'no fresh held status: ' + JSON.stringify(status), s);
            maxStatusAgeMs = Math.max(maxStatusAgeMs, now - status!.ms);
            passes.a++;
            const control = readMulePreparation(options.cueDir, account);
            const p = s.player;
            if (!isDeepStrictEqual(control, hold)) fail('b', 'control changed: ' + JSON.stringify(control), s);
            if (!p || p.worldX !== tile.x || p.worldZ !== tile.z || p.level !== tile.level) fail('b', 'helper left its held tile: ' + JSON.stringify(snapshot(s)?.player), s);
            passes.b++;
            try {
                assertItems(s.inventory, held, 'inventory');
                assertItems(s.equipment, worn, 'equipment');
            } catch (error) { fail('c', String(error), s); }
            passes.c++;
            if (mule.sessionId !== sessionId || !s.inGame || !p || p.isDead || p.hp <= 0) fail('d', 'session or life lost', s);
            if (s.bank.isOpen || s.trade?.isOpen || s.dialog.isOpen || s.modalOpen || s.interface?.isOpen || s.shop?.isOpen) fail('d', 'an interface opened', s);
            passes.d++;
            const foreign = [...holdActions.keys()].filter(type => type !== 'wait');
            if (foreign.length) fail('e', 'helper sent ' + JSON.stringify(Object.fromEntries(holdActions)), s);
            passes.e++;
            hpMin = Math.min(hpMin, p!.hp);
            if (now >= nextRecipientInput) { await scored.sdk.sendWait(1); nextRecipientInput = now + 240_000; }
            if (now >= nextReport) {
                emit('hold-health', { elapsedMs: now - begun, tick: s.tick, passes, statusAgeMs: now - status!.ms, maxStatusAgeMs,
                    phase: status!.phase, hp: p!.hp, hpMin, tile, keepAlives: holdKeepAlives, actions: Object.fromEntries(holdActions), sessionId, cadence: cadenceStats() });
                nextReport = now + 60_000;
            }
        }
    } finally {
        holding = false;
        clearInterval(lagTimer);
        unsubscribeFrames();
    }
    holdProof = { row: hold.row, seq: hold.seq, attempt: hold.attempt, elapsedMs: Date.now() - begun, startTick: initial.tick, endTick: lastTick,
        passes, maxStatusAgeMs, cadence: cadenceStats(), hpMin, tile, keepAlives: holdKeepAlives, actions: Object.fromEntries(holdActions), sessionId, client: mule.client };
    emit('hold-complete', { ...holdProof, snapshot: snapshot(mule.sdk.getState()) });
}

function tradeFrame(s: BotWorldState | null) {
    return s && { tick: s.tick, player: s.player && { x: s.player.worldX, z: s.player.worldZ, level: s.player.level },
        open: s.trade?.isOpen, screen: s.trade?.screen, partner: s.trade?.partner,
        myAccepted: s.trade?.myAccepted, partnerAccepted: s.trade?.partnerAccepted };
}
function traceFields() {
    return { row: activeRow, mule: tradeFrame(mule.sdk.getState()), scored: tradeFrame(scored.sdk.getState()) };
}
function installTradeTrace(session: Session) {
    const request = session.sdk.sendTradeRequest.bind(session.sdk);
    session.sdk.sendTradeRequest = playerIndex => {
        emit('trade-request-call', { actor: session.name, playerIndex, ...traceFields() });
        const pending = request(playerIndex);
        void pending.then(response => emit('trade-request-result', { actor: session.name, playerIndex, response, ...traceFields() }),
            error => emit('trade-request-error', { actor: session.name, error: String(error), ...traceFields() }));
        return pending;
    };
    removeTraces.push(() => { session.sdk.sendTradeRequest = request; });
    removeTraces.push(session.sdk.onStateUpdate(() => {
        const fields = traceFields();
        const a = fields.mule?.player, b = fields.scored?.player;
        if (fields.mule?.open || fields.scored?.open || (a && b && a.level === b.level && Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z)) <= 16))
            emit('trade-frame', { source: session.name, ...fields });
    }));
}

function snapshot(s: BotWorldState | null) {
    return s && {
        tick: s.tick, inGame: s.inGame,
        player: s.player && { x: s.player.worldX, z: s.player.worldZ, level: s.player.level, hp: s.player.hp, dead: s.player.isDead },
        inventory: s.inventory.map(i => ({ id: i.id, name: i.name, count: i.count })),
        equipment: s.equipment,
        skills: s.skills.map(i => ({ name: i.name, base: i.baseLevel, level: i.level })),
        bankOpen: s.bank.isOpen, trade: s.trade, dialogOpen: s.dialog.isOpen
    };
}
function emit(event: string, fields: Record<string, unknown> = {}) {
    const record = { event, ms: Date.now(), muleTick: mule?.sdk.getState()?.tick ?? null, ...fields };
    evidence.push(record);
    appendFileSync(join(root, 'events.jsonl'), JSON.stringify(record) + '\n');
    console.log(JSON.stringify(record));
}
function itemId(line: PackageItem): number {
    if (line.id !== undefined) return noteLink(line.id, pack).item;
    const name = line.item!.toLowerCase();
    const debug = [name.replace(/ /g, '_'), name.replace(/ /g, '')].find(n => pack.ids.has(n));
    if (!debug) throw new Error(`No fixture obj for ${line.item}`);
    return pack.ids.get(debug)!;
}
function amount(line: PackageItem): number {
    if (isTopUp(line)) throw new Error('This measurement has no top-up fixture');
    if (line.amount < 1) throw new Error('Fixture needs exact positive ledger quantities');
    return line.amount;
}
function assertItems(actual: ReadonlyArray<{ id: number; count: number }>, expected: ReadonlyArray<{ id: number; count: number }>, label: string) {
    const counts = (items: ReadonlyArray<{ id: number; count: number }>) => {
        const map = new Map<number, number>();
        for (const item of items) map.set(item.id, (map.get(item.id) ?? 0) + item.count);
        return [...map].sort((a, b) => a[0] - b[0]);
    };
    if (JSON.stringify(counts(actual)) !== JSON.stringify(counts(expected))) throw new Error(`${label}: actual ${JSON.stringify(counts(actual))}, expected ${JSON.stringify(counts(expected))}`);
}
const expectedItems = (items: readonly PackageItem[]) => items.map(line => ({ id: line.noted ? noteLink(itemId(line), pack).note! : itemId(line), count: amount(line) }));
function profile() {
    const st = mule.sdk.getState()!;
    const wrong = st.skills.filter(s => s.baseLevel !== (profileStats[s.name.toLowerCase()] ?? 1));
    const worn = helperProfile === 'h55-observed' ? [{ id: 1381, count: 1 }] : [];
    assertItems(st.equipment, worn, 'Observed helper equipment profile');
    if (wrong.length || st.player?.hp !== profileStats.hitpoints) throw new Error(`Helper profile ${helperProfile} differs: ${JSON.stringify(snapshot(st))}`);
}
async function seedBank() {
    const opened = await mule.bot.openBank();
    if (!opened.success) throw new Error(`Fixture bank: ${opened.message}`);
    // tutorial_complete seeds 25 coins even on a brand-new account.
    const initial = mule.sdk.getBankItems();
    if (initial.some(i => i.id !== 995 || i.count !== 25)) throw new Error(`Unexpected fresh bank: ${JSON.stringify(initial)}`);
    for (const p of options.packages) {
        for (const line of p.items) {
            const id = itemId(line);
            const obj = pack.names.get(noteLink(id, pack).note ?? id)!;
            const before = mule.sdk.getInventory().reduce((n, i) => n + i.count, 0);
            await cheat(mule.sdk, `give ${obj} ${amount(line)}`);
            const got = await waitUntil(mule.sdk, s => s.inventory.reduce((n, i) => n + i.count, 0) === before + amount(line), { maxTicks: 15 });
            if (!got.ok) throw new Error(`Fixture give failed: ${obj}`);
            if (!(await depositAll(mule.sdk)).ok) throw new Error(`Fixture deposit failed: ${obj}`);
        }
    }
    emit('fixture-bank', { items: mule.sdk.getBankItems() });
    await mule.bot.closeBank();
    await waitTicks(mule.sdk, 2);
}
async function seedStock(session: Session, batches: FixtureItem[][], label: string) {
    if (!(await session.bot.openBank()).success) throw new Error(label + ': fixture bank unavailable');
    const initial = session.sdk.getBankItems();
    if (initial.some(i => i.id !== 995 || i.count !== 25)) throw new Error(label + ': unexpected fresh bank');
    for (const batch of batches) {
        for (const item of batch) {
            const before = session.sdk.getInventory().filter(i => i.id === item.id).reduce((n, i) => n + i.count, 0);
            await cheat(session.sdk, `give ${item.debugName} ${item.count}`);
            if (!(await waitUntil(session.sdk, s => s.inventory.filter(i => i.id === item.id).reduce((n, i) => n + i.count, 0) === before + item.count, { maxTicks: 15 })).ok)
                throw new Error(label + ': fixture give failed for ' + item.debugName);
        }
        assertItems(session.sdk.getInventory(), batch, label + ' seed batch');
        if (!(await depositAll(session.sdk)).ok) throw new Error(label + ': fixture deposit failed');
    }
    emit('fixture-bank', { account: session.name, label, items: session.sdk.getBankItems() });
    await session.bot.closeBank();
}
async function withdrawFixture(items: FixtureItem[]) {
    for (const item of items) {
        const live = scored.sdk.getBankItems().find(i => i.id === item.bankId);
        if (!live || !(await scored.bot.withdrawItem(live, item.count, { asNote: item.kind === 'n' })).success)
            throw new Error('Recipient fixture withdrawal failed: ' + item.debugName);
    }
}
async function equipFixture(items: FixtureItem[]) {
    for (const item of items) {
        const live = scored.sdk.getInventory().find(i => i.id === item.id);
        if (!live) throw new Error('Recipient equipment missing: ' + item.debugName);
        const op = opIndex(live, /^(wear|wield)$/i);
        if (op === undefined) throw new Error('Recipient item cannot equip: ' + item.debugName);
        await scored.sdk.sendUseItem(live.slot, op);
        if (!(await waitUntil(scored.sdk, s => s.equipment.some(i => i.id === item.id && i.count === item.count), { maxTicks: 8 })).ok)
            throw new Error('Recipient profile cannot equip ' + item.debugName);
    }
}
async function recipientTravel(to: Area, row: string, purpose: 'bank' | 'meeting') {
    const start = scored.sdk.getState()!;
    const player = start.player;
    if (!player) throw new Error('Recipient has no position');
    const stopReason = () => {
        const state = scored.sdk.getState();
        return stop.signal.aborted ? 'lab stopped' : !state?.player || state.player.isDead || state.player.hp <= 0 ? 'recipient died or left game' : null;
    };
    const legs: Awaited<ReturnType<typeof runTo>>[] = [];
    const walk = async (at: Area) => {
        const leg = await runTo(scored.sdk, at, { bot: scored.bot, stopIf: stopReason });
        legs.push(leg);
        return leg;
    };
    try {
        const crossings = player.level === 0 && (to.level ?? 0) === 0
            ? crossingsBetween({ x: player.worldX, z: player.worldZ }, to) ?? [] : [];
        for (const crossing of crossings) await crossForDelivery({
            sdk: scored.sdk, stopped: () => stopReason() !== null,
            log: (message, data) => emit('recipient-passage', { row, purpose, message, ...data }),
            walk: async at => { const leg = await walk({ ...at, level: 0, tol: 0 }); if (!leg.ok) throw new Error(leg.reason); }
        }, crossing);
        return await walk(to);
    } finally {
        const endTick = scored.sdk.getState()!.tick;
        emit('recipient-route', { row, purpose, startTick: start.tick, endTick, ticks: endTick - start.tick, legs });
    }
}
/**
 * runTo accepts the receiving area's tolerance while its queued run click can still carry the
 * recipient onto the helper's exact stand; the helper's adjacent trade click then auto-steps it
 * off that stand. The recipient stops where it arrived and settles before any trade.
 */
async function settleRecipient(row: string) {
    const here = scored.sdk.getState()!.player!;
    await scored.sdk.sendWalk(here.worldX, here.worldZ, false);
    let last = '', same = 0;
    const settled = await waitUntil(scored.sdk, s => {
        const at = `${s.player?.worldX},${s.player?.worldZ},${s.player?.level}`;
        same = at === last ? same + 1 : 0;
        last = at;
        return same >= 2;
    }, { maxTicks: 12 });
    emit('recipient-settled', { row, ok: settled.ok, scored: snapshot(scored.sdk.getState())?.player, mule: snapshot(mule.sdk.getState())?.player });
    if (!settled.ok) throw new Error('Recipient did not settle at ' + row);
}
async function prepareRecipient(fixture: MuleDeliveryFixture) {
    const travel = await recipientTravel(fixture.bank, fixture.row, 'bank');
    emit('recipient-reset-travel', { row: fixture.row, travel });
    if (!travel.ok || !(await scored.bot.openBank()).success) throw new Error('Recipient cannot reach fixture bank');
    if (!(await depositAll(scored.sdk)).ok) throw new Error('Recipient deposit failed');
    await scored.bot.closeBank();
    for (const item of scored.sdk.getState()!.equipment) await scored.sdk.sendUseEquipmentItem(item.slot, opIndex(item, /^remove$/i) ?? 1);
    if (!(await waitUntil(scored.sdk, s => !s.equipment.length, { maxTicks: 10 })).ok) throw new Error('Recipient unequip failed');
    if (!(await scored.bot.openBank()).success || !(await depositAll(scored.sdk)).ok) throw new Error('Recipient equipment deposit failed');
    await withdrawFixture(fixture.beforeEquipment);
    await scored.bot.closeBank();
    await equipFixture(fixture.beforeEquipment);
    if (!(await scored.bot.openBank()).success) throw new Error('Recipient inventory bank unavailable');
    await withdrawFixture(fixture.beforeInventory);
    await scored.bot.closeBank();
    assertItems(scored.sdk.getInventory(), fixture.beforeInventory, fixture.row + ' recipient before inventory');
    assertItems(scored.sdk.getState()!.equipment, fixture.beforeEquipment, fixture.row + ' recipient before equipment');
    emit('recipient-reset', { row: fixture.row, snapshot: snapshot(scored.sdk.getState()) });
}
async function awaitReady(index: number) {
    const bound = owner.prepare(selectedRows[index]!);
    expectedReady.set(index, bound);
    emit('prepare', { expected: bound });
    const begin = mule.sdk.getState()!.tick;
    while (mule.sdk.getState()!.tick - begin < maxTicks) {
        if (roleError) throw roleError;
        const state = mule.sdk.getState()!;
        if (!state.inGame || !state.player || state.player.isDead || state.player.hp <= 0) throw new Error('Mule died or left game');
        const { ok, status: ready } = owner.ready(selectedRows[index]!);
        if (ok) {
            const fixture = fixturePlan?.fixtures[index];
            if (fixture) assertItems(state.inventory, fixture.helperBeforeInventory, fixture.row + ' full staged helper inventory');
            const previous = selectedRows[index - 1];
            const previousTradeTick = previous ? handOffTicks.get(previous) : undefined;
            const timing = { row: selectedRows[index], previous: previous ?? null, previousTradeTick: previousTradeTick ?? null,
                readyTick: state.tick, ticks: state.tick - (previousTradeTick ?? startTick), minHp };
            rowTimings.push(timing);
            emit('row-ready-timing', timing);
            emit('ready', { row: selectedRows[index], ready, snapshot: snapshot(state) });
            return state.tick;
        }
        if (ready?.phase === 'fault') throw new Error('Canonical role reports fault');
        await nextTick(mule.sdk);
    }
    throw new Error(`Readiness timeout for ${selectedRows[index]}`);
}

try {
    scored = await openSession(botArg()); sessions.push(scored);
    mule = await openSession(account); sessions.push(mule);
    // The ordinary tutorial skip restores side tabs; it grants no quest or stat unlock.
    for (const s of sessions) { await leaveTutorial(s); await clearInventory(s.sdk); }
    if (helperProfile === 'h55-observed') {
        // Parent observed this western carrier's public profile, not quest stages.
        // Its Magic level is reproduced without granting any spell kit or unlock.
        await setStats(mule.sdk, profileStats);
        await cheat(mule.sdk, 'give staff_of_air 1');
        if (!(await waitUntil(mule.sdk, s => s.inventory.some(i => i.id === 1381), { maxTicks: 15 })).ok) throw new Error('Observed staff fixture missing');
        const staff = mule.sdk.getInventory().find(i => i.id === 1381)!;
        await mule.sdk.sendUseItem(staff.slot, opIndex(staff, /^wield$/i) ?? 2);
        if (!(await waitUntil(mule.sdk, s => s.equipment.some(i => i.id === 1381), { maxTicks: 8 })).ok) throw new Error('Observed staff fixture equip failed');
    }
    if (helperProfile === 'h03-observed') await setStats(mule.sdk, profileStats);
    profile();
    if (recipientProfile !== 'fresh') await setStats(scored.sdk, { ranged: 70 });
    const recipientState = scored.sdk.getState()!;
    if (recipientState.skills.some(s => s.baseLevel !== (recipientStats[s.name.toLowerCase()] ?? 1)))
        throw new Error('Recipient fixture profile differs: ' + JSON.stringify(snapshot(recipientState)));
    emit('recipient-profile', { recipientProfile, recipientStats, provenance: recipientProfileSource, snapshot: snapshot(recipientState) });
    const first = options.packages[0]!;
    await mustTele(mule.sdk, first.bank.x, first.bank.z, first.bank.level);
    if (fixturePlan) {
        await seedStock(mule, fixturePlan.seedBatches!, 'helper');
        if (protectedInventory.length) {
            for (const item of protectedInventory) {
                const name = pack.names.get(item.id);
                if (!name) throw new Error('Missing observed inventory object');
                await cheat(mule.sdk, `give ${name} ${item.count}`);
                if (!(await waitUntil(mule.sdk, s => s.inventory.filter(i => i.id === item.id).reduce((n, i) => n + i.count, 0) === item.count, { maxTicks: 15 })).ok)
                    throw new Error('Observed initial inventory fixture failed');
            }
            assertItems(mule.sdk.getInventory(), protectedInventory, 'Observed h03 initial inventory');
            await mustTele(mule.sdk, observedStart.x, observedStart.z, observedStart.level);
            emit('observed-inventory-profile', { source: 'Production h03 actual profile per main (rs/551 brief): HP69, coins1670 + kebabs21 at (3213,3463,0); bank UNKNOWN; tutorial bank25 retained as LAB bootstrap only', snapshot: snapshot(mule.sdk.getState()) });
        }
        await mustTele(scored.sdk, first.bank.x, first.bank.z, first.bank.level);
        const catalog = loadFixtureCatalog(pack);
        const stock = fixturePlan.fixtures.flatMap(f => [...f.beforeInventory, ...f.beforeEquipment]);
        await seedStock(scored, fixtureSeedBatches(stock, pack, catalog), 'recipient');
        await prepareRecipient(fixturePlan.fixtures[0]!);
        const arrival = fixturePlan.fixtures[0]!.receivingArea;
        if (!(idleMs > 0 && idleRow === selectedRows[0]) && holdMs === 0) await mustTele(scored.sdk, arrival.x, arrival.z, arrival.level);
        emit('fixture-plan', { plan: fixturePlan, recipientMode: 'single identity, real bank resets, no scored quest simulation' });
    } else {
        await mustTele(scored.sdk, first.at.x + 1, first.at.z, first.at.level);
        await seedBank();
    }
    if (!fixturePlan && rows[0] === 'H4') {
        await cheat(scored.sdk, 'give ring_of_recoil 20');
        if (!(await waitUntil(scored.sdk, s => s.inventory.filter(i => i.id === 2550).reduce((n, i) => n + i.count, 0) === 20, { maxTicks: 15 })).ok)
            throw new Error('Recipient did not receive 20 lab-only enchanted rings');
    }
    profile();
    startTick = mule.sdk.getState()!.tick;
    minHp = mule.sdk.getState()!.player!.hp;
    emit('measurement-start', { revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), rows, options, helperProfile, profileStats, protectedInventory, idleMs, idleRow, holdMs, stopOnRow, recipientProfile, recipientStats, recipientProfileSource, itinerary: itinerary ?? null, tickRate: process.env.NODE_TICKRATE, mule: snapshot(mule.sdk.getState()), scored: snapshot(scored.sdk.getState()), root });
    if (traceTrades) for (const session of sessions) installTradeTrace(session);
    let lastPhase = '';
    unsubscribe = mule.sdk.onStateUpdate(st => {
        minHp = Math.min(minHp, st.player?.hp ?? 0);
        maxInventorySlots = Math.max(maxInventorySlots, st.inventory.length);
        if (h4TradeTick !== null && h4kTradeTick === null && st.bank.isOpen) bankBetweenTrades = true;
        const ready = readMuleReady(options.cueDir, account);
        const phase = JSON.stringify([ready?.row, ready?.phase, st.bank.isOpen, st.trade?.isOpen]);
        if (phase !== lastPhase || (st.tick - startTick) % 25 === 0) {
            lastPhase = phase;
            emit('observe', { ready, snapshot: snapshot(st) });
        }
        if (st.bank.isOpen) {
            lastObservedBank = st.bank.items.map(i => ({ id: i.id, count: i.count }));
            const bank = JSON.stringify(st.bank.items.map(i => ({ id: i.id, count: i.count })));
            if (bank !== lastBank) {
                lastBank = bank;
                emit('bank-change', { items: st.bank.items, inventory: st.inventory });
            }
            if (handOffTicks.size === selectedRows.length && !st.inventory.length) finalBankTick = st.tick;
            const rings = st.bank.items.filter(i => i.id === 2550).reduce((n, i) => n + i.count, 0);
            if (rings !== previousBankRings) {
                previousBankRings = rings;
                if (rings === 20 && h4TradeTick !== null) ringDepositTick = st.tick;
                emit('bank-rings', { rings, items: st.bank.items });
            }
        }
    });
    // Every helper action funnels through sendAction; during the hold each one is counted by type.
    const muleActions = mule.sdk as unknown as { sendAction(action: { type: string }): Promise<unknown> };
    const sendAction = muleActions.sendAction.bind(mule.sdk);
    muleActions.sendAction = action => {
        if (holding) holdActions.set(action.type, (holdActions.get(action.type) ?? 0) + 1);
        return sendAction(action);
    };
    // As the runner preflight does, the hold exists before the helper's role starts.
    const initialHold = holdMs > 0 ? holdCarrier(options.cueDir, { runId, account, row: selectedRows[0]!, receiver: botArg(), at: options.packages[0]!.at, attempt: 1 }) : null;
    if (initialHold) emit('hold-written', { hold: initialHold });
    const state = await openRoleState(join(root, 'role-state.json'));
    if (stopOnRow) gate = new CueGate({ dir: options.cueDir, login: null, stop: { step: stopOnRow, family: 'mule' }, since: Date.now(),
        onStop: closed => { gateStopped = true; emit('row-stop-gate', { closed, snapshot: snapshot(mule.sdk.getState()) }); stop.abort(); },
        log: line => emit('row-stop-gate-log', { line }) });
    running = role.run({
        sdk: mule.sdk, bot: mule.bot, account, options: { ...options },
        signal: stop.signal, state,
        log: (message, data) => {
            if (message === 'hand-off' && data?.success) {
                const p = options.packages.find(p => p.name === data.package);
                if (p?.scope) handOffTicks.set(p.scope.step, mule.sdk.getState()!.tick);
            }
            h4TradeTick = handOffTicks.get('H4') ?? null;
            h4kTradeTick = handOffTicks.get('H4k') ?? null;
            if (holding && message === 'keep-alive') holdKeepAlives++;
            emit('role', { message, ...data });
            if (message === 'delivery travel' && data?.ok === false) {
                const key = JSON.stringify([data.row, data.purpose]);
                const to = data.to as { x?: number; z?: number } | undefined;
                const st = mule.sdk.getState();
                if (!probedRoutes.has(key) && st?.player && typeof to?.x === 'number' && typeof to.z === 'number') {
                    probedRoutes.add(key);
                    const { worldX: x, worldZ: z, level } = st.player;
                    const tiles = [];
                    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) tiles.push({
                        x: x + dx, z: z + dz, allocated: isZoneAllocated(level, x + dx, z + dz),
                        walkable: isTileWalkable(level, x + dx, z + dz), door: getDoorAt(level, x + dx, z + dz) ?? null
                    });
                    emit('path-diagnostic', { row: data.row, purpose: data.purpose, at: { x, z, level }, to,
                        sceneReady: st.sceneReady, sdkStaticPath: mule.sdk.findPath(to.x, to.z, 500), sdkStaticTiles: tiles,
                        liveNearbyLocs: st.nearbyLocs, liveCollisionGridAvailable: false });
                }
            }
        },
        reportBank: bank => emit('bank', { items: bank.items })
    }).then(() => { roleCompleted = true; if (!stop.signal.aborted) roleError = new Error('Role exited before measurement finished'); },
        error => { roleError = error; emit('role-error', { error: String(error) }); });

    for (let i = 0; i < selectedRows.length; i++) {
        const row = selectedRows[i]!;
        activeRow = row;
        const p = options.packages[i]!;
        const fixture = fixturePlan?.fixtures[i];
        if (i === 0 && initialHold) await holdBeforePrepare(initialHold);
        const readiness = awaitReady(i);
        const recipient = async () => {
            const delayed = (idleMs > 0 && row === idleRow) || (i === 0 && !!initialHold);
            if (delayed) { await readiness; if (idleMs > 0) await idleBeforeArrival(i); }
            if (!fixture || (i === 0 && !delayed)) return;
            await prepareRecipient(fixture);
            const travel = await recipientTravel(fixture.receivingArea, row, 'meeting');
            emit('recipient-travel', { row, travel, scored: snapshot(scored.sdk.getState()) });
            if (!travel.ok) throw new Error('Recipient failed to reach ' + row);
            await settleRecipient(row);
        };
        const [readyTick] = await Promise.all([readiness, recipient()]);
        if (!fixturePlan && carriesNext && i === 0) {
            assertItems(mule.sdk.getInventory(), options.packages.flatMap(pkg => expectedItems(pkg.items)), 'Initial carry bundle');
            emit('carry-inventory', { phase: 'initial', slots: mule.sdk.getInventory().length, inventory: mule.sdk.getInventory() });
        }
        if (row === 'H4k') {
            if (!fixturePlan && carriesNext) {
                assertItems(mule.sdk.getInventory(), [...expectedItems(p.items), { id: 2550, count: 20 }], 'H4k retained returns and kit');
                if (bankBetweenTrades) throw new Error('Carry path opened a bank between H4 and H4k');
                emit('carry-inventory', { phase: 'H4k-ready', slots: mule.sdk.getInventory().length, inventory: mule.sdk.getInventory() });
            }
            h4kReadyTick = readyTick;
            emit('transition', { h4TradeTick, ringDepositTick, h4kReadyTick, ticks: h4TradeTick === null ? null : readyTick - h4TradeTick, windows: [206, 132], minHp });
            // Recipient travel is ordinary walking, never a mid-delivery teleport.
            if (!fixturePlan) {
                const travel = await runTo(scored.sdk, TILES.taverleyNormals, { bot: scored.bot });
                emit('recipient-travel', { travel });
                if (!travel.ok) throw new Error('Recipient failed to reach H4k');
            }
        }
        if (fixture) {
            for (const item of scored.sdk.getState()!.equipment.filter(e => fixture.takeBacks.some(t => t.id === e.id)))
                await scored.sdk.sendUseEquipmentItem(item.slot, opIndex(item, /^remove$/i) ?? 1);
            await waitTicks(scored.sdk, 1);
            assertItems(scored.sdk.getInventory(), fixture.tradeInventory, row + ' trade inventory');
        }
        if (!owner.ready(row).ok) throw new Error('Readiness expired before cue for ' + row);
        if (fixture?.topUpAsk) {
            let written = false;
            removeAskListener = scored.sdk.onStateUpdate(s => {
                if (written || !s.trade?.isOpen) return;
                written = true;
                const ask = fixture.topUpAsk!;
                emit('top-up-ask', { row, ask: writeTopUpAsk(options.cueDir, ask.items, Date.now(), ask.scope) });
            });
        }
        cue = owner.cueWriter(row);
        cue.write({ beacons: [{ tick: scored.sdk.getState()!.tick, ms: Date.now() }], turns: [] });
        const want = fixture?.want ?? p.items.map(line => ({ item: line.noted ? noteLink(itemId(line), pack).note! : itemId(line), amount: amount(line) }));
        const traded = await swap(scored.sdk, account, fixture?.give ?? (row === 'H4' ? [{ item: 2550, n: 20 }] : []), want, { closeModals: true });
        removeAskListener?.(); removeAskListener = undefined;
        emit('recipient-trade', { row, traded, mule: snapshot(mule.sdk.getState()), scored: snapshot(scored.sdk.getState()) });
        cue.stop([{ tick: scored.sdk.getState()!.tick, ms: Date.now() }], { final: row === stopOnRow });
        cue = undefined;
        if (!traded.ok) throw new Error(`Trade ${row} failed: ${traded.reason}`);
        assertItems(traded.received, fixture?.receive ?? expectedItems(p.items), `Exact recipient ${row} package`);
        if (fixture) assertItems(traded.gave, fixture.takeBacks, row + ' exact take-backs');
        // Let the canonical role durably record success before selecting the next row.
        const recorded = await waitUntil(mule.sdk, () => {
            const served = state.get('mule-delivery-served') as Array<{ pkg: string }> | undefined;
            return !!served?.some(entry => entry.pkg === p.name);
        }, { maxTicks: 20 });
        if (!recorded.ok) throw new Error(`Role did not record successful ${row}`);
        if (fixture) assertItems(mule.sdk.getInventory(), fixture.helperAfterInventory, row + ' helper retained inventory after trade');
        if (!fixturePlan && carriesNext) {
            const remaining = i === 0 ? expectedItems(options.packages[1]!.items) : [];
            assertItems(mule.sdk.getInventory(), [...remaining, { id: 2550, count: 20 }], `Retained inventory after ${rows[i]}`);
            emit('carry-inventory', { phase: `after-${rows[i]}`, slots: mule.sdk.getInventory().length, inventory: mule.sdk.getInventory() });
        }
    }
    if (!fixturePlan && carriesNext) {
        const deposited = await waitUntil(mule.sdk, () => previousBankRings === 20 || !!roleError, { maxTicks });
        if (roleError) throw roleError;
        if (!deposited.ok || previousBankRings !== 20 || bankBetweenTrades || h4kTradeTick === null || ringDepositTick === null || ringDepositTick < h4kTradeTick)
            throw new Error('Carry returns were not preserved through H4k and deposited afterward');
        emit('carry-final-deposit', { h4kTradeTick, ringDepositTick, bank: mule.sdk.getBankItems(), inventory: mule.sdk.getInventory() });
    }
    if (!fixturePlan && rows[0] === 'H4' && (h4TradeTick === null || h4kReadyTick === null || ringDepositTick === null || previousBankRings !== 20))
        throw new Error('Missing verified H4 take-back deposit or H4k readiness');
    if (fixturePlan && !stopOnRow) {
        const deposited = await waitUntil(mule.sdk, () => finalBankTick !== null || !!roleError, { maxTicks });
        if (roleError) throw roleError;
        if (!deposited.ok || finalBankTick === null) throw new Error('Final helper bank consolidation not observed');
        const bankCounts = new Map<number, number>([[995, 25]]);
        for (const item of protectedInventory) bankCounts.set(item.id, (bankCounts.get(item.id) ?? 0) + item.count);
        for (const item of fixturePlan.bankSeed!) bankCounts.set(item.bankId, (bankCounts.get(item.bankId) ?? 0) + item.count);
        for (const fixture of fixturePlan.fixtures) {
            for (const item of fixture.receive) bankCounts.set(item.bankId, (bankCounts.get(item.bankId) ?? 0) - item.count);
            for (const item of fixture.takeBacks) bankCounts.set(item.bankId, (bankCounts.get(item.bankId) ?? 0) + item.count);
        }
        assertItems(mule.sdk.getBankItems(), [...bankCounts].filter(([, count]) => count !== 0).map(([id, count]) => ({ id, count })), 'Final helper bank conservation');
        emit('regional-final-deposit', { finalBankTick, bank: mule.sdk.getBankItems(), inventory: mule.sdk.getInventory() });
    }
    if (stopOnRow) {
        if (fixturePlan!.fixtures.some(f => f.takeBacks.length)) throw new Error('Row-stop fixture cannot retain returns');
        const stopped = await waitUntil(mule.sdk, () => gateStopped && roleCompleted || !!roleError, { maxTicks: 20 });
        if (!stopped.ok || roleError || !gateStopped || !roleCompleted) throw new Error('Canonical row-stop did not finish role');
        const s = mule.sdk.getState()!, at = options.packages.at(-1)!.at;
        if (s.player?.worldX !== at.x || s.player.worldZ !== at.z || s.player.level !== at.level || s.bank.isOpen)
            throw new Error('Row-stop helper left stand or returned to bank');
        assertItems(s.inventory, [], 'Row-stop inventory empty');
        const expectedBank = [{ id: 995, count: 25 + (protectedInventory.find(i => i.id === 995)?.count ?? 0) }, ...protectedInventory.filter(i => i.id !== 995)];
        assertItems(lastObservedBank, expectedBank, 'Protected bank after staging (last observed before departure)');
        emit('row-stop-before-logout', { lastObservedBank, snapshot: snapshot(s), served: state.get('mule-delivery-served') });
        logoutProof = await logoutClean(mule, { timeoutMs: 25_000 });
        emit('row-stop-logout', { logoutProof, snapshot: snapshot(mule.sdk.getState()) });
        if (!logoutProof.ok) throw new Error('Row-stop logout not observed');
    }
    emit('completion-proof', { options, served: state.get('mule-delivery-served'), selection: state.get('mule-delivery-selection'),
        unresolvedAttempt: state.get('mule-delivery-attempt') ?? null, mule: snapshot(mule.sdk.getState()), scored: snapshot(scored.sdk.getState()) });
    pass = true;
} catch (error) {
    emit('failure', { error: String(error), mule: snapshot(mule?.sdk.getState() ?? null), scored: snapshot(scored?.sdk.getState() ?? null), nearbyLocs: mule?.sdk.getState()?.nearbyLocs });
} finally {
    stop.abort();
    if (cue && scored) cue.stop([{ tick: scored.sdk.getState()?.tick ?? 0, ms: Date.now() }]);
    if (running) await Promise.race([running, new Promise<void>(resolve => setTimeout(resolve, 5000))]);
    gate?.close();
    unsubscribe?.();
    removeAskListener?.();
    for (const remove of removeTraces) remove();
    for (const s of sessions) await closeSession(s);
    const transitionTicks = h4TradeTick === null || h4kReadyTick === null ? null : h4kReadyTick - h4TradeTick;
    deadlinePass = selectedRows.includes('H4') && selectedRows.includes('H4k') ? transitionTicks !== null && transitionTicks <= 132 : null;
    // The strict receiving-leg deadline is separate from eventual mechanical completion.
    const summary = { mechanicalPass: pass, helperProfile, recipientProfile, deliveryMode: carriesNext ? 'carry-ahead' : 'bank-return', maxInventorySlots, bankBetweenTrades, h4kTradeTick, deadlinePass, deadlineTicks: rows[0] === 'H4' ? 132 : null, rows, root, startTick, h4TradeTick, ringDepositTick, h4kReadyTick, transitionTicks, minHp,
        deadlineComparisons: [206, 132].map(window => ({ window, withinWindow: transitionTicks === null ? null : transitionTicks <= window })),
        scoredArrivalAccepted: false, fixtureMode: fixturePlan ? 'ledger' : 'minimal-two-row', region: region || null, selectedRows, rowTimings, finalBankTick, idleProof, holdMs, holdProof, gateStopped, roleCompleted, logoutProof, events: evidence.length };
    writeFileSync(join(root, 'result.json'), JSON.stringify(summary, null, 2));
    result('mule-delivery', summary);
}
process.exit(pass && deadlinePass !== false ? 0 : 1);
