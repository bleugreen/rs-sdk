import { describe, expect, test } from 'bun:test';
import type { TickRow } from '../lib/ticks';
import type { ChainStep } from './chain';
import { formatRunReport, runReport, STAFF_SUPPLY_STEP, STAND_IN_STEP } from './run-report';

const RUN_ORDER = `## 2. Step table (a)

| id | kind | where | what | levels | expected | best |
|---|---|---|---|---|---|---|
| S02 | M | coop | strikes | Magic 1-7 | **20.3 m (browser)** | 19 |
| S04 | M | row | enchants | Magic 7-59 | 1,000 m | 950 |
| S05 | I | Doric | quest | Mining 1-49 | 17 i | 15 |

## 3. Next
`;
const chain = [
    { id: 'S02', name: 'S02 magic' }, { id: 'T02-03', name: 'T02-03 walk' }, { id: 'S04', name: 'S04 magic' }, { id: 'S05', name: "S05 Doric's Quest" }, { id: 'H9', name: 'H9 hand-off' },
] as unknown as ChainStep[];
const row = (step: string, ticks: number, more: Partial<TickRow> = {}): TickRow => ({ v: 1, runId: 'r', account: 'SCORED', sessionId: 1, step, startTick: 0, endTick: ticks, ticks, wallMs: 0, ok: true, tickMs: 300, at: '', ...more });

describe('runReport', () => {
    test('per id against RUN-ORDER, flags past 10%, stand-ins out of every total and the run partial', () => {
        const rows = [
            row('S02 magic', 21), row('(boundary)', 1), row('T02-03 walk', 4),
            row('S04 magic', 1200),
            row(`${STAND_IN_STEP} S05`, 40),
            row('H9 hand-off', 8),
            row('(census)', 0, { kind: 'note' }),
            row('T02-03 walk', 4, { kind: 'travel', meta: { segments: [{ hop: 'teleport ardougne', ticks: 4 }, { hop: 'run 2661,3301', ticks: 30 }] } }),
            row('(program) item-cycle', 100, { kind: 'program', meta: { counters: { overBudget: 2 } } }),
            row('(drop)', 0), row('(resume)', 0), row('(resume)', 0),
        ];
        const r = runReport(rows, chain, RUN_ORDER);
        expect(r.partial).toBe(true);
        expect(r.steps).toEqual([
            { id: 'S02', ticks: 21, expected: 20.3, best: 19, off: expect.closeTo(0.0345, 3), flagged: false },
            { id: 'S04', ticks: 1200, expected: 1000, best: 950, off: expect.closeTo(0.2, 5), flagged: true },
        ]);
        expect(r.standIns).toEqual([{ step: `${STAND_IN_STEP} S05`, ticks: 40 }]);
        expect(r.totalTicks).toBe(21 + 1 + 4 + 1200 + 8 + 0 + 0 + 0 + 0);
        expect(r.teleports).toEqual([{ leg: 'T02-03 walk', hop: 'teleport ardougne', ticks: 4 }]);
        expect([r.overBudget, r.drops, r.resumes, r.census]).toEqual([2, 1, 2, 1]);
        expect(r.handOffs).toEqual([{ row: 'H9', ticks: 8, ok: true }]);
        expect(formatRunReport(r)).toContain('PARTIAL');
        expect(formatRunReport(r)).toContain('-> rs/158');
    });

    test('a staff supply also marks the run partial and is never compared to RUN-ORDER; a clean run is complete', () => {
        expect(runReport([row(`${STAFF_SUPPLY_STEP} H11`, 0, { kind: 'note' })], chain, RUN_ORDER).partial).toBe(true);
        const staffed = [{ id: 'S01', name: `H1 hand-off (${STAFF_SUPPLY_STEP})` }] as unknown as ChainStep[];
        expect(runReport([row(`H1 hand-off (${STAFF_SUPPLY_STEP})`, 12)], staffed, RUN_ORDER).steps).toEqual([]);
        const clean = runReport([row('S02 magic', 20)], chain, RUN_ORDER);
        expect(clean.partial).toBe(false);
        expect(formatRunReport(clean)).toContain('complete');
    });
});
