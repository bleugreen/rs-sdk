import { describe, expect, test } from 'bun:test';
import { hopLine, hopRows, type Frame, type Send } from './leg-trace';

const frame = (tick: number, x: number, z: number, dialog = false, locNear: number | null = 1): Frame => ({ tick, x, z, level: 0, dialog, locNear, inv: 5 });
const send = (tick: number, kind: string, target: string, x = 0, z = 0): Send => ({ tick, kind, target, x, z, level: 0 });

describe('hopRows', () => {
    // A teleport cast at tick 10 lands at tick 14; the run's first click goes at 16, the player
    // first steps at 18, stands still at 20, and arrives at 22.
    const segments = [
        { hop: 'teleport falador', ok: true, startTick: 10, ticks: 5 },
        { hop: 'run 3,0', ok: true, startTick: 15, ticks: 7 },
    ];
    const frames: Frame[] = [
        frame(10, 0, 0), frame(11, 0, 0), frame(12, 0, 0), frame(13, 0, 0), frame(14, 100, 100),
        frame(15, 100, 100), frame(16, 100, 100), frame(17, 100, 100), frame(18, 101, 100), frame(19, 102, 100),
        frame(20, 102, 100), frame(21, 103, 100), frame(22, 104, 100),
    ];
    const sends: Send[] = [send(10, 'sendClickComponent', '1170'), send(16, 'sendWalk', '104,100', 100, 100), send(20, 'sendWalk', '104,100', 102, 100)];
    const rows = hopRows(segments, sends, frames, 22);

    test('splits clicks by hop start and times the first click after the landing', () => {
        expect(rows.map(r => r.sends)).toEqual([1, 2]);
        expect(rows[0]!.firstSend).toBe(0);
        expect(rows[1]!.firstSend).toBe(1);
        expect(rows[1]!.byKind).toEqual({ sendWalk: 2 });
    });

    test('times the first step from the first click and lists the idle ticks after it', () => {
        expect(rows[0]!.firstStep).toBe(4);
        expect(rows[1]!.firstStep).toBe(2);
        expect(rows[1]!.still).toEqual([5]);
        expect(rows[1]!.tiles).toBe(4);
        expect(rows[0]!.tiles).toBe(0);
    });

    test('counts a repeated click with the same target', () => {
        expect(rows[1]!.repeats).toBe(1);
        expect(rows[0]!.repeats).toBe(0);
    });

    test('a click on the boundary tick belongs to the hop that starts there', () => {
        const r = hopRows(segments, [send(15, 'sendWalk', 'a')], frames, 22);
        expect(r.map(x => x.sends)).toEqual([0, 1]);
    });

    test('times the first dialogue page and counts missing ticks', () => {
        const fs = [frame(30, 5, 5), frame(31, 5, 5), frame(33, 5, 5, true), frame(34, 9, 9)];
        const [r] = hopRows([{ hop: 'tree stronghold', ok: true, startTick: 30, ticks: 4 }], [send(30, 'sendInteractLoc', 'loc 1 at 5,5 op 1'), send(36, 'sendInteractLoc', 'x')], fs, 34);
        expect(r!.firstPage).toBe(3);
        expect(r!.frameGaps).toBe(1);
        expect(r!.sends).toBe(1);
    });

    test('times the scene built around the player after a landing', () => {
        const fs = [frame(40, 0, 0), frame(41, 100, 100, false, 60), frame(42, 100, 100, false, null), frame(43, 100, 100, false, 3)];
        const [a, b] = hopRows([{ hop: 'teleport', ok: true, startTick: 40, ticks: 1 }, { hop: 'run', ok: true, startTick: 41, ticks: 2 }], [], fs, 43);
        expect(a!.sceneAt).toBe(0);
        expect(b!.sceneAt).toBe(2);
        expect(hopLine([b!])).toContain('scene +2');
    });

    test('hopLine prints one clause per hop', () => {
        expect(hopLine(rows)).toBe('teleport falador 5 (1 clicks, first click +0, step +4, idle 0) | run 3,0 7 (2 clicks, first click +1, step +2, idle 1, repeats 1)');
    });
});
