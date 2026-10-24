// Attempt 4's death on the lab: SCORED low and poisoned around H12's kit segment (S15:A-narnode), driven by
// run.ts's own runChainOnSession over buildChain's S15:A step, with the run's login upkeep (run.ts loginUpkeep,
// wait-guard.ts enteringEnds) as run.ts wraps the chain. H12 is a delivery-mode carrier (helpers/mule.ts's role,
// muleRunOptions as generated) prepared, awaited and cued by the DeliveryOwner, as in lab/s15-chain.ts.
//
//   LAB_RUNNERS=0 LAB_HELPERS=<carrier> NODE_TICKRATE=400 speedrun/lab/lab.sh <scored> \
//     'speedrun/lab/kit-resume.ts:--mule=<carrier>:--case=late'
//
// --case=late: H12 not served. The carrier is staged ready, then stopped; SCORED enters A and stands in the
//   {H12, mule} cue's readiness wait; LATE ticks in, SCORED is hit to 11 HP and freshly poisoned (::~hit,
//   ::~poison 30); the carrier restarts --late ticks after A's entry. Pass: alive, the wait's upkeep ate and
//   cured (`(wait) upkeep` rows), H12 traded and recorded served, A ended ok.
// --case=served: H12 served first (an on-time carrier, nothing staged on SCORED), then attempt 4's resume:
//   Monkey Madness's vars back to 0 so A runs again, the carrier stopped, SCORED relogged, hit to 11 HP and
//   freshly poisoned, then `--from` S15:A. Pass: no new {H12, mule} cue, the `(cue) H12 skipped` row, the
//   login upkeep's eat and cure rows, A's body ran (its row), SCORED alive. `--extra=<obj>` gives one more
//   item in the free slot before the resume (the interim staging, labelled in the result).
// The poison is a fresh one (::~poison's 'You have been poisoned!'): the lab bundle publishes no hitmark type,
// so a carried poison is invisible to every cure until rs/755's field is in it.

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readCue } from '../helpers/altar-cue';
import { role } from '../helpers/mule';
import { muleRunOptions } from '../helpers/mule-ledger';
import { readMuleReady } from '../helpers/mule-readiness';
import { openRoleState } from '../helpers/role';
import { depositAll } from '../lib/bank';
import { ReservationWatch, reservationPath } from '../lib/host-reservation';
import { objPack } from '../lib/obj-pack';
import { closeSession, isLoopbackHost, loadBotEnv, openSession, relog, ROOT, type Session } from '../lib/session';
import { TickLog } from '../lib/ticks';
import { waitTicks, waitUntil } from '../lib/wait';
import { opIndex } from '../lib/world';
import * as monkeyMadness from '../quests/monkey-madness';
import { buildChain, KIT_PARTNER_ROWS, KIT_SEGMENTS, muleCueDir, PLACEMENT, type RunConfig } from '../runner/chain';
import { RunCues } from '../runner/cue-keeper';
import { deliveryOwnerFor, type DeliveryOwner } from '../runner/delivery-owner';
import { AttemptRecord } from '../runner/attempt-record';
import { enteringEnds } from '../runner/wait-guard';
import { loginUpkeep, runChainOnSession } from '../run';
import { MANIFEST } from '../tools/slot-ledger';
import { arg, botArg, result } from './common';
import { planMuleDeliveryFixtures, type FixtureItem } from './mule-delivery-fixtures';
import { MM_VARS, PREREQ_VARS, ROUTE_LEVELS } from './quests/monkey-madness';
import { cheat, clearInventory, leaveTutorial, mustTele, setStats, setVars } from './setup';

const scoredName = botArg();
const muleName = arg('mule', '');
const kase = arg('case', 'late');
const late = Number(arg('late', '100'));
const hitAt = Number(arg('hit-at', '15'));
const extra = arg('extra', '');
if (!['late', 'served'].includes(kase)) throw new Error('--case is late or served');
if (!muleName || muleName === scoredName) throw new Error('--mule must name a separate fresh lab account');
for (const n of [muleName, scoredName]) if (!isLoopbackHost(loadBotEnv(n).SERVER ?? '')) throw new Error('lab only: a non-loopback world is refused');
const scoredAccount = loadBotEnv(scoredName).BOT_USERNAME!;

const manifest = readFileSync(MANIFEST, 'utf8');
const concrete = (id: number, count: number, reason: string) => ({ items: [{ id, count }], reason });
const plan = planMuleDeliveryFixtures({
    manifest, rows: ['H12'], onRequest: [], pack: objPack(),
    overrides: { H12: { takeBacks: { 'coins @995': concrete(995, 1000, 'the ledger walk'), 'death rune': concrete(560, 49, 'the ledger walk'), 'chaos rune': concrete(562, 16, 'the ledger walk') } } },
});
if (!plan.ok) {
    result('kit-resume-unresolved', plan.unresolved);
    process.exit(1);
}
const h12 = plan.fixtures[0]!;

const root = mkdtempSync(join(tmpdir(), 'kit-resume-'));
const cueRoot = join(root, 'rc-cue');
mkdirSync(cueRoot, { recursive: true, mode: 0o700 });
const runId = `a1-lab${Date.now().toString(36)}`;
const options = muleRunOptions([h12.ledger], cueRoot, { deliveryRun: runId, serve: scoredAccount });
mkdirSync(options.cueDir, { recursive: true, mode: 0o700 });
const launcherPath = join(root, 'launcher-config.json');
writeFileSync(launcherPath, JSON.stringify({ accounts: [{ account: muleName, role: 'mule', cueDir: options.cueDir, options }] }, null, 2));
const partners: Record<string, string> = Object.fromEntries([...Object.keys(PLACEMENT), ...KIT_PARTNER_ROWS].map(id => [id, `lab_${id.toLowerCase()}`]));
partners.H12 = muleName;
const h45Dirs = join(root, 'h45');
const cfg: RunConfig = {
    partners, firemakingTiles: '3240,3296;3239,3296;3238,3296', rings: { giver: 'lab_ring' }, bones: { giver: 'lab_bone' },
    courier: { giver: 'lab_courier', below: 3 }, anvil: { giver: 'lab_anvil' },
    cueDir: cueRoot, muleCueDir: options.cueDir, delivery: { run: runId, launcherConfig: launcherPath },
    h12o: { account: 'lab_h45', cueDir: join(h45Dirs, 'cue'), loginDir: join(h45Dirs, 'login'), leadTicks: 300 },
};
const cues = new RunCues({ main: cfg.cueDir, mule: muleCueDir(cfg) }, scoredAccount);
const record = new AttemptRecord(root, runId);
const full = buildChain(cfg, { cues, manifest, attempt: runId, record });
const slice = full.filter(s => s.name === KIT_SEGMENTS.H12);
if (slice.length !== 1) throw new Error(`buildChain has ${slice.length} ${KIT_SEGMENTS.H12} steps`);

let scored!: Session;
let mule!: Session;
const tick = () => scored?.sdk.getState()?.tick ?? -1;
const emit = (event: string, fields: Record<string, unknown> = {}) => {
    const r = { event, ms: Date.now(), scoredTick: tick(), ...fields };
    appendFileSync(join(root, 'events.jsonl'), JSON.stringify(r) + '\n');
    console.log(JSON.stringify(r));
};
const vitals = () => {
    const s = scored.sdk.getState();
    return { hp: s?.player?.hp, maxHp: s?.player?.maxHp, inventory: s?.inventory.map(i => `${i.slot}:${i.name} x${i.count}`), worn: s?.equipment.map(e => e.name) };
};

async function giveAll(s: Session, items: readonly FixtureItem[]) {
    for (const item of items) {
        const have = () => s.sdk.getInventory().filter(i => i.id === item.id).reduce((n, i) => n + i.count, 0);
        const before = have();
        await cheat(s.sdk, `give ${item.debugName} ${item.count}`);
        if (!(await waitUntil(s.sdk, () => have() === before + item.count, { maxTicks: 15 })).ok) throw new Error(`fixture give failed: ${item.debugName}`);
    }
}

async function stageScored() {
    await setVars(scored.sdk, { ...PREREQ_VARS, ...Object.fromEntries(MM_VARS.map(v => [v, 0])) });
    await cheat(scored.sdk, '~clearinv reinitialisation_inv', 1);
    await setStats(scored.sdk, { ...ROUTE_LEVELS });
    for (const item of scored.sdk.getState()!.equipment) await scored.sdk.sendUseEquipmentItem(item.slot, opIndex(item, /^remove$/i) ?? 1);
    await waitUntil(scored.sdk, s => !s.equipment.length, { maxTicks: 10 });
    await clearInventory(scored.sdk);
    await giveAll(scored, h12.beforeEquipment);
    for (const item of h12.beforeEquipment) {
        const live = scored.sdk.getInventory().find(i => i.id === item.id)!;
        await scored.sdk.sendUseItem(live.slot, opIndex(live, /^(wear|wield)$/i) ?? 2);
        if (!(await waitUntil(scored.sdk, s => s.equipment.some(e => e.id === item.id), { maxTicks: 8 })).ok) throw new Error(`fixture equip failed: ${item.debugName}`);
    }
    await giveAll(scored, h12.beforeInventory);
    const a = h12.receivingArea;
    await mustTele(scored.sdk, a.x, a.z, a.level ?? 0);
    await relog(scored);
    emit('scored-staged', vitals());
}

async function seedCarrier() {
    const b = options.packages[0]!.bank;
    await mustTele(mule.sdk, b.x, b.z, b.level);
    if (!(await mule.bot.openBank()).success) throw new Error('carrier fixture bank unavailable');
    for (const batch of plan.seedBatches!) {
        await giveAll(mule, batch);
        if (!(await depositAll(mule.sdk)).ok) throw new Error('carrier fixture deposit failed');
    }
    await mule.bot.closeBank();
}

/** SCORED to 11 HP and a fresh poisoning: the engine's own message is the cure's signal in this bundle. */
async function lowAndPoisoned(): Promise<void> {
    const hp = scored.sdk.getState()!.player!.hp;
    if (hp > 11) await cheat(scored.sdk, `~hit ${hp - 11}`);
    if (!(await waitUntil(scored.sdk, s => (s.player?.hp ?? 99) <= 11, { maxTicks: 10 })).ok) throw new Error('::~hit did not take SCORED to 11 HP');
    const t0 = tick();
    await cheat(scored.sdk, '~poison 30');
    const r = await waitUntil(scored.sdk, s => s.gameMessages.some(m => m.tick >= t0 && /you have been poisoned/i.test(m.text)), { maxTicks: 10 });
    emit('low-and-poisoned', { ok: r.ok, ...vitals() });
    if (!r.ok) throw new Error('::~poison gave no poisoning message');
}

let carrier: { stop: AbortController; running: Promise<void> } | null = null;
let roleError: unknown;
async function startCarrier(): Promise<void> {
    const stop = new AbortController();
    const state = await openRoleState(join(root, 'role-state.json'));
    const running = role.run({
        sdk: mule.sdk, bot: mule.bot, account: muleName, options: { ...options }, signal: stop.signal, state,
        log: (message, data) => emit('carrier', { message, ...data }),
        reportBank: () => {},
    }).then(() => { if (!stop.signal.aborted) roleError = new Error('the carrier role exited'); }, e => { roleError = e; emit('carrier-error', { error: String(e) }); });
    carrier = { stop, running };
    emit('carrier-start');
}
async function stopCarrier(): Promise<void> {
    if (!carrier) return;
    carrier.stop.abort();
    await Promise.race([carrier.running, new Promise<void>(r => setTimeout(r, 10_000))]);
    carrier = null;
    emit('carrier-stop', { status: readMuleReady(options.cueDir, muleName) });
}

function revision(): string {
    try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
    catch { return 'unknown'; }
}

/** S15:A once through run.ts's runChainOnSession, `--from` it, under the login upkeep. */
async function runA(label: string, during?: (log: TickLog) => Promise<void>) {
    const log = TickLog.memory(scoredAccount);
    const upkeep = loginUpkeep(scored, log, line => emit('say', { line }));
    const side = during?.(log).catch(e => emit('side-error', { error: String(e) }));
    let res: unknown = null;
    try {
        const ran = await runChainOnSession(scored, { log, chain: enteringEnds(slice, upkeep), from: 0, reservation: new ReservationWatch(reservationPath(join(root, 'no-reservation.json')), { label }), cues, record: record.steps, label });
        res = ran.result;
    } finally {
        upkeep.stop();
    }
    await side;
    const rows = log.rows.map(r => ({ step: r.step, kind: r.kind, ok: r.ok, startTick: r.startTick, ticks: r.ticks, ...(r.error ? { error: r.error } : {}), ...(r.meta?.why ? { why: r.meta.why } : {}), ...(r.kind === 'note' && /upkeep/.test(r.step) ? { act: r.meta } : {}) }));
    for (const r of rows) emit('row', r);
    return { res: res as { code: number; outcome: string } | null, rows, died: scored.died ?? null };
}

let pass = false;
const summary: Record<string, unknown> = { case: kase, host: hostname(), revision: revision(), tickRate: process.env.NODE_TICKRATE, runId, root };
try {
    emit('start', summary);
    scored = await openSession(scoredName, { client: 'lite', launch: true });
    mule = await openSession(muleName);
    for (const s of [scored, mule]) { await leaveTutorial(s); await clearInventory(s.sdk); }
    await seedCarrier();
    await stageScored();

    const pre = deliveryOwnerFor({ delivery: cfg.delivery, partners: cfg.partners, chain: slice, receiver: scoredAccount, dir: muleCueDir(cfg) });
    if ('refusal' in pre) throw new Error(`preflight refused: ${pre.refusal}`);
    const owner = pre.owner as DeliveryOwner;
    cues.bindDelivery(owner);
    for (const r of owner.firstRows()) emit('prepare-first', { row: r.row, bound: owner.prepare(r.row) });
    await startCarrier();
    const t0 = tick();
    const inView = await waitUntil(scored.sdk, st => !!roleError || (owner.ready('H12').ok && st.nearbyPlayers.some(p => p.name.toLowerCase() === muleName.toLowerCase())), { maxTicks: 1500 });
    if (roleError) throw roleError;
    emit('carrier-staged', { ok: inView.ok, waitTicks: tick() - t0 });
    if (!inView.ok) throw new Error('H12: the carrier was not ready and in view within 1500 ticks');

    if (kase === 'late') {
        // The carrier goes quiet (its readiness expires in 3 s): SCORED's cue open waits on it.
        await stopCarrier();
        const a = await runA('late', async () => {
            const entry = tick();
            await waitTicks(scored.sdk, hitAt);
            await lowAndPoisoned();
            await waitTicks(scored.sdk, Math.max(0, late - (tick() - entry)));
            await startCarrier();
        });
        const wait = a.rows.filter(r => r.step.startsWith('(wait) upkeep waiting for the H12/mule cue'));
        const checks = {
            alive: !a.died,
            ateInWait: wait.some(r => r.step.endsWith(': eat')),
            curedInWait: wait.some(r => r.step.endsWith(': cure')),
            servedRecorded: record.handOffs.has('H12'),
            aOk: a.res?.code === 0,
        };
        Object.assign(summary, { checks, result: a.res, died: a.died, end: vitals() });
        pass = Object.values(checks).every(Boolean);
    } else {
        const serve = await runA('serve');
        emit('serve', { result: serve.res, served: record.handOffs.has('H12') });
        if (!record.handOffs.has('H12')) throw new Error('the serve did not record H12');
        await stopCarrier();
        const cueAfterServe = readCue(options.cueDir);
        // Attempt 4's resume: A to run again, SCORED relogged (the tab reset) low and freshly poisoned.
        await setVars(scored.sdk, Object.fromEntries(MM_VARS.map(v => [v, 0])));
        await waitTicks(scored.sdk, 2);
        const kitBefore = monkeyMadness.kitMissing(scored.sdk.getState()!, monkeyMadness.DEFAULT_OPTIONS.bow).map(([n, k]) => `${k} ${n.source}`);
        if (extra) await cheat(scored.sdk, `give ${extra} 1`, 2);
        await relog(scored);
        emit('resume-staged', { kitMissing: kitBefore, extra: extra || null, ...vitals() });
        await lowAndPoisoned();
        const a = await runA('resume');
        const cueAfterResume = readCue(options.cueDir);
        const login = a.rows.filter(r => r.step.startsWith('(run) upkeep'));
        const aRow = a.rows.find(r => r.step === KIT_SEGMENTS.H12 && r.kind === undefined);
        const checks = {
            alive: !a.died,
            noNewCue: JSON.stringify(cueAfterResume) === JSON.stringify(cueAfterServe),
            skippedRow: a.rows.some(r => r.step === '(cue) H12 skipped' && r.why === 'H12 served this attempt: no cue, no wait'),
            loginAte: login.some(r => r.step.endsWith(': eat')),
            loginCured: login.some(r => r.step.endsWith(': cure')),
            aBodyRan: !!aRow,
        };
        Object.assign(summary, { checks, interimExtra: extra || null, aOk: aRow?.ok ?? null, result: a.res, died: a.died, end: vitals() });
        pass = Object.values(checks).every(Boolean);
    }
} catch (e) {
    summary.failure = e instanceof Error ? e.stack ?? e.message : String(e);
    emit('failure', { error: summary.failure, carrier: readMuleReady(options.cueDir, muleName) });
} finally {
    await stopCarrier().catch(() => {});
    try { cues.close({ final: false }); } catch { /* nothing open */ }
    if (mule) await closeSession(mule).catch(() => {});
    if (scored) await closeSession(scored).catch(() => {});
    summary.pass = pass;
    writeFileSync(join(root, 'result.json'), JSON.stringify(summary, null, 2));
    result('kit-resume', summary);
}
process.exit(pass ? 0 : 1);
