// The chain-built S15 lab: run.ts's real chain sliced to Monkey Madness (S15:A..Z, with h45's login trigger
// between L and M), run by run.ts's own runChainOnSession with the run's RunCues and DeliveryOwner bound as
// run.ts binds them. What is the run's and not a lab copy:
// - the chain: runner/chain.ts buildChain, the steps run being every S15 step and the H12o login step;
// - H12: a delivery-mode carrier (helpers/mule.ts's role with muleRunOptions as generated, a deliveryRun),
//   prepared, awaited and cued by the DeliveryOwner; SCORED's shark ask written on the trade's first frame;
// - h45: run day's launcher entry, helpers/mule-ledger.ts h45LauncherEntry verbatim but for its account,
//   serve and cueDir, through the run-machine launcher (helpers/standalone.ts), staged by lab/h45.ts.
// The lab part: SCORED staged at H12's ledger before-state (lab/mule-delivery-fixtures.ts) with Monkey
// Madness's route levels and prerequisite vars, at the Grand Tree door; the carrier's bank seed.
//
//   LAB_RUNNERS=0 LAB_HELPERS=<carrier> NODE_TICKRATE=400 speedrun/lab/lab.sh <scored> \
//     'speedrun/lab/s15-chain.ts:--mule=<carrier>:--gw=<h45 launcher gateway port>'
//
// One JSON line per event; `checkpoint` lines are (1) sharks after A, (2) the login trigger and h45's entry,
// (3) each H12o trade, (4) P's final stop and h45's logout. Exit 0 when the slice ran to Z, 1 otherwise.

import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Subprocess } from 'bun';
import { readCue } from '../helpers/altar-cue';
import { role } from '../helpers/mule';
import { h45LauncherEntry, muleRunOptions } from '../helpers/mule-ledger';
import { readMuleReady } from '../helpers/mule-readiness';
import { openRoleState } from '../helpers/role';
import { depositAll } from '../lib/bank';
import { ReservationWatch, reservationPath } from '../lib/host-reservation';
import { objPack } from '../lib/obj-pack';
import { closeSession, isLoopbackHost, loadBotEnv, openSession, relog, ROOT, type Session } from '../lib/session';
import { TickLog } from '../lib/ticks';
import { waitUntil } from '../lib/wait';
import { opIndex } from '../lib/world';
import { buildChain, KIT_PARTNER_ROWS, muleCueDir, PLACEMENT, type RunConfig } from '../runner/chain';
import { RunCues } from '../runner/cue-keeper';
import { deliveryOwnerFor, type DeliveryOwner } from '../runner/delivery-owner';
import { HandOffRecord } from '../runner/handoff';
import { runChainOnSession } from '../run';
import { MANIFEST } from '../tools/slot-ledger';
import { arg, botArg, result } from './common';
import { H45_BOT, h45Env, stageH45 } from './h45';
import { planMuleDeliveryFixtures, type FixtureItem } from './mule-delivery-fixtures';
import { MM_VARS, PREREQ_VARS, ROUTE_LEVELS } from './quests/monkey-madness';
import { cheat, clearInventory, leaveTutorial, mustTele, setStats, setVars } from './setup';

const scoredName = botArg();
const muleName = arg('mule', '');
const gw = Number(arg('gw', '8479'));
if (!muleName || muleName === scoredName) throw new Error('--mule must name a separate fresh lab account');
for (const n of [muleName, scoredName]) if (!isLoopbackHost(loadBotEnv(n).SERVER ?? '')) throw new Error('lab only: a non-loopback world is refused');
const scoredAccount = loadBotEnv(scoredName).BOT_USERNAME!;

const manifest = readFileSync(MANIFEST, 'utf8');
// H12's before-state as the ledger walks it, with the swap's returns at the walked counts (Fight Arena's 1,000 coins;
// the runes S12's Fire Blasts leave).
const concrete = (id: number, count: number, reason: string) => ({ items: [{ id, count }], reason });
const plan = planMuleDeliveryFixtures({
    manifest, rows: ['H12'], onRequest: [], pack: objPack(),
    overrides: { H12: {
        takeBacks: { 'coins @995': concrete(995, 1000, 'the ledger walk'), 'death rune': concrete(560, 49, 'the ledger walk'), 'chaos rune': concrete(562, 16, 'the ledger walk') },
    } },
});
if (!plan.ok) {
    result('s15-chain-unresolved', plan.unresolved);
    process.exit(1);
}
const h12 = plan.fixtures[0]!;

const root = mkdtempSync(join(tmpdir(), 's15-chain-'));
const cueRoot = join(root, 'rc-cue');
mkdirSync(cueRoot, { recursive: true, mode: 0o700 });
const runId = `a1-lab${Date.now().toString(36)}`;
const options = muleRunOptions([h12.ledger], cueRoot, { deliveryRun: runId, serve: scoredAccount });
mkdirSync(options.cueDir, { recursive: true, mode: 0o700 });
const launcherPath = join(root, 'launcher-config.json');
writeFileSync(launcherPath, JSON.stringify({ accounts: [{ account: muleName, role: 'mule', cueDir: options.cueDir, options }] }, null, 2));

// h45: run day's entry, with only the lab's account, SCORED's login and this lab's role folder put in.
const h45 = h45Env(H45_BOT);
const h45Base = join(root, 'h45');
const h45Cue = join(h45Base, 'h45-cue');
const h45Login = join(h45Base, 'h45-login');
const h45Run = join(h45Base, 'run');
const h45Bots = join(h45Base, 'bots');
const runDay = h45LauncherEntry(manifest);
const h45Entry = { ...runDay, account: h45.account, cueDir: h45Cue, options: { ...runDay.options, serve: scoredAccount } };
const entryDiff: string[] = [
    ...(['account', 'role', 'cueDir', 'loginOn', 'stopOn'] as const).filter(k => JSON.stringify(runDay[k]) !== JSON.stringify(h45Entry[k])),
    ...(Object.keys(runDay.options).filter(k => JSON.stringify((runDay.options as Record<string, unknown>)[k]) !== JSON.stringify((h45Entry.options as Record<string, unknown>)[k])).map(k => `options.${k}`)),
];

const partners: Record<string, string> = Object.fromEntries([...Object.keys(PLACEMENT), ...KIT_PARTNER_ROWS].map(id => [id, `lab_${id.toLowerCase()}`]));
partners.H12 = muleName;
const cfg: RunConfig = {
    partners, firemakingTiles: '3240,3296;3239,3296;3238,3296', rings: { giver: 'lab_ring' }, bones: { giver: 'lab_bone' },
    courier: { giver: 'lab_courier', below: 3 }, anvil: { giver: 'lab_anvil' },
    cueDir: cueRoot, muleCueDir: options.cueDir, delivery: { run: runId, launcherConfig: launcherPath },
    h12o: { account: h45.account, cueDir: h45Cue, loginDir: h45Login, leadTicks: 300 },
};
const cues = new RunCues({ main: cfg.cueDir, mule: muleCueDir(cfg) }, scoredAccount);
const full = buildChain(cfg, { cues, manifest, attempt: runId, handOffs: new HandOffRecord(root, runId) });
const i0 = full.findIndex(s => s.id === 'S15');
const i1 = full.map(s => s.id).lastIndexOf('S15');
const slice = full.slice(i0, i1 + 1);

let scored!: Session;
let mule!: Session;
const tick = () => scored?.sdk.getState()?.tick ?? -1;
const emit = (event: string, fields: Record<string, unknown> = {}) => {
    const r = { event, ms: Date.now(), scoredTick: tick(), ...fields };
    appendFileSync(join(root, 'events.jsonl'), JSON.stringify(r) + '\n');
    console.log(JSON.stringify(r));
};
const sharks = () => (scored.sdk.getState()?.inventory ?? []).filter(i => /^shark$/i.test(i.name)).reduce((n, i) => n + i.count, 0);

async function giveAll(s: Session, items: readonly FixtureItem[]) {
    for (const item of items) {
        const have = () => s.sdk.getInventory().filter(i => i.id === item.id).reduce((n, i) => n + i.count, 0);
        const before = have();
        await cheat(s.sdk, `give ${item.debugName} ${item.count}`);
        if (!(await waitUntil(s.sdk, () => have() === before + item.count, { maxTicks: 15 })).ok) throw new Error(`fixture give failed: ${item.debugName}`);
    }
}

/** SCORED as H12's row leaves it arriving at the Grand Tree door: route levels, Monkey Madness unstarted, the walked pack and worn set. */
async function stageScored() {
    await setVars(scored.sdk, { ...PREREQ_VARS, ...Object.fromEntries(MM_VARS.map(v => [v, 0])) });
    // The hangar's board persists per account (lab/quests/monkey-madness.ts applyFixture): E meets a fresh scramble.
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
    // ::setvar changes the varps but not the quest list the client publishes until a login.
    await relog(scored);
    const s = scored.sdk.getState()!;
    emit('scored-staged', { at: { x: s.player?.worldX, z: s.player?.worldZ, level: s.player?.level }, sharks: sharks(), worn: s.equipment.map(e => `${e.name} x${e.count}`), inventory: s.inventory.map(i => `${i.name} x${i.count}`) });
}

async function seedCarrier() {
    const b = options.packages[0]!.bank;
    await mustTele(mule.sdk, b.x, b.z, b.level);
    if (!(await mule.bot.openBank()).success) throw new Error('carrier fixture bank unavailable');
    for (const batch of plan.seedBatches!) {
        await giveAll(mule, batch);
        if (!(await depositAll(mule.sdk)).ok) throw new Error('carrier fixture deposit failed');
    }
    emit('carrier-bank', { items: mule.sdk.getBankItems().map(i => `${i.name} x${i.count}`) });
    await mule.bot.closeBank();
}

/** The launcher for h45 alone on run day's entry; its own stdout and role log echoed as events. */
function launchH45(): { child: Subprocess<'ignore', 'pipe', 'inherit'>; status: () => Record<string, unknown> | undefined; roleLines: Record<string, unknown>[]; stop: () => Promise<void> } {
    mkdirSync(join(h45Bots, h45.account), { recursive: true, mode: 0o700 });
    mkdirSync(h45Cue, { recursive: true, mode: 0o700 });
    writeFileSync(join(h45Bots, h45.account, 'bot.env'), `BOT_USERNAME=${h45.account}\nPASSWORD=${h45.password}\nSERVER=localhost:${process.env.WEB_PORT ?? '9300'}\nSHOW_CHAT=false\nTELEMETRY=false\nPROFANITY_FILTER=false\n`, { mode: 0o600 });
    const configPath = join(h45Base, 'launch.json');
    writeFileSync(configPath, JSON.stringify({ gatewayPort: gw, botsDir: h45Bots, runDir: h45Run, loginSpacingMs: 1000, accounts: [h45Entry] }, null, 2));
    const child: Subprocess<'ignore', 'pipe', 'inherit'> = Bun.spawn([process.execPath, 'speedrun/helpers/standalone.ts', configPath], { cwd: ROOT, env: process.env, stdin: 'ignore', stdout: 'pipe', stderr: 'inherit' });
    void (async () => {
        const decoder = new TextDecoder();
        let buf = '';
        const reader = child.stdout.getReader();
        for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            let nl: number;
            while ((nl = buf.indexOf('\n')) >= 0) {
                emit('h45-launcher', { line: buf.slice(0, nl) });
                buf = buf.slice(nl + 1);
            }
        }
    })();
    const roleLines: Record<string, unknown>[] = [];
    let read = 0;
    const poll = setInterval(() => {
        let text = '';
        try { text = readFileSync(join(h45Run, 'logs', `${h45.account}.role.log`), 'utf8'); } catch { return; }
        const lines = text.split('\n');
        for (const line of lines.slice(read, lines.length - 1)) {
            try {
                const d = JSON.parse(line.slice(line.indexOf('{'))) as Record<string, unknown>;
                roleLines.push({ tick: tick(), ...d });
                emit('h45-role', d);
            } catch { /* a non-JSON line */ }
        }
        read = lines.length - 1;
    }, 100);
    const status = () => {
        try {
            return (JSON.parse(readFileSync(join(h45Run, 'launcher.json'), 'utf8')) as { accounts: Record<string, unknown>[] }).accounts.find(a => a.account === h45.account);
        } catch { return undefined; }
    };
    return {
        child, status, roleLines,
        async stop() {
            clearInterval(poll);
            if (child.exitCode === null) {
                child.kill('SIGTERM');
                await Promise.race([child.exited, new Promise<void>(r => setTimeout(r, 40_000))]);
            }
        },
    };
}

function revision(): string {
    try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
    catch { try { return readFileSync(join(ROOT, 'LAB_COMMIT'), 'utf8').trim(); } catch { return 'unknown'; } }
}

let pass = false;
let running: Promise<void> | undefined;
let roleError: unknown;
const stop = new AbortController();
let launcher: ReturnType<typeof launchH45> | null = null;
const steps: Record<string, unknown>[] = [];

try {
    emit('start', { host: hostname(), revision: revision(), tickRate: process.env.NODE_TICKRATE, runId, root, slice: slice.map(s => `${s.id}|${s.name}`) });
    emit('h45-entry', { entry: h45Entry, differsFromRunDay: entryDiff });
    if (entryDiff.some(k => !['account', 'cueDir', 'options.serve'].includes(k))) throw new Error(`h45's entry differs from run day's beyond account, cueDir and serve: ${entryDiff.join(', ')}`);

    await stageH45(H45_BOT, line => emit('h45-stage', { line }));
    scored = await openSession(scoredName, { client: 'lite', launch: true });
    mule = await openSession(muleName);
    for (const s of [scored, mule]) { await leaveTutorial(s); await clearInventory(s.sdk); }
    await seedCarrier();
    await stageScored();

    const state = await openRoleState(join(root, 'role-state.json'));
    running = role.run({
        sdk: mule.sdk, bot: mule.bot, account: muleName, options: { ...options }, signal: stop.signal, state,
        log: (message, data) => emit('carrier', { message, ...data }),
        reportBank: () => {},
    }).then(() => { if (!stop.signal.aborted) roleError = new Error('the carrier role exited'); }, e => { roleError = e; emit('carrier-error', { error: String(e) }); });

    const pre = deliveryOwnerFor({ delivery: cfg.delivery, partners: cfg.partners, chain: slice, receiver: scoredAccount, dir: muleCueDir(cfg) });
    if ('refusal' in pre) throw new Error(`preflight refused: ${pre.refusal}`);
    const owner = pre.owner as DeliveryOwner;
    cues.bindDelivery(owner);
    for (const r of owner.firstRows()) emit('prepare-first', { row: r.row, bound: owner.prepare(r.row) });

    launcher = launchH45();
    // On run day the carrier was prepared rows earlier: the staged entry waits for it ready and in view.
    const t0 = tick();
    const inView = await waitUntil(scored.sdk, st => !!roleError || (owner.ready('H12').ok && st.nearbyPlayers.some(p => p.name.toLowerCase() === muleName.toLowerCase())), { maxTicks: 1500 });
    if (roleError) throw roleError;
    emit('entry-wait', { ok: inView.ok, waitTicks: tick() - t0, status: readMuleReady(options.cueDir, muleName) });
    if (!inView.ok) throw new Error('H12: the carrier was not ready and in view within 1500 ticks');

    // Checkpoints, from the run log's rows (one per finished step) and h45's launcher status and role log.
    const log = TickLog.memory(scoredAccount);
    let seenRows = 0;
    let loginRowTick: number | null = null;
    let mStartTick: number | null = null;
    let lastStatus = '';
    let h45InTick: number | null = null;
    let handOffs = 0;
    let roleSeen = 0;
    let finalDone = false;
    const watch = setInterval(() => {
        for (const row of log.rows.slice(seenRows)) {
            const r = { step: row.step, ok: row.ok, ticks: row.ticks, endTick: tick() };
            steps.push(r);
            emit('step', r);
            if (row.step === 'S15:A-narnode') emit('checkpoint', { n: 1, what: 'sharks right after segment A (H12)', ok: row.ok, sharks: sharks(), aTicks: row.ticks, inventory: scored.sdk.getState()?.inventory.map(i => `${i.name} x${i.count}`) });
            if (row.step === 'H12o h45 login trigger') {
                loginRowTick = tick();
                emit('login-trigger', { ok: row.ok, tick: loginRowTick, loginDirCue: existsSync(h45Login) ? readCue(h45Login) : null });
            }
            if (row.step === 'S15:L-amulet' || row.step === 'H12o h45 login trigger') mStartTick = tick();
        }
        seenRows = log.rows.length;
        const st = launcher?.status();
        const key = JSON.stringify(st ?? null);
        if (key !== lastStatus) {
            lastStatus = key;
            emit('h45-status', { status: st ?? null });
            // helpers/standalone.ts AccountState: queued, awaiting-cue, logging-in, online, backoff, stopping, stopped.
            const s = String((st as { state?: unknown } | undefined)?.state ?? '');
            if (h45InTick === null && s === 'online') {
                h45InTick = tick();
                emit('checkpoint', { n: 2, what: "h45's entry relative to the login trigger and M's start", state: s, h45InTick, loginTriggerTick: loginRowTick, mStartTick, afterTrigger: loginRowTick !== null ? h45InTick - loginRowTick : null, afterMStart: mStartTick !== null ? h45InTick - mStartTick : null, roleCue: readCue(h45Cue) });
            }
            if (h45InTick !== null && (s === 'stopping' || s === 'stopped') && !finalDone) {
                finalDone = true;
                emit('checkpoint', { n: 4, what: "P's final stop and h45's logout", state: s, roleCue: readCue(h45Cue), status: st });
            }
        }
        for (const l of launcher?.roleLines.slice(roleSeen) ?? []) {
            if (/^hand-off/.test(String(l.message ?? ''))) {
                handOffs++;
                emit('checkpoint', { n: 3, what: `H12o trade ${handOffs}`, line: l });
            }
        }
        roleSeen = launcher?.roleLines.length ?? 0;
    }, 200);
    try {
        const { result: res } = await runChainOnSession(scored, { log, chain: slice, reservation: new ReservationWatch(reservationPath(join(root, 'no-reservation.json')), { label: 's15' }), cues, label: 's15' });
        emit('chain-done', { code: res.code, res });
        pass = res.code === 0;
        // h45 logs out on P's final stop; give the launcher time to report it.
        await new Promise(r => setTimeout(r, 20_000));
    } finally {
        clearInterval(watch);
    }
} catch (e) {
    emit('failure', { error: e instanceof Error ? e.stack ?? e.message : String(e), carrier: readMuleReady(options.cueDir, muleName), h45Cue: readCue(h45Cue) });
} finally {
    stop.abort();
    try { cues.close({ final: false }); } catch { /* nothing open */ }
    if (running) await Promise.race([running, new Promise<void>(r => setTimeout(r, 5000))]);
    const h45Final = launcher?.status() ?? null;
    const h45Role = launcher?.roleLines ?? [];
    if (launcher) await launcher.stop();
    if (mule) await closeSession(mule).catch(() => {});
    if (scored) await closeSession(scored).catch(() => {});
    const summary = { pass, host: hostname(), runId, tickRate: process.env.NODE_TICKRATE, steps, h45Final, h45HandOffs: h45Role.filter(l => /^hand-off/.test(String(l.message ?? ''))), root };
    writeFileSync(join(root, 'result.json'), JSON.stringify(summary, null, 2));
    result('s15-chain', summary);
}
process.exit(pass ? 0 : 1);
