import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ROOT } from '../lib/session';
import type { TickRow } from '../lib/ticks';
import { buildChain, KIT_PARTNER_ROWS, PLACEMENT } from '../runner/chain';
import { MANIFEST } from '../tools/slot-ledger';
import { benchArgs, benchNames, benchScore, failurePrice, helperFlags, labRunConfig, median, resolveTarget, restartTicks, runMetrics, runOrderCells, tsvRow, TSV_COLUMNS, unservedLiteFamilies, type PlanStep } from './bench-step';
import { familyNeeds, labChain, rehearsalPlan, STAFF, type FamilyNeeds } from './dress-rehearsal';
import type { LabWorld } from './stand-ins';

const runOrder = readFileSync(join(ROOT, 'docs/speedrun/RUN-ORDER.md'), 'utf8');

const step = (id: string, name: string, kind = 'step'): PlanStep => ({ id, name, kind: kind as PlanStep['kind'] });
/** S07's shape on the chain: its bands around the T07a leg, a cue stop, then S08. */
const chain: PlanStep[] = [
    step('T06-07', 'T06-07', 'leg'),
    step('H4k', 'H4k hand-off (supply: staff)', 'handoff'),
    step('S07', 'woodcutting:walk-oaks'),
    step('S07', 'woodcutting:normal-1-15'),
    step('S07', 'woodcutting:oak-15-73'),
    step('T07a', 'T07a', 'leg'),
    step('S07', 'woodcutting:willow-73-99'),
    step('S07', 'cue stop S07', 'cue'),
    step('T07-08', 'T07-08', 'leg'),
    step('S08', 'S08:A-kit'),
    step('S08', 'S08:B-talk'),
];

const row = (step: string, o: Partial<TickRow> = {}): TickRow => ({ v: 1, runId: 'r', account: 'benchabc1', sessionId: 1, step, startTick: 0, endTick: 0, ticks: 0, wallMs: 0, ok: true, tickMs: 150, at: '2026-10-24T18:00:00.000Z', ...o });
const none: FamilyNeeds = { droppers: false, rings: false, altar: false, bones: false, anvil: false, holder: false, wine: false };

describe('benchArgs', () => {
    test("lab.sh's bot comes first and is ignored; both flag forms parse; dress-rehearsal's helper flags pass through", () => {
        const a = benchArgs(['benchlab', 'S12', '--k=3', '--tick-ms', '150', '--stub=stub1', '--client=lite']);
        expect(a).toMatchObject({ target: 'S12', k: 3, tickMs: 150, budgetMin: null, client: 'lite', expected: null, pass: ['--stub=stub1'] });
        expect(benchArgs(['S12']).k).toBe(5);
    });

    test("a step name lab.sh split at its colons rejoins after lab.sh's bot", () => {
        expect(benchArgs(['benchlab', 'woodcutting', 'oak-15-73', '--k=2']).target).toBe('woodcutting:oak-15-73');
        expect(benchArgs(['woodcutting:oak-15-73']).target).toBe('woodcutting:oak-15-73');
    });

    test('refuses an unknown flag, a K the account names cannot carry, and no target', () => {
        expect(() => benchArgs(['S12', '--bot=x'])).toThrow('unknown flag');
        expect(() => benchArgs(['S12', '--k=36'])).toThrow('1 to 35');
        expect(() => benchArgs(['S12', '--k=0'])).toThrow('positive');
        expect(() => benchArgs([])).toThrow('<step>');
    });
});

describe('resolveTarget', () => {
    test("an id is RUN-ORDER's row: its own steps, not the leg between its bands nor its cue stop; staged from its chunk", () => {
        const t = resolveTarget(chain, 'S07');
        expect([...t.names]).toEqual(['woodcutting:walk-oaks', 'woodcutting:normal-1-15', 'woodcutting:oak-15-73', 'woodcutting:willow-73-99']);
        expect(t).toMatchObject({ lastName: 'woodcutting:willow-73-99', ids: ['S07'], band: false, chunk: 'S07', until: 'S07' });
    });

    test("a step name is one band: the bench stages its id's chunk and stops the chain after it", () => {
        const t = resolveTarget(chain, 'woodcutting:oak-15-73');
        expect([...t.names]).toEqual(['woodcutting:oak-15-73']);
        expect(t).toMatchObject({ ids: ['S07'], band: true, chunk: 'S07', until: 'woodcutting:oak-15-73' });
    });

    test('a range is the stretch, its legs included and its cue stops not', () => {
        const t = resolveTarget(chain, 'S07..S08');
        expect([...t.names]).toContain('T07-08');
        expect([...t.names]).not.toContain('cue stop S07');
        expect(t).toMatchObject({ ids: ['S07', 'S08'], lastName: 'S08:B-talk', chunk: 'S07', until: 'S08' });
    });

    test('refuses what is not on the chain, a backwards range, and a leg', () => {
        expect(() => resolveTarget(chain, 'S12')).toThrow('no step of that id');
        expect(() => resolveTarget(chain, 'S08..S07')).toThrow('comes before');
        expect(() => resolveTarget(chain, 'T07a')).toThrow('not a step');
    });

    test("on the real lab chain: S12 is Fight Arena's steps and the oak band one woodcutting step, both from their own chunk", () => {
        const manifest = readFileSync(MANIFEST, 'utf8');
        const partners = Object.fromEntries([...Object.keys(PLACEMENT), ...KIT_PARTNER_ROWS, 'H4m'].map(id => [id, STAFF]));
        const cfg = { ...(labRunConfig() as object), partners, cueDir: '/tmp/x' } as Parameters<typeof buildChain>[0];
        const world = (): LabWorld => ({ staffLevel: '4', server: 'localhost', gateway: 'ws://localhost:8300' });
        const lab = labChain(buildChain(cfg, { cues: { open: async () => {}, stop: () => {} }, manifest }), { manifest, stub: null, world });
        const planned = rehearsalPlan(lab.chain, 0, familyNeeds(lab.chain), [], null).chain;
        const s12 = resolveTarget(planned, 'S12');
        expect(s12.chunk).toBe('S12');
        expect([...s12.names].length).toBeGreaterThan(1);
        expect([...s12.names].every(n => planned.find(s => s.name === n)!.id === 'S12')).toBe(true);
        const oak = resolveTarget(planned, 'woodcutting:oak-15-73');
        expect(oak).toMatchObject({ chunk: 'S07', band: true, ids: ['S07'] });
    });
});

describe('runMetrics', () => {
    const t = resolveTarget(chain, 'woodcutting:oak-15-73');
    const rows = [
        row('(stage) S07', { kind: 'gate', meta: { unresolved: ['x'] } }),
        row('supply: staff H4k', { kind: 'note' }),
        row('woodcutting:normal-1-15', { startTick: 100, endTick: 122, ticks: 22 }),
        row('woodcutting:oak-15-73', { startTick: 122, endTick: 722, ticks: 600 }),
        row('tickmon', { kind: 'tickmon', startTick: 0, endTick: 390, meta: { late: 1, glued: 2, gaps: 0, periodMs: 150 } }),
        row('tickmon', { kind: 'tickmon', startTick: 391, endTick: 790, meta: { late: 0, glued: 1, gaps: 1, periodMs: 151 } }),
        row('tickmon', { kind: 'tickmon', sessionId: 2, startTick: 0, endTick: 400, meta: { late: 9 } }),
    ];
    const vitals = [
        { sid: 1, tick: 90, hp: 42, food: 5 },
        { sid: 1, tick: 300, hp: 30, food: 5 },
        { sid: 1, tick: 301, hp: 42, food: 4 },
        { sid: 1, tick: 800, hp: 10, food: 0 },
    ];

    test('the counted rows are the ticks; TICKMON is summed over the minutes overlapping them in their session; hp and food inside their ticks', () => {
        const m = runMetrics(rows, vitals, t, 0);
        expect(m).toMatchObject({ ticks: 600, rows: 1, pass: true, refusal: null, late: 1, glued: 3, gaps: 1, minutes: 2, periodMs: 150.5, hpMin: 30, food: 1 });
        expect(m.cheats).toEqual(['stage S07 (1 unstaged)', 'supply: staff H4k']);
    });

    test("a failed phase is the step's (step.ts failRow `<name>:<phase>`): its ticks count and its error is the refusal", () => {
        const failed = [row('woodcutting:oak-15-73:postcondition', { ok: false, error: 'Woodcutting 70 < 73', startTick: 722, endTick: 722 }), row('woodcutting:oak-15-73', { ticks: 640, ok: false, error: 'knife gate' })];
        const m = runMetrics(failed, [], t, 1);
        expect(m).toMatchObject({ ticks: 640, rows: 2, pass: false, refusal: 'woodcutting:oak-15-73:postcondition: Woodcutting 70 < 73', hpMin: null, food: null });
    });

    test('a run that never reached the step has no counted rows, and its refusal says it failed before', () => {
        const m = runMetrics([row('T06-07', { ok: false, error: 'out_of_scene' })], [], t, 1);
        expect(m).toMatchObject({ rows: 0, pass: false, refusal: 'before the step: T06-07: out_of_scene' });
    });

    test('exit 0 without the last counted step ok is not a pass', () => {
        expect(runMetrics([row('woodcutting:walk-oaks', { ticks: 9 })], [], resolveTarget(chain, 'S07'), 0).pass).toBe(false);
    });
});

describe('the score', () => {
    test("RUN-ORDER's manual-restart line gives the restart's ticks", () => {
        const r = restartTicks(runOrder);
        expect(r.ticks).toBeGreaterThan(0);
        expect(r.line).toStartWith('Any step that throws costs a manual restart, ~');
    });

    test('with no failure it is the median over passing runs', () => {
        expect(benchScore([530, 533, 540].map(ticks => ({ pass: true, ticks, refused: false })), 532.2, 11.7)).toBe(533);
        expect(median([1, 4, 2, 3])).toBe(2.5);
    });

    test('a faster change that fails one run in three loses to the steady one', () => {
        const steady = benchScore([530, 533, 540].map(ticks => ({ pass: true, ticks, refused: false })), 532.2, 11.7)!;
        const flaky = benchScore([{ pass: true, ticks: 480, refused: false }, { pass: true, ticks: 482, refused: false }, { pass: false, ticks: 300, refused: false }], 532.2, 11.7)!;
        expect(failurePrice(300, 532.2, 11.7)).toBeCloseTo(843.9);
        expect(flaky).toBeGreaterThan(steady);
    });

    test('runs that never reached the step are not scored; a failure with no expected and no pass has no price', () => {
        expect(benchScore([{ pass: false, ticks: 0, refused: true }, { pass: true, ticks: 600, refused: false }], null, 11.7)).toBe(600);
        expect(benchScore([{ pass: false, ticks: 0, refused: true }], 500, 11.7)).toBeNull();
        expect(benchScore([{ pass: false, ticks: 200, refused: false }], null, 11.7)).toBeNull();
    });

    test("RUN-ORDER's cells: an id's own, a band's step for context only", () => {
        const s12 = runOrderCells(runOrder, { ...resolveTarget([step('S12', 'S12:A')], 'S12') });
        expect(s12.expected).toBeGreaterThan(400);
        expect(s12.text).toStartWith('RUN-ORDER S12 expected ');
        const oak = runOrderCells(runOrder, resolveTarget(chain, 'woodcutting:oak-15-73'));
        expect(oak.expected).toBeNull();
        expect(oak.text).toContain('prices S07 whole');
    });
});

describe('accounts and helpers', () => {
    test("fresh names per run: a lab SCORED name and cairn_ helper names standalone.ts launches (helpers/fleet-config ACCOUNT_NAME_RE)", () => {
        const n = benchNames('k3x', 12);
        expect(n.scored).toBe('benchk3xc');
        expect(n.helper('b', 4)).toBe('cairn_k3xbc4');
        expect(n.helper('b', 4)).toMatch(/^cairn_[a-z0-9_]{1,6}$/);
        expect(() => benchNames('K3', 1)).toThrow('three');
    });

    test('each launcher family the slice meets gets its full set; the lite-runner families must be passed', () => {
        expect(helperFlags(none, 'abc', 1)).toEqual([]);
        const f = helperFlags({ ...none, bones: true, anvil: true }, 'abc', 1);
        expect(f).toEqual(['--bone-givers=cairn_abcb11,cairn_abcb12,cairn_abcb13,cairn_abcb14', '--anvil=cairn_abcv11']);
        expect(unservedLiteFamilies({ ...none, rings: true }, [])).toHaveLength(1);
        expect(unservedLiteFamilies({ ...none, rings: true }, ['--ringers=a,b,c'])).toEqual([]);
    });
});

describe('results.tsv', () => {
    test('one row per run in the column order, tabs and newlines in a refusal flattened', () => {
        const line = tsvRow({ commit: 'abc', target: 'S12', tick_ms: 150, run: 1, account: 'benchk3x1', status: 'fail', ticks: 300, score: 843.9, secs: 210, late: 0, glued: 0, gaps: 0, hp_min: 12, food: 2, cheats: 'stage S12', notes: 'S12:B\tfailed\nhere', log: '/tmp/l', at: 'now' });
        expect(line.split('\t')).toHaveLength(TSV_COLUMNS.length);
        expect(line).toContain('S12:B failed here');
        expect(line.endsWith('\n')).toBe(true);
    });
});
