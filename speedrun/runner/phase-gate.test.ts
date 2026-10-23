import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildChain, KIT_PARTNER_ROWS, PLACEMENT } from './chain';
import { judgeStatus, membersFromLauncher, PHASE_STEPS, phaseGates, STALE_MS, statusFileName, type PhaseMember } from './phase-gate';
import { configMembers, hostPhaseGates, startGates, type GateIO } from '../run';
import { S07_SITES } from '../helpers/bone-giver';
import { tickPreflight } from '../lib/feed-hello';

const now = 1_800_000_000_000;
const oak = S07_SITES[0]!.giver;
const bone = (o: Record<string, unknown> = {}) => ({ v: 1, account: 'cairn_b01', phase: 'waiting', held: 23, n: 23, trades: 0, bounces: 0, tile: { ...oak, level: 0 }, readyAt: now - 5000, session: null, final: false, loads: null, ms: now - 1000, ...o });

describe('judgeStatus: ready by role phase, not by being online', () => {
    test('a bone giver waiting loaded on a site giver tile passes', () => {
        expect(judgeStatus('bone', bone(), { now })).toEqual({ ok: true, detail: 'waiting on site 0 (2913,3494), 23 held, ready 5 s' });
    });
    test("attempt 2's bone givers: 'travel' between sites refuses, whatever the launcher says", () => {
        const j = judgeStatus('bone', bone({ phase: 'travel', readyAt: null, detail: 'site 1', tile: { x: 2919, z: 3407, level: 0 } }), { now });
        expect(j).toEqual({ ok: false, detail: 'phase travel, not waiting (site 1)' });
    });
    test('a fault refuses, with its reason', () => {
        expect(judgeStatus('bone', bone({ phase: 'fault', readyAt: null, detail: 'Error: could not stand on 2920,3407' }), { now })).toEqual({ ok: false, detail: 'phase fault, not waiting (Error: could not stand on 2920,3407)' });
    });
    test('a stale status refuses even when it says waiting: its writer is gone', () => {
        const j = judgeStatus('bone', bone({ ms: now - STALE_MS - 1000 }), { now });
        expect(j.ok).toBe(false);
        expect(j.detail).toBe('stale: last written 31 s ago, phase waiting');
    });
    test('waiting is not enough: readyAt set, bones held, and on a site giver tile (the giver\'s own sites when given)', () => {
        expect(judgeStatus('bone', bone({ readyAt: null }), { now }).ok).toBe(false);
        expect(judgeStatus('bone', bone({ held: 0 }), { now }).ok).toBe(false);
        const off = judgeStatus('bone', bone({ tile: { x: 2920, z: 3407, level: 0 } }), { now, sites: [S07_SITES[0]!, { giver: { x: 2920, z: 3405 }, receiver: { x: 2920, z: 3406 } }] });
        expect(off).toEqual({ ok: false, detail: "waiting at (2920,3407), not on a site's giver tile ((2913,3494), (2920,3405))" });
        expect(judgeStatus('bone', bone({ tile: { x: 2920, z: 3405, level: 0 } }), { now, sites: [S07_SITES[0]!, { giver: { x: 2920, z: 3405 }, receiver: { x: 2920, z: 3406 } }] }).ok).toBe(true);
    });
    test('no file, or a file without a heartbeat, refuses', () => {
        expect(judgeStatus('bone', null, { now })).toEqual({ ok: false, detail: 'no status file' });
        expect(judgeStatus('bone', { phase: 'waiting' }, { now }).ok).toBe(false);
    });
    test('altar givers: ready or armed with readyAt; restock, travel, fault refuse', () => {
        const g = (o: Record<string, unknown>) => ({ v: 2, account: 'cairn_h70', phase: 'ready', readyAt: now - 2000, tile: { x: 2841, z: 4829, level: 0 }, ms: now - 500, ...o });
        expect(judgeStatus('altar', g({}), { now }).ok).toBe(true);
        expect(judgeStatus('altar', g({ phase: 'armed' }), { now }).ok).toBe(true);
        for (const phase of ['restock', 'travel', 'fault', 'start', 'off']) expect(judgeStatus('altar', g({ phase, readyAt: null }), { now }).ok).toBe(false);
        expect(judgeStatus('altar', g({ ms: now - 60_000 }), { now }).ok).toBe(false);
    });
    test('the anvil helper: waiting passes; travel, restock and fault refuse', () => {
        const a = (phase: string) => ({ v: 1, account: 'cairn_a', phase, tile: { x: 1, z: 2 }, trades: 0, delivered: null, ms: now });
        expect(judgeStatus('anvil', a('waiting'), { now }).ok).toBe(true);
        for (const p of ['travel', 'restock', 'fault']) expect(judgeStatus('anvil', a(p), { now }).ok).toBe(false);
    });
    test("the S18 courier: its idle loop publishes 'travel' by its waiting tile; loaded there passes, far off or faulted refuses", () => {
        const sites = [{ giver: { x: 2655, z: 3300 }, receiver: { x: 2655, z: 3301 } }];
        const c = (o: Record<string, unknown>) => bone({ account: 'cairn_c', phase: 'travel', detail: 'to the scored account', readyAt: null, held: 28, tile: { x: 2656, z: 3301, level: 0 }, ...o });
        expect(judgeStatus('courier', c({}), { now, sites }).ok).toBe(true);
        expect(judgeStatus('courier', c({ tile: { x: 2670, z: 3301, level: 0 } }), { now, sites }).ok).toBe(false);
        expect(judgeStatus('courier', c({ phase: 'fault' }), { now, sites }).ok).toBe(false);
        expect(judgeStatus('courier', c({ phase: 'restock' }), { now, sites }).ok).toBe(false);
    });
});

describe('phaseGates: the next helper step refuses, every later family is reported', () => {
    const group = ['cairn_b01', 'cairn_b02', 'cairn_b03', 'cairn_b04'];
    const members: PhaseMember[] = [...group.map(account => ({ account, scope: { step: 'S07', family: 'bone' as const } })), { account: 'cairn_c', scope: { step: 'S18', family: 'courier' } }, { account: 'cairn_a', scope: { step: 'S25a', family: 'anvil' } }];
    const files = (by: Record<string, unknown>) => (f: string) => by[f] ?? null;
    const allWaiting = Object.fromEntries(group.map(a => [statusFileName('bones', a), bone({ account: a })]));
    const path = ['S07', 'T07-08', 'S18', 'S25a'];

    test('S07 next: one line per giver file, all waiting passes; the later families are reported, not refused', () => {
        const g = phaseGates({ path, members, read: files(allWaiting), launcher: null, now, source: 'helpers.json' });
        expect(g.filter(x => x.gate.startsWith('role phase S07/bone')).map(x => [x.gate, x.ok])).toEqual(group.map(a => [`role phase S07/bone ${a}`, true]));
        expect(g.every(x => x.ok)).toBe(true);
        expect(g.find(x => x.gate === 'role phase S18/courier cairn_c')!.detail).toBe('bones-cairn_c.json: no status file (reported: not the next helper step, not refused)');
        expect(g.find(x => x.gate === 'role phase S25a/anvil cairn_a')!.ok).toBe(true);
    });
    test('one giver travelling, one stale, one faulted: each refuses on its own line', () => {
        const by = { ...allWaiting, [statusFileName('bones', 'cairn_b02')]: bone({ account: 'cairn_b02', phase: 'travel', readyAt: null }), [statusFileName('bones', 'cairn_b03')]: bone({ account: 'cairn_b03', ms: now - 120_000 }), [statusFileName('bones', 'cairn_b04')]: bone({ account: 'cairn_b04', phase: 'fault', readyAt: null }) };
        const g = phaseGates({ path, members, read: files(by), launcher: null, now, source: 'helpers.json' }).filter(x => x.gate.startsWith('role phase S07'));
        expect(g.map(x => x.ok)).toEqual([true, false, false, false]);
        expect(g[1]!.detail).toBe('bones-cairn_b02.json: phase travel, not waiting');
        expect(g[2]!.detail).toStartWith('bones-cairn_b03.json: stale: last written 120 s ago');
    });
    test('online in the launcher does not pass a travelling giver; logged out awaiting its login cue does', () => {
        const by = { ...allWaiting, [statusFileName('bones', 'cairn_b01')]: bone({ phase: 'travel', readyAt: null }) };
        const online = phaseGates({ path, members, read: files(by), launcher: [{ account: 'cairn_b01', state: 'online', cue: null }], now, source: 'x' });
        expect(online.find(x => x.gate.endsWith('cairn_b01'))!.ok).toBe(false);
        const cued = phaseGates({ path, members, read: files(by), launcher: [{ account: 'Cairn B01', state: 'awaiting-cue', cue: { state: 'waiting' } }], now, source: 'x' });
        expect(cued.find(x => x.gate.endsWith('cairn_b01'))).toMatchObject({ ok: true, detail: expect.stringContaining('logged out until its login cue opens') });
    });
    test('a next helper step no launcher entry serves refuses; a later one is reported', () => {
        const g = phaseGates({ path: ['S06', 'S07'], members, read: files(allWaiting), launcher: null, now, source: 'helpers.json' });
        expect(g[0]).toEqual({ gate: 'role phase S06/altar', ok: false, detail: 'no helper serves S06/altar in helpers.json' });
        expect(g.slice(1).every(x => x.ok)).toBe(true);
    });
    test('h45 (S15) and h92 (H11, H23) keep no file on the run machine: reported lines, never refused', () => {
        const g = phaseGates({ path: ['S15', 'H11', 'S14'], members: [], read: () => null, launcher: null, now, source: 'x' });
        expect(g.map(x => [x.gate, x.ok])).toEqual([['role phase H12o h45', true], ['role phase cannon h92', true]]);
    });
    test('a path past every phase step has no lines', () => {
        expect(phaseGates({ path: ['S26', 'S27'], members, read: () => null, launcher: null, now, source: 'x' })).toEqual([]);
    });
});

describe('who serves each step, and the gate on the run machine', () => {
    test('members from the launcher config: each entry\'s options.scope and a bone giver\'s sites; families without a status file left out', () => {
        const sites = [{ giver: { x: 2913, z: 3494 }, receiver: { x: 2914, z: 3494 } }];
        const m = membersFromLauncher({ accounts: [
            { account: 'cairn_b01', role: 'bone-giver', options: { scope: { step: 'S07', family: 'bone' }, sites } },
            { account: 'cairn_h70', role: 'altar-giver', options: { scope: { step: 'S06', family: 'altar' } } },
            { account: 'cairn_mule1', role: 'mule', options: { scope: { step: 'H1', family: 'mule' } } },
            { account: 'cairn_x', role: 'idle', options: {} },
        ] });
        expect(m).toEqual([{ account: 'cairn_b01', scope: { step: 'S07', family: 'bone' }, sites }, { account: 'cairn_h70', scope: { step: 'S06', family: 'altar' } }]);
    });
    test('the run config names the bone group, the courier, the anvil and the S21 roster', () => {
        expect(configMembers({ bones: { group: ['b1', 'b2'] }, courier: { giver: 'c', below: 3 }, anvil: { giver: 'a' }, s21Givers: ['s1'] }).map(m => `${m.account} ${m.scope.step}/${m.scope.family}`)).toEqual(['b1 S07/bone', 'b2 S07/bone', 'c S18/courier', 'a S25a/anvil', 's1 S21/altar']);
    });
    test('every phase step id is a step of the built chain', () => {
        const partners = Object.fromEntries([...Object.keys(PLACEMENT), ...KIT_PARTNER_ROWS].map(id => [id, `p_${id}`]));
        const chain = buildChain({ partners, firemakingTiles: '3240,3296', rings: { giver: 'r' }, bones: { giver: 'b' }, courier: { giver: 'c', below: 3 }, anvil: { giver: 'a' }, cueDir: '/tmp/x' }, { cues: { open: async () => {}, stop: () => {} } });
        const ids = new Set(chain.map(s => s.id));
        for (const id of [...Object.keys(PHASE_STEPS), 'S15']) expect(ids.has(id)).toBe(true);
    });
    test('hostPhaseGates reads the launcher config and the cue dir; startGates prints its lines after helpers ready, and a refusing line refuses', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'phase-'));
        const cueDir = join(dir, 'rc-cue');
        require('node:fs').mkdirSync(cueDir);
        const launcher = join(dir, 'helpers.json');
        writeFileSync(launcher, JSON.stringify({ accounts: [{ account: 'cairn_b01', role: 'bone-giver', options: { scope: { step: 'S07', family: 'bone' } } }] }));
        writeFileSync(join(cueDir, 'bones-cairn_b01.json'), JSON.stringify(bone({ phase: 'travel', readyAt: null, ms: Date.now() })));
        const cfg = { bones: { group: ['cairn_b01', 'cairn_b02'] }, courier: { giver: 'c', below: 3 }, anvil: { giver: 'a' }, cueDir, helperLaunchers: [launcher] } as never;
        const lines = hostPhaseGates(cfg, ['S07'], dir);
        // b02 is only in the run config, but the launcher config names S07/bone, so it is not added.
        expect(lines.map(l => [l.gate, l.ok, l.detail])).toEqual([['role phase S07/bone cairn_b01', false, 'bones-cairn_b01.json: phase travel, not waiting']]);
        writeFileSync(join(cueDir, 'bones-cairn_b01.json'), JSON.stringify(bone({ ms: Date.now(), readyAt: Date.now() - 1000 })));
        expect(hostPhaseGates(cfg, ['S07'], dir)[0]!.ok).toBe(true);
        const io: GateIO = {
            floor: async () => ({ ok: true, floor: 'f', runCommit: 'a'.repeat(40), line: 1, tickMs: { ok: true, tickMs: 400, line: 1 } }),
            tick: async r => tickPreflight({ ok: true, url: 'wss://w/worldfeed', hello: { tickMs: 400, players: 1, tick: 1 }, wallMs: 1 }, r, 400),
            reservation: () => ({ owner: 'o', state: { state: 'live', reservation: { owner: 'o', until: '2099-01-01T00:00:00Z', reason: '' } }, path: '/h' }),
            slotLedger: async () => ({ code: 0, out: '' }),
            helpersReady: () => true,
            cannonServe: () => ({ path: '/c', serve: null }),
            phases: () => [{ gate: 'role phase S07/bone cairn_b01', ok: false, detail: 'bones-cairn_b01.json: phase travel, not waiting' }],
        };
        const g = await startGates([], io);
        const at = g.findIndex(x => x.gate === 'helpers ready');
        expect(g[at + 1]).toEqual({ gate: 'role phase S07/bone cairn_b01', ok: false, detail: 'bones-cairn_b01.json: phase travel, not waiting' });
    });
});
