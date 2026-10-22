// Demo acceptance of the Magic step module (STEP-MANIFEST.md entry 24, "Demo"; magic.md section 9):
// a throwaway Magic-1 account holding the S04 stand-in kit (20 sapphire rings, a staff of water,
// 20+ cosmic runes, the starter air and mind runes) runs S02 at the Lumbridge coop and then
// enchants its rings. No staff commands.
//
//   bun speedrun/lab/magic-demo.ts <account> [--enchants=20]
//
// Tenet 12: the account's bot.env must carry GATEWAY_URL=ws://127.0.0.1:<port>. This script
// starts the loopback SDK gateway on that port (as helpers/standalone.ts does: 127.0.0.1, no login
// server) and launches the lite client against it, so nothing goes through the demo relay.
//
// Phases: travel to the coop gate (untimed staging); the S02 step (timed by its TickLog row,
// against 18); wield the staff; enchant every held sapphire ring (enchantHeld). Pass: S02 reaches
// 7, and the enchants are all cast with a span (first cast to the last cast's delay clearing)
// within 2 ticks of 3 a cast. Then a clean logout, reported.
//
// --lab is the dry run on a local engine through lab.sh (its gateway and runner): it stages the
// kit at Varrock west bank with staff commands, as the throwaway stands on the demo.
import { wield } from '../lib/act';
import { closeSession, logoutClean, openSession, type Session } from '../lib/session';
import { formatReport, report } from '../lib/ticks';
import { travelTo } from '../lib/toll-gate';
import { nextTick, waitUntil } from '../lib/wait';
import { runSteps } from '../runner/step';
import { enchantHeld, magicLevel, magicXp, steps, type MagicReport } from '../skills/magic';
import { arg, botArg, labLog, result } from './common';
import { startLoopbackGateway } from './loopback-gateway';
import { cheat, leaveTutorial, mustTele } from './setup';

const account = botArg();
const lab = process.argv.includes('--lab');
const COOP_GATE = { x: 3235, z: 3295 };
const VARROCK_WEST_BANK = { x: 3185, z: 3436 };
const log = labLog('magic-demo');
const say = (m: string, d?: Record<string, unknown>) => console.log(`demo: ${m}${d ? ` ${JSON.stringify(d)}` : ''}`);
const noStop = { shouldStop: () => false, logout: async () => {} };
const count = (s: Session, re: RegExp) => s.sdk.getState()!.inventory.filter(i => re.test(i.name)).reduce((a, i) => a + i.count, 0);

const gateway = lab ? null : await startLoopbackGateway(account, 'magic-demo');

const s = await openSession(account, lab ? {} : { launch: true, readyTimeoutMs: 180_000 });
let pass = false;
const out: Record<string, unknown> = { account, lab };
try {
    if (lab) {
        await leaveTutorial(s, log);
        await mustTele(s.sdk, VARROCK_WEST_BANK.x, VARROCK_WEST_BANK.z);
        for (const c of ['~clearinv inv', '~clearinv worn']) await cheat(s.sdk, c);
        for (const c of ['sapphire_ring 20', 'staff_of_water 1', 'cosmicrune 20', 'airrune 25', 'mindrune 15']) await cheat(s.sdk, `give ${c}`);
        await waitUntil(s.sdk, st => st.inventory.length >= 24, { maxTicks: 15 });
    }
    const st0 = s.sdk.getState()!;
    const rings = count(s, /^sapphire ring$/i);
    const n = Number(arg('enchants', String(rings)));
    out.start = { at: [st0.player!.worldX, st0.player!.worldZ], magic: magicLevel(st0), rings, cosmic: count(s, /^cosmic rune$/i), air: count(s, /^air rune$/i), mind: count(s, /^mind rune$/i) };
    say('kit', out.start as Record<string, unknown>);
    if (rings < n) throw new Error(`holding ${rings} sapphire rings, ${n} wanted`);

    const there = await travelTo(s.bot, s.sdk, COOP_GATE, { tolerance: 2, log: say });
    if (!there.ok) throw new Error(`travel to the coop gate: ${there.reason}`);

    const reports: MagicReport[] = [];
    const [s02] = steps({ onReport: r => reports.push(r) });
    await runSteps(s, [s02!], { log, c: {}, ...noStop });
    const strike = reports.find(r => r.step === 'S02') as Extract<MagicReport, { step: 'S02' }> | undefined;
    const s02Row = log.rows.find(r => r.step === s02!.name);
    out.s02 = { ticks: s02Row?.ticks, ok: s02Row?.ok, against: 18, level: magicLevel(s.sdk.getState()), xp: magicXp(s.sdk.getState()), casts: strike?.strike.xpTicks.length, dropped: strike?.dropped };
    say('S02', out.s02 as Record<string, unknown>);

    const w = await wield(s.sdk, /^staff of water$/i);
    if (!w.ok) throw new Error(`wielding the staff: ${w.reason ?? 'failed'}`);
    await nextTick(s.sdk);
    const e = await enchantHeld(s.sdk, { untilLevel: 99 });
    const gaps = e.xpTicks.slice(1).map((t, i) => t - e.xpTicks[i]!);
    const span = e.xpTicks.length ? e.xpTicks.at(-1)! - e.xpTicks[0]! + 3 : 0;
    out.enchant = { ok: e.ok, casts: e.casts, span, against: 3 * n, gaps: gaps.reduce<Record<number, number>>((h, g) => ((h[g] = (h[g] ?? 0) + 1), h), {}), clicks: e.clicks, ...(e.reason ? { reason: e.reason } : {}) };
    pass = !!s02Row?.ok && magicLevel(s.sdk.getState()) >= 7 && e.ok && e.casts === n && Math.abs(span - 3 * n) <= 2;
} catch (err) {
    out.error = err instanceof Error ? err.message : String(err);
} finally {
    const lo = await logoutClean(s);
    out.logout = { ok: lo.ok, latencyTicks: lo.latencyTicks, ...(lo.ok ? {} : { reason: (lo as { reason?: string }).reason }) };
    await closeSession(s);
    gateway?.kill('SIGTERM');
}
result('magic demo', { pass, ...out });
console.log(formatReport(report(log.rows)));
process.exit(pass ? 0 : 1);
