import { describe, expect, test } from 'bun:test';
import {
    botClientWindows, checkAccount, choose, gateRow, loopsSummary, type MachineGate, machineVerdict, oneWindowProblem, parseClaimStatus, parseDirectJson,
    relabel, remoteLine, shq, sshArgv, Stop,
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
    a: { onTime: 60, trials: 60, passAt: 60, floorAt: 58 }, b: { p90: 380 }, c: { perMinute: 0 }, d: { lowest: 70, median: 72, highest: 73, samples: 30 },
    players: 1600, gateLogout: 'confirmed', failures: [], ...over,
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
    const direct = (onTime: number, catchUps: number) => ({ onTime, trials: 60, steadiness: { p90: 380, catchUpsPerMinute: catchUps }, players: 1600, logoutOk: true });
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
        const j = JSON.stringify({ vantage: { players: 1700 }, result: { onTime: 59, trials: 60, steadiness: { p90: 390, catchUpsPerMinute: 1 } }, logout: { ok: true } });
        expect(parseDirectJson(j)).toEqual({ onTime: 59, trials: 60, steadiness: { p90: 390, catchUpsPerMinute: 1 }, players: 1700, logoutOk: true });
        expect(() => parseDirectJson('{}')).toThrow('no probe result');
    });
    test('a row names (a)-(d), the status and the gate logout', () => {
        const row = gateRow('twin', gate({ gateLogout: 'unconfirmed' }));
        for (const s of ['01:00Z', '(a) 60/60', '(b) p90 380 ms', '(c) 0/min', '(d) p10 70 / 72 / 73', 'pass', 'gate logout unconfirmed']) expect(row).toContain(s);
        expect(gateRow('run', null)).toContain('not gated');
    });
});

describe('choosing the machine (RUN-HOST.md step 5a.2)', () => {
    test('both pass: the run host', () => {
        expect(choose({ run: gate({}), twin: gate({}) }).machine).toBe('run');
    });
    test('both pass, the run host at the margin and the twin clean: the twin', () => {
        for (const run of [gate({ status: 'marginal', a: { onTime: 59, trials: 60, passAt: 60, floorAt: 58 } }), gate({ c: { perMinute: 2 } }), gate({ d: { lowest: 55, median: 70, highest: 72, samples: 30 } })]) {
            expect(choose({ run, twin: gate({ c: { perMinute: 1 } }) }).machine).toBe('twin');
        }
    });
    test('the run host at the margin but the twin not clearly better: the run host', () => {
        const run = gate({ c: { perMinute: 2 } });
        expect(choose({ run, twin: gate({ c: { perMinute: 2 } }) }).machine).toBe('run');
        expect(choose({ run, twin: gate({ status: 'marginal', a: { onTime: 59, trials: 60, passAt: 60, floorAt: 58 } }) }).machine).toBe('run');
    });
    test('one passes: that one; none: no start, with both reasons', () => {
        expect(choose({ run: gate({ status: 'fail', failures: ['on time 51/60'] }), twin: gate({}) }).machine).toBe('twin');
        expect(choose({ run: gate({}), twin: gate({ status: 're-measure' }) }).machine).toBe('run');
        const none = choose({ run: gate({ status: 're-measure', failures: ['overrun'] }), twin: null });
        expect(none.machine).toBeNull();
        expect(none.reason).toContain('run re-measure (overrun)');
        expect(none.reason).toContain('twin not gated');
    });
    test('a twin-only gate can choose the twin', () => {
        expect(choose({ twin: gate({}) }).machine).toBe('twin');
    });
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
