// S09 under H4m on the lab (rs/701): the run's own S09 slice with H4m's loads, against a real
// `deliveryRun` carrier (rs/705's lab/h4m-carrier.ts, its own process in the same lab.sh call).
// What is the run's and not a lab copy:
// - the chain: runner/chain.ts buildChain with `s07PrayerTo` 98 over a manifest carrying the fallback
//   row H4m.1-H4m.N, sliced from H4p to T09-10 (H4p, [H4m.k hand-off, mining.bury: load k] x N,
//   mining.iron-63, mining.exit), run by runner/step.ts runSteps;
// - the cues: runner/cue-keeper.ts RunCues bound to run.ts's own delivery preflight (deliveryOwnerFor
//   over chainPartners), so every load is prepared, its readiness awaited, its cue written and kept
//   fresh, and its stop prepares the next.
// The lab part: SCORED's stats and kit by staff command (Mining --level, Prayer 98's floor, Magic 59
// for combat 43; knife and S07's log), its arrival tile, the five-rock control before it, and one
// override, S09_MINING's respawn 13 for 'auto': the lab's /playercount answers its two bots, and the
// engine's respawn is pinned to 13 in the scratch tree (player_count.rs2, never committed). --level
// defaults to the level from which Mining 99 comes about 7 loads in, so the last loads are taken at 99
// and buried by hand at the zoo: the fallback stop.
//
//   LAB_RUNNERS=0 LAB_HELPERS=<carrier> NODE_TICKRATE=400 speedrun/lab/lab.sh <scored> \
//     '<rs/705's carrier spec>' 'speedrun/lab/h4m-s09.ts:--carrier=<carrier>:--manifest=<file>:--run=<id>:--cue-root=<dir>'
//
// Exit 0 when every step held its postconditions (the last bury step's is the chain's Prayer 99),
// at least 4 loads were buried on the lap and at least one by hand at Mining 99.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname, loadavg } from 'node:os';
import { join } from 'node:path';
import { muleFromLedger, muleRunOptions } from '../helpers/mule-ledger';
import { readMuleReady } from '../helpers/mule-readiness';
import { objPack } from '../lib/obj-pack';
import { awaitProgram, startProgram } from '../lib/programs';
import { closeSession, isLoopbackHost, loadBotEnv, type Session } from '../lib/session';
import { TickLog, type TickRow } from '../lib/ticks';
import { waitUntil } from '../lib/wait';
import { levelForXp, XP_RATE, xpForLevel } from '../lib/xp';
import { buildChain, chainPartners, KIT_PARTNER_ROWS, muleCueDir, PLACEMENT, S09_MINING, type ChainStep, type RunConfig } from '../runner/chain';
import { RunCues } from '../runner/cue-keeper';
import { deliveryOwnerFor, type DeliveryOwner } from '../runner/delivery-owner';
import { HandOffRecord } from '../runner/handoff';
import { runSteps } from '../runner/step';
import * as mining from '../skills/mining';
import { openSecureLabSession, type SecureLabSession } from './browser';
import { arg, botArg, result } from './common';
import { cheat, clearInventory, give, leaveTutorial, mustTele, setStats } from './setup';

const scoredName = botArg();
const carrier = arg('carrier', '');
const manifestFile = arg('manifest', '');
const runId = arg('run', '');
const cueRoot = arg('cue-root', '');
const CONTROL_ORES = Number(arg('control-ores', '150'));
/** Ores to Mining 99 from the start: ~5 ores a bone, so 700 is about 7 loads on the lap. */
const LAP_ORES = Number(arg('lap-ores', '700'));
const LEVEL = Number(arg('level', String(levelForXp(xpForLevel(99) - LAP_ORES * 35 * XP_RATE))));
const PRAYER = 98;
if (!carrier || carrier === scoredName || !manifestFile || !runId || !cueRoot) throw new Error('--carrier, --manifest, --run and --cue-root are required');
for (const n of [carrier, scoredName]) if (!isLoopbackHost(loadBotEnv(n).SERVER ?? '')) throw new Error('lab only: a non-loopback world is refused');

const manifest = readFileSync(manifestFile, 'utf8');
mkdirSync(cueRoot, { recursive: true, mode: 0o700 });
const root = join(cueRoot, '..');
mkdirSync(join(root, 'cue'), { recursive: true, mode: 0o700 });
const where = () => ({ host: hostname(), load: loadavg().map(l => +l.toFixed(2)), at: new Date().toISOString() });
const log = TickLog.open(runId, join(root, 'ticks.jsonl'));
const say = (event: string, fields: Record<string, unknown> = {}) => console.log(JSON.stringify({ event, tick: scored?.sdk.getState()?.tick ?? null, ...where(), ...fields }));

// The carrier's options as it serves them (lab/h4m-carrier.ts writes them before it logs in), else as
// mule-ledger.ts generates them for the run: the launcher config run.ts's preflight checks.
const servedFile = join(process.env.LAB_LOG ?? '', 'h4m-carrier-options.json');
const options: ReturnType<typeof muleRunOptions> = process.env.LAB_LOG && existsSync(servedFile)
    ? JSON.parse(readFileSync(servedFile, 'utf8'))
    : muleRunOptions(muleFromLedger(manifest, { rows: ['H4p'], onRequest: [], pack: objPack() }), cueRoot, { deliveryRun: runId, serve: scoredName });
const launcherPath = join(root, 'launcher-config.json');
writeFileSync(launcherPath, JSON.stringify({ accounts: [{ account: carrier, role: 'mule', cueDir: options.cueDir, options }] }, null, 2));

const partners: Record<string, string> = Object.fromEntries([...Object.keys(PLACEMENT), ...KIT_PARTNER_ROWS].map(id => [id, `lab_${id.toLowerCase()}`]));
partners.H4p = carrier;
partners.H4m = carrier;
const cfg: RunConfig = {
    partners, firemakingTiles: '3240,3296;3239,3296;3238,3296', rings: { giver: 'lab_ring' }, bones: { giver: 'lab_bone' },
    courier: { giver: 'lab_courier', below: 3 }, anvil: { giver: 'lab_anvil' }, s07PrayerTo: PRAYER,
    cueDir: join(root, 'cue'), muleCueDir: options.cueDir, delivery: { run: runId, launcherConfig: launcherPath },
};
// The lab's one override: its /playercount answers two bots (respawn 'auto' would schedule 20).
Object.assign(S09_MINING, { respawn: 13 });
const cues = new RunCues({ main: cfg.cueDir, mule: muleCueDir(cfg) }, scoredName);
const full = buildChain(cfg, { cues, manifest, attempt: runId, handOffs: new HandOffRecord(root, runId) });
const slice: ChainStep[] = full.slice(full.findIndex(s => s.id === 'H4p'), full.findIndex(s => s.id === 'T09-10'));
const loads = slice.filter(s => s.name.startsWith('mining.bury')).length;

let scored!: Session;
let secure: SecureLabSession | null = null;
let pass = false;
const summary: Record<string, unknown> = { host: hostname(), tickRate: process.env.NODE_TICKRATE, runId, level: LEVEL, prayer: PRAYER, loads, steps: slice.map(s => `${s.id}: ${s.name}`) };
const ready: Array<{ row: string; waitTicks: number }> = [];

/** knife-mine on the five-rock lap for CONTROL_ORES ores at the start level, the kit as S09's: the control's ticks per ore. */
async function control(): Promise<Record<string, unknown>> {
    await clearInventory(scored.sdk);
    await give(scored.sdk, ['rune_pickaxe', 'knife', 'logs', 'logs']);
    const first = mining.parseSteps(mining.ROTATIONS.five!.steps)[0]!.stand;
    await mustTele(scored.sdk, first[0], first[1]);
    await waitUntil(scored.sdk, () => false, { maxTicks: 14 }); // every rock respawned
    const params = { steps: mining.ROTATIONS.five!.steps, respawn: 13, starter: 'knife', ores: CONTROL_ORES, rate: [[41, 2]], selfStarter: true };
    const started = await startProgram(scored.sdk as never, 'knife-mine', params);
    const end = await awaitProgram(scored.sdk as never, started.runId);
    const r = (end.result ?? {}) as Record<string, unknown>;
    return { params: { ...params, steps: 'five' }, ores: r.ores, ticks: r.ticks, ticksPerOre: r.ticksPerOre, slips: r.slips, histogram: r.histogram };
}

const rowsOf = (pre: string) => log.rows.filter(r => r.step.startsWith(pre));
const metaOf = (r: TickRow) => (r.meta ?? {}) as Record<string, unknown>;

function measure(): Record<string, unknown> {
    const buries = rowsOf('(bury) mining.bury: load ').map(r => ({ step: r.step.replace('(bury) ', ''), startTick: r.startTick, endTick: r.endTick, ...metaOf(r) }));
    const segs = rowsOf('(band) mining.bury: load ').flatMap(r => (metaOf(r).segments as Array<{ ticks: number; ores: number; buried?: number; technique: string }>) ?? []);
    const lap = segs.reduce((a, s) => ({ ticks: a.ticks + s.ticks, ores: a.ores + s.ores, buried: a.buried + (s.buried ?? 0) }), { ticks: 0, ores: 0, buried: 0 });
    const steps = log.rows.filter(r => slice.some(s => s.name === r.step) && r.kind !== 'program' && r.kind !== 'note').map(r => ({ step: r.step, startTick: r.startTick, endTick: r.endTick, ticks: r.ticks, ok: r.ok }));
    const hands = steps.filter(s => /^H4m\.\d+ hand-off$/.test(s.step));
    // A load's cost on the band: from its bury step's lap end (the last bone, or Mining 99) to the next lap's first ore.
    const firstSeg = (k: number) => rowsOf(`(segment) mining.bury: load ${k}`)[0]?.startTick;
    const perLoad = hands.map((h, i) => {
        const k = i + 1;
        const prev = buries.find(b => b.step === `mining.bury: load ${k - 1}`);
        return { row: h.step.replace(' hand-off', ''), tradeStepTicks: h.ticks, readyWaitTicks: ready.find(r => `${r.row} hand-off` === h.step)?.waitTicks ?? null, lapGapTicks: prev && firstSeg(k) !== undefined ? firstSeg(k)! - prev.endTick : null };
    });
    return {
        lap: { ...lap, ticksPerOre: lap.ores ? +(lap.ticks / lap.ores).toFixed(3) : null, bonesPerTick: lap.ticks ? +(lap.buried / lap.ticks).toFixed(4) : null, segments: segs.length },
        buries, perLoad, steps,
        onLap: buries.reduce((a, b) => a + Number(b.onLap ?? 0), 0), byHand: buries.reduce((a, b) => a + Number(b.byHand ?? 0), 0), dropped: buries.reduce((a, b) => a + Number(b.dropped ?? 0), 0),
        loadsOnLap: buries.filter(b => Number(b.onLap ?? 0) > 0).length, loadsByHandAt99: buries.filter(b => Number(b.byHand ?? 0) > 0 && Number(b.mining) >= 99).length,
    };
}

try {
    say('start', { runId, level: LEVEL, loads, lapOres: LAP_ORES, controlOres: CONTROL_ORES, override: 'S09_MINING.respawn 13' });
    secure = await openSecureLabSession(scoredName);
    scored = secure.session;
    await leaveTutorial(scored);
    await setStats(scored.sdk, { mining: LEVEL, prayer: PRAYER, magic: 59, hitpoints: 10, defence: 1 });
    summary.control = await control();
    say('control', summary.control as Record<string, unknown>);

    // T08-09's arrival: S07's knife and kept log, Mining back at the start level, at the zoo tile.
    await clearInventory(scored.sdk);
    await setStats(scored.sdk, { mining: LEVEL, prayer: PRAYER });
    await give(scored.sdk, ['knife', 'logs']);
    await mustTele(scored.sdk, 2604, 3235);
    const s0 = scored.sdk.getState()!;
    summary.arrival = { mining: mining.miningLevel(s0), combat: mining.combatLevel(s0), prayerXp: s0.skills.find(k => k.name === 'Prayer')?.experience, inventory: s0.inventory.map(i => i.name) };
    say('arrival', summary.arrival as Record<string, unknown>);

    const pre = deliveryOwnerFor({ delivery: cfg.delivery, partners: chainPartners(cfg, slice), chain: slice, receiver: scoredName, dir: muleCueDir(cfg) });
    if ('refusal' in pre) throw new Error(`preflight refused: ${pre.refusal}`);
    const owner = pre.owner as DeliveryOwner;
    cues.bindDelivery(owner);
    for (const r of owner.firstRows()) say('prepare-first', { row: r.row, bound: owner.prepare(r.row) });
    const awaitReady = owner.awaitReady.bind(owner);
    owner.awaitReady = async (row, sdk, o) => {
        const t0 = scored.sdk.getState()!.tick;
        const status = await awaitReady(row, sdk, o);
        ready.push({ row, waitTicks: scored.sdk.getState()!.tick - t0 });
        say('ready', { row, waitTicks: scored.sdk.getState()!.tick - t0, phase: status.phase });
        return status;
    };
    // H4p is not cue-served: on run day its carrier stood there from S08; here it comes from its bank.
    const inView = await waitUntil(scored.sdk, st => owner.ready('H4p').ok && st.nearbyPlayers.some(p => p.name.toLowerCase().replace(/ /g, '_') === carrier.toLowerCase()), { maxTicks: 900 });
    say('entry-wait', { ok: inView.ok, status: readMuleReady(options.cueDir, carrier) });
    if (!inView.ok) throw new Error('H4p: the carrier was not ready and in view within 900 ticks');

    const off = cues.attach(scored.sdk);
    try {
        const r = await runSteps(scored, slice, { log, c: {}, shouldStop: () => false, logout: async () => {} });
        summary.completed = r.completed;
    } finally {
        off();
    }
    const s1 = scored.sdk.getState()!;
    const m = measure();
    Object.assign(summary, m, { end: { mining: mining.miningLevel(s1), prayer: s1.skills.find(k => k.name === 'Prayer')?.baseLevel, prayerXp: s1.skills.find(k => k.name === 'Prayer')?.experience, inventory: s1.inventory.map(i => i.name) } });
    const last = slice.find(s => s.name === `mining.bury: load ${loads}`)!;
    summary.lastPostcondition = last.postconditions(s1, {});
    pass = summary.completed === slice.length && summary.lastPostcondition === true && Number(m.loadsOnLap) >= 4 && Number(m.loadsByHandAt99) >= 1;
} catch (e) {
    summary.failure = e instanceof Error ? e.stack ?? e.message : String(e);
    say('failure', { error: summary.failure });
    try { Object.assign(summary, measure()); } catch { /* nothing measured */ }
} finally {
    try { cues.close({ final: false }); } catch { /* nothing open */ }
    if (secure) await secure.close();
    else if (scored) await closeSession(scored);
    summary.pass = pass;
    writeFileSync(join(root, 'result.json'), JSON.stringify(summary, null, 2));
    result('h4m-s09', summary);
}
process.exit(pass ? 0 : 1);
