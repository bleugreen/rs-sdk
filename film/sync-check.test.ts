import { describe, expect, test } from 'bun:test';
import { firstChange, frameDiffs, threshold } from './sync-check';

describe('sync check', () => {
    test('frame differences are the mean absolute change per pixel', () => {
        // Three 2x1 frames: unchanged, then both pixels up by 10.
        expect(frameDiffs(new Uint8Array([0, 0, 0, 0, 10, 10]), 2, 1)).toEqual([0, 0, 10]);
    });

    test('the first change above the threshold inside the window, as its frame time', () => {
        const d = [0, 0.2, 0.1, 9, 0.2, 8, 0.1];
        expect(firstChange(d, 25, 0, 1000, 1)).toBe(120);
        expect(firstChange(d, 25, 130, 1000, 1)).toBe(200);
        expect(firstChange(d, 25, 0, 100, 1)).toBeNull();
    });

    test('the threshold sits well above resting noise, never below one grey level', () => {
        expect(threshold([0, 0, 0, 50])).toBe(1);
        expect(threshold([0.5, 0.5, 0.5, 9])).toBe(2);
    });
});
