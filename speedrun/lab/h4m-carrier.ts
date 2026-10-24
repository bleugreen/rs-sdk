// Lab-only H4m carrier: a lab account on h55's observed profile serving H4p and H4m's loads
// from the real mule role, with the canonical options (muleFromLedger -> muleRunOptions), while
// another script drives SCORED through the scored chain's DeliveryOwner (prepare, ready, cue).
//
//   LAB_HELPERS=<carrier> speedrun/lab/lab.sh <scored> \
//     'speedrun/lab/h4m-carrier.ts:--carrier=<carrier>:--delivery-run=<run>:--cue-root=<dir>:--manifest=<file>:--background' \
//     '<the scored script>'
//
// The receiver is lab.sh's bot (or --serve). --rows (default H4p) selects the ordered rows, and H4m's
// loads follow H4p when the manifest has the row H4m.1-H4m.N. The bank is seeded with exactly the
// packages' stock. With --background the role runs in a child process; the parent returns once the
// carrier is staged at its first bank with the role started (pid in $LAB_LOG/h4m-carrier.pid); the
// options it serves are in $LAB_LOG/h4m-carrier-options.json before it logs in. The
// child exits when every package is served, when lab.sh's engine (its $LAB_LOG/engine.pid) is gone,
// or after --max-minutes.
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { role } from '../helpers/mule';
import { muleFromLedger, muleRunOptions } from '../helpers/mule-ledger';
import { openRoleState } from '../helpers/role';
import { depositAll } from '../lib/bank';
import { noteLink, objPack } from '../lib/obj-pack';
import { closeSession, isLoopbackHost, loadBotEnv, openSession } from '../lib/session';
import { waitUntil } from '../lib/wait';
import { opIndex } from '../lib/world';
import { MANIFEST } from '../tools/slot-ledger';
import { arg, botArg, result } from './common';
import { cheat, clearInventory, leaveTutorial, mustTele, setStats } from './setup';

const carrier = arg('carrier', '');
const serve = arg('serve', botArg());
const deliveryRun = arg('delivery-run', '');
const cueRoot = arg('cue-root', '');
const rows = arg('rows', 'H4p').split(',').filter(Boolean);
const manifestPath = arg('manifest', MANIFEST);
const profile = arg('profile', 'h55-observed');
const maxMinutes = Number(arg('max-minutes', '60'));
const labLog = process.env.LAB_LOG ?? join(tmpdir(), 'speedrun-lab');
if (!carrier || carrier === serve) throw new Error('--carrier must name a lab account other than the receiver');
if (!deliveryRun || !cueRoot) throw new Error('--delivery-run and --cue-root are required (the scored side\'s run id and cue root)');
if (profile !== 'h55-observed' && profile !== 'fresh') throw new Error('--profile is h55-observed or fresh');
if (!Number.isFinite(maxMinutes) || maxMinutes <= 0 || maxMinutes > 240) throw new Error('--max-minutes must be in (0, 240]');
for (const name of [carrier, serve]) {
    const env = loadBotEnv(name);
    if (!env.SERVER || !isLoopbackHost(env.SERVER)) throw new Error('Lab-only carrier refuses non-loopback worlds');
}

const pack = objPack();
const options = muleRunOptions(muleFromLedger(readFileSync(manifestPath, 'utf8'), { rows, onRequest: [], pack }), cueRoot, { deliveryRun, serve });
const readyFile = join(labLog, 'h4m-carrier.ready');
// The scored side writes its launcher config (run.ts's preflight) from these exact options.
if (!process.argv.includes('--child')) writeFileSync(join(labLog, 'h4m-carrier-options.json'), JSON.stringify(options, null, 2) + '\n');

if (process.argv.includes('--background')) {
    if (existsSync(readyFile)) throw new Error(`stale ${readyFile}; remove it first`);
    const child = Bun.spawn([process.execPath, import.meta.path, ...process.argv.slice(2).filter(a => a !== '--background'), '--child'], {
        stdout: Bun.file(join(labLog, 'h4m-carrier.log')), stderr: Bun.file(join(labLog, 'h4m-carrier.err')), stdin: 'ignore',
    });
    child.unref();
    writeFileSync(join(labLog, 'h4m-carrier.pid'), String(child.pid));
    const begun = Date.now();
    while (!existsSync(readyFile)) {
        if (child.exitCode !== null) throw new Error(`carrier exited (${child.exitCode}) before it was staged; see ${labLog}/h4m-carrier.log`);
        if (Date.now() - begun > 300_000) { child.kill(); throw new Error('carrier not staged in 5 minutes'); }
        await Bun.sleep(500);
    }
    result('h4m-carrier-started', { pid: child.pid, carrier, serve, rows: options.packages.map(p => p.scope!.step), log: join(labLog, 'h4m-carrier.log') });
    process.exit(0);
}

const emit = (event: string, fields: Record<string, unknown> = {}) => console.log(JSON.stringify({ event, ms: Date.now(), ...fields }));
const engineAlive = () => {
    const pidFile = join(labLog, 'engine.pid');
    if (!existsSync(pidFile)) return true;
    try { process.kill(Number(readFileSync(pidFile, 'utf8')), 0); return true; } catch { return false; }
};

const session = await openSession(carrier);
const stop = new AbortController();
let exitCode = 1;
try {
    await leaveTutorial(session);
    await clearInventory(session.sdk);
    if (profile === 'h55-observed') {
        // h55's public profile only: no quest stages, spell kit or travel runes.
        await setStats(session.sdk, { hitpoints: 90, attack: 29, defence: 27, strength: 27, magic: 99 });
        await cheat(session.sdk, 'give staff_of_air 1');
        if (!(await waitUntil(session.sdk, s => s.inventory.some(i => i.id === 1381), { maxTicks: 15 })).ok) throw new Error('staff fixture missing');
        const staff = session.sdk.getInventory().find(i => i.id === 1381)!;
        await session.sdk.sendUseItem(staff.slot, opIndex(staff, /^wield$/i) ?? 2);
        if (!(await waitUntil(session.sdk, s => s.equipment.some(i => i.id === 1381), { maxTicks: 8 })).ok) throw new Error('staff fixture equip failed');
    }
    const first = options.packages[0]!;
    await mustTele(session.sdk, first.bank.x, first.bank.z, first.bank.level);
    if (!(await session.bot.openBank()).success) throw new Error('carrier bank unavailable');
    for (const p of options.packages) for (const line of p.items) {
        if (!('amount' in line) || line.id === undefined) throw new Error(`${p.name}: the lab carrier seeds fixed lines by id only`);
        const obj = pack.names.get(noteLink(line.id, pack).item)!;
        const before = session.sdk.getInventory().reduce((n, i) => n + i.count, 0);
        await cheat(session.sdk, `give ${obj} ${line.amount}`);
        if (!(await waitUntil(session.sdk, s => s.inventory.reduce((n, i) => n + i.count, 0) === before + line.amount, { maxTicks: 15 })).ok) throw new Error(`seed give failed: ${obj}`);
        if (!(await depositAll(session.sdk)).ok) throw new Error(`seed deposit failed: ${obj}`);
    }
    emit('carrier-bank', { items: session.sdk.getBankItems().map(i => ({ id: i.id, count: i.count })) });
    await session.bot.closeBank();
    const root = mkdtempSync(join(tmpdir(), 'h4m-carrier-'));
    writeFileSync(join(root, 'options.json'), JSON.stringify(options, null, 2));
    const state = await openRoleState(join(root, 'role-state.json'));
    const served = () => (state.get('mule-delivery-served') as { pkg: string }[] | undefined)?.length ?? 0;
    emit('carrier-start', { carrier, serve, deliveryRun, cueDir: options.cueDir, packages: options.packages.map(p => ({ name: p.name, items: p.items, at: p.at, bank: p.bank, carryNext: p.carryNext })), root });
    let roleError: unknown = null;
    const running = role.run({
        sdk: session.sdk, bot: session.bot, account: carrier, options: { ...options }, signal: stop.signal, state,
        log: (message, data) => emit('role', { message, tick: session.sdk.getState()?.tick, ...data }),
        reportBank: bank => emit('bank', { items: bank.items.map(i => ({ id: i.id, count: i.count })) }),
    }).catch(e => { roleError = e; });
    writeFileSync(readyFile, String(Date.now()));
    const deadline = Date.now() + maxMinutes * 60_000;
    while (served() < options.packages.length && engineAlive() && Date.now() < deadline && !roleError) await Bun.sleep(1000);
    // Let the last plain stop release the carrier to its bank before the role is stopped.
    if (served() === options.packages.length) await Bun.sleep(20_000);
    stop.abort();
    await Promise.race([running, Bun.sleep(5000)]);
    exitCode = served() === options.packages.length && !roleError ? 0 : 1;
    result('h4m-carrier', { exitCode, served: state.get('mule-delivery-served'), packages: options.packages.length, roleError: roleError ? String(roleError) : null, engineAlive: engineAlive(), final: session.sdk.getState()?.player && { x: session.sdk.getState()!.player!.worldX, z: session.sdk.getState()!.player!.worldZ, hp: session.sdk.getState()!.player!.hp } });
} catch (error) {
    emit('failure', { error: String(error) });
} finally {
    stop.abort();
    await closeSession(session);
}
process.exit(exitCode);
