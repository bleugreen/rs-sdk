// Run day on the two Ashburn machines: bring up the tab stack, gate both machines in the same
// minute, choose one, and hand the recorded display over from the gate's probe tab to SCORED's
// tab. It replaces docs/speedrun/RUN-HOST.md steps 3, 5, 5a, 6 and 7's hand-run commands; the
// rest of the runbook (step 0's run commit, step 4's helpers, steps 8-9) stays as it is.
//
// On the Mac (or any executor holding the fleet keys), with RS_RUN_HOST, RS_TWIN_HOST and
// RS_RUN_TAILNET set locally from cairn://p/rs/host (never committed, tenet 20):
//
//   bun speedrun/tools/run-gate.ts up      [--machines=run,twin] [--rehearsal] [--claim=OWNER]
//   bun speedrun/tools/run-gate.ts gate    --gate-run=ACCOUNT --gate-twin=ACCOUNT [--machines=run,twin]
//                                          [--prefer=run|twin] [--minutes=5] [--rehearsal] [--claim=OWNER]
//                                          [--rehearse=CASE]
//   bun speedrun/tools/run-gate.ts handoff --machine=run|twin --scored-env=PATH [--max-gate-age=20]
//                                          [--cap=80] [--no-login] [--rehearsal] [--claim=OWNER]
//
//   common: [--remote-checkout=rs-sdk] (relative to the machine's $HOME) [--log-dir=DIR] [--display=:10]
//
// Each command runs `on-machine <command>` on the machines over ssh (the exact ssh options of
// RUN-HOST.md "Reaching them"), detached under its own `timeout`, so a dropped ssh line never
// stops a step halfway: the on-machine run finishes into ~/rs-run/gate-<UTC>/steps.log on the
// machine, and the Mac prints the same lines prefixed [run] or [twin] and keeps a copy in
// --log-dir (default ~/rs-run-gate). `gate` runs both machines in parallel, prints (a)-(d) per
// machine, chooses (RUN-HOST.md step 5a.2: the preferred machine when both pass, DEFAULT_PREFER
// unless --prefer says otherwise, and the other only on the tiebreak) and writes choice.json;
// `handoff` refuses a machine the latest choice did not name, or a choice older than
// --max-gate-age minutes. Between the two, step 5a.4-5a.5's roster moves and step 7's login count
// happen through rs/117's launcher, as before.
//
// Beside (a)-(d), `gate` prints three report-only lines from the gate tab, never pass or fail:
// `scene`, the page ticks from the gate tab's login to the client's sceneState 2 (the gate tab and
// SCORED's share the run profile and its origin, so this reads how warm the profile is); `locs`, the
// SDK's nearby locs once the scene is built; and `tile`, where the gate account stands against
// Lumbridge spawn, where it is parked as the profile's warm-up probe.
//
// Main's recording rulings (cairn://p/rs/main/messages, 18:16 and 19:08 PDT 2026-10-21) are hard
// checks here:
// 1. `gate` logs the probe tab out and then kills the gate Chrome UNCONDITIONALLY, whether or not
//    the logout was confirmed: one Chrome per profile, so a gate Chrome left up would own SCORED's
//    window and kill it at the gate tab's 15-minute bound.
// 2. after the kill, and again at the start of `handoff`: no `tmux -L run` session `chrome`, no
//    process on rs-run/chrome-profile, no Bot Client window on the display.
// 3. before SCORED's login: exactly one Bot Client window, 1920 wide (step 3's xwininfo check).
// 4. the recording runs before SCORED's login, and a live frame (an x11grab of the display, as the
//    recording grabs it) matches the page's own screenshot (speedrun/lib/display.ts frameShows,
//    mean gray difference at most 12/255) with the run tab the window in front. It is a pass line
//    beside (a)-(d), checked before the login and again once SCORED is in game.
// 5. nothing in this tool raises a window on a display that has a run tab: `gate` and `handoff`
//    refuse to start while any Bot Client window or run-profile Chrome exists, so a mid-run or
//    after-run probe that needs a tab can only run on the machine not chosen.
// Any failed precondition or pass line stops with a non-zero exit and one `STOP:` line. Nothing
// here repairs the recorded display: no window is raised, closed or retried by this tool except
// the gate Chrome's unconditional kill, which is the rule itself.
//
// Exit codes: 0 pass, 1 a pass line failed (or no machine passes), 2 a precondition or a tool
// failed (STOP), 3 re-measure ((c) failed, or (d) marginal).
//
// No account's name is printed: `handoff` reads SCORED's from --scored-env and relabels every line
// it prints, its frames and its logs as SCORED; `gate` relabels each gate account as GATE-run or
// GATE-twin in its lines, its STOP lines, its JSON and the files it leaves in ~/rs-run/gate-*, and
// the Mac relabels both again in what it prints, its log and choice.json.
//
// `handoff --no-login` (run day, main 12:05Z 2026-10-23: SCORED is logged in exactly once, by
// run.ts): every step before the login runs as without it, then the served bundle is checked against
// this checkout's build, and the hand-off passes with SCORED's tab up on the bare client page, not
// logged in. No tab-login, no secrets check, no after-login window check or in-game frame; run.ts
// logs SCORED in. handoff.json's `loggedIn` is false; without the flag it is true once the login
// was started.
//
// --rehearsal: 30-minute bounds instead of the run's 9 h, `rehearsal-` recordings, and it requires
// --claim with an owner other than host or run. --rehearse=unconfirmed-logout skips the gate tab's
// logoutClean and treats the logout as unconfirmed, to show the unconditional kill;
// --rehearse=kept-chrome also skips the kill (the old `logout && kill` behaviour on an unconfirmed
// logout), to show the closed-window checks stop the gate. Both only with --rehearsal.

import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';
import { catchUpText, DIRECT_RULE, directDecision, type DirectVerdict, tickP90Text, type TickSource, verdictText } from '../lib/hostgate-verdict';

// ------------------------------------------------------------------ fixed names (RUN-HOST.md "Names and ports")

const HOME = homedir();
const ROOT = resolve(import.meta.dir, '../..');
const PROFILE = join(HOME, 'rs-run/chrome-profile');
const CDP = 'http://127.0.0.1:9222';
const PAGE = 'http://127.0.0.1:8899';
const DEMO = 'rs-sdk-demo.fly.dev';
const RECORD_WIDTH = 1920;
const GATE_TAB_BOUND = '15m';
const RUN_BOUND = '9h';
const REHEARSAL_BOUND = '30m';
/** The six Chrome flags step 3 checks on the browser process. */
export const CHROME_FLAGS = [
    'disable-background-timer-throttling',
    'disable-renderer-backgrounding',
    'disable-backgrounding-occluded-windows',
    'start-maximized',
    'remote-debugging-port=9222',
    `user-data-dir=${PROFILE}`,
] as const;

// ------------------------------------------------------------------ pure parts (run-gate.test.ts)

export type Machine = 'run' | 'twin';
export const MACHINES: readonly Machine[] = ['run', 'twin'];
export const otherMachine = (m: Machine): Machine => (m === 'run' ? 'twin' : 'run');
const machineName = (m: Machine) => (m === 'run' ? 'the run host' : 'the twin');

/**
 * Where the run starts when both machines pass: the twin is the expected start machine and the
 * run host the fallback (main, 10:4x PDT 2026-10-22, from rs/83's same-minute pair series: the twin
 * passed 17 of 17, the run host 4 of 17; tenet 17). `gate --prefer=run|twin` overrides it.
 */
export const DEFAULT_PREFER: Machine = 'twin';

export class Stop extends Error {
    constructor(
        message: string,
        readonly code = 2
    ) {
        super(message);
    }
}

export interface XwinWindow {
    id: string;
    name: string;
    width: number;
    height: number;
}

/** The Bot Client windows in `xwininfo -root -tree` output (step 3's check reads the same lines). */
export function botClientWindows(tree: string): XwinWindow[] {
    const out: XwinWindow[] = [];
    for (const line of tree.split('\n')) {
        const m = line.match(/^\s*(0x[0-9a-f]+) "((?:[^"\\]|\\.)*)":.*?\s(\d+)x(\d+)[+-]\d+[+-]\d+/i);
        if (!m || !/Bot Client/.test(m[2]!)) continue;
        out.push({ id: m[1]!, name: m[2]!, width: Number(m[3]), height: Number(m[4]) });
    }
    return out;
}

/** Ruling 3: exactly one Bot Client window on the display, `width` wide. Null when it holds. */
export function oneWindowProblem(ws: readonly XwinWindow[], width = RECORD_WIDTH): string | null {
    if (ws.length !== 1) return `${ws.length} Bot Client windows on the display, not exactly one${ws.length ? ` (${ws.map(w => `${w.width}x${w.height}`).join(', ')})` : ''}`;
    if (ws[0]!.width !== width) return `the Bot Client window is ${ws[0]!.width}x${ws[0]!.height}, not ${width} wide (not maximised)`;
    return null;
}

export interface LoopsSummary {
    lowest: number;
    median: number;
    highest: number;
    samples: number;
}

/** (d) from runhost-loops.ts's samples: lowest / median / highest 10-second p10, as its summary line. */
export function loopsSummary(samples: ReadonlyArray<{ loopsP10?: unknown }>): LoopsSummary | null {
    const v = samples.map(s => s.loopsP10).filter((x): x is number => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
    if (!v.length) return null;
    return { lowest: v[0]!, median: v[Math.floor((v.length - 1) / 2)]!, highest: v[v.length - 1]!, samples: v.length };
}

/** What the direct CLI's --json file gives the gate: (a), (b), (c) and the players online. */
export interface DirectRead {
    onTime: number;
    trials: number;
    /** `T`: the tick length (b) and (c) were read at, with its source; null in a file without one. */
    steadiness: { p90: number; catchUpsPerMinute: number; T: number | null; TSource: TickSource | null } | null;
    players: number | null;
    logoutOk: boolean | null;
}

export function parseDirectJson(text: string): DirectRead {
    const j = JSON.parse(text) as {
        result?: { onTime?: number; trials?: number; steadiness?: { p90?: number; catchUpsPerMinute?: number; T?: unknown; TSource?: unknown } };
        vantage?: { players?: number };
        logout?: { ok?: boolean };
    };
    const r = j.result;
    if (!r || typeof r.onTime !== 'number' || typeof r.trials !== 'number') throw new Error('the direct gate wrote no probe result');
    const s = r.steadiness;
    const T = typeof s?.T === 'number' && s.T > 0 ? s.T : null;
    const TSource = T !== null && typeof s?.TSource === 'string' ? (s.TSource as TickSource) : null;
    return {
        onTime: r.onTime,
        trials: r.trials,
        steadiness: s && typeof s.p90 === 'number' && typeof s.catchUpsPerMinute === 'number' ? { p90: s.p90, catchUpsPerMinute: s.catchUpsPerMinute, T, TSource } : null,
        players: j.vantage?.players ?? null,
        logoutOk: typeof j.logout?.ok === 'boolean' ? j.logout.ok : null,
    };
}

/** pass and marginal may start; re-measure and fail may not; not-probed: a precondition stopped it. */
export type GateStatus = 'pass' | 'marginal' | 're-measure' | 'fail' | 'not-probed';

export interface MachineGate {
    machine: string;
    startedUtc: string;
    endUtc: string;
    status: GateStatus;
    a: { onTime: number; trials: number; passAt: number; floorAt: number } | null;
    /** (b) with the T it was read at and its report line, 4/3 T (null with no T). */
    b: { p90: number; T: number | null; limit: number | null } | null;
    /** (c), with the T its catch-ups were counted at. */
    c: { perMinute: number; T: number | null } | null;
    d: LoopsSummary | null;
    players: number | null;
    /** confirmed: logoutClean saw the page out of game. The window is killed either way. */
    gateLogout: 'confirmed' | 'unconfirmed' | 'not-run';
    failures: string[];
    /** Report only, never part of the status: the gate tab's scene, locs and tile. Null when not read. */
    scene: SceneRead | null;
    locs: LocsRead | null;
    tile: TileRead | null;
}

export const startable = (s: GateStatus | undefined) => s === 'pass' || s === 'marginal';

/** `handoff`'s steps on the machine, in order, after SCORED's env file is read. */
export type HandoffStep =
    | 'claim'
    | 'preconditions'
    | 'display'
    | 'recording'
    | 'login count'
    | 'tab'
    | 'chrome flags'
    | 'one window'
    | 'title frame'
    | 'served bundle'
    | 'login'
    | 'secrets'
    | 'one window after login'
    | 'in-game frame';

const BEFORE_LOGIN: readonly HandoffStep[] = ['claim', 'preconditions', 'display', 'recording', 'login count', 'tab', 'chrome flags', 'one window', 'title frame'];

/** With `noLogin` the hand-off stops at SCORED's bare page, checked against the built bundle; run.ts logs SCORED in. */
export function handoffSteps(opts: { noLogin: boolean }): HandoffStep[] {
    return opts.noLogin ? [...BEFORE_LOGIN, 'served bundle'] : [...BEFORE_LOGIN, 'login', 'secrets', 'one window after login', 'in-game frame'];
}

/**
 * The machine's verdict on tenet 12's rule, through hostgate-verdict's directDecision with (d) as
 * the lowest 10-second sample. RUN-HOST.md step 6 reads a (d) whose lowest sample is under 50
 * but whose median is not as marginal, to re-measure; a median under 50 fails. (d) not measured
 * is never a pass.
 */
export function machineVerdict(direct: DirectRead, loops: LoopsSummary | null, opts: { requireLoops?: boolean } = {}): { status: GateStatus; verdict: DirectVerdict; failures: string[] } {
    const verdict = directDecision({ onTime: direct.onTime, trials: direct.trials, steadiness: direct.steadiness, loopRateP10: loops?.lowest ?? null });
    let failures = [...verdict.failures];
    let status: GateStatus;
    if (verdict.status === 're-measure') status = 're-measure';
    else if (verdict.status === 'throttled' && loops && loops.median >= DIRECT_RULE.minLoopRateP10) {
        status = 're-measure';
        failures = [`(d) marginal: lowest sample ${loops.lowest}/s under ${DIRECT_RULE.minLoopRateP10}, median ${loops.median}/s, re-measure`, ...failures.filter(f => !f.startsWith('tab throttled'))];
    } else if (verdict.status === 'throttled' || verdict.status === 'investigate') status = 'fail';
    else status = verdict.status;
    if (!loops && (opts.requireLoops ?? true) && startable(status)) {
        status = 'fail';
        failures.push('(d) not measured');
    }
    return { status, verdict, failures };
}

/** Where a passing gate sits at the margin: (a) under 60 of 60, (c) above 1 a minute (the line is 2), a (d) sample under 60. */
export function marginOf(g: MachineGate): string[] {
    return [
        g.a && g.a.onTime < g.a.passAt ? `(a) ${g.a.onTime}/${g.a.trials}` : '',
        g.c && g.c.perMinute > 1 ? `(c) ${g.c.perMinute}/min` : '',
        g.d && g.d.lowest < 60 ? `(d) lowest ${g.d.lowest}/s` : '',
    ].filter(Boolean);
}

/** A read clearly better than a marginal one: (a) 60 of 60 and (c) at most 1 a minute. */
const cleanRead = (g: MachineGate) => !!g.a && g.a.onTime >= g.a.passAt && !!g.c && g.c.perMinute <= 1;

export interface Choice {
    machine: Machine | null;
    /** The preference in force (DEFAULT_PREFER or --prefer). */
    prefer: Machine;
    /** True when the tiebreak moved the start off the preferred machine. */
    tiebreak: boolean;
    reason: string;
}

/**
 * RUN-HOST.md step 5a.2. One passes: start on it. Both pass: the preferred machine, unless it
 * passed only at the margin (marginOf) while the other read clean ((a) 60 of 60, (c) at most 1):
 * then the other, by the tiebreak. Neither: no start.
 */
export function choose(gates: Partial<Record<Machine, MachineGate | null>>, prefer: Machine = DEFAULT_PREFER): Choice {
    const other = otherMachine(prefer);
    const pg = gates[prefer] ?? null;
    const og = gates[other] ?? null;
    const ok = (g: MachineGate | null): g is MachineGate => !!g && startable(g.status);
    const why = (m: Machine, g: MachineGate | null) => `${m} ${g ? `${g.status}${g.failures.length ? ` (${g.failures.join('; ')})` : ''}` : 'not gated'}`;
    const pick = (machine: Machine | null, reason: string, tiebreak = false): Choice => ({ machine, prefer, tiebreak, reason });
    if (ok(pg) && ok(og)) {
        const margin = marginOf(pg);
        if (margin.length && cleanRead(og)) return pick(other, `tiebreak: preferred ${prefer} passed only at the margin: ${margin.join(', ')}; ${other} read clean`, true);
        return pick(prefer, margin.length ? `both pass; preferred ${prefer} at the margin (${margin.join(', ')}) but ${other} not clearly better: the preferred machine` : `both pass: the preferred machine, ${prefer}`);
    }
    if (ok(pg)) return pick(prefer, `only ${machineName(prefer)} passes; ${why(other, og)}`);
    if (ok(og)) return pick(other, `only ${machineName(other)} passes; ${why(prefer, pg)}`);
    return pick(null, `no machine passes: ${why('run', gates.run ?? null)}; ${why('twin', gates.twin ?? null)}`);
}

/** The step log's choice line; a tiebreak reads `chosen: run (tiebreak: preferred twin ...)`. */
export const choiceLine = (c: Choice) => `chosen: ${c.machine ?? 'NONE'} (${c.reason})`;

export function parsePrefer(v: string | undefined): Machine {
    if (v === undefined) return DEFAULT_PREFER;
    if (v === 'run' || v === 'twin') return v;
    throw new Stop(`--prefer takes run or twin, not ${v}`);
}

export interface ClaimStatus {
    free: boolean;
    owner: string | null;
    live: boolean;
    preempted: boolean;
    /** Our accounts online now, as rs-claim counts them (tenet 16); null when it could not count. */
    ours: number | null;
}

/** `rs-claim status`: the holder line, an optional PREEMPTED line, and `N of ours online of M`. */
export function parseClaimStatus(text: string): ClaimStatus {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const first = lines[0] ?? '';
    const free = first === 'free';
    const holder = free ? null : first.match(/^(\S+) logins=\S+ until=\S+ \((live|STALE)\)/);
    const n = text.match(/(\d+) of ours online of \d+/);
    return {
        free,
        owner: holder?.[1] ?? null,
        live: holder?.[2] === 'live',
        preempted: /PREEMPTED/.test(text),
        ours: n ? Number(n[1]) : null,
    };
}

/**
 * Replace each account's name (and its in-game form, underscores as spaces, in any case) with its
 * label. Longer names go first, so a name that contains another is never half-replaced.
 */
export function relabelAll(text: string, pairs: ReadonlyArray<readonly [string | null | undefined, string]>): string {
    const label = new Map<string, string>();
    for (const [name, l] of pairs) if (name) for (const form of [name, name.replace(/_/g, ' ')]) label.set(form.toLowerCase(), l);
    if (!label.size) return text;
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const forms = [...label.keys()].sort((x, y) => y.length - x.length).map(esc).join('|');
    return text.replace(new RegExp(forms, 'gi'), m => label.get(m.toLowerCase())!);
}

/** Replace one account's name (and the in-game form) with `label`. */
export const relabel = (text: string, name: string | null, label: string) => relabelAll(text, [[name, label]]);

/** What a gate account is called in everything run-gate prints or writes. */
export const gateLabel = (m: Machine | null) => (m ? `GATE-${m}` : 'GATE');

/** Both machines' gate accounts relabelled at once: what the Mac runs over every line, its log and choice.json. */
export const gateScrub = (accounts: Partial<Record<Machine, string | undefined>>) => (s: string) => relabelAll(s, MACHINES.map(m => [accounts[m], gateLabel(m)] as const));

export function gateRow(m: string, g: MachineGate | null): string {
    if (!g) return `${m.padEnd(5)} not gated`;
    const minute = g.startedUtc.slice(11, 16);
    const a = g.a ? `${g.a.onTime}/${g.a.trials}` : '-';
    const b = g.b ? tickP90Text(g.b.p90, g.b.T, g.b.limit) : '-';
    const c = g.c ? `${g.c.perMinute}/min${g.c.T !== null ? ` (${catchUpText(g.c.T)})` : ''}` : '-';
    const d = g.d ? `${g.d.lowest} / ${g.d.median} / ${g.d.highest}` : '-';
    const scene = g.scene?.built ? `${g.scene.built.firstLook ? '<=' : ''}t${g.scene.built.tick ?? '?'}` : g.scene ? 'not built' : '-';
    const locs = g.locs?.look ? String(g.locs.look.locs) : '-';
    const tile = g.tile ? (g.tile.atSpawn ? 'at spawn' : `${g.tile.fromSpawn} from spawn`) : '-';
    return (
        `${m.padEnd(5)} ${minute}Z  (a) ${a.padEnd(6)} (b) p90 ${b.padEnd(30)} (c) ${c.padEnd(30)} (d) p10 ${d.padEnd(20)} ${g.status.padEnd(10)} online ${g.players ?? '?'}  gate logout ${g.gateLogout}` +
        `  | report only: scene ${scene}, locs ${locs}, tile ${tile}${g.failures.length ? `  [${g.failures.join('; ')}]` : ''}`
    );
}

// ------------------------------------------------------------------ the gate tab's scene, locs and tile (report only)

/** Lumbridge spawn: each machine's gate account is parked there as the run profile's warm-up probe. */
export const LUMBRIDGE_SPAWN = { x: 3222, z: 3218, level: 0 } as const;
/** Within this many tiles (Chebyshev, on the spawn's level) reads as at Lumbridge spawn. */
export const SPAWN_RADIUS = 5;
/** rs/41's bbs reading (cairn://p/rs/41, bbs-warm): the scene built at page tick 73-83 on a cold profile at a busy site, 3-4 warm. */
const SCENE_REFERENCE = 'bbs reference: warm 3-4 ticks, cold 73-83 at a busy site';

/** One light look at the page: in game, the client's sceneState (2: built), and the overlay's tick count. */
export interface ScenePoll {
    inGame: boolean;
    sceneState: number | null;
    /** BotOverlay.serverTick: the page's ticks in game, 0 when it enters the world on a fresh load. */
    tick: number | null;
}

export const SCENE_EXPRESSION = `(() => {
    const c = window.gameClient;
    if (!c) return null;
    const o = c.botOverlay;
    return { inGame: !!c.ingame, sceneState: typeof c.sceneState === 'number' ? c.sceneState : null, tick: o && typeof o.serverTick === 'number' ? o.serverTick : null };
})()`;

export interface Tile {
    x: number;
    z: number;
    level: number;
}

/** The SDK state's view, from the page's own BotOverlay.getState(): counts and the tile only, never a name. */
export interface StateLook {
    tick: number;
    sceneReady: boolean;
    locs: number;
    npcs: number;
    players: number;
    tile: Tile | null;
}

export const STATE_EXPRESSION = `(() => {
    const o = window.gameClient && window.gameClient.botOverlay;
    if (!o || typeof o.getState !== 'function') return null;
    const s = o.getState();
    const p = s.player;
    const n = a => (Array.isArray(a) ? a.length : 0);
    return { tick: s.tick, sceneReady: !!s.sceneReady, locs: n(s.nearbyLocs), npcs: n(s.nearbyNpcs), players: n(s.nearbyPlayers), tile: p ? { x: p.worldX, z: p.worldZ, level: p.level } : null };
})()`;

export interface SceneRead {
    /** The first look that saw the page in game: its page tick and seconds after tab-login started. */
    inGame: { tick: number | null; s: number } | null;
    /**
     * The first look that saw sceneState 2. `firstLook` when that was also the first in-game look:
     * the scene was built by then, so its tick is an upper bound.
     */
    built: { tick: number | null; s: number; firstLook: boolean } | null;
    /** The last look in game, for a scene not built. */
    last: { sceneState: number | null; tick: number | null } | null;
    looks: number;
    waitedS: number;
}

export interface LocsRead {
    /** The first look with locs, or the last look when none had any. */
    look: StateLook | null;
    waitedS: number;
    error?: string;
}

export interface TileRead extends Tile {
    /** Chebyshev distance to Lumbridge spawn on the same level; null on another level. */
    fromSpawn: number | null;
    atSpawn: boolean;
}

export interface Clock {
    now(): number;
    sleep(ms: number): Promise<void>;
}
const realClock: Clock = { now: () => Date.now(), sleep: ms => Bun.sleep(ms) };
const secs = (ms: number) => Math.round(ms / 100) / 10;

/**
 * Watch the gate tab from before its login until the scene is built. It looks every `everyMs`
 * (a look that fails, as during the login's navigation, counts as no look), and gives up when
 * `stopped()` says the login failed, `afterInGameMs` after the page entered the world, or at
 * `limitMs` in all.
 */
export async function watchScene(
    look: () => Promise<ScenePoll | null>,
    opts: { stopped: () => boolean; clock?: Clock; everyMs?: number; limitMs?: number; afterInGameMs?: number }
): Promise<SceneRead> {
    const clock = opts.clock ?? realClock;
    const t0 = clock.now();
    const r: SceneRead = { inGame: null, built: null, last: null, looks: 0, waitedS: 0 };
    let inGameAt: number | null = null;
    for (;;) {
        const p = await look().catch(() => null);
        const t = clock.now();
        r.looks++;
        if (p?.inGame) {
            const first = inGameAt === null;
            if (first) {
                inGameAt = t;
                r.inGame = { tick: p.tick, s: secs(t - t0) };
            }
            r.last = { sceneState: p.sceneState, tick: p.tick };
            if (p.sceneState === 2) {
                r.built = { tick: p.tick, s: secs(t - t0), firstLook: first };
                break;
            }
        }
        if (opts.stopped() || t - t0 >= (opts.limitMs ?? 240_000) || (inGameAt !== null && t - inGameAt >= (opts.afterInGameMs ?? 120_000))) break;
        await clock.sleep(opts.everyMs ?? 250);
    }
    r.waitedS = secs(clock.now() - t0);
    return r;
}

/** The SDK's nearby locs once the scene is built: the first look with any, for up to `waitMs` (locs follow the scene by about a tick). */
export async function readLocs(look: () => Promise<StateLook | null>, opts: { clock?: Clock; everyMs?: number; waitMs?: number } = {}): Promise<LocsRead> {
    const clock = opts.clock ?? realClock;
    const t0 = clock.now();
    let last: StateLook | null = null;
    let error: string | undefined;
    for (;;) {
        try {
            const l = await look();
            if (l) last = l;
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
        }
        if ((last && last.locs > 0) || clock.now() - t0 >= (opts.waitMs ?? 10_000)) break;
        await clock.sleep(opts.everyMs ?? 500);
    }
    return { look: last, waitedS: secs(clock.now() - t0), ...(last ? {} : { error: error ?? 'no SDK state on the page' }) };
}

export function tileRead(t: Tile): TileRead {
    const fromSpawn = t.level === LUMBRIDGE_SPAWN.level ? Math.max(Math.abs(t.x - LUMBRIDGE_SPAWN.x), Math.abs(t.z - LUMBRIDGE_SPAWN.z)) : null;
    return { ...t, fromSpawn, atSpawn: fromSpawn !== null && fromSpawn <= SPAWN_RADIUS };
}

export function sceneLine(r: SceneRead | null, why?: string): string {
    const head = 'scene (report only):';
    if (!r) return `${head} not read${why ? `: ${why}` : ''}`;
    if (!r.inGame) return `${head} not read: the page never reported in game (${r.looks} looks over ${r.waitedS} s)`;
    if (r.built) {
        const at = r.built.firstLook ? `by page tick ${r.built.tick ?? '?'} (already built at the first in-game look)` : `at page tick ${r.built.tick ?? '?'}`;
        const after = r.built.firstLook ? '' : `, ${secs((r.built.s - r.inGame.s) * 1000)} s after in game (tick ${r.inGame.tick ?? '?'})`;
        return `${head} sceneState 2 ${at}, ${r.built.s} s after tab-login started${after}; ${SCENE_REFERENCE}`;
    }
    return `${head} NOT built ${secs((r.waitedS - r.inGame.s) * 1000)} s after in game (tick ${r.inGame.tick ?? '?'}): sceneState ${r.last?.sceneState ?? '?'} at page tick ${r.last?.tick ?? '?'}; ${SCENE_REFERENCE}`;
}

export function locsLine(r: LocsRead | null, why?: string): string {
    const head = 'locs (report only):';
    if (!r) return `${head} not read${why ? `: ${why}` : ''}`;
    if (!r.look) return `${head} not read: ${r.error ?? 'no SDK state'}`;
    const l = r.look;
    const around = `(${l.npcs} NPCs, ${l.players} players nearby)`;
    if (l.locs > 0) return `${head} ${l.locs} locs at page tick ${l.tick} ${around}; > 0 expected`;
    return `${head} 0 locs for ${r.waitedS} s after the scene was built, last at page tick ${l.tick} ${around}; > 0 expected: the tab sees no scenery`;
}

export function tileLine(t: TileRead | null, why?: string): string {
    const head = 'tile (report only):';
    if (!t) return `${head} not read${why ? `: ${why}` : ''}`;
    const spawn = `Lumbridge spawn (${LUMBRIDGE_SPAWN.x}, ${LUMBRIDGE_SPAWN.z}, level ${LUMBRIDGE_SPAWN.level})`;
    const n = (k: number | null) => `${k} tile${k === 1 ? '' : 's'}`;
    const where = t.atSpawn ? `at ${spawn}, ${n(t.fromSpawn)} from it` : t.fromSpawn === null ? `on level ${t.level}, not ${spawn}'s level` : `${n(t.fromSpawn)} from ${spawn}`;
    return `${head} (${t.x}, ${t.z}, level ${t.level}): ${where}`;
}

/** Single-quote for a POSIX shell. */
export const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

const ACCOUNT = /^[a-z0-9_]{1,12}$/i;

export function checkAccount(name: string, what: string): string {
    if (!ACCOUNT.test(name)) throw new Stop(`${what} is not an account name (letters, digits, underscore, at most 12)`);
    return name;
}

/** The ssh argv for a machine, RUN-HOST.md "Reaching them"; the address only from the local env. */
export function sshArgv(m: Machine, env: Record<string, string | undefined>, home = HOME): string[] {
    const v = m === 'run' ? 'RS_RUN_HOST' : 'RS_TWIN_HOST';
    const host = env[v];
    if (!host) throw new Stop(`set ${v} in your shell from cairn://p/rs/host (never commit it)`);
    const [key, known] = m === 'run' ? ['id_ed25519_ashburn', 'known_hosts_ashburn'] : ['id_ed25519_rehearsal', 'known_hosts_rehearsal'];
    return [
        'ssh', '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-i', `${home}/.rs-fleet/${key}`,
        '-o', `UserKnownHostsFile=${home}/.rs-fleet/${known}`, '-o', 'StrictHostKeyChecking=yes', '-o', 'CheckHostIP=no',
        '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=15', `ubuntu@${host}`,
    ];
}

/**
 * The remote shell line: the on-machine command detached under its own bound, writing
 * ~/rs-run/gate-<stamp>/steps.log, which the ssh session follows until the command exits and
 * then exits with its code. A dropped ssh line ends the `tail`, never the command.
 */
export function remoteLine(checkout: string, stamp: string, bound: string, args: readonly string[]): string {
    if (!/^[\w./-]+$/.test(checkout) || checkout.startsWith('/') || checkout.includes('..')) throw new Stop(`--remote-checkout must be a plain path under the machine's $HOME, not ${checkout}`);
    const cmd = ['timeout', '--kill-after=30s', bound, '"$HOME"/.bun/bin/bun', 'speedrun/tools/run-gate.ts', 'on-machine', ...args.map(shq), '--out="$D"'].join(' ');
    return `cd "$HOME"/${checkout} && D="$HOME"/rs-run/gate-${stamp} && mkdir -p "$D" && { nohup ${cmd} >>"$D"/steps.log 2>&1 </dev/null & P=$!; tail --pid=$P -n +1 -f "$D"/steps.log; wait $P; }`;
}

// ------------------------------------------------------------------ process helpers

const flags = (argv: readonly string[]) => {
    const get = (k: string) => argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
    const has = (k: string) => argv.includes(`--${k}`);
    return { get, has };
};

/** The Mac's flags forwarded to `on-machine <cmd>`, beside the command's own. */
export function forwarded(cmd: string | undefined, argv: readonly string[]): string[] {
    const f = flags(argv);
    const pass = ['display', 'claim'].flatMap(k => (f.get(k) ? [`--${k}=${f.get(k)}`] : [])).concat(f.has('rehearsal') ? ['--rehearsal'] : []);
    return cmd === 'handoff' && f.has('no-login') ? [...pass, '--no-login'] : pass;
}

const utc = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const stampOf = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

async function capture(argv: string[], env: Record<string, string | undefined> = process.env, cwd = ROOT): Promise<{ code: number; out: string; err: string }> {
    const p = Bun.spawn(argv, { env, cwd, stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' });
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    return { code, out, err };
}

const bash = (line: string, env?: Record<string, string | undefined>) => capture(['bash', '-c', line], env);

/** Run argv, printing each output line through `map` (null drops it); resolves the exit code. */
async function stream(argv: string[], map: (line: string) => string | null, opts: { env?: Record<string, string | undefined>; cwd?: string } = {}): Promise<number> {
    const p = Bun.spawn(argv, { env: opts.env ?? process.env, cwd: opts.cwd ?? ROOT, stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' });
    const pump = async (s: ReadableStream<Uint8Array>) => {
        const dec = new TextDecoder();
        let buf = '';
        const reader = s.getReader();
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            let i: number;
            while ((i = buf.indexOf('\n')) >= 0) {
                const out = map(buf.slice(0, i));
                if (out !== null) console.log(out);
                buf = buf.slice(i + 1);
            }
        }
        if (buf) {
            const out = map(buf);
            if (out !== null) console.log(out);
        }
    };
    await Promise.all([pump(p.stdout), pump(p.stderr)]);
    return p.exited;
}

// ------------------------------------------------------------------ on the machine

interface Ctx {
    display: string;
    out: string;
    rehearsal: boolean;
    claim: string | null;
    bound: string;
    progress: string;
    /** Every printed line goes through this (SCORED's relabelling). */
    say: (s: string) => string;
}

function step(ctx: Ctx, name: string, detail: string) {
    console.log(ctx.say(`[step] ${utc()} ${name}: ${detail}`));
}

const bun = process.execPath;

async function tmuxHas(session: string): Promise<boolean> {
    return (await capture(['tmux', '-L', 'run', 'has-session', '-t', session])).code === 0;
}

/**
 * `pgrep -f rs-run/chrome-profile`, less a tmux server: tmux names its server process after the
 * command of the first session it was started with, so a server first started for `chrome` keeps
 * the profile in its command line after Chrome is gone.
 */
async function profilePids(): Promise<number[]> {
    const r = await capture(['pgrep', '-f', 'rs-run/chrome-profile']);
    const pids = r.out.split('\n').map(Number).filter(n => n > 0 && n !== process.pid);
    return pids.filter(p => {
        try {
            return !readFileSync(`/proc/${p}/comm`, 'utf8').startsWith('tmux');
        } catch {
            return false; // exited meanwhile
        }
    });
}

async function windowsOn(display: string): Promise<XwinWindow[]> {
    const r = await capture(['xwininfo', '-root', '-tree'], { ...process.env, DISPLAY: display });
    if (r.code !== 0) throw new Stop(`xwininfo on ${display} failed: ${r.err.trim()}`);
    return botClientWindows(r.out);
}

/** Ruling 2 (and ruling 5's guard): no gate or run Chrome, no Bot Client window. Null when it holds. */
async function noChromeProblem(display: string): Promise<string | null> {
    const problems: string[] = [];
    if (await tmuxHas('chrome')) problems.push('`tmux -L run` still has a session `chrome`');
    const pids = await profilePids();
    if (pids.length) problems.push(`${pids.length} process(es) still on rs-run/chrome-profile (pids ${pids.slice(0, 6).join(' ')})`);
    const ws = await windowsOn(display);
    if (ws.length) problems.push(`${ws.length} Bot Client window(s) on ${display}`);
    return problems.length ? problems.join('; ') : null;
}

async function claimCheck(ctx: Ctx): Promise<ClaimStatus> {
    const tool = join(HOME, '.local/bin/rs-claim');
    if (!existsSync(tool)) throw new Stop(`no ${tool}: the claim lock (tenet 21) is not installed here`);
    const r = await capture([tool, 'status']);
    const c = parseClaimStatus(r.out);
    if (c.free || !c.live) throw new Stop(`no live claim on this machine (rs-claim: ${r.out.split('\n')[0]}); take one first (tenet 21; the run's is host's preempt)`);
    if (c.preempted) throw new Stop(`the claim is preempted (${r.out.trim().replace(/\n\s*/g, '; ')})`);
    if (ctx.claim && c.owner !== ctx.claim) throw new Stop(`the live claim is ${c.owner}'s, not ${ctx.claim}'s`);
    if (ctx.rehearsal && (!ctx.claim || c.owner === 'host' || c.owner === 'run')) throw new Stop('a rehearsal runs under its own claim: pass --claim=OWNER (not host or run)');
    if (ctx.claim) await capture([tool, 'touch', ctx.claim]);
    return c;
}

async function displayCheck(ctx: Ctx) {
    const r = await capture(['xdpyinfo'], { ...process.env, DISPLAY: ctx.display });
    const dim = r.out.match(/dimensions:\s+(\d+)x(\d+) pixels/);
    const depth = r.out.match(/depth of root window:\s+(\d+) planes/);
    if (r.code !== 0 || !dim || !depth) throw new Stop(`display ${ctx.display} does not answer (xdpyinfo exit ${r.code}): is the operator's desktop session up (RUN-HOST.md step 2)?`);
    if (dim[1] !== '1920' || dim[2] !== '1080' || depth[1] !== '24') throw new Stop(`display ${ctx.display} is ${dim[1]}x${dim[2]} at ${depth[1]} planes, not 1920x1080 at 24 (RUN-HOST.md step 2)`);
    const rdp = await bash(`ss -Htn state established '( sport = :3389 )' | wc -l`);
    const n = Number(rdp.out.trim());
    if (n !== 0) throw new Stop(`${n} remote desktop connection(s) are up: the operator disconnects before the recording and the gate (tenet 12)`);
    step(ctx, 'display', `${ctx.display} 1920x1080 at 24 planes, remote desktop disconnected`);
}

const lastFrame = (text: string) => {
    const all = [...text.matchAll(/^frame=(\d+)$/gm)];
    return all.length ? Number(all[all.length - 1]![1]) : null;
};

/** Ruling 4's first half: a recording grabs the display, and its frame counter advances. */
async function recordingCheck(ctx: Ctx) {
    const { recordingState } = await import('../lib/display');
    const r = await recordingState(ctx.display);
    if (r.on !== true) throw new Stop(`no recording grabs ${ctx.display}${r.why ? ` (${r.why})` : ''}: it starts before the gate and before SCORED's login (\`up\`, RUN-HOST.md step 5)`);
    const read = () => (existsSync(ctx.progress) ? readFileSync(ctx.progress, 'utf8') : '');
    const f0 = lastFrame(read());
    await Bun.sleep(2_500);
    const text = read();
    const f1 = lastFrame(text);
    if (f0 === null || f1 === null || f1 <= f0) throw new Stop(`the recording's frame counter is not advancing in ${ctx.progress} (${f0} then ${f1})`);
    const last = (k: string) => [...text.matchAll(new RegExp(`^${k}=(\\S+)$`, 'gm'))].at(-1)?.[1] ?? '?';
    step(ctx, 'recording', `pid ${r.pid} writing ${r.file ?? '(file not named)'}; frame ${f1}, fps ${last('fps')}, dropped ${last('drop_frames')}`);
}

async function envFile(path: string, what: string): Promise<{ name: string; path: string; password: string }> {
    if (!existsSync(path)) throw new Stop(`no env file for ${what} at the given path`);
    const mode = statSync(path).mode & 0o777;
    if (mode !== 0o600) throw new Stop(`${what}'s env file is mode ${mode.toString(8)}, not 600 (chmod 600)`);
    const text = readFileSync(path, 'utf8');
    const name = text.match(/^BOT_USERNAME=(.*)$/m)?.[1]?.trim() ?? '';
    const password = text.match(/^PASSWORD=(.*)$/m)?.[1] ?? '';
    checkAccount(name, `${what}'s BOT_USERNAME`);
    const expect = join(ROOT, 'bots', name, 'bot.env');
    if (resolve(path) !== expect) throw new Stop(`${what}'s env file must be <checkout>/bots/<BOT_USERNAME>/bot.env (RUN-HOST.md step 0)`);
    if (!password) throw new Stop(`${what}'s env file has no PASSWORD`);
    return { name, path, password };
}

async function chromeFlagsCheck(ctx: Ctx) {
    const r = await capture(['ps', '-o', 'args=', '-C', 'chrome']);
    const browser = r.out.split('\n').find(l => l.includes(`--user-data-dir=${PROFILE}`) && !l.includes('--type='));
    if (!browser) throw new Stop('no Chrome browser process on rs-run/chrome-profile');
    const missing = CHROME_FLAGS.filter(f => !browser.includes(`--${f}`));
    if (missing.length) throw new Stop(`Chrome runs without ${missing.join(', ')} (RUN-HOST.md step 3)`);
    step(ctx, 'chrome flags', `all six present (${CHROME_FLAGS.map(f => f.split('=')[0]).join(', ')})`);
}

/** Start step 3's Chrome on the account's bare page, and wait for its tab and its window. */
async function launchTab(ctx: Ctx, name: string, bound: string) {
    checkAccount(name, 'the account');
    const line =
        `exec timeout --kill-after=30s ${bound} env DISPLAY=${ctx.display} google-chrome --user-data-dir=${PROFILE} --remote-debugging-port=9222 ` +
        `--no-first-run --no-default-browser-check --password-store=basic --disable-background-timer-throttling --disable-renderer-backgrounding ` +
        `--disable-backgrounding-occluded-windows --start-maximized --app="${PAGE}/bot?bot=${name}"`;
    const r = await capture(['tmux', '-L', 'run', 'new-session', '-d', '-s', 'chrome', line]);
    if (r.code !== 0) throw new Stop(`tmux could not start Chrome: ${r.err.trim()}`);
    const { botTabs } = await import('../lib/tab');
    const until = Date.now() + 30_000;
    let tab = false;
    let ws: XwinWindow[] = [];
    // Waiting for Chrome to map and maximise its one window; nothing on the display is touched.
    while (Date.now() < until) {
        try {
            tab = botTabs((await (await fetch(`${CDP}/json/list`)).json()) as never, name).length > 0;
        } catch {
            tab = false;
        }
        ws = await windowsOn(ctx.display);
        if (tab && ws.length === 1 && ws[0]!.width === RECORD_WIDTH) break;
        await Bun.sleep(500);
    }
    if (!tab) throw new Stop(`Chrome's DevTools port lists no tab for the account within 30 s`);
    step(ctx, 'tab', `Chrome up on the bare page (bound ${bound}); ${ws.length} Bot Client window(s): ${ws.map(w => `${w.width}x${w.height}`).join(', ') || 'none'}`);
}

/** tab-login.ts, bound 3 min; its lines go through ctx.say. */
async function tabLogin(ctx: Ctx, name: string): Promise<void> {
    const code = await stream(['timeout', '--kill-after=30s', '3m', bun, 'speedrun/tools/tab-login.ts', name, `--bots-dir=${join(ROOT, 'bots')}`], l => ctx.say(`  ${l}`));
    if (code !== 0) throw new Stop(`tab-login exited ${code}: the tab is not in game`, 2);
    step(ctx, 'login', 'the tab is in game');
}

/** RUN-HOST.md "Served = built", in process: the page server serves exactly this checkout's bot bundle. */
async function servedBundleCheck(ctx: Ctx) {
    const builtPath = join(ROOT, 'server/webclient/out/bot/client.js');
    if (!existsSync(builtPath)) throw new Stop('no built bundle at server/webclient/out/bot/client.js: build the webclient (RUN-HOST.md step 0)');
    let served: ArrayBuffer;
    try {
        const r = await fetch(`${PAGE}/bot/client.js?v=check`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        served = await r.arrayBuffer();
    } catch (e) {
        throw new Stop(`the page server does not serve /bot/client.js: ${e instanceof Error ? e.message : String(e)}`);
    }
    const md5 = (b: ArrayBuffer | Uint8Array) => new Bun.CryptoHasher('md5').update(b).digest('hex');
    const s = md5(served);
    const b = md5(readFileSync(builtPath));
    if (s !== b) throw new Stop(`served bundle != built: the page server serves md5 ${s}, this checkout built ${b}`, 1);
    step(ctx, 'served bundle', `served = built: md5 ${b}, commit ${(await capture(['git', 'rev-parse', 'HEAD'])).out.trim()}`);
}

/** RUN-HOST.md step 3's secrets check, in process: no password or token in ps, none in a tab URL. */
async function secretsCheck(ctx: Ctx, password: string) {
    const ps = (await capture(['ps', '-efww'])).out.split('\n');
    const withPassword = ps.filter(l => l.includes(password)).length;
    const withToken = ps.filter(l => /token=/.test(l)).length;
    let inUrls = 0;
    try {
        const list = (await (await fetch(`${CDP}/json/list`)).json()) as Array<{ url: string }>;
        inUrls = list.filter(t => t.url.includes('token=') || t.url.includes(password)).length;
    } catch {
        throw new Stop("Chrome's DevTools port does not answer for the secrets check");
    }
    if (withPassword || withToken || inUrls) throw new Stop(`secrets check ${withPassword} ${withToken} ${inUrls}, not 0 0 0: a password or token is visible (RUN-HOST.md step 3)`);
    step(ctx, 'secrets', '0 0 0');
}

/**
 * Ruling 4's pass line: the window in front of the display is the run tab, and an x11grab frame
 * of the display matches the page's own screenshot. It waits up to `waitMs` for a conclusive
 * match (a page still loading is flat and inconclusive) and never raises or touches a window.
 */
async function liveFrame(ctx: Ctx, name: string, tag: string, waitMs = 20_000): Promise<void> {
    const { frameShows, frontWindows, grabFrame, xpropRunner } = await import('../lib/display');
    const { screenshotTab } = await import('../lib/tab');
    const until = Date.now() + waitMs;
    let n = 0;
    let last = 'no look taken';
    while (Date.now() < until || n === 0) {
        n++;
        const front = await frontWindows(xpropRunner(ctx.display));
        const top = front.top?.name ?? 'none';
        const framePath = join(ctx.out, `${tag}-frame-${n}.png`);
        const pagePath = join(ctx.out, `${tag}-page-${n}.png`);
        await grabFrame(ctx.display, framePath);
        const page = await screenshotTab(CDP, name);
        if (!page) throw new Stop(`the run tab has no page to screenshot (${tag})`);
        writeFileSync(pagePath, page);
        const f = await frameShows(framePath, pagePath);
        const topOk = /Bot Client/.test(top);
        last = `front window "${ctx.say(top)}", frame difference ${f.diff ?? '-'} (pass at <= ${f.max}), page contrast ${f.contrast}, at ${f.at ? `${f.at.x},${f.at.y}` : '-'}`;
        if (topOk && f.match === true) {
            console.log(ctx.say(`[gate] ${utc()} live frame (${tag}): PASS: ${last}; ${framePath}`));
            return;
        }
        await Bun.sleep(1_000);
    }
    throw new Stop(`live frame (${tag}) FAIL after ${n} look(s): ${last}: the recording does not show the run tab`, 1);
}

async function onUp(ctx: Ctx, argv: readonly string[]) {
    const f = flags(argv);
    const bind = f.get('live-bind');
    if (!bind || !/^\d{1,3}(\.\d{1,3}){3}$/.test(bind)) throw new Stop('--live-bind=IPv4 is required: the run host binds its tailnet address, the twin 127.0.0.1 (RUN-HOST.md step 5)');
    await claimCheck(ctx);
    await displayCheck(ctx);
    const up: string[] = [];
    for (const s of ['gateway', 'page', 'rec', 'live', 'chrome']) if (await tmuxHas(s)) up.push(s);
    if (up.length) throw new Stop(`the run stack is already up (tmux -L run: ${up.join(', ')}); tear it down first (RUN-HOST.md step 9)`);
    const ports = await bash(`ss -Hltn | grep -E ':(7780|8899|8090) ' || true`);
    if (ports.out.trim()) throw new Stop(`a port the stack needs is taken: ${ports.out.trim().replace(/\s+/g, ' ')}`);
    if (!existsSync(join(ROOT, 'server/webclient/out/bot/client.js'))) throw new Stop("the checkout has no built client (server/webclient/out/bot/client.js): RUN-HOST.md step 0's build");
    const T = ctx.bound;
    const start = async (name: string, cwd: string | null, line: string) => {
        const r = await capture(['tmux', '-L', 'run', 'new-session', '-d', '-s', name, ...(cwd ? ['-c', cwd] : []), line]);
        if (r.code !== 0) throw new Stop(`tmux could not start ${name}: ${r.err.trim()}`);
    };
    await start('gateway', join(ROOT, 'server/gateway'), `exec timeout --kill-after=30s ${T} env AGENT_PORT=7780 GATEWAY_HOSTNAME=127.0.0.1 ${bun} run gateway.ts >>${HOME}/rs-run/gateway.log 2>&1`);
    await start('page', join(ROOT, 'server/webclient'), `exec timeout --kill-after=30s ${T} ${bun} run proxy.ts --world=https://${DEMO} --port=8899 --gateway=ws://127.0.0.1:7780 >>${HOME}/rs-run/page.log 2>&1`);
    await Bun.sleep(4_000);
    const listening = (await bash(`ss -Hltn | grep -cE ':(7780|8899) '`)).out.trim();
    if (listening !== '2') throw new Stop(`the gateway (7780) and page server (8899) are not both listening (${listening} of 2); see ~/rs-run/gateway.log and page.log`);
    const redirect = (await bash(`curl -s -o /dev/null -w '%{http_code} %{redirect_url}' '${PAGE}/bot?bot=x'`)).out.trim();
    if (!redirect.startsWith('302 ') || !redirect.includes(`server=${DEMO}`)) throw new Stop(`the page server answers ${redirect}, not a 302 to the demo (RUN-HOST.md step 3)`);
    const refuse = (await bash(`curl -s -o /dev/null -w '%{http_code}' '${PAGE}/bot?bot=x&password=y'`)).out.trim();
    if (refuse !== '400') throw new Stop(`the page server answers ${refuse} to a password in the URL, not 400 (rs/138 must be on the checkout)`);
    step(ctx, 'stack', `gateway 7780 and page server 8899 up (bound ${T}); ${redirect}; password URL refused 400`);
    mkdirSync(join(HOME, 'recordings'), { recursive: true });
    const file = join(HOME, 'recordings', `${ctx.rehearsal ? 'rehearsal' : 'run'}-${stampOf()}.mkv`);
    await bash(`rm -f ${shq(ctx.progress)}`);
    await start(
        'rec',
        null,
        `exec timeout -s INT --kill-after=30s ${T} ffmpeg -hide_banner -loglevel warning -f x11grab -draw_mouse 1 -framerate 30 -video_size 1920x1080 -i ${ctx.display}.0+0,0 -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -progress ${ctx.progress} ${file} 2>>${HOME}/recordings/ffmpeg.log`
    );
    await start(
        'live',
        null,
        `exec timeout --kill-after=30s ${T} bash -c "while true; do ffmpeg -nostdin -hide_banner -loglevel warning -f x11grab -draw_mouse 1 -framerate 3 -video_size 1920x1080 -i ${ctx.display}.0+0,0 -vf scale=960:540 -c:v mjpeg -q:v 8 -f mpjpeg -listen 1 http://${bind}:8090/live.mjpg; sleep 1; done"`
    );
    await Bun.sleep(5_000);
    await recordingCheck(ctx);
    step(ctx, 'live view', `3 fps MJPEG on port 8090 of the given bind address (bound ${T})`);
    console.log(`UP-RESULT ${JSON.stringify({ ok: true, recording: file, utc: utc() })}`);
}

/** Rewrite a file another tool left in the gate's folder with every line through `say` (the gate account's label). */
function scrubFile(path: string, say: (s: string) => string) {
    if (!existsSync(path)) return;
    const text = readFileSync(path, 'utf8');
    const out = say(text);
    if (out !== text) writeFileSync(path, out);
}

/**
 * The report-only lines from the gate tab, after its login: `scene` (from `watched`), then `locs`
 * and `tile` from the SDK state once the scene is built. They go in the gate's JSON and never
 * stop the gate.
 */
async function reportScene(ctx: Ctx, g: MachineGate, gate: string, watched: SceneRead | null, why?: string) {
    const say = (s: string) => console.log(ctx.say(`[gate] ${utc()} ${s}`));
    g.scene = watched;
    say(sceneLine(watched, why));
    if (!watched?.built) {
        const not = why ?? 'the scene was not built';
        say(locsLine(null, not));
        say(tileLine(null, not));
        return;
    }
    const { evaluateInTab } = await import('../lib/tab');
    g.locs = await readLocs(() => evaluateInTab<StateLook | null>(CDP, gate, STATE_EXPRESSION, 3_000).then(r => r?.value ?? null));
    say(locsLine(g.locs));
    g.tile = g.locs.look?.tile ? tileRead(g.locs.look.tile) : null;
    say(tileLine(g.tile, 'the SDK state has no player'));
}

async function onGate(ctx: Ctx, argv: readonly string[]): Promise<number> {
    const f = flags(argv);
    const gate = checkAccount(f.get('gate') ?? '', '--gate');
    const role = f.get('role') ?? null;
    if (role !== null && role !== 'run' && role !== 'twin') throw new Stop(`--role takes run or twin, not ${role}`);
    // From here no line, file or result names the gate account (as SCORED in `handoff`).
    const plain = ctx.say;
    ctx.say = s => relabel(plain(s), gate, gateLabel(role));
    const say = (s: string) => console.log(ctx.say(s));
    const minutes = Number(f.get('minutes') ?? '5');
    const rehearse = f.get('rehearse') ?? null;
    if (rehearse && !['unconfirmed-logout', 'kept-chrome'].includes(rehearse)) throw new Stop(`--rehearse is unconfirmed-logout or kept-chrome, not ${rehearse}`);
    if (rehearse && !ctx.rehearsal) throw new Stop('--rehearse needs --rehearsal');
    const g: MachineGate = {
        machine: (await capture(['hostname'])).out.trim(), startedUtc: utc(), endUtc: '', status: 'not-probed', a: null, b: null, c: null, d: null, players: null,
        gateLogout: 'not-run', failures: [], scene: null, locs: null, tile: null,
    };
    const json = join(ctx.out, 'direct.json');
    const jsonl = join(ctx.out, 'loops.jsonl');
    const finish = (code: number) => {
        g.endUtc = utc();
        for (const p of [json, jsonl]) scrubFile(p, ctx.say);
        writeFileSync(join(ctx.out, 'verdict.json'), ctx.say(JSON.stringify(g, null, 2)));
        say(`GATE-RESULT ${JSON.stringify(g)}`);
        return code;
    };
    try {
        // Preconditions, including ruling 5's guard: no run or gate tab may already be on this display.
        await claimCheck(ctx);
        await displayCheck(ctx);
        const busy = await noChromeProblem(ctx.display);
        if (busy) throw new Stop(`a tab is already on the recorded display (${busy}): never gate where a run tab may be; probes go to the machine not chosen`);
        for (const s of ['gateway', 'page', 'rec', 'live']) if (!(await tmuxHas(s))) throw new Stop(`\`tmux -L run\` has no ${s} session: run \`up\` first`);
        const timer = (await capture(['systemctl', '--user', 'is-active', 'rs-gate-read.service'])).out.trim();
        if (timer === 'active') throw new Stop('a gate history timer read is in progress (rs-gate-read.service active): wait for it to finish');
        await recordingCheck(ctx);
        const env = await envFile(join(ROOT, 'bots', gate, 'bot.env'), 'the gate account');
        step(ctx, 'preconditions', `claim live, stack up, no tab on ${ctx.display}, gate timer ${timer}, gate account ${gateLabel(role)}`);

        // (a)-(c): rs/96's direct CLI, before the gate tab opens (it logs the account in itself).
        step(ctx, '(a)-(c)', `tickmanip-latency.ts ${gate} --path=direct --no-tele (bound 15m)`);
        const dcode = await stream(['timeout', '--kill-after=30s', '15m', bun, 'docs/speedrun/scripts/tickmanip-latency.ts', gate, '--path=direct', '--no-tele', `--json=${json}`], l => ctx.say(`  ${l}`));
        if (dcode === 2) throw new Stop('(a)-(c) not probed: a vantage precondition failed (edge iad, TCP connect p50 <= 5 ms); see the vantage line');
        if (!existsSync(json)) throw new Stop(`(a)-(c): the direct CLI exited ${dcode} without a result`);
        const direct = parseDirectJson(readFileSync(json, 'utf8'));
        g.players = direct.players;
        const pre = machineVerdict(direct, null, { requireLoops: false });
        g.a = { onTime: direct.onTime, trials: direct.trials, passAt: pre.verdict.passAt, floorAt: pre.verdict.floorAt };
        g.b = direct.steadiness ? { p90: direct.steadiness.p90, T: direct.steadiness.T, limit: pre.verdict.checks.find(k => k.id === 'b')?.limit ?? null } : null;
        g.c = direct.steadiness ? { perMinute: direct.steadiness.catchUpsPerMinute, T: direct.steadiness.T } : null;
        if (direct.logoutOk === false) step(ctx, '(a)-(c)', 'WARNING: the direct probe did not confirm its logout; the tab login may meet "already logged in"');
        if (!startable(pre.status)) {
            g.status = pre.status;
            g.failures = pre.failures;
            say(`STOP: (a)-(c) ${pre.status}: ${pre.failures.join('; ')}; (d) not measured`);
            return finish(pre.status === 're-measure' ? 3 : 1);
        }

        // (d): the gate tab, logged in, sampled; then logged out and, whatever the logout said, killed.
        let loops: LoopsSummary | null = null;
        let sampleError: string | null = null;
        try {
            await launchTab(ctx, gate, GATE_TAB_BOUND);
            await chromeFlagsCheck(ctx);
            // The scene watch starts before the login's navigation, so it sees the page enter the world.
            const { evaluateInTab } = await import('../lib/tab');
            let loginFailed = false;
            const watching = watchScene(() => evaluateInTab<ScenePoll | null>(CDP, gate, SCENE_EXPRESSION, 3_000).then(r => r?.value ?? null), { stopped: () => loginFailed });
            try {
                await tabLogin(ctx, gate);
            } catch (e) {
                loginFailed = true;
                await reportScene(ctx, g, gate, await watching, 'the login failed');
                throw e;
            }
            await reportScene(ctx, g, gate, await watching);
            await secretsCheck(ctx, env.password);
            step(ctx, '(d)', `runhost-loops.ts ${gate} --minutes=${minutes} (bound 10m)`);
            const lcode = await stream(
                ['timeout', '--kill-after=30s', '10m', bun, 'docs/speedrun/scripts/runhost-loops.ts', gate, '--label=gate', `--minutes=${minutes}`, `--display=${ctx.display}`, `--out=${jsonl}`, `--progress=${ctx.progress}`],
                l => (/^\[(Runner|BotSDK)\]|Pathfinding|LOGOUT DEBUG/.test(l) ? null : ctx.say(`  ${l}`))
            );
            const samples = existsSync(jsonl) ? readFileSync(jsonl, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as { loopsP10?: unknown }) : [];
            loops = loopsSummary(samples);
            if (lcode !== 0) sampleError = `the (d) sampler exited ${lcode}`;
        } catch (e) {
            sampleError = e instanceof Error ? e.message : String(e);
        } finally {
            if (rehearse) {
                g.gateLogout = 'unconfirmed';
                step(ctx, 'gate logout', `NOT CONFIRMED (forced by --rehearse=${rehearse}: logoutClean skipped)`);
            } else {
                const snippet =
                    'const m = await import("./speedrun/lib/session.ts"); const s = await m.openSession(process.env.B, { client: "browser", pathfinding: false, readyTimeoutMs: 30000 }); ' +
                    'const r = await m.logoutClean(s); console.log(r.ok ? "logged out; the page is out of game" : "not confirmed: " + r.reason); await m.closeSession(s); process.exit(r.ok ? 0 : 1);';
                const lo = await stream(['timeout', '--kill-after=30s', '3m', bun, '-e', snippet], l => (/^\[(Runner|BotSDK)\]|LOGOUT DEBUG/.test(l) ? null : ctx.say(`  ${l}`)), { env: { ...process.env, B: gate } });
                g.gateLogout = lo === 0 ? 'confirmed' : 'unconfirmed';
                step(ctx, 'gate logout', lo === 0 ? 'confirmed by the page' : `NOT CONFIRMED (exit ${lo}); the window is killed anyway`);
            }
            // Ruling 1: the gate Chrome is killed whatever the logout said.
            if (rehearse === 'kept-chrome') step(ctx, 'gate chrome', 'NOT killed (forced by --rehearse=kept-chrome: the old `logout && kill`)');
            else await killGateChrome(ctx);
        }
        // Ruling 2, after the kill.
        const left = await noChromeProblem(ctx.display);
        if (left) throw new Stop(`the gate tab is not closed after the kill: ${left}`);
        step(ctx, 'closed', `no tmux chrome session, no rs-run/chrome-profile process, no Bot Client window on ${ctx.display}`);
        if (sampleError) throw new Stop(`(d) not measured: ${sampleError}`);

        const v = machineVerdict(direct, loops);
        g.d = loops;
        g.status = v.status;
        g.failures = v.failures;
        say(`[gate] ${verdictText(v.verdict)}`);
        say(`[gate] ${gateRow(g.machine, g)}`);
        return finish(startable(v.status) ? 0 : v.status === 're-measure' ? 3 : 1);
    } catch (e) {
        // Any error ends in a result line, so the Mac's choice sees this machine as gated and failed.
        const stop = e instanceof Stop ? e : new Stop(`run-gate failed: ${e instanceof Error ? e.message : String(e)}`);
        g.failures.push(stop.message);
        // A stop after (a)-(c) were read is a failed gate; before them, nothing was probed.
        if (g.status !== 're-measure') g.status = g.a ? 'fail' : 'not-probed';
        say(`STOP: ${stop.message}`);
        return finish(stop.code);
    }
}

/** Ruling 1: end the gate Chrome by its tmux session, then by its profile, then SIGKILL. */
async function killGateChrome(ctx: Ctx) {
    await capture(['tmux', '-L', 'run', 'kill-session', '-t', 'chrome']);
    const gone = async (ms: number) => {
        const until = Date.now() + ms;
        while (Date.now() < until) {
            if (!(await profilePids()).length) return true;
            await Bun.sleep(250);
        }
        return !(await profilePids()).length;
    };
    let how = 'tmux kill-session';
    if (!(await gone(10_000))) {
        how += ', then SIGTERM on the profile';
        await capture(['pkill', '-TERM', '-f', 'rs-run/chrome-profile']);
        if (!(await gone(5_000))) {
            how += ', then SIGKILL';
            await capture(['pkill', '-KILL', '-f', 'rs-run/chrome-profile']);
            await gone(5_000);
        }
    }
    step(ctx, 'gate chrome', `killed unconditionally (${how})`);
}

async function onHandoff(ctx: Ctx, argv: readonly string[]): Promise<number> {
    const f = flags(argv);
    const envPath = f.get('scored-env');
    if (!envPath) throw new Stop('--scored-env=PATH is required');
    const cap = Number(f.get('cap') ?? '80');
    const noLogin = f.has('no-login');
    let name: string | null = null;
    const result = { ok: false, utc: '', reason: '', loggedIn: false };
    try {
        const env = await envFile(resolve(envPath), 'SCORED');
        name = env.name;
        const label = 'SCORED';
        const plain = ctx.say;
        ctx.say = s => relabel(plain(s), name, label);

        const steps: Record<HandoffStep, () => Promise<void>> = {
            claim: async () => void (await claimCheck(ctx)),
            // Ruling 2: after the gate's unconditional kill, nothing of the gate Chrome is left.
            preconditions: async () => {
                const left = await noChromeProblem(ctx.display);
                if (left) throw new Stop(`step-7 precondition failed: ${left}`);
                step(ctx, 'preconditions', `no tmux chrome session, no rs-run/chrome-profile process, no Bot Client window on ${ctx.display}`);
            },
            display: () => displayCheck(ctx),
            // Ruling 4's first half: the recording is already running before the login.
            recording: () => recordingCheck(ctx),
            // With --no-login the 1 is run.ts's login, still counted here.
            'login count': async () => {
                const claim = await claimCheck(ctx);
                if (claim.ours === null) throw new Stop('the login count is unavailable (rs-claim could not read /playerpositions): do not log SCORED in uncounted (tenet 16)');
                if (claim.ours + 1 > cap) throw new Stop(`login count ${claim.ours} of ours online + SCORED's 1 is over ${cap} (tenet 16; log the unneeded fleet out first)`);
                step(ctx, 'login count', `${claim.ours} of ours online + 1 = ${claim.ours + 1}, at most ${cap}`);
            },
            // From here a failure leaves SCORED's bare page up, not logged in, for the operator to read.
            tab: () => launchTab(ctx, env.name, ctx.bound),
            'chrome flags': () => chromeFlagsCheck(ctx),
            // Ruling 3: exactly one Bot Client window, 1920 wide, before the login.
            'one window': async () => {
                const one = oneWindowProblem(await windowsOn(ctx.display));
                if (one) throw new Stop(`window check before the login: ${one}`, 1);
                step(ctx, 'one window', `exactly one Bot Client window on ${ctx.display}, ${RECORD_WIDTH} wide`);
            },
            // Rulings 4 and 5: the recording's live frame shows the run tab, in front, before the login.
            'title frame': () => liveFrame(ctx, env.name, 'scored-title'),
            'served bundle': () => servedBundleCheck(ctx),
            login: async () => {
                // Set before the login: a tab-login that fails part way may still have left SCORED in game.
                result.loggedIn = true;
                await tabLogin(ctx, env.name);
            },
            secrets: () => secretsCheck(ctx, env.password),
            'one window after login': async () => {
                await Bun.sleep(2_000);
                const after = oneWindowProblem(await windowsOn(ctx.display));
                if (after) throw new Stop(`window check after the login: ${after}; SCORED is in game: touch nothing on the display and tell main`, 1);
            },
            'in-game frame': () => liveFrame(ctx, env.name, 'scored-ingame'),
        };
        for (const s of handoffSteps({ noLogin })) await steps[s]();

        result.ok = true;
        if (noLogin) {
            result.reason = "SCORED's tab is up on the bare client page, alone and in front on the recorded display, recording running, served bundle = built; not logged in: run.ts logs SCORED in";
            console.log(ctx.say(`[handoff] ${utc()} PASS: ${result.reason}. Nothing else opens a window on ${ctx.display} until the run ends.`));
        } else {
            result.reason = 'SCORED is in game, alone and in front on the recorded display, with the recording showing it';
            console.log(ctx.say(`[handoff] ${utc()} PASS: ${result.reason}. The run scripts take it from here; nothing else opens a window on ${ctx.display} until the run ends.`));
        }
        return 0;
    } catch (e) {
        if (!(e instanceof Stop)) throw e;
        result.reason = e.message;
        console.log(ctx.say(`STOP: ${e.message}`));
        return e.code;
    } finally {
        result.utc = utc();
        const line = relabel(JSON.stringify(result), name, 'SCORED');
        writeFileSync(join(ctx.out, 'handoff.json'), line);
        console.log(`HANDOFF-RESULT ${line}`);
    }
}

async function onMachine(argv: readonly string[]): Promise<number> {
    const [cmd, ...rest] = argv;
    const f = flags(rest);
    const rehearsal = f.has('rehearsal');
    const out = f.get('out') ?? join(HOME, 'rs-run', `gate-${stampOf()}`);
    mkdirSync(out, { recursive: true });
    const ctx: Ctx = {
        display: f.get('display') ?? ':10',
        out,
        rehearsal,
        claim: f.get('claim') ?? null,
        bound: rehearsal ? REHEARSAL_BOUND : RUN_BOUND,
        progress: f.get('progress') ?? join(HOME, 'recordings/ffmpeg-progress.log'),
        say: s => s,
    };
    try {
        if (!/^:\d+$/.test(ctx.display)) throw new Stop(`--display must look like :10, not ${ctx.display}`);
        console.log(`[run-gate] ${utc()} on-machine ${cmd} on ${(await capture(['hostname'])).out.trim()}, checkout ${ROOT} at ${(await capture(['git', 'log', '-1', '--format=%h'])).out.trim()}, ${rehearsal ? 'REHEARSAL' : 'RUN'}, outputs ${out}`);
        if (cmd === 'up') {
            await onUp(ctx, rest);
            return 0;
        }
        if (cmd === 'gate') return await onGate(ctx, rest);
        if (cmd === 'handoff') return await onHandoff(ctx, rest);
        throw new Stop(`on-machine takes up, gate or handoff, not ${cmd}`);
    } catch (e) {
        if (!(e instanceof Stop)) throw e;
        console.log(ctx.say(`STOP: ${e.message}`));
        return e.code;
    }
}

// ------------------------------------------------------------------ on the Mac

interface RemoteRun {
    machine: Machine;
    code: number;
    lines: string[];
}

async function remote(m: Machine, args: readonly string[], opts: { checkout: string; stamp: string; bound: string; log: string; scrub?: (s: string) => string }): Promise<RemoteRun> {
    const lines: string[] = [];
    const argv = [...sshArgv(m, process.env), remoteLine(opts.checkout, opts.stamp, opts.bound, args)];
    const code = await stream(argv, raw => {
        const l = opts.scrub ? opts.scrub(raw) : raw;
        lines.push(l);
        const out = `[${m}] ${l}`;
        appendFileSync(opts.log, out + '\n');
        return out;
    }, { cwd: process.cwd() });
    return { machine: m, code, lines };
}

const resultOf = <T>(r: RemoteRun, tag: string): T | null => {
    const line = [...r.lines].reverse().find(l => l.startsWith(`${tag} `));
    return line ? (JSON.parse(line.slice(tag.length + 1)) as T) : null;
};

function pickMachines(v: string | undefined): Machine[] {
    const ms = (v ?? 'run,twin').split(',').map(s => s.trim()).filter(Boolean);
    for (const m of ms) if (!MACHINES.includes(m as Machine)) throw new Stop(`--machines takes run and/or twin, not ${m}`);
    return [...new Set(ms)] as Machine[];
}

async function mac(argv: readonly string[]): Promise<number> {
    const [cmd, ...rest] = argv;
    const f = flags(rest);
    const rehearsal = f.has('rehearsal');
    const logDir = f.get('log-dir') ?? join(HOME, 'rs-run-gate');
    mkdirSync(logDir, { recursive: true });
    const stamp = stampOf();
    const log = join(logDir, `${cmd}-${stamp}.log`);
    const checkout = f.get('remote-checkout') ?? 'rs-sdk';
    const pass = forwarded(cmd, rest);
    const say = (s: string) => {
        console.log(s);
        appendFileSync(log, s + '\n');
    };
    say(`[run-gate] ${utc()} ${cmd}${rehearsal ? ' (REHEARSAL)' : ''}; log ${log}`);

    if (cmd === 'up') {
        const ms = pickMachines(f.get('machines'));
        const bind = (m: Machine) => {
            if (m === 'twin') return '127.0.0.1';
            const t = process.env.RS_RUN_TAILNET;
            if (!t) throw new Stop('set RS_RUN_TAILNET in your shell from cairn://p/rs/host: the run host binds its live view there');
            return t;
        };
        const runs = await Promise.all(ms.map(m => remote(m, ['up', `--live-bind=${bind(m)}`, ...pass], { checkout, stamp, bound: '3m', log })));
        for (const r of runs) say(`[run-gate] ${r.machine}: ${r.code === 0 ? 'up' : `NOT up (exit ${r.code})`}`);
        return Math.max(0, ...runs.map(r => r.code));
    }

    if (cmd === 'gate') {
        const ms = pickMachines(f.get('machines'));
        const accounts: Record<Machine, string | undefined> = { run: f.get('gate-run'), twin: f.get('gate-twin') };
        for (const m of ms) checkAccount(accounts[m] ?? '', `--gate-${m}`);
        if (ms.length === 2 && accounts.run === accounts.twin) throw new Stop('each machine gates on its own account: one account is in the world only once (RUN-HOST.md step 0)');
        const prefer = parsePrefer(f.get('prefer'));
        // Each machine relabels its own account; this catches either name in anything that comes back.
        const scrub = gateScrub(accounts);
        const extra = ['minutes', 'rehearse'].flatMap(k => (f.get(k) ? [`--${k}=${f.get(k)}`] : []));
        say(`[run-gate] preference: ${prefer} (${f.get('prefer') ? '--prefer' : 'the default'}; both pass: ${prefer}, unless the tiebreak moves it)`);
        if (ms.length < 2) say(`[run-gate] WARNING: gating ${ms.join('')} only; a run-day choice gates both machines in the same minute (tenet 17)`);
        const runs = await Promise.all(ms.map(m => remote(m, ['gate', `--gate=${accounts[m]}`, `--role=${m}`, ...extra, ...pass], { checkout, stamp, bound: '40m', log, scrub })));
        const gates: Partial<Record<Machine, MachineGate | null>> = {};
        for (const r of runs) gates[r.machine] = resultOf<MachineGate>(r, 'GATE-RESULT');
        say('');
        say('[run-gate] the gate, per machine (RUN-HOST.md step 5a.3: record both):');
        for (const m of MACHINES) if (ms.includes(m)) say(`  ${gateRow(m, gates[m] ?? null)}`);
        const choice = choose(gates, prefer);
        say(`[run-gate] ${choiceLine(choice)}`);
        const record = scrub(JSON.stringify({ utc: utc(), stamp, machines: ms, rehearsal, prefer, gates, choice }, null, 2));
        writeFileSync(join(logDir, `choice-${stamp}.json`), record);
        writeFileSync(join(logDir, 'choice.json'), record);
        if (choice.machine) say(`[run-gate] next: the roster on ${choice.machine} (RUN-HOST.md step 5a.4-5a.5), then \`handoff --machine=${choice.machine}\``);
        return choice.machine ? 0 : runs.some(r => r.code === 3) && !runs.some(r => r.code === 2) ? 3 : 1;
    }

    if (cmd === 'handoff') {
        const m = f.get('machine') as Machine | undefined;
        if (!m || !MACHINES.includes(m)) throw new Stop('--machine=run|twin is required');
        const env = f.get('scored-env');
        if (!env) throw new Stop("--scored-env=PATH (on the machine, relative to the checkout or absolute) is required");
        const maxAge = Number(f.get('max-gate-age') ?? '20');
        const choiceFile = f.get('choice') ?? join(logDir, 'choice.json');
        if (!existsSync(choiceFile)) throw new Stop(`no gate choice at ${choiceFile}: run \`gate\` first`);
        const choice = JSON.parse(readFileSync(choiceFile, 'utf8')) as { utc: string; rehearsal: boolean; choice: { machine: Machine | null } };
        if (choice.choice.machine !== m) throw new Stop(`the latest gate chose ${choice.choice.machine ?? 'no machine'}, not ${m}`);
        const age = (Date.now() - Date.parse(choice.utc)) / 60_000;
        if (age > maxAge) throw new Stop(`the gate is ${age.toFixed(0)} min old, over --max-gate-age=${maxAge}: gate again`);
        if (choice.rehearsal !== rehearsal) throw new Stop(`the gate was ${choice.rehearsal ? 'a rehearsal' : 'the run'}'s and this hand-off is ${rehearsal ? 'a rehearsal' : 'the run'}'s`);
        const extra = ['cap'].flatMap(k => (f.get(k) ? [`--${k}=${f.get(k)}`] : []));
        say(`[run-gate] hand-off on ${m}, gate ${age.toFixed(1)} min old${f.has('no-login') ? '; --no-login: SCORED is not logged in, run.ts logs it in' : ''}`);
        const r = await remote(m, ['handoff', `--scored-env=${env}`, ...extra, ...pass], { checkout, stamp, bound: '12m', log });
        say(`[run-gate] hand-off on ${m}: ${r.code === 0 ? 'PASS' : `STOPPED (exit ${r.code})`}`);
        return r.code;
    }

    if (cmd === 'choice') {
        const file = f.get('choice') ?? join(logDir, 'choice.json');
        console.log(readFileSync(file, 'utf8'));
        return 0;
    }
    throw new Stop(`usage: run-gate.ts up|gate|handoff [--no-login] (see the header), or on-machine up|gate|handoff on a machine; not ${cmd ?? '(nothing)'}`);
}

if (import.meta.main) {
    const argv = process.argv.slice(2);
    const run = argv[0] === 'on-machine' ? onMachine(argv.slice(1)) : mac(argv);
    run.then(
        code => process.exit(code),
        e => {
            if (e instanceof Stop) {
                console.log(`STOP: ${e.message}`);
                process.exit(e.code);
            }
            console.log(`STOP: ${e instanceof Error ? e.message : String(e)}`);
            process.exit(2);
        }
    );
}
