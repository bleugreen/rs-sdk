// One protocol for the Runecraft hand-off: the page's rc-cycle program
// (server/webclient/src/bot/programs/rc-cycle.ts) cannot import altar-cue.ts, which
// needs node:fs, so it carries its own copy of the scored half. These tests hold the two
// together, and hold rcCueFields to what CueWriter.write takes.
import { describe, expect, test } from 'bun:test';
import { cycleTicks as pageCycle, scoredSteps as pageSteps, canonName as pageCanon } from '../../server/webclient/src/bot/programs/rc-cycle';
import { canonName, cycleTicks, DEFAULT_OPEN, scoredSteps } from '../helpers/altar-cue';
import { type ProgramStatus, type RcShared, rcCueFields } from './programs';

describe('rc-cycle and altar-cue.ts agree', () => {
    test('the scored half, the cycle length and the name form', () => {
        for (const schedule of ['tuned', 'robust'] as const) {
            for (const open of [DEFAULT_OPEN, 4, 6]) {
                expect(pageSteps(100, open, schedule)).toEqual(scoredSteps(100, open, schedule));
                expect(pageCycle(open, schedule)).toBe(cycleTicks(open, schedule));
            }
        }
        for (const n of ['Cairn H05', 'cairn_h05', '  CAIRN  h05 ']) expect(pageCanon(n)).toBe(canonName(n));
    });
});

describe('rcCueFields', () => {
    const shared: RcShared = {
        v: 1, open: 5, schedule: 'robust',
        beacons: [{ tick: 10, ms: 1.8e12 }],
        turns: [{ giver: 'cairn_h05', T: 12, schedule: 'tuned' }],
        results: [], queue: [], waiting: null
    };
    const status = (s: Partial<ProgramStatus>) => ({ runId: 3, name: 'rc-cycle', shared, ...s }) as ProgramStatus;

    test('gives CueWriter.write its fields, with a key that changes on new turns, stop or a new run', () => {
        const f = rcCueFields(status({}))!;
        expect(f).toMatchObject({ beacons: shared.beacons, turns: shared.turns, schedule: 'robust', open: 5 });
        expect(f.stop).toBeUndefined();
        const beaconsOnly = rcCueFields(status({ shared: { ...shared, beacons: [{ tick: 11, ms: 1.8e12 + 300 }] } }))!;
        expect(beaconsOnly.key).toBe(f.key);
        expect(rcCueFields(status({ shared: { ...shared, turns: [...shared.turns, { giver: 'cairn_h06', T: 20, schedule: 'robust' }] } }))!.key).not.toBe(f.key);
        expect(rcCueFields(status({ shared: { ...shared, stop: true } }))).toMatchObject({ stop: true });
        expect(rcCueFields(status({ runId: 4 }))!.key).not.toBe(f.key);
    });

    test('nothing to write for another program, no shared data yet, or no beacon', () => {
        expect(rcCueFields(null)).toBeNull();
        expect(rcCueFields(status({ name: 'probe' }))).toBeNull();
        expect(rcCueFields(status({ shared: undefined }))).toBeNull();
        expect(rcCueFields(status({ shared: { ...shared, beacons: [] } }))).toBeNull();
    });
});
