import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import * as dialogue from '../../lib/dialogue';
import { baseState, FakeSdk } from '../../lib/fake-sdk';
import type { TickRow } from '../../lib/ticks';
import { questSteps, type QuestOptions } from '../../quests/segments';
import { BOUNDARY_STEP, type RunnerSession } from '../../runner/step';
import { baseXpGained, formatComparison, formatReport, letterOf, runLabQuest, selectSegments, skillXps, summarize, type LabQuest, type QuestFixture } from './run';

const prevTick = process.env.SPEEDRUN_TICK_MS;
beforeAll(() => { process.env.SPEEDRUN_TICK_MS = '5'; });
afterAll(() => { if (prevTick === undefined) delete process.env.SPEEDRUN_TICK_MS; else process.env.SPEEDRUN_TICK_MS = prevTick; });

const row = (step: string, ticks: number, ok = true, kind?: TickRow['kind']): TickRow =>
    ({ v: 1, runId: 'r', account: 'lab', sessionId: 0, step, startTick: 0, endTick: ticks, ticks, wallMs: 0, ok, tickMs: 300, at: '', ...(kind ? { kind } : {}) });

const names = ['S15:A-narnode', 'S15:B-daero', 'S15:C-hangar'];

describe('letterOf / selectSegments', () => {
    test('letters and full names; until defaults to from', () => {
        expect(letterOf('S15', 'S15:H2-garkor')).toBe('H2');
        expect(letterOf('S15', 'S11b:A-x')).toBeNull();
        const steps = names.map(name => ({ name }));
        expect(selectSegments(steps, 'S15', 'B').map(s => s.name)).toEqual(['S15:B-daero']);
        expect(selectSegments(steps, 'S15', 'a', 'S15:C-hangar').map(s => s.name)).toEqual(names);
        expect(() => selectSegments(steps, 'S15', 'C', 'A')).toThrow(/comes before/);
        expect(() => selectSegments(steps, 'S15', 'Z')).toThrow(/no segment "Z"/);
    });
});

describe('summarize / formatReport', () => {
    const records = [
        { ok: true, rows: [row(BOUNDARY_STEP, 1), row(names[0]!, 30), row(BOUNDARY_STEP, 0), row(names[1]!, 10), row('tickmon', 99, true, 'tickmon')] },
        { ok: true, rows: [row(BOUNDARY_STEP, 0), row(names[0]!, 34), { ...row(names[0]!, 0, true, 'note'), meta: { casts: 27 } }, row(BOUNDARY_STEP, 1), row(names[1]!, 12)] },
        { ok: false, error: 'step "S15:B-daero" run failed: boom', rows: [row(BOUNDARY_STEP, 0), row(names[0]!, 32), row(names[1]!, 5, false)] },
    ];

    test('per segment: passing values only for the stats; failed and unreached runs shown', () => {
        const r = summarize('MM', 'burst', names.slice(0, 2), records, { A: 31, B: 11 }, 'S15');
        expect(r).toMatchObject({ runs: 3, passes: 2, errors: ['step "S15:B-daero" run failed: boom'] });
        expect(r.segments[0]).toMatchObject({ ref: 31, runs: [30, 34, 32], stats: { n: 3, mean: 32, min: 30, max: 34 } });
        expect(r.segments[1]).toMatchObject({ runs: [10, 12, 'fail@5'], stats: { n: 2, mean: 11 } });
        expect(r.boundary.runs).toEqual([1, 1, 0]);
        expect(r.total).toMatchObject({ ref: 42, runs: [41, 47, null], stats: { n: 2, mean: 44, min: 41, max: 47 } });
    });

    test('the markdown table carries every segment, the boundaries, the total and the failures', () => {
        const r = summarize('MM', 'fixed', names.slice(0, 2), records, { A: 31 }, 'S15');
        const md = formatReport(r);
        expect(md).toContain('| S15:A-narnode | 31 | 30, 34, 32 | 32 | 30 | 34 | +1 (+3%) |');
        expect(md).toContain('| S15:B-daero |  | 10, 12, fail@5 | 11 | 10 | 12 |  |');
        expect(md).toContain('| (boundaries) |  | 1, 1, 0 |');
        expect(md).toContain('| **Total** |  | 41, 47, - | 44 | 41 | 47 |  |');
        expect(md).toContain('2/3 runs passed (dialogue fixed');
        expect(md).toContain('- failure 1: step "S15:B-daero" run failed: boom');
        // A note row is listed by run and never counted into a segment.
        expect(r.notes).toEqual([{ run: 1, step: names[0]!, meta: { casts: 27 } }]);
        expect(md).toContain('- run 2 S15:A-narnode: {"casts":27}');
    });

    test('the fixed-vs-burst comparison', () => {
        const fixed = summarize('MM', 'fixed', names.slice(0, 1), [{ ok: true, rows: [row(names[0]!, 30)] }]);
        const burst = summarize('MM', 'burst', names.slice(0, 1), [{ ok: true, rows: [row(names[0]!, 12)] }]);
        expect(formatComparison(fixed, burst)).toContain('| S15:A-narnode | 30 | 12 | 18 |');
    });
});

describe('skillXps / baseXpGained', () => {
    test('game xp over XP_RATE (25), to 0.1 base', () => {
        expect(baseXpGained({ defence: 0 }, { defence: 4300 })).toEqual({ defence: 172 });
        expect(baseXpGained({ magic: 1000 }, { magic: 2234 })).toEqual({ magic: 49.4 }); // 1,234 / 25 = 49.36
    });
    test('only the skills of the first snapshot; one the second lacks gained nothing', () => {
        expect(baseXpGained({ magic: 500 }, { defence: 2500 })).toEqual({ magic: 0 });
    });
    test('a skill the state does not publish reads as 0 game xp', () => {
        const s = baseState({ skills: [{ name: 'Magic', level: 77, baseLevel: 77, experience: 218_900 }] } as never);
        expect(skillXps(s)).toEqual({ magic: 218_900, defence: 0, hitpoints: 0 });
        expect(skillXps(null)).toEqual({ magic: 0, defence: 0, hitpoints: 0 });
    });
});

describe('runLabQuest', () => {
    test('applies the --from fixture every run, runs the chosen segments with the dialogue mode, and tabulates', async () => {
        const sdk = new FakeSdk(baseState({ tick: 0 }));
        const timer = setInterval(() => sdk.tick(), 2);
        const session = { sdk, bot: {}, name: 'lab', sessionId: 0 } as unknown as RunnerSession;
        const applied: string[] = [];
        const modes: Array<string | undefined> = [];
        const ran: string[] = [];
        const resets: object[] = [];
        const spy = spyOn(dialogue, 'resetDialogueMemory').mockImplementation(s => { resets.push(s); });
        const quest: LabQuest<QuestOptions & { extra?: number }> = {
            title: 'Example',
            stepId: 'S99',
            options: { extra: 1 },
            steps: opts => {
                modes.push(opts.dialogue);
                return questSteps('S99', ['A', 'B', 'C'].map(letter => ({ letter, label: 'x', logoutSafe: true, run: async () => { ran.push(letter); } })));
            },
            fixtures: [{ letter: 'B', tile: { x: 1, z: 1 } }],
            applyFixture: async (_s, f: QuestFixture) => { applied.push(f.letter); },
            reference: { B: 3 },
        };
        try {
            const r = await runLabQuest(session, quest, { from: 'B', until: 'C', runs: 2, dialogue: 'burst' });
            expect(applied).toEqual(['B', 'B']);
            // steps() once per run: a closure's memory never reaches the next run
            expect(modes).toEqual(['burst', 'burst']);
            // nor does the dialogue layer's last acted page: forgotten before each run
            expect(resets).toEqual([sdk, sdk]);
            expect(ran).toEqual(['B', 'C', 'B', 'C']);
            expect(r).toMatchObject({ runs: 2, passes: 2, dialogue: 'burst' });
            expect(r.segments.map(s => s.name)).toEqual(['S99:B-x', 'S99:C-x']);
            await expect(runLabQuest(session, quest, { from: 'A' })).rejects.toThrow(/no fixture for segment A/);
            // check fails an otherwise passing run.
            const checked = await runLabQuest(session, { ...quest, check: async () => 'xp short' }, { from: 'B', runs: 1 });
            expect(checked).toMatchObject({ passes: 0, errors: ['xp short'] });
        } finally {
            clearInterval(timer);
            spy.mockRestore();
        }
    });
});
