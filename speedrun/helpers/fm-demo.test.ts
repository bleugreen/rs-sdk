import { describe, expect, test } from 'bun:test';
import { judgeGaps } from './fm-demo';

/** A trace of every tick 100-130, the roll animation on two ticks of every four for each failed roll (lab traces). */
function animFor(events: Array<[from: number, failed: number]>): Map<number, number> {
    const anim = new Map<number, number>();
    for (let t = 100; t <= 130; t++) anim.set(t, -1);
    for (const [from, failed] of events) for (let r = 0; r < failed; r++) for (const d of [1, 2]) anim.set(from + 4 * r + d, 733);
    return anim;
}

describe('fm-demo: judging the gaps against the trace', () => {
    test('a chained gap is 4 ticks per roll; each failed roll shows one start of the roll animation', () => {
        // fires at 100, 104 (first roll), 112 (one failed roll), 124 (two failed rolls)
        const anim = animFor([[104, 1], [112, 2]]);
        expect(judgeGaps([100, 104, 112, 124], anim)).toEqual([
            { n: 1, gap: 4, unseen: 0, starts: 0, expected: 4, chained: true },
            { n: 2, gap: 8, unseen: 0, starts: 1, expected: 8, chained: true },
            { n: 3, gap: 12, unseen: 0, starts: 2, expected: 12, chained: true }
        ]);
    });

    test('a gap a walk or a fresh start stretched is not chained: the lab\'s 9-tick lap turn with one roll shown', () => {
        const anim = new Map([[202, 733], [203, 733]]);
        expect(judgeGaps([200, 209], anim)[0]).toEqual({ n: 1, gap: 9, unseen: 7, starts: 1, expected: 8, chained: false });
        // a 6-tick wait with no roll at all
        expect(judgeGaps([300, 306], new Map())[0]).toMatchObject({ starts: 0, expected: 4, chained: false });
    });

    test('a tick missing from the trace keeps the animation before it', () => {
        const anim = new Map([[401, 733], [403, -1]]);
        // 402 is missing: still rolling, so one start, not two
        expect(judgeGaps([400, 408], anim)[0]).toMatchObject({ starts: 1, unseen: 6, chained: true });
    });
});
