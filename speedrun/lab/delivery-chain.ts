// The runner-driven banked delivery lab (rs/598): run.ts's own chain steps and run owner serving one
// real `deliveryRun` mule role, in one process and one session, through H1, then H4 (Doric's segment A)
// and H4k with the generated carry-ahead. What is the run's and not a lab copy:
// - the chain: runner/chain.ts buildChain, the steps run being H1's hand-off step, Doric's
//   `S05:A-h4-swap` segment and H4k's hand-off step, each with its {row, mule} cue around it;
// - the cues: runner/cue-keeper.ts RunCues with runner/delivery-owner.ts's DeliveryOwner bound by
//   run.ts's own preflight (deliveryOwnerFor, against a launcher config written as on run day), so
//   each row is prepared, its readiness awaited and its cue written under deliverySession(run, row)
//   and kept fresh, and its stop prepares the carrier's next row;
// - the carrier: helpers/mule.ts's role with muleRunOptions (helpers/mule-ledger.ts), as generated;
//   with --hold=1 it is first held by tools/mule-hold.ts, the run host's pre-launcher command.
// The lab part: SCORED's inventory before each row (the ledger fixture, lab/mule-delivery-fixtures.ts)
// and its tile, by staff command (a staged entry into the row's step); the carrier's bank seed. The
// carrier is never moved: H4 waits on its real route from H1 (Lumbridge, Falador west bank, Doric).
//
//   LAB_RUNNERS=0 LAB_HELPERS=<mule> NODE_TICKRATE=400 speedrun/lab/lab.sh <scored> \
//     'speedrun/lab/delivery-chain.ts:--mule=<mule>:--client=browser[:--hold=1]'
//
// Exit 0 every row served and its step's postconditions held, 1 otherwise.

import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readCue } from '../helpers/altar-cue';
import { role } from '../helpers/mule';
import { muleRunOptions } from '../helpers/mule-ledger';
import { readMulePreparation, readMuleReady } from '../helpers/mule-readiness';
import { openRoleState } from '../helpers/role';
import { depositAll } from '../lib/bank';
import { objPack } from '../lib/obj-pack';
import { closeSession, isLoopbackHost, loadBotEnv, openSession, ROOT, type Session } from '../lib/session';
import { TickLog } from '../lib/ticks';
import { waitUntil } from '../lib/wait';
import { opIndex } from '../lib/world';
import { buildChain, KIT_PARTNER_ROWS, muleCueDir, PLACEMENT, type ChainStep, type RunConfig } from '../runner/chain';
import { RunCues } from '../runner/cue-keeper';
import { deliveryOwnerFor, type DeliveryOwner } from '../runner/delivery-owner';
import { HandOffRecord } from '../runner/handoff';
import { MANIFEST } from '../tools/slot-ledger';
import { openSecureLabSession, type SecureLabSession } from './browser';
import { arg, botArg, result } from './common';
import { fixtureSeedBatches, loadFixtureCatalog, planMuleDeliveryFixtures, type FixtureItem, type MuleDeliveryFixture } from './mule-delivery-fixtures';
import { cheat, clearInventory, leaveTutorial, mustTele } from './setup';

const ROWS = ['H1', 'H4', 'H4k'] as const;
const scoredName = botArg();
const muleName = arg('mule', '');
const client = arg('client', 'browser') as 'browser' | 'lite';
const hold = arg('hold', '') === '1';
if (!muleName || muleName === scoredName) throw new Error('--mule must name a separate fresh lab account');
for (const n of [muleName, scoredName]) if (!isLoopbackHost(loadBotEnv(n).SERVER ?? '')) throw new Error('lab only: a non-loopback world is refused');

const manifest = readFileSync(MANIFEST, 'utf8');
const pack = objPack();
const plan = planMuleDeliveryFixtures({ manifest, rows: [...ROWS], onRequest: [], pack });
if (!plan.ok) {
    result('delivery-chain-unresolved', plan.unresolved);
    process.exit(1);
}
const root = mkdtempSync(join(tmpdir(), 'delivery-chain-'));
const cueRoot = join(root, 'rc-cue');
mkdirSync(cueRoot, { recursive: true, mode: 0o700 });
const runId = `a1-lab${Date.now().toString(36)}`;
// The carrier's options exactly as mule-ledger.ts generates them for the run (--delivery-run, --serve, --cue-root).
const options = muleRunOptions(plan.fixtures.map(f => f.ledger), cueRoot, { deliveryRun: runId, serve: scoredName });
mkdirSync(options.cueDir, { recursive: true, mode: 0o700 });
const launcherPath = join(root, 'launcher-config.json');
writeFileSync(launcherPath, JSON.stringify({ accounts: [{ account: muleName, role: 'mule', cueDir: options.cueDir, options }] }, null, 2));

const partners: Record<string, string> = Object.fromEntries([...Object.keys(PLACEMENT), ...KIT_PARTNER_ROWS].map(id => [id, `lab_${id.toLowerCase()}`]));
for (const r of ROWS) partners[r] = muleName;
const cfg: RunConfig = {
    partners, firemakingTiles: '3240,3296;3239,3296;3238,3296', rings: { giver: 'lab_ring' }, bones: { giver: 'lab_bone' },
    courier: { giver: 'lab_courier', below: 3 }, anvil: { giver: 'lab_anvil' },
    cueDir: cueRoot, muleCueDir: options.cueDir, delivery: { run: runId, launcherConfig: launcherPath },
};
const cues = new RunCues({ main: cfg.cueDir, mule: muleCueDir(cfg) }, scoredName);
const full = buildChain(cfg, { cues, manifest, attempt: runId, handOffs: new HandOffRecord(root, runId) });
const steps: ChainStep[] = ROWS.map(r => {
    const s = full.find(st => st.cue?.family === 'mule' && st.cue.step === r);
    if (!s) throw new Error(`the chain has no {${r}, mule} step`);
    return s;
});

const events: Record<string, unknown>[] = [];
let mule!: Session;
let scored!: Session;
let secure: SecureLabSession | null = null;
const emit = (event: string, fields: Record<string, unknown> = {}) => {
    const r = { event, ms: Date.now(), scoredTick: scored?.sdk.getState()?.tick ?? null, muleTick: mule?.sdk.getState()?.tick ?? null, ...fields };
    events.push(r);
    appendFileSync(join(root, 'events.jsonl'), JSON.stringify(r) + '\n');
    console.log(JSON.stringify(r));
};

const counts = (items: ReadonlyArray<{ id: number; count: number }>) => {
    const m = new Map<number, number>();
    for (const i of items) m.set(i.id, (m.get(i.id) ?? 0) + i.count);
    return JSON.stringify([...m].sort((a, b) => a[0] - b[0]));
};
function assertItems(actual: ReadonlyArray<{ id: number; count: number }>, expected: ReadonlyArray<{ id: number; count: number }>, label: string) {
    if (counts(actual) !== counts(expected)) throw new Error(`${label}: actual ${counts(actual)}, expected ${counts(expected)}`);
}

async function giveAll(s: Session, items: readonly FixtureItem[]) {
    for (const item of items) {
        const have = () => s.sdk.getInventory().filter(i => i.id === item.id).reduce((n, i) => n + i.count, 0);
        const before = have();
        await cheat(s.sdk, `give ${item.debugName} ${item.count}`);
        if (!(await waitUntil(s.sdk, () => have() === before + item.count, { maxTicks: 15 })).ok) throw new Error(`fixture give failed: ${item.debugName}`);
    }
}

async function seedCarrier() {
    await mustTele(mule.sdk, options.packages[0]!.bank.x, options.packages[0]!.bank.z, options.packages[0]!.bank.level);
    if (!(await mule.bot.openBank()).success) throw new Error('carrier fixture bank unavailable');
    for (const batch of plan.seedBatches!) {
        await giveAll(mule, batch);
        if (!(await depositAll(mule.sdk)).ok) throw new Error('carrier fixture deposit failed');
    }
    emit('carrier-bank', { items: mule.sdk.getBankItems().map(i => ({ id: i.id, name: i.name, count: i.count })) });
    await mule.bot.closeBank();
}

/** SCORED's pack and worn set before the row (the ledger fixture), then its receiving area: the staged entry into the row's step. */
async function stageScored(f: MuleDeliveryFixture) {
    for (const item of scored.sdk.getState()!.equipment) await scored.sdk.sendUseEquipmentItem(item.slot, opIndex(item, /^remove$/i) ?? 1);
    await waitUntil(scored.sdk, s => !s.equipment.length, { maxTicks: 10 });
    await clearInventory(scored.sdk);
    await giveAll(scored, f.beforeEquipment);
    for (const item of f.beforeEquipment) {
        const live = scored.sdk.getInventory().find(i => i.id === item.id)!;
        await scored.sdk.sendUseItem(live.slot, opIndex(live, /^(wear|wield)$/i) ?? 2);
        if (!(await waitUntil(scored.sdk, s => s.equipment.some(e => e.id === item.id), { maxTicks: 8 })).ok) throw new Error(`fixture equip failed: ${item.debugName}`);
    }
    await giveAll(scored, f.beforeInventory);
    assertItems(scored.sdk.getInventory(), f.beforeInventory, `${f.row} SCORED before inventory`);
    const a = f.receivingArea;
    await mustTele(scored.sdk, a.x, a.z, a.level ?? 0);
}

const rowsOut: Record<string, unknown>[] = [];
const muleLines: Record<string, unknown>[] = [];
let pass = false;
let running: Promise<void> | undefined;
let roleError: unknown;
const stop = new AbortController();

try {
    emit('start', { host: hostname(), revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(), tickRate: process.env.NODE_TICKRATE, client, hold, runId, root, rows: ROWS });
    if (client === 'browser') secure = await openSecureLabSession(scoredName);
    scored = secure?.session ?? await openSession(scoredName, { client, launch: true });
    mule = await openSession(muleName);
    for (const s of [scored, mule]) { await leaveTutorial(s); await clearInventory(s.sdk); }
    await seedCarrier();
    // Recipient stock is not under test: the fixture's items arrive by staff command at each row.
    void fixtureSeedBatches; void loadFixtureCatalog;

    if (hold) {
        // The run host's step before the launcher: the carrier is held before its role starts.
        const out = execFileSync('bun', [join(ROOT, 'speedrun/tools/mule-hold.ts'), '--config', launcherPath, '--account', muleName], { cwd: ROOT, encoding: 'utf8' });
        emit('hold-cli', { out: out.trim(), control: readMulePreparation(options.cueDir, muleName) });
    }
    const state = await openRoleState(join(root, 'role-state.json'));
    running = role.run({
        sdk: mule.sdk, bot: mule.bot, account: muleName, options: { ...options }, signal: stop.signal, state,
        log: (message, data) => {
            const line = { message, ...data };
            if (/^delivery|^hand-off|ready|selected|refused|served/.test(message)) {
                const cue = readCue(options.cueDir);
                muleLines.push({ tick: mule.sdk.getState()?.tick ?? null, ...line, cue: cue && { step: cue.scope?.step, session: cue.session, seq: cue.seq, stop: !!cue.stop, ageMs: Date.now() - cue.ms } });
            }
            emit('role', line);
        },
        reportBank: () => {},
    }).then(() => { if (!stop.signal.aborted) roleError = new Error('the mule role exited'); }, e => { roleError = e; emit('role-error', { error: String(e) }); });

    if (hold) {
        const held = await waitUntil(mule.sdk, () => readMuleReady(options.cueDir, muleName)?.phase === 'held' || !!roleError, { maxTicks: 60 });
        emit('held', { ok: held.ok, status: readMuleReady(options.cueDir, muleName) });
        if (!held.ok || roleError) throw roleError ?? new Error('the carrier never published held');
    }

    // run.ts's preflight and its first prepare, over the steps this lab runs.
    const pre = deliveryOwnerFor({ delivery: cfg.delivery, partners: cfg.partners, chain: steps, receiver: scoredName, dir: muleCueDir(cfg) });
    if ('refusal' in pre) throw new Error(`preflight refused: ${pre.refusal}`);
    const owner = pre.owner as DeliveryOwner;
    cues.bindDelivery(owner);
    for (const r of owner.firstRows()) emit('prepare-first', { row: r.row, bound: owner.prepare(r.row) });

    // The readiness wait each cue open pays, in SCORED's observed ticks.
    const waits = new Map<string, { openTick: number; readyTick?: number }>();
    const awaitReady = owner.awaitReady.bind(owner);
    owner.awaitReady = async (row, sdk, o) => {
        const openTick = scored.sdk.getState()!.tick;
        waits.set(row, { openTick });
        const status = await awaitReady(row, sdk, o);
        waits.get(row)!.readyTick = scored.sdk.getState()!.tick;
        emit('ready', { row, waitTicks: scored.sdk.getState()!.tick - openTick, status });
        return status;
    };
    const offCues = cues.attach(scored.sdk);
    const ctx = { session: scored, sdk: scored.sdk, bot: scored.bot, c: {}, log: TickLog.memory(scoredName) } as never;
    try {
        for (let i = 0; i < ROWS.length; i++) {
            const row = ROWS[i]!;
            const f = plan.fixtures[i]!;
            const step = steps[i]!;
            await stageScored(f);
            const pre = step.preconditions(scored.sdk.getState()!, {} as never);
            emit('row-start', { row, step: step.name, preconditions: pre, control: readMulePreparation(options.cueDir, muleName), status: readMuleReady(options.cueDir, muleName) });
            if (pre !== true) throw new Error(`${row}: ${step.name} preconditions: ${pre}`);
            const startTick = scored.sdk.getState()!.tick;
            const startMs = Date.now();
            await step.run(ctx);
            const s = scored.sdk.getState()!;
            const post = step.postconditions(s, {} as never);
            const w = waits.get(row);
            const out = {
                row, step: step.name, ok: post === true, post, stepTicks: s.tick - startTick, stepMs: Date.now() - startMs,
                readyWaitTicks: w?.readyTick !== undefined ? w.readyTick - w.openTick : null,
                cueToEndTicks: w?.readyTick !== undefined ? s.tick - w.readyTick : null,
                cue: (c => c && { session: c.session, seq: c.seq, stop: !!c.stop, final: !!c.final })(readCue(options.cueDir)),
                nextControl: (c => c && { op: c.op, row: c.row, seq: c.seq })(readMulePreparation(options.cueDir, muleName)),
                inventory: s.inventory.map(it => ({ id: it.id, name: it.name, count: it.count })),
            };
            rowsOut.push(out);
            emit('row-done', out);
            if (post !== true) throw new Error(`${row}: postconditions: ${post}`);
            if (roleError) throw roleError;
        }
    } finally {
        offCues();
    }
    // The carrier's last row stopped final: it records the serve and stands down on its stand.
    const served = await waitUntil(mule.sdk, () => (state.get('mule-delivery-served') as unknown[] | undefined)?.length === ROWS.length, { maxTicks: 20 });
    emit('served', { ok: served.ok, served: state.get('mule-delivery-served') });
    pass = served.ok;
} catch (e) {
    emit('failure', { error: e instanceof Error ? e.stack ?? e.message : String(e), control: readMulePreparation(options.cueDir, muleName), status: readMuleReady(options.cueDir, muleName), cue: readCue(options.cueDir) });
} finally {
    stop.abort();
    try { cues.close({ final: false }); } catch { /* the run's own close; nothing open */ }
    if (running) await Promise.race([running, new Promise<void>(r => setTimeout(r, 5000))]);
    if (mule) await closeSession(mule);
    if (secure) await secure.close();
    else if (scored) await closeSession(scored);
    const summary = { pass, host: hostname(), client, hold, runId, tickRate: process.env.NODE_TICKRATE, rows: rowsOut, muleLines, root };
    writeFileSync(join(root, 'result.json'), JSON.stringify(summary, null, 2));
    result('delivery-chain', summary);
}
process.exit(pass ? 0 : 1);
