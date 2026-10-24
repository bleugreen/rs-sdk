import { describe, expect, test } from 'bun:test';
import { firstChange, frameDiffs, threshold } from './sync-check';

describe('sync check', () => {
    test('frame differences count the pixels that moved past the encoder noise', () => {
        // Four 2x1 frames: unchanged, both pixels up 10 (noise), one pixel up 100.
        expect(frameDiffs(new Uint8Array([0, 0, 0, 0, 10, 10, 110, 10]), 2, 1)).toEqual([0, 0, 0, 1]);
    });

    test('the first change above the threshold inside the window, as its frame time', () => {
        const d = [0, 2, 1, 900, 2, 800, 1];
        expect(firstChange(d, 25, 0, 1000, 40)).toBe(120);
        expect(firstChange(d, 25, 130, 1000, 40)).toBe(200);
        expect(firstChange(d, 25, 0, 100, 40)).toBeNull();
    });

    test('the threshold sits well above resting noise, never below 40 pixels', () => {
        expect(threshold([0, 0, 0, 500])).toBe(40);
        expect(threshold([20, 20, 20, 900])).toBe(80);
    });
});
