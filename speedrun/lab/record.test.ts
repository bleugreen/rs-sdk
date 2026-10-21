import { describe, expect, test } from 'bun:test';
import type { PlayerState } from '../../sdk/types';
import { baseState, FakeSdk } from '../lib/fake-sdk';
import { geometric, Recorder, stats } from './record';
import { getvar } from './setup';

const player = (worldX: number) => ({ worldX, worldZ: 0, level: 0 }) as PlayerState;

describe('Recorder', () => {
    test('a segment ends at its last mark, counts tiles and dialogue shape', async () => {
        const sdk = new FakeSdk(baseState({ tick: 10, player: player(0) }));
        const rec = new Recorder(sdk as never, 't');
        const seg = await rec.seg('walk and talk', async () => {
            sdk.tick({ player: player(2) });
            sdk.tick({ player: player(4) });
            rec.interact();
            rec.dialogue({ ok: true, opened: true, pages: 3, options: 1, levelUps: 0, startTick: 12, firstTick: 13, endTick: 15, ticks: 3, transcript: ['[13] page: a', '[13] page: b', '[14] > Yes', '[14] page: c'], remaining: [] });
            sdk.tick();
            sdk.tick();
            sdk.tick(); // idle confirmation: not counted
            return 'ok';
        });
        expect(seg).toMatchObject({ ticks: 5, endTick: 15, tiles: 4, pages: 3, options: 1, interactions: 1, runs: '2c, opt, 1c', note: 'ok' });
        expect(rec.total().ticks).toBe(5);
    });

    test('stats and geometric', () => {
        expect(stats([3, 1, 2, NaN])).toEqual({ n: 3, min: 1, max: 3, mean: 2, median: 2, p90: 3 });
        expect(stats([]).n).toBe(0);
        expect(geometric(0.5)).toEqual({ mean: 2, p50: 1, p90: 4 });
    });
});

describe('getvar', () => {
    test('does not reuse a reply already published on the request tick', async () => {
        const sdk = new FakeSdk(baseState({ tick: 5, gameMessages: [{ type: 0, text: 'get grail: 1', sender: '', tick: 5, fromSelf: false }] }));
        sdk.onSend = (_a, f) => setTimeout(() => f.tick({ gameMessages: [...f.state!.gameMessages, { type: 0, text: 'get grail: 4', sender: '', tick: 6, fromSelf: false }] }), 1);
        expect(await getvar(sdk as never, 'grail')).toBe(4);
    });

    test('parses the engine reply "get <name>: <value>" sent after the request', async () => {
        const sdk = new FakeSdk(baseState({ tick: 5, gameMessages: [{ type: 0, text: 'get grail: 1', sender: '', tick: 3, fromSelf: false }] }));
        sdk.onSend = (_a, f) => queueMicrotask(() => f.tick({ gameMessages: [...f.state!.gameMessages, { type: 0, text: 'get grail: 4', sender: '', tick: 6, fromSelf: false }] }));
        expect(await getvar(sdk as never, 'grail')).toBe(4);
    });
});
