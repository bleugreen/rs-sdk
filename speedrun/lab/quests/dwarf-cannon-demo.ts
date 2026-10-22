// Demo acceptance of the Dwarf Cannon module (STEP-MANIFEST.md entry 12, "Acceptance, demo"): a
// throwaway (cairn_dc01, staged by rs/289) at Lawgof with 8 sharks, 30 Hitpoints, Magic 1 and no
// Plague City runs the whole quest, A to L, walking K and L over White Wolf Mountain
// (teleports: false). No staff commands.
//
//   bun speedrun/lab/quests/dwarf-cannon-demo.ts <account> [--dialogue=burst|fixed]
//
// Tenet 12: the account's bot.env must carry GATEWAY_URL=ws://127.0.0.1:<port>. This script starts
// the loopback SDK gateway on that port (as magic-demo.ts does) and launches the lite client
// against it, so nothing goes through the demo relay.
//
// Staging, untimed: the step from wherever the account stands at Lawgof onto the arrival tile
// (2571,3463 tol 1, segment A's precondition). Then the module's twelve segments, each timed by
// its TickLog row and set beside the lab's mean for the same path. Pass: every segment ok and the
// quest complete. Then a clean logout, reported.
//
// --lab is the dry run on a local engine through lab.sh (LAB_RUNNERS=0, so this script owns the
// client): a fresh lab account staged with staff commands as the throwaway stands on the demo.
import type { Subprocess } from 'bun';
import { join, resolve } from 'node:path';
import { closeSession, loadBotEnv, logoutClean, openSession } from '../../lib/session';
import { TickLog } from '../../lib/ticks';
import { runTo } from '../../lib/travel';
import { invCount } from '../../lib/world';
import { questStatus } from '../../lib/quests';
import { ARRIVAL, MIN_FOOD, newTally, quest, steps } from '../../quests/dwarf-cannon';
import type { DialogueMode } from '../../quests/segments';
import { runSteps } from '../../runner/step';
import { arg, botArg, result } from '../common';
import { clearInventory, give, leaveTutorial, mustTele, setStats } from '../setup';

const ROOT = resolve(import.meta.dir, '..', '..', '..');
const account = botArg();
const lab = process.argv.includes('--lab');
const dialogue = arg('dialogue', 'burst') as DialogueMode;
if (dialogue !== 'burst' && dialogue !== 'fixed') throw new Error(`--dialogue=${dialogue}: want burst or fixed`);
const say = (m: string, d?: Record<string, unknown>) => console.log(`demo: ${m}${d ? ` ${JSON.stringify(d)}` : ''}`);

/**
 * The lab's means for the same path (m, lab, 300 ms; rs/257's PR #286): A-J the real-level chains
 * (J on travel.ts #240, as the demo's tree has it), K and L the walking runs. B and I are dice.
 */
const LAB_BY_MODE: Readonly<Record<DialogueMode, Record<string, number>>> = {
    burst: { A: 8, B: 296.3, C: 6, D: 29.3, E: 18, F: 58.3, G: 43, H: 101.7, I: 103.7, J: 45.3, K: 410.5, L: 421.5 },
    fixed: { A: 15, B: 281.7, C: 13.3, D: 30.3, E: 27, F: 58, G: 47, H: 107.3, I: 124.3, J: 54, K: 410.5, L: 421.5 },
};

let gateway: Subprocess | null = null;
if (!lab) {
    const url = loadBotEnv(account).GATEWAY_URL ?? '';
    const m = /^ws:\/\/127\.0\.0\.1:(\d+)\/?$/.exec(url);
    if (!m) throw new Error(`bots/${account}/bot.env: GATEWAY_URL must be ws://127.0.0.1:<port> (tenet 12, the loopback gateway)`);
    const port = m[1]!;
    const up = () => fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(1500) }).then(() => true, () => false);
    if (await up()) throw new Error(`something already answers on 127.0.0.1:${port}; pick another port`);
    gateway = Bun.spawn([process.execPath, 'server/gateway/gateway.ts'], {
        cwd: ROOT,
        env: { ...process.env, AGENT_PORT: port, GATEWAY_HOSTNAME: '127.0.0.1', GATEWAY_PUBLIC_PORT: '0', LOGIN_SERVER: 'false', ENGINE_MANAGEMENT_URL: 'http://127.0.0.1:9' },
        stdin: 'ignore',
        stdout: Bun.file(join(process.env.TMPDIR ?? '/tmp', `dc-demo-gateway-${port}.log`)),
        stderr: 'inherit',
    });
    const deadline = Date.now() + 20_000;
    while (!(await up())) {
        if (gateway.exitCode !== null || Date.now() > deadline) throw new Error(`gateway did not come up on 127.0.0.1:${port}`);
        await Bun.sleep(250);
    }
    say('loopback gateway up', { port: Number(port) });
}

const s = await openSession(account, { launch: true, readyTimeoutMs: 180_000 });
const log = TickLog.memory('dc-demo');
const tally = newTally();
let pass = false;
const out: Record<string, unknown> = { account, lab, dialogue };
const inventory = () => (s.sdk.getState()?.inventory ?? []).map(i => `${i.name}${i.count > 1 ? ` x${i.count}` : ''}`);
try {
    if (lab) {
        await leaveTutorial(s);
        await clearInventory(s.sdk);
        await setStats(s.sdk, { attack: 1, strength: 42, defence: 1, magic: 1, prayer: 1, hitpoints: 30, crafting: 1, smithing: 1 });
        await give(s.sdk, 'shark', MIN_FOOD);
        await mustTele(s.sdk, 2571, 3461);
    }
    const st0 = s.sdk.getState()!;
    const hp = st0.skills.find(k => /hitpoints/i.test(k.name));
    out.start = { at: [st0.player!.worldX, st0.player!.worldZ, st0.player!.level], hp: `${st0.player!.hp}/${hp?.baseLevel}`, sharks: invCount(st0, /^shark$/i), quest: questStatus(st0, quest), inventory: inventory() };
    say('start', out.start as Record<string, unknown>);

    // Untimed staging onto the arrival tile, where the run's leg T12-13 would leave SCORED.
    const there = await runTo(s.sdk as never, ARRIVAL, { bot: s.bot as never });
    if (!there.ok) throw new Error(`to the arrival tile ${ARRIVAL.x},${ARRIVAL.z}: ${there.reason ?? 'not arrived'}`);

    const list = steps({ teleports: false, dialogue, tally });
    const pre = list[0]!.preconditions(s.sdk.getState()!, {});
    if (pre !== true) throw new Error(`segment A refuses: ${pre}`);
    await runSteps(s, list, { log, c: {}, shouldStop: () => false, logout: async () => {}, tickMonitor: false });

    const rows = log.rows.filter(r => !r.kind && r.step.startsWith('S13:'));
    const lab0 = LAB_BY_MODE[dialogue];
    out.segments = rows.map(r => {
        const letter = r.step.split(':')[1]!.split('-')[0]!;
        const ref = lab0[letter];
        return { step: r.step, ok: r.ok, ticks: r.ticks, lab: ref, vsLab: ref ? `${Math.round(((r.ticks - ref) / ref) * 100)}%` : '' };
    });
    const total = rows.reduce((a, r) => a + r.ticks, 0);
    out.total = { ticks: total, lab: Object.values(lab0).reduce((a, x) => a + x, 0) };
    const st = s.sdk.getState()!;
    out.end = { at: [st.player!.worldX, st.player!.worldZ, st.player!.level], hp: st.player!.hp, quest: questStatus(st, quest), inventory: inventory() };
    out.tally = { ...tally, minHp: Number.isFinite(tally.minHp) ? tally.minHp : null };
    pass = rows.length === list.length && rows.every(r => r.ok) && questStatus(st, quest) === 'complete';
} catch (err) {
    out.error = err instanceof Error ? err.message : String(err);
    out.partial = log.rows.filter(r => !r.kind && r.step.startsWith('S13:')).map(r => ({ step: r.step, ok: r.ok, ticks: r.ticks }));
} finally {
    const lo = await logoutClean(s);
    out.logout = { ok: lo.ok, latencyTicks: lo.latencyTicks, ...(lo.ok ? {} : { reason: (lo as { reason?: string }).reason }) };
    await closeSession(s);
    gateway?.kill('SIGTERM');
}
result('dc demo', { pass, ...out });
if (Array.isArray(out.segments)) {
    console.log(`\n| Segment | ${lab ? 'Lab dry run' : 'Demo'} | Lab mean (${dialogue}) | vs lab |\n|---|---|---|---|`);
    for (const r of out.segments as Array<{ step: string; ticks: number; lab?: number; vsLab: string; ok: boolean }>) console.log(`| ${r.step}${r.ok ? '' : ' (failed)'} | ${r.ticks} | ${r.lab ?? ''} | ${r.vsLab} |`);
    const t = out.total as { ticks: number; lab: number };
    console.log(`| **Total** | ${t.ticks} | ${Math.round(t.lab * 10) / 10} | ${Math.round(((t.ticks - t.lab) / t.lab) * 100)}% |`);
}
process.exit(pass ? 0 : 1);
