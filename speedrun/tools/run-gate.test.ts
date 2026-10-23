import { describe, expect, test } from 'bun:test';
import {
    botClientWindows, checkAccount, choiceLine, choose, DEFAULT_PREFER, forwarded, gateLabel, handoffSteps, gateRow, gateScrub, locsLine, loopsSummary, type Machine, type MachineGate,
    machineVerdict, oneWindowProblem, parseClaimStatus, parseDirectJson, parsePrefer, readLocs, relabel, remoteLine, type ScenePoll, sceneLine, shq, sshArgv,
    type StateLook, Stop, tileLine, tileRead, watchScene,
} from './run-gate';

const TREE = `
xwininfo: Window id: 0x3b8 (the root window) (has no name)

  Root window id: 0x3b8 (the root window) (has no name)
  Parent window id: 0x0 (none)
     12 children:
     0x1400003 "xfce4-panel": ("xfce4-panel" "Xfce4-panel")  1920x51+0+0  +0+0
     0x2a00001 (has no name): ()  1920x1080+0+0  +0+0
        0x2600004 "2004Scape Bot Client": ("google-chrome (/home/ubuntu/rs-run/chrome-profile)" "Google-chrome")  1920x1029+0+0  +0+51
     0x2600001 "google-chrome": ("google-chrome" "Google-chrome")  10x10+10+10  +10+10
`;

const gate = (over: Partial<MachineGate>): MachineGate => ({
    machine: 'm', startedUtc: '2026-10-23T01:00:00Z', endUtc: '2026-10-23T01:09:00Z', status: 'pass',
    a: { onTime: 60, trials: 60, passAt: 60, floorAt: 58 }, b: { p90: 380, T: 300, limit: 400 }, c: { perMinute: 0, T: 300 }, d: { lowest: 70, median: 72, highest: 73, samples: 30 },
    players: 1600, gateLogout: 'confirmed', failures: [], scene: null, locs: null, tile: null, ...over,
});

describe('windows on the recorded display', () => {
    test('the Bot Client window and its size, not the panel or Chrome helper windows', () => {
        expect(botClientWindows(TREE)).toEqual([{ id: '0x2600004', name: '2004Scape Bot Client', width: 1920, height: 1029 }]);
        expect(oneWindowProblem(botClientWindows(TREE))).toBeNull();
    });
    test('two windows (the gate tab left up) or none fail ruling 3', () => {
        const two = TREE + '        0x2700004 "2004Scape Bot Client": ("google-chrome" "Google-chrome")  1920x1029+0+0  +0+51\n';
        expect(oneWindowProblem(botClientWindows(two))).toContain('2 Bot Client windows');
        expect(oneWindowProblem([])).toContain('0 Bot Client windows');
    });
    test('a window not maximised fails', () => {
        expect(oneWindowProblem([{ id: '0x1', name: '2004Scape Bot Client', width: 1280, height: 800 }])).toContain('not 1920 wide');
    });
    test('a page title with a quote in it still parses', () => {
        expect(botClientWindows('  0x5 "a \\"b\\" Bot Client": ("c" "C")  1920x1029+0+0  +0+51')).toHaveLength(1);
    });
});

describe('the gate verdict', () => {
    const direct = (onTime: number, catchUps: number) => ({ onTime, trials: 60, steadiness: { p90: 380, catchUpsPerMinute: catchUps, T: 300, TSource: 'feed' as const }, players: 1600, logoutOk: true });
    test('(d) as runhost-loops summarises it', () => {
        expect(loopsSummary([{ loopsP10: 72 }, { loopsP10: 70.6 }, { loopsP10: null }, { loopsP10: 73.3 }, { loopsP10: 71 }])).toEqual({ lowest: 70.6, median: 71, highest: 73.3, samples: 4 });
        expect(loopsSummary([])).toBeNull();
    });
    test('pass, marginal, re-measure on (c), fail on (a)', () => {
        const d = { lowest: 70, median: 72, highest: 73, samples: 30 };
        expect(machineVerdict(direct(60, 0), d).status).toBe('pass');
        expect(machineVerdict(direct(58, 1), d).status).toBe('marginal');
        expect(machineVerdict(direct(60, 3), d).status).toBe('re-measure');
        expect(machineVerdict(direct(55, 0), d).status).toBe('fail');
    });
    test('(d): lowest under 50 with the median above re-measures; the median under 50 fails; unmeasured never passes', () => {
        expect(machineVerdict(direct(60, 0), { lowest: 48, median: 70, highest: 72, samples: 30 })).toMatchObject({ status: 're-measure' });
        expect(machineVerdict(direct(60, 0), { lowest: 30, median: 45, highest: 60, samples: 30 }).status).toBe('fail');
        expect(machineVerdict(direct(60, 0), null)).toMatchObject({ status: 'fail', failures: ['(d) not measured'] });
        expect(machineVerdict(direct(60, 0), null, { requireLoops: false }).status).toBe('pass');
    });
    test('the direct CLI json', () => {
        const j = JSON.stringify({ vantage: { players: 1700 }, T: 400, TSource: 'feed', result: { onTime: 59, trials: 60, steadiness: { p90: 390, catchUpsPerMinute: 1, T: 400, TSource: 'feed' } }, logout: { ok: true } });
        expect(parseDirectJson(j)).toEqual({ onTime: 59, trials: 60, steadiness: { p90: 390, catchUpsPerMinute: 1, T: 400, TSource: 'feed' }, players: 1700, logoutOk: true });
        // a file written before T: (b) has no line, (c) still reads
        const old = parseDirectJson(JSON.stringify({ result: { onTime: 60, trials: 60, steadiness: { p90: 390, catchUpsPerMinute: 0 } } }));
        expect(old.steadiness).toEqual({ p90: 390, catchUpsPerMinute: 0, T: null, TSource: null });
        expect(machineVerdict(old, null, { requireLoops: false }).verdict.checks.map(c => c.ok)).toEqual([true, null, true, null]);
        expect(() => parseDirectJson('{}')).toThrow('no probe result');
    });
    test('a row names (a)-(d), the status, the gate logout and the report-only scene, locs and tile', () => {
        const row = gateRow('twin', gate({ gateLogout: 'unconfirmed' }));
        for (const s of ['01:00Z', '(a) 60/60', '(b) p90 380 ms', '(c) 0/min', '(d) p10 70 / 72 / 73', 'pass', 'gate logout unconfirmed', 'report only: scene -, locs -, tile -']) expect(row).toContain(s);
        expect(row).toContain('(b) p90 380 ms (T 300, report <= 400)');
        expect(row).toContain('(c) 0/min (< 150 after > 350 ms)');
        const at400 = gateRow('twin', gate({ b: { p90: 447, T: 400, limit: 533.3 }, c: { perMinute: 0, T: 400 } }));
        expect(at400).toContain('(b) p90 447 ms (T 400, report <= 533)');
        expect(at400).toContain('(c) 0/min (< 200 after > 467 ms)');
        expect(gateRow('run', null)).toContain('not gated');
        const read = gate({
            scene: { inGame: { tick: 0, s: 4.2 }, built: { tick: 3, s: 4.4, firstLook: false }, last: { sceneState: 2, tick: 3 }, looks: 12, waitedS: 4.4 },
            locs: { look: { tick: 4, sceneReady: true, locs: 89, npcs: 20, players: 97, tile: { x: 3222, z: 3218, level: 0 } }, waitedS: 0.5 },
            tile: tileRead({ x: 3222, z: 3218, level: 0 }),
        });
        expect(gateRow('twin', read)).toContain('report only: scene t3, locs 89, tile at spawn');
        expect(gateRow('twin', gate({ scene: { inGame: { tick: 0, s: 4 }, built: { tick: 2, s: 4, firstLook: true }, last: null, looks: 1, waitedS: 4 }, tile: tileRead({ x: 3185, z: 3436, level: 0 }) }))).toContain(
            'scene <=t2, locs -, tile 218 from spawn'
        );
    });
});

describe('choosing the machine (RUN-HOST.md step 5a.2)', () => {
    const marginal = (): MachineGate[] => [
        gate({ status: 'marginal', a: { onTime: 59, trials: 60, passAt: 60, floorAt: 58 } }),
        gate({ c: { perMinute: 2, T: 300 } }),
        gate({ d: { lowest: 55, median: 70, highest: 72, samples: 30 } }),
    ];
    const pair = (prefer: Machine, p: MachineGate | null, o: MachineGate | null) => (prefer === 'twin' ? { twin: p, run: o } : { run: p, twin: o });

    test('the twin is preferred by default (main, 10:4x PDT 2026-10-22); --prefer overrides it', () => {
        expect(DEFAULT_PREFER).toBe('twin');
        expect(choose({ run: gate({}), twin: gate({}) })).toMatchObject({ machine: 'twin', prefer: 'twin', tiebreak: false });
        expect(parsePrefer(undefined)).toBe('twin');
        expect(parsePrefer('run')).toBe('run');
        expect(() => parsePrefer('both')).toThrow(Stop);
    });

    for (const prefer of ['twin', 'run'] as const) {
        const other = prefer === 'twin' ? 'run' : 'twin';
        describe(`--prefer=${prefer}`, () => {
            test('both pass: the preferred machine', () => {
                const c = choose(pair(prefer, gate({}), gate({})), prefer);
                expect(c).toEqual({ machine: prefer, prefer, tiebreak: false, reason: `both pass: the preferred machine, ${prefer}` });
            });
            test('both pass, the preferred one at the margin and the other clean: the tiebreak picks the other', () => {
                for (const p of marginal()) {
                    const c = choose(pair(prefer, p, gate({ c: { perMinute: 1, T: 300 } })), prefer);
                    expect(c).toMatchObject({ machine: other, prefer, tiebreak: true });
                    expect(choiceLine(c)).toStartWith(`chosen: ${other} (tiebreak: preferred ${prefer} passed only at the margin: (`);
                    expect(choiceLine(c)).toEndWith(`; ${other} read clean)`);
                }
            });
            test('the preferred one at the margin but the other not clearly better: the preferred machine', () => {
                const p = gate({ c: { perMinute: 2, T: 300 } });
                for (const o of [gate({ c: { perMinute: 2, T: 300 } }), gate({ status: 'marginal', a: { onTime: 59, trials: 60, passAt: 60, floorAt: 58 } })]) {
                    const c = choose(pair(prefer, p, o), prefer);
                    expect(c).toMatchObject({ machine: prefer, tiebreak: false });
                    expect(c.reason).toContain(`preferred ${prefer} at the margin ((c) 2/min) but ${other} not clearly better`);
                }
            });
            test('the other at the margin and the preferred clean: still the preferred machine', () => {
                expect(choose(pair(prefer, gate({}), gate({ c: { perMinute: 2, T: 300 } })), prefer)).toMatchObject({ machine: prefer, tiebreak: false });
            });
            test('only the preferred passes: it; only the other passes: the other', () => {
                expect(choose(pair(prefer, gate({}), gate({ status: 're-measure' })), prefer)).toMatchObject({ machine: prefer, tiebreak: false });
                expect(choose(pair(prefer, gate({}), null), prefer).reason).toContain(`${other} not gated`);
                const c = choose(pair(prefer, gate({ status: 'fail', failures: ['on time 51/60'] }), gate({})), prefer);
                expect(c).toMatchObject({ machine: other, tiebreak: false });
                expect(c.reason).toContain(`${prefer} fail (on time 51/60)`);
                expect(choose(pair(prefer, null, gate({})), prefer).machine).toBe(other);
            });
            test('neither passes: no start, with both reasons', () => {
                const none = choose(pair(prefer, gate({ status: 're-measure', failures: ['overrun'] }), null), prefer);
                expect(none).toMatchObject({ machine: null, prefer, tiebreak: false });
                expect(none.reason).toContain(`${prefer} re-measure (overrun)`);
                expect(none.reason).toContain(`${other} not gated`);
                expect(choiceLine(none)).toStartWith('chosen: NONE (no machine passes: ');
            });
        });
    }
});

describe('the claim lock and the login count', () => {
    test('a live claim with the count', () => {
        expect(parseClaimStatus('rs/247 logins=2 until=2026-10-22T03:50:00Z (live) : run-gate rehearsal\n58 of ours online of 1695\n')).toEqual({ free: false, owner: 'rs/247', live: true, preempted: false, ours: 58 });
    });
    test('free, stale, preempted, no count', () => {
        expect(parseClaimStatus('free\n58 of ours online of 1695')).toMatchObject({ free: true, live: false, ours: 58 });
        expect(parseClaimStatus('rs/1 logins=2 until=2026-10-22T01:00:00Z (STALE)\nlogin count unavailable (x)')).toMatchObject({ live: false, ours: null });
        expect(parseClaimStatus('host logins=1 until=2026-10-22T09:00:00Z (live) starts=2026-10-22T03:00:00Z : scored run\n  PREEMPTED rs/2: log out and release by x\n3 of ours online of 9').preempted).toBe(true);
    });
});

describe('names, quoting and the ssh line', () => {
    test('SCORED is relabelled in both of its forms', () => {
        expect(relabel('[tab-login] cairn_s247: in game; Cairn s247 front', 'cairn_s247', 'SCORED')).toBe('[tab-login] SCORED: in game; SCORED front');
        expect(relabel('x', null, 'SCORED')).toBe('x');
    });
    test('no gate account name survives in any line shape the gate prints or writes', () => {
        // The twin's name contains the run host's, so the longer one must be replaced first.
        const run = 'cairn_g440';
        const twin = 'cairn_g4401';
        const g = gate({ failures: [`(d) not measured: tab-login exited 1 for ${run}`] });
        const shapes = [
            `[step] 17:20:00Z preconditions: claim live, stack up, no tab on :10, gate timer inactive, gate account ${run}`,
            `[step] 17:20:01Z (a)-(c): tickmanip-latency.ts ${run} --path=direct --no-tele (bound 15m)`,
            `  vantage: edge iad, app iad, mesh hop none, TCP connect p50 1.2 ms (20 samples), 1650 online`,
            `  [direct] ${run}: logged in at 3222,3218`,
            `  logout (direct): ${run} logged out after 2 ticks`,
            `  [tab-login] ${run}: tab reloaded with a one-time token`,
            `  [tab-login] ${run}: in game after 4.6 s`,
            `  Cairn G440 is already logged in`,
            `  Cairn g4401: welcome to RuneScape`,
            `[gate] 17:21:00Z scene (report only): sceneState 2 at page tick 4, 5.1 s after tab-login started, 0.4 s after in game (tick 0)`,
            `[step] 17:21:02Z (d): runhost-loops.ts ${run} --minutes=5 (bound 10m)`,
            `  runhost-loops: gate, host h (8 cpus), display :10, bot ${run}`,
            `  logged out; the page is out of game`,
            `  not confirmed: ${run} still in game after timeout`,
            `[step] 17:27:00Z gate logout: NOT CONFIRMED (exit 1); the window is killed anyway`,
            `STOP: (d) not measured: no bot.env at bots/${run}/bot.env`,
            `STOP: (a)-(c) re-measure: catch-ups 3/min over the line of 2; (d) not measured`,
            `GATE-RESULT ${JSON.stringify(g)}`,
            JSON.stringify(g, null, 2),
            JSON.stringify({ account: run, result: { onTime: 60 } }, null, 2),
            `${JSON.stringify({ label: 'gate', bot: run, loopsP10: 71 })}\n${JSON.stringify({ label: 'gate', bot: run, loopsP10: 72 })}`,
            JSON.stringify({ prefer: 'twin', gates: { run: g, twin: { ...g, failures: [`${twin} ${twin.toUpperCase()}`] } }, choice: { machine: 'twin' } }, null, 2),
        ];
        const scrub = gateScrub({ run, twin });
        for (const raw of shapes) {
            for (const [one, label] of [[scrub, null], [(s: string) => relabel(s, run, gateLabel('run')), 'GATE-run']] as const) {
                const out = one(raw);
                expect(out.toLowerCase()).not.toContain('g440');
                if (label && raw.toLowerCase().includes('g440') && !raw.toLowerCase().includes('g4401')) expect(out).toContain(label);
            }
            // [run] / [twin] prefixed, as the Mac prints and logs them.
            expect(scrub(`[twin] ${raw}`).toLowerCase()).not.toContain('g440');
        }
        expect(scrub(`${twin} then ${run}, Cairn g4401 and Cairn G440`)).toBe('GATE-twin then GATE-run, GATE-twin and GATE-run');
        expect(JSON.parse(scrub(JSON.stringify(g))).failures).toEqual(['(d) not measured: tab-login exited 1 for GATE-run']);
        expect(gateLabel(null)).toBe('GATE');
        expect(gateScrub({})('cairn_g440')).toBe('cairn_g440');
    });
    test('account names are checked before they reach a shell', () => {
        expect(checkAccount('cairn_g247', 'a')).toBe('cairn_g247');
        expect(() => checkAccount('a;rm -rf', 'a')).toThrow(Stop);
        expect(shq("it's")).toBe(`'it'\\''s'`);
    });
    test('the ssh argv takes the address only from the environment', () => {
        expect(() => sshArgv('twin', {})).toThrow('RS_TWIN_HOST');
        const a = sshArgv('twin', { RS_TWIN_HOST: 'twin.example' }, '/h');
        expect(a).toContain('/h/.rs-fleet/id_ed25519_rehearsal');
        expect(a).toContain('UserKnownHostsFile=/h/.rs-fleet/known_hosts_rehearsal');
        expect(a.at(-1)).toBe('ubuntu@twin.example');
        expect(sshArgv('run', { RS_RUN_HOST: 'run.example' }, '/h')).toContain('/h/.rs-fleet/id_ed25519_ashburn');
    });
    test('the remote line detaches the command under its bound and follows its log', () => {
        const l = remoteLine('rs247/rs-sdk', '20261022T030000Z', '40m', ['gate', '--gate=cairn_g247']);
        expect(l).toContain('cd "$HOME"/rs247/rs-sdk');
        expect(l).toContain("nohup timeout --kill-after=30s 40m \"$HOME\"/.bun/bin/bun speedrun/tools/run-gate.ts on-machine 'gate' '--gate=cairn_g247' --out=\"$D\"");
        expect(l).toContain('tail --pid=$P -n +1 -f "$D"/steps.log; wait $P;');
        expect(() => remoteLine('/etc', 's', '1m', [])).toThrow(Stop);
        expect(() => remoteLine('../x', 's', '1m', [])).toThrow(Stop);
    });
});

describe('handoff --no-login (SCORED is logged in once, by run.ts)', () => {
    const argv = ['--machine=twin', '--scored-env=bots/x/bot.env', '--rehearsal', '--claim=rs/601', '--display=:11'];
    test('the Mac forwards --no-login to the on-machine handoff, and only for handoff', () => {
        expect(forwarded('handoff', [...argv, '--no-login'])).toEqual(['--display=:11', '--claim=rs/601', '--rehearsal', '--no-login']);
        expect(forwarded('handoff', argv)).toEqual(['--display=:11', '--claim=rs/601', '--rehearsal']);
        expect(forwarded('gate', [...argv, '--no-login'])).not.toContain('--no-login');
        expect(forwarded('up', [...argv, '--no-login'])).not.toContain('--no-login');
        expect(remoteLine('rs-sdk', 's', '12m', ['handoff', '--scored-env=e', ...forwarded('handoff', [...argv, '--no-login'])])).toContain("'--no-login'");
    });
    test('--no-login stops at the bare page and checks the served bundle; the default logs in', () => {
        const before = ['claim', 'preconditions', 'display', 'recording', 'login count', 'tab', 'chrome flags', 'one window', 'title frame'];
        expect(handoffSteps({ noLogin: true })).toEqual([...before, 'served bundle']);
        expect(handoffSteps({ noLogin: false })).toEqual([...before, 'login', 'secrets', 'one window after login', 'in-game frame']);
    });
});

/** A clock the watchers sleep on without waiting. */
const fakeClock = () => {
    let t = 1_000_000;
    return { now: () => t, sleep: async (ms: number) => void (t += ms), advance: (ms: number) => void (t += ms) };
};

describe("the gate tab's scene, locs and tile (report only)", () => {
    const looks = (seq: Array<ScenePoll | null | 'throw'>) => {
        let i = 0;
        return async () => {
            const v = seq[Math.min(i++, seq.length - 1)];
            if (v === 'throw') throw new Error('navigating');
            return v ?? null;
        };
    };
    const title: ScenePoll = { inGame: false, sceneState: 0, tick: 0 };
    const loading = (tick: number): ScenePoll => ({ inGame: true, sceneState: 1, tick });
    const built = (tick: number): ScenePoll => ({ inGame: true, sceneState: 2, tick });

    test('cold: the page enters the world, then builds the scene at its own tick', async () => {
        const clock = fakeClock();
        const r = await watchScene(looks([title, 'throw', title, loading(0), loading(1), loading(40), built(83)]), { stopped: () => false, clock, everyMs: 250 });
        expect(r.inGame).toEqual({ tick: 0, s: 0.8 });
        expect(r.built).toEqual({ tick: 83, s: 1.5, firstLook: false });
        expect(sceneLine(r)).toBe(
            'scene (report only): sceneState 2 at page tick 83, 1.5 s after tab-login started, 0.7 s after in game (tick 0); bbs reference: warm 3-4 ticks, cold 73-83 at a busy site'
        );
    });
    test('warm: already built at the first in-game look reads as "by" that tick', async () => {
        const r = await watchScene(looks([title, built(2)]), { stopped: () => false, clock: fakeClock() });
        expect(r.built).toMatchObject({ tick: 2, firstLook: true });
        expect(sceneLine(r)).toStartWith('scene (report only): sceneState 2 by page tick 2 (already built at the first in-game look), 0.3 s after tab-login started;');
    });
    test('not built within its bound after in game; never in game; a failed login stops the watch', async () => {
        const notBuilt = await watchScene(looks([title, loading(0), loading(5)]), { stopped: () => false, clock: fakeClock(), everyMs: 1_000, afterInGameMs: 10_000 });
        expect(notBuilt.built).toBeNull();
        expect(sceneLine(notBuilt)).toStartWith('scene (report only): NOT built 10 s after in game (tick 0): sceneState 1 at page tick 5;');
        const never = await watchScene(looks([title]), { stopped: () => false, clock: fakeClock(), everyMs: 1_000, limitMs: 5_000 });
        expect(sceneLine(never)).toBe('scene (report only): not read: the page never reported in game (6 looks over 5 s)');
        let stop = false;
        const seq = looks([title, title, title]);
        const stopped = await watchScene(async () => ((stop = true), seq()), { stopped: () => stop, clock: fakeClock() });
        expect(stopped.looks).toBe(1);
        expect(sceneLine(null, 'the login failed')).toBe('scene (report only): not read: the login failed');
    });

    const state = (locs: number, tick: number): StateLook => ({ tick, sceneReady: true, locs, npcs: 20, players: 97, tile: { x: 3222, z: 3218, level: 0 } });
    test('locs: the first SDK state with any, or 0 after the wait', async () => {
        let i = 0;
        const seq = [state(0, 3), state(89, 4)];
        const r = await readLocs(async () => seq[Math.min(i++, 1)]!, { clock: fakeClock() });
        expect(r.look?.locs).toBe(89);
        expect(locsLine(r)).toBe('locs (report only): 89 locs at page tick 4 (20 NPCs, 97 players nearby); > 0 expected');
        const none = await readLocs(async () => state(0, 9), { clock: fakeClock(), waitMs: 10_000, everyMs: 500 });
        expect(locsLine(none)).toBe('locs (report only): 0 locs for 10 s after the scene was built, last at page tick 9 (20 NPCs, 97 players nearby); > 0 expected: the tab sees no scenery');
        const err = await readLocs(async () => {
            throw new Error('page threw: x');
        }, { clock: fakeClock(), waitMs: 1_000 });
        expect(locsLine(err)).toBe('locs (report only): not read: page threw: x');
        expect(locsLine(null, 'the scene was not built')).toBe('locs (report only): not read: the scene was not built');
    });
    test('tile: at Lumbridge spawn within 5 tiles on its level, else how far', () => {
        expect(tileRead({ x: 3222, z: 3218, level: 0 })).toEqual({ x: 3222, z: 3218, level: 0, fromSpawn: 0, atSpawn: true });
        expect(tileRead({ x: 3227, z: 3214, level: 0 })).toMatchObject({ fromSpawn: 5, atSpawn: true });
        expect(tileRead({ x: 3228, z: 3218, level: 0 })).toMatchObject({ fromSpawn: 6, atSpawn: false });
        expect(tileRead({ x: 3222, z: 3218, level: 1 })).toMatchObject({ fromSpawn: null, atSpawn: false });
        expect(tileLine(tileRead({ x: 3221, z: 3219, level: 0 }))).toBe('tile (report only): (3221, 3219, level 0): at Lumbridge spawn (3222, 3218, level 0), 1 tile from it');
        expect(tileLine(tileRead({ x: 3185, z: 3436, level: 0 }))).toBe('tile (report only): (3185, 3436, level 0): 218 tiles from Lumbridge spawn (3222, 3218, level 0)');
        expect(tileLine(tileRead({ x: 3205, z: 3209, level: 2 }))).toBe("tile (report only): (3205, 3209, level 2): on level 2, not Lumbridge spawn (3222, 3218, level 0)'s level");
        expect(tileLine(null, 'the scene was not built')).toBe('tile (report only): not read: the scene was not built');
    });
});
