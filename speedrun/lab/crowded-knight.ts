// S18 crowded-knight lab (rs/479): lite bots at Thieving 99 pickpocket one Knight of Ardougne beside a
// browser stand-in for SCORED, which runs the in-page `pickpocket` program with the knights band's
// parameters from skills/thieving.ts (no top-up, no stun pack), bounded by `maxTicks` in place of
// `untilLevel`. Answers two questions (docs/speedrun/research/stun-pack.md, the crowded-knight section):
// does a crowd on the same knight change the stand-in's picks, failures, stuns and stun-to-next, and
// does the crowd in view cost the browser tab frames or next-tick reactions (the in-page probe)?
//
//   LAB_BLOCK=37 NODE_TICKRATE=400 HEADLESS=1 bash docs/speedrun/scripts/tickprog-lab.sh <stand-in> \
//       speedrun/lab/crowded-knight.ts:--crowd=10:--ticks=200:--trials=60
//
// Phases, in --phases order (default base1,crowd,prefer,away,base2), each on the stand-in's observed ticks:
//   base1  no bots in the world
//   crowd  the bots click the knight every tick (they path to its side tiles; players never block
//          players, so any number fit) while the stand-in pickpockets the knight nearest it
//   prefer the bots crowd the knight nearest the anchor; the stand-in stays on the anchor and runs
//          with rs/480's `prefer` list, ordered by thieving.ts `chooseKnight` (needs rs/480's
//          thieving.ts and pickpocket.ts in the tree the page was built from; refused otherwise)
//   away   the bots stay logged in, teleported out of view (--away=x,z): the host-load control
//   base2  the bots logged out
// Each phase sets the stand-in to --thieving (80) and its hitpoints back, runs the in-page probe
// (--trials) from the anchor, then the program for --ticks. Rolls are timed from chat, the tick each line was first
// published; a bot's ticks are moved onto the stand-in's clock by the median offset between the two
// clients' publications of the same server tick (wall clock, one process).
//
// --prefix=ck479 names the bots <prefix>b01...; a bot whose bot.env is missing is created
// (bots/create-bot.ts --local) and every bot.env is pointed at this lab's ports.
// Output: RESULT lines per phase and $LAB_LOG/crowded-knight-<time>.json with every series.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname, loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatHistory } from '../../sdk/chat-history';
import type { BotWorldState, GameMessage, NearbyNpc } from '../../sdk/types';
import { probeInPage, runProgram, stopProgram, type ProgramStatus } from '../lib/programs';
import { closeSession, logoutClean, openSession, type Session } from '../lib/session';
import { waitTicks, waitUntil } from '../lib/wait';
import * as thieving from '../skills/thieving';
import { BANDS, eatPolicy, FOODS, foodPattern } from '../skills/thieving';
import { arg, result } from './common';
import { cheat, leaveTutorial, tele } from './setup';

const ROOT = join(import.meta.dir, '..', '..');
const standInName = process.argv[2] ?? '';
if (!standInName) throw new Error('usage: crowded-knight.ts <stand-in> [--crowd=10 --ticks=200 --trials=60 --phases=base1,crowd,away,base2]');
const CROWD = Number(arg('crowd', '10'));
const TICKS = Number(arg('ticks', '200'));
const TRIALS = Number(arg('trials', '60'));
const THIEVING = Number(arg('thieving', '80'));
const HP = Number(arg('hp', '97'));
const PREFIX = arg('prefix', 'ck479');
const PHASES = arg('phases', 'base1,crowd,prefer,away,base2').split(',').filter(Boolean);
/** rs/480's uncrowded choice, when the tree has it (on main through rs/480's PR, not on this branch). */
const chooseKnight = (thieving as unknown as {
    chooseKnight?: (s: BotWorldState, npc: RegExp, exclude: readonly string[]) => { candidates: Array<{ index: number; players: number; distance: number }>; chosen: number | null; retarget: number | null };
}).chooseKnight;
const LOGIN_BATCH = Number(arg('login-batch', '5'));
const [AWAY_X, AWAY_Z] = arg('away', '2705,3305').split(',').map(Number) as [number, number];
const ANCHOR = BANDS.find(b => b.name === 'thieving:knights')!.anchors[0]!;
const KNIGHT = /^Knight of Ardougne$/i;
const LOG = process.env.LAB_LOG ?? join(process.env.TMPDIR ?? tmpdir(), `tickprog-${process.env.LAB_BLOCK ?? 'tickmanip'}`);
const STATS = join(LOG, 'tab', 'stats.log');
const load = () => +loadavg()[0]!.toFixed(2);

/** One client's view: its publication clock, chat lines, rolls and op rejections. */
class Watch {
    readonly clock: Array<{ wall: number; tick: number }> = [];
    readonly rolls: Array<{ tick: number; ok: boolean }> = [];
    readonly stuns: number[] = [];
    readonly lines: Array<{ tick: number; text: string }> = [];
    private readonly chat = new ChatHistory();
    private lastTick = -1;
    rejected = 0;
    constructor(readonly sdk: Session['sdk'], private readonly onTick?: (s: BotWorldState) => void) {
        sdk.onStateUpdate(s => this.update(s));
    }
    private update(s: BotWorldState) {
        if (!s.inGame) return;
        for (const m of this.chat.record(s.gameMessages ?? [])) this.message(m, s.tick);
        this.rejected = s.opFeedback?.opRejectedCount ?? this.rejected;
        if (s.tick === this.lastTick) return;
        this.lastTick = s.tick;
        this.clock.push({ wall: performance.now(), tick: s.tick });
        this.onTick?.(s);
    }
    private message(m: GameMessage, tick: number) {
        if (m.type !== 0) return;
        this.lines.push({ tick, text: m.text });
        if (/^You pick the/i.test(m.text)) this.rolls.push({ tick, ok: true });
        else if (/You fail to pick/i.test(m.text)) this.rolls.push({ tick, ok: false });
        else if (/You've been stunned/i.test(m.text)) this.stuns.push(tick);
    }
}

/** A crowd bot: once `knight` is set it clicks Pickpocket on it every tick it sees it. */
class CrowdBot {
    knight: number | null = null;
    clicks = 0;
    unseen = 0;
    readonly watch: Watch;
    constructor(readonly session: Session) {
        this.watch = new Watch(session.sdk, s => this.tick(s));
    }
    private tick(s: BotWorldState) {
        if (this.knight === null) return;
        const k = s.nearbyNpcs.find(n => n.index === this.knight);
        const op = k?.optionsWithIndex.find(o => /^pickpocket$/i.test(o.text));
        if (!k || !op) {
            this.unseen++;
            return;
        }
        this.clicks++;
        void this.session.sdk.sendInteractNpc(k.index, op.opIndex).catch(() => {});
    }
}

function median(xs: number[]): number {
    const a = [...xs].sort((p, q) => p - q);
    return a.length ? a[Math.floor(a.length / 2)]! : 0;
}

/** The offset that moves `w`'s ticks onto `ref`'s: the median, over w's publications, of ref's tick nearest in wall time minus w's. */
function clockOffset(ref: Watch, w: Watch): { offset: number; spread: number; n: number } {
    const r = ref.clock;
    const diffs: number[] = [];
    let j = 0;
    for (const c of w.clock) {
        while (j + 1 < r.length && Math.abs(r[j + 1]!.wall - c.wall) <= Math.abs(r[j]!.wall - c.wall)) j++;
        if (r.length && Math.abs(r[j]!.wall - c.wall) < 150) diffs.push(r[j]!.tick - c.tick);
    }
    const off = median(diffs);
    return { offset: off, spread: diffs.filter(d => d !== off).length, n: diffs.length };
}

function hist(xs: number[]): Record<number, number> {
    const h: Record<number, number> = {};
    for (const x of xs) h[x] = (h[x] ?? 0) + 1;
    return h;
}

/** The tab's once-a-second render samples (tickprog-tab.ts) appended since line `from`. */
function statsLines(): string[] {
    return existsSync(STATS) ? readFileSync(STATS, 'utf8').split('\n').filter(l => l.includes('loops/s=')) : [];
}
function statsSummary(lines: string[]) {
    const field = (k: string) => lines.map(l => Number(l.match(new RegExp(`${k.replace('/', '\\/')}=(\\d+)`))?.[1])).filter(n => Number.isFinite(n));
    const sum = (k: string) => {
        const v = field(k);
        if (!v.length) return null;
        const s = [...v].sort((a, b) => a - b);
        return { n: v.length, mean: +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1), min: s[0], p10: s[Math.floor(s.length * 0.1)], max: s[s.length - 1] };
    };
    return { loops: sum('loops/s'), draws: sum('draws/s'), raf: sum('raf/s'), lagmax: sum('lagmax'), over50: field('>50').reduce((a, b) => a + b, 0), over100: field('>100').reduce((a, b) => a + b, 0) };
}

/** Count chat lines by text with the numbers blanked, so 'busy' or a refusal shows up however worded. */
function tally(lines: Array<{ text: string }>): Record<string, number> {
    const t: Record<string, number> = {};
    for (const l of lines) {
        const k = l.text.replace(/\d+/g, '#');
        t[k] = (t[k] ?? 0) + 1;
    }
    return Object.fromEntries(Object.entries(t).sort((a, b) => b[1] - a[1]));
}

function ensureBotEnv(name: string): void {
    const env = join(ROOT, 'bots', name, 'bot.env');
    if (!existsSync(env)) {
        const r = Bun.spawnSync(['bun', 'bots/create-bot.ts', name, '--local', '--no-chat'], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' });
        if (!existsSync(env)) throw new Error(`create-bot ${name} left no bot.env: ${r.stdout.toString()}${r.stderr.toString()}`);
    }
    const web = process.env.WEB_PORT;
    const agent = process.env.AGENT_PORT;
    if (!web || !agent) throw new Error('WEB_PORT and AGENT_PORT unset: run this through tickprog-lab.sh');
    const text = readFileSync(env, 'utf8')
        .replace(/^SERVER=.*$/m, `SERVER=localhost:${web}`)
        .replace(/^GATEWAY_URL=.*$/m, `GATEWAY_URL=ws://localhost:${agent}`)
        .replace(/^TELEMETRY=.*$/m, 'TELEMETRY=false');
    writeFileSync(env, text, { mode: 0o600 });
}

const session = await openSession(standInName, { client: 'browser', insecureQueryLogin: true });
const { sdk } = session;
const state = () => sdk.getState()!;
const say = async (cmd: string) => {
    await cheat(sdk, cmd);
    await waitTicks(sdk, 1);
};

// per-tick samples on the stand-in: players in view, every knight in sight [index, x, z] and the stand-in's tile
const samples: Array<{ tick: number; players: number; knights: Array<[number, number, number]>; at: { x: number; z: number } }> = [];
let knightIndex: number | null = null;
const me = new Watch(sdk, s => {
    const knights = s.nearbyNpcs.filter(n => KNIGHT.test(n.name)).map(n => [n.index, n.tileX ?? n.x, n.tileZ ?? n.z] as [number, number, number]);
    samples.push({ tick: s.tick, players: s.nearbyPlayers.length, knights, at: { x: s.player!.worldX, z: s.player!.worldZ } });
});

/** A knight's track over a window: tiles moved, ticks seen, the stand-in's mean Chebyshev distance to it. */
function knightTrack(index: number | null, inWin: (t: number) => boolean) {
    if (index === null) return null;
    const seen = samples.filter(x => inWin(x.tick)).map(x => ({ at: x.at, k: x.knights.find(k => k[0] === index) })).filter(x => x.k);
    const moves = seen.slice(1).filter((x, i) => x.k![1] !== seen[i]!.k![1] || x.k![2] !== seen[i]!.k![2]).length;
    const dist = seen.length ? +(seen.reduce((a, x) => a + Math.max(Math.abs(x.at.x - x.k![1]), Math.abs(x.at.z - x.k![2])), 0) / seen.length).toFixed(2) : null;
    return { index, seenTicks: seen.length, moves, standInMeanDist: dist };
}

await leaveTutorial(session);
await say('~clearinv inv');
await waitUntil(sdk, s => s.inventory.length === 0, { maxTicks: 5 });
await say('give shark 20');
await waitUntil(sdk, s => s.inventory.filter(i => /^shark$/i.test(i.name)).length >= 20, { maxTicks: 10 });
for (const [k, v] of [['defence', 89], ['hitpoints', HP], ['thieving', THIEVING]] as const) await say(`setstat ${k} ${v}`);
if (!(await tele(sdk, ANCHOR.x, ANCHOR.z))) throw new Error('tele to the knights failed');

const bots: CrowdBot[] = [];
const botNames = Array.from({ length: CROWD }, (_, i) => `${PREFIX}b${String(i + 1).padStart(2, '0')}`);
let botsIn = false;

async function loginBots(): Promise<void> {
    for (const n of botNames) ensureBotEnv(n);
    for (let i = 0; i < botNames.length; i += LOGIN_BATCH) {
        const batch = await Promise.all(botNames.slice(i, i + LOGIN_BATCH).map(async n => {
            const s = await openSession(n, { launch: true, pathfinding: false });
            await leaveTutorial(s);
            for (const [k, v] of [['thieving', 99], ['hitpoints', 99], ['defence', 99]] as const) await cheat(s.sdk, `setstat ${k} ${v}`, 1);
            return new CrowdBot(s);
        }));
        bots.push(...batch);
    }
    botsIn = true;
}

async function logoutBots(): Promise<Array<{ bot: string; ok: boolean; reason?: string }>> {
    const out = await Promise.all(bots.map(async b => {
        b.knight = null;
        const r = await logoutClean(b.session).catch(e => ({ ok: false, reason: String(e) }));
        await closeSession(b.session);
        return { bot: b.session.name, ok: r.ok, ...('reason' in r && r.reason ? { reason: r.reason } : {}) };
    }));
    botsIn = false;
    return out;
}

async function teleBots(x: number, z: number, spread: boolean): Promise<number> {
    const ring = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const;
    const ok = await Promise.all(bots.map((b, i) => {
        const [dx, dz] = spread ? ring[i % ring.length]! : [0, 0];
        return tele(b.session.sdk, x + dx, z + dz).catch(() => false);
    }));
    return ok.filter(Boolean).length;
}

const rss = (): number | null => {
    const pids = bots.map(b => b.session.child?.pid).filter((p): p is number => !!p);
    if (!pids.length) return null;
    const r = Bun.spawnSync(['ps', '-o', 'rss=', '-p', pids.join(',')]);
    return Math.round(r.stdout.toString().split('\n').map(Number).filter(Number.isFinite).reduce((a, b) => a + b, 0) / 1024);
};

function knightNear(s: BotWorldState): NearbyNpc | undefined {
    return s.nearbyNpcs.filter(n => KNIGHT.test(n.name)).sort((a, b) => a.distance - b.distance)[0];
}

const phases: Record<string, unknown>[] = [];

async function phase(name: string): Promise<void> {
    const kind = name.replace(/\d+$/, '');
    const prep: Record<string, unknown> = {};
    if (kind === 'base' && botsIn) prep.logout = await logoutBots();
    if (kind === 'prefer' && !chooseKnight) throw new Error("prefer: this tree's thieving.ts has no chooseKnight (rs/480); overlay rs/480's thieving.ts and pickpocket.ts for the lab");
    if ((kind === 'crowd' || kind === 'away' || kind === 'prefer') && !botsIn) {
        const t0 = Date.now();
        await loginBots();
        prep.loginWallMs = Date.now() - t0;
    }
    // a level-up page left open by the last program swallows the ::tele typed into chat
    for (let i = 0; i < 10 && state().dialog?.isOpen; i++) {
        await sdk.sendClickDialog(0);
        await waitTicks(sdk, 1);
    }
    let landed = false;
    for (let i = 0; i < 3 && !landed; i++) landed = await tele(sdk, ANCHOR.x, ANCHOR.z);
    if (!landed) throw new Error(`${name}: tele to the anchor failed (dialog open: ${!!state().dialog?.isOpen})`);
    for (const [k, v] of [['hitpoints', HP], ['thieving', THIEVING]] as const) await say(`setstat ${k} ${v}`);
    if (kind === 'crowd' || kind === 'prefer') {
        const k = knightNear(state());
        if (!k) throw new Error(`${name}: no knight in view of the anchor`);
        knightIndex = k.index;
        for (const b of bots) {
            b.knight = null;
            await cheat(b.session.sdk, 'setstat hitpoints 99');
        }
        prep.knight = { index: k.index, x: k.tileX ?? k.x, z: k.tileZ ?? k.z };
        prep.teleported = await teleBots(k.tileX ?? k.x, k.tileZ ?? k.z, true);
        for (const b of bots) b.knight = k.index;
        // the crowd is on the knight once most bots stand within a tile of it
        const placed = await waitUntil(sdk, s => {
            const kn = s.nearbyNpcs.find(n => n.index === k.index);
            if (!kn) return false;
            const kx = kn.tileX ?? kn.x;
            const kz = kn.tileZ ?? kn.z;
            return s.nearbyPlayers.filter(p => Math.max(Math.abs(p.x - kx), Math.abs(p.z - kz)) <= 1).length >= Math.ceil(bots.length * 0.8);
        }, { maxTicks: 40 });
        prep.crowdPlacedTicks = placed.ok ? 'ok' : 'timeout';
    }
    let prefer: number[] | undefined;
    if (kind === 'prefer') {
        const c = chooseKnight!(state(), KNIGHT, []);
        prefer = [c.chosen, c.retarget].filter((i): i is number => i !== null);
        prep.choice = { ...c, crowdedKnight: knightIndex };
    }
    if (kind === 'away') {
        for (const b of bots) b.knight = null;
        knightIndex = null;
        prep.teleported = await teleBots(AWAY_X, AWAY_Z, false);
        await waitTicks(sdk, 3);
    }
    if (kind === 'base') knightIndex = null;
    prep.botRssMb = rss();

    const segment = async <T>(label: string, fn: () => Promise<T>) => {
        const l0 = statsLines().length;
        const load0 = load();
        const t0 = state().tick;
        const players: number[] = [];
        const unsub = sdk.onStateUpdate(s => players.push(s.nearbyPlayers.length));
        try {
            const out = await fn();
            return { out, t0, t1: state().tick, render: statsSummary(statsLines().slice(l0)), load: [load0, load()], playersInView: players.length ? +(players.reduce((a, b) => a + b, 0) / players.length).toFixed(1) : null, label };
        } finally {
            unsub();
        }
    };

    // The probe runs from the anchor in every phase, the crowd in view a few tiles off. Beside the
    // knight it measures the knight instead: once its trial direction is proven, a pinned knight
    // standing on the probe's home tile turns every later trial into a lost one.
    let probeRow: Record<string, unknown>;
    try {
        const probe = await segment('probe', () => probeInPage(sdk, { trials: TRIALS }));
        const lat = probe.out.latencies;
        probeRow = {
            trials: lat.length, at1: lat.filter(l => l === 1).length, hist: hist(lat), lost: probe.out.lost, ticks: probe.out.ticks,
            steadiness: probe.out.steadiness, render: probe.render, load: probe.load, playersInView: probe.playersInView, ...(probe.out.reason ? { reason: probe.out.reason } : {})
        };
    } catch (e) {
        await stopProgram(sdk).catch(() => {});
        probeRow = { error: String(e).slice(0, 300) };
    }
    result(`${name} probe`, probeRow);
    // crowd: the stand-in pickpockets beside the pinned knight; prefer: it stays on the anchor and chooses
    if (kind === 'crowd' && knightIndex !== null) {
        const kn = state().nearbyNpcs.find(n => n.index === knightIndex);
        if (kn) await tele(sdk, (kn.tileX ?? kn.x) - 1, kn.tileZ ?? kn.z);
    }

    const food = FOODS.shark;
    const band = BANDS.find(b => b.name === 'thieving:knights')!;
    const params = {
        npc: band.npc, food: foodPattern(food), heal: food.heal, eat: 'window', ...eatPolicy(state().player!.maxHp, food.heal, band.stunDamage),
        stopWhenFoodBelow: 1, retargetTicks: 12, maxTicks: TICKS, ...(prefer ? { prefer } : {})
    };
    const rej0 = me.rejected;
    const botRej0 = bots.map(b => b.watch.rejected);
    // the program's `target` gauge (published with a prefer list): every change, on the stand-in's ticks
    const targets: Array<{ tick: number; target: number }> = [];
    const onProgress = (p: ProgramStatus) => {
        const g = p.gauges?.target;
        if (g !== undefined && targets[targets.length - 1]?.target !== g) targets.push({ tick: p.tick, target: g });
    };
    const prog = await segment('pickpocket', () => runProgram(sdk, 'pickpocket', params, { maxTicks: TICKS + 80, onProgress }));
    const st = prog.out as ProgramStatus;
    const t0 = st.startedTick;
    const t1 = st.endedTick ?? prog.t1;
    const inWin = (t: number) => t >= t0 && t <= t1;
    const r = (st.result ?? {}) as Record<string, unknown>;
    const myRolls = me.rolls.filter(x => inWin(x.tick));
    const myLines = me.lines.filter(x => inWin(x.tick));

    // the crowd's rolls on the stand-in's clock, and how many players rolled on each tick
    const crowd = bots.length && (kind === 'crowd' || kind === 'prefer')
        ? bots.map(b => {
            const off = clockOffset(me, b.watch);
            const rolls = b.watch.rolls.map(x => ({ tick: x.tick + off.offset, ok: x.ok })).filter(x => inWin(x.tick));
            const lines = b.watch.lines.map(x => ({ tick: x.tick + off.offset, text: x.text })).filter(x => inWin(x.tick));
            return { bot: b.session.name, off, rolls, lines, stuns: b.watch.stuns.map(t => t + off.offset).filter(inWin).length, clicks: b.clicks, unseen: b.unseen };
        })
        : [];
    const perTick = new Map<number, { me?: boolean; bots: number; botOk: number }>();
    for (const c of crowd) for (const x of c.rolls) {
        const e = perTick.get(x.tick) ?? { bots: 0, botOk: 0 };
        e.bots++;
        if (x.ok) e.botOk++;
        perTick.set(x.tick, e);
    }
    for (const x of myRolls) {
        const e = perTick.get(x.tick) ?? { bots: 0, botOk: 0 };
        e.me = x.ok;
        perTick.set(x.tick, e);
    }
    const shared = myRolls.filter(x => (perTick.get(x.tick)?.bots ?? 0) > 0);
    const alone = myRolls.filter(x => (perTick.get(x.tick)?.bots ?? 0) === 0);
    const botRolls = crowd.flatMap(c => c.rolls);
    const finalTarget = st.gauges?.target ?? null;
    const row = {
        phase: name, host: hostname(), tickrate: process.env.NODE_TICKRATE ?? '', ticks: t1 - t0, startedTick: t0, endedTick: t1, phaseOk: st.phase,
        thieving: THIEVING, rolls: r.rolls, successes: r.successes, fails: r.fails, successRate: r.successRate,
        ticksPerSuccess: typeof r.successes === 'number' && r.successes ? +((t1 - t0) / r.successes).toFixed(3) : null,
        stuns: me.stuns.filter(inWin).length, gapAfterSuccess: r.gapAfterSuccess, stunToNext: r.gapAfterFail,
        eats: r.eats, hpLost: r.hpLost, retargets: st.counters.retargets ?? 0, noTarget: st.counters.noTarget ?? 0, combatBlocks: st.counters.combatBlocks ?? 0,
        opRejected: me.rejected - rej0, lines: tally(myLines),
        packets: st.packets, packetsPerTick: +(st.packets / Math.max(1, t1 - t0)).toFixed(3), deferred: st.deferred, skippedTicks: st.skippedTicks, maxTickMs: st.maxTickMs,
        frames: st.frames, publish: st.publish, react: st.react, loops: st.loops, render: prog.render, load: prog.load, playersInView: prog.playersInView,
        crowdedKnight: knightTrack(knightIndex, inWin), ...(prefer ? { prefer, targets, targetKnight: knightTrack(finalTarget, inWin) } : {}),
        knightsInSight: samples.filter(x => inWin(x.tick)).length ? +(samples.filter(x => inWin(x.tick)).reduce((a, x) => a + x.knights.length, 0) / samples.filter(x => inWin(x.tick)).length).toFixed(1) : null,
        ...(crowd.length ? {
            crowd: {
                bots: crowd.length, rolls: botRolls.length, successes: botRolls.filter(x => x.ok).length, stuns: crowd.reduce((a, c) => a + c.stuns, 0),
                successRate: botRolls.length ? +(botRolls.filter(x => x.ok).length / botRolls.length).toFixed(4) : null,
                rollsPerTick: +(botRolls.length / Math.max(1, t1 - t0)).toFixed(3),
                rollersPerTick: hist([...perTick.values()].map(e => e.bots + (e.me === undefined ? 0 : 1))),
                maxRollersOneTick: Math.max(0, ...[...perTick.values()].map(e => e.bots + (e.me === undefined ? 0 : 1))),
                standInShared: { rolls: shared.length, ok: shared.filter(x => x.ok).length },
                standInAlone: { rolls: alone.length, ok: alone.filter(x => x.ok).length },
                clockSpread: crowd.map(c => `${c.bot}:${c.off.offset}/${c.off.spread}of${c.off.n}`),
                opRejected: bots.reduce((a, b, i) => a + b.watch.rejected - botRej0[i]!, 0),
                clicks: crowd.reduce((a, c) => a + c.clicks, 0), unseen: crowd.reduce((a, c) => a + c.unseen, 0),
                lines: tally(crowd.flatMap(c => c.lines))
            }
        } : {}),
        prep
    };
    result(`${name} pickpocket`, row);
    phases.push({ name, probe: probeRow, pickpocket: row, standInRolls: myRolls, crowdRolls: crowd.map(c => ({ bot: c.bot, rolls: c.rolls })) });
}

try {
    result('crowded-knight', { host: hostname(), load: load(), tickrate: process.env.NODE_TICKRATE ?? '', standIn: standInName, crowd: CROWD, ticks: TICKS, trials: TRIALS, thieving: THIEVING, phases: PHASES, at: new Date().toISOString() });
    for (const p of PHASES) await phase(p);
} finally {
    const out = join(LOG, `crowded-knight-${new Date().toISOString().replace(/[:.]/g, '')}.json`);
    writeFileSync(out, JSON.stringify({ phases, samples }, null, 1));
    result('crowded-knight files', { json: out });
    if (botsIn) await logoutBots().catch(() => {});
    await closeSession(session);
}
process.exit(0);
