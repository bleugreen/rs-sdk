import { describe, expect, test } from 'bun:test';
import type { BotWorldState, GameMessage } from '../../sdk/types';
import { VitalsTracker } from './attempt';
import type { TickRow } from './ticks';

const msg = (tick: number, text: string, observationId?: number): GameMessage => ({ type: 0, text, sender: '', tick, fromSelf: false, ...(observationId !== undefined ? { observationId } : {}) });
const state = (tick: number, gameMessages: GameMessage[], extra: Record<string, unknown> = {}) => ({ tick, gameMessages, ...extra }) as Pick<BotWorldState, 'tick' | 'gameMessages'>;
const row = (startTick: number, endTick: number, meta?: Record<string, unknown>): TickRow => ({
    v: 1, runId: 'r', account: 'SCORED', sessionId: 1, step: 'S15:A-narnode', startTick, endTick, ticks: endTick - startTick, wallMs: 0, ok: true, tickMs: 400, at: '', ...(meta ? { meta } : {}),
});
const player = (hp: number, maxHp: number) => ({ player: { hp, maxHp } }) as unknown as Pick<BotWorldState, 'player'>;

describe('VitalsTracker: hp and poison on tick-log rows', () => {
    test("hp and maxHp from the state at the row's end; the row's own meta kept, and a key it already has never overwritten", () => {
        const v = new VitalsTracker();
        expect(v.stamp(row(10, 20, { index: 4 }), player(17, 38)).meta).toEqual({ index: 4, hp: 17, maxHp: 38 });
        expect(v.stamp(row(10, 20, { hp: 'theirs' }), player(17, 38)).meta).toEqual({ hp: 'theirs', maxHp: 38 });
        const bare = row(10, 20);
        expect(v.stamp(bare, null)).toBe(bare);
    });

    test('a poison message is noted on the rows whose ticks cover it, once however many states repeat it', () => {
        const v = new VitalsTracker();
        v.observe(state(100, [msg(99, 'Welcome')]));
        v.observe(state(101, [msg(99, 'Welcome'), msg(101, 'You have been poisoned!')]));
        v.observe(state(102, [msg(99, 'Welcome'), msg(101, 'You have been poisoned!')]));
        v.observe(state(103, [msg(101, 'You have been poisoned!')]));
        expect(v.stamp(row(90, 105), player(20, 40)).meta).toEqual({ hp: 20, maxHp: 40, poison: { seen: 1, firstTick: 101, lastTick: 101, source: 'message', text: 'You have been poisoned!' } });
        expect(v.stamp(row(102, 110), player(20, 40)).meta).toEqual({ hp: 20, maxHp: 40 });
        // A 0-tick row (a census) on the message's tick.
        expect(v.poisonDuring(101, 101)).toMatchObject({ seen: 1 });
        // The same text again on a later tick is a new sighting.
        v.observe(state(140, [msg(101, 'You have been poisoned!'), msg(140, 'You have been poisoned!')]));
        expect(v.poisonDuring(90, 150)).toMatchObject({ seen: 2, firstTick: 101, lastTick: 140 });
        expect(v.poisonDuring(-1, 150)).toBeNull();
    });

    test("a state's poisonSeenAt tick is a hitmark sighting, and names the note's source", () => {
        const v = new VitalsTracker();
        v.observe(state(200, [msg(200, 'You have been poisoned!')], { poisonSeenAt: 200 }));
        v.observe(state(201, [msg(200, 'You have been poisoned!')], { poisonSeenAt: 200 }));
        v.observe(state(230, [], { poisonSeenAt: 230 }));
        expect(v.poisonDuring(190, 240)).toEqual({ seen: 3, firstTick: 200, lastTick: 230, source: 'hitmark', text: 'You have been poisoned!' });
        expect(v.poisonDuring(225, 240)).toEqual({ seen: 1, firstTick: 230, lastTick: 230, source: 'hitmark' });
    });

    test("a relaunch's restarted tick count drops the old count's sightings", () => {
        const v = new VitalsTracker();
        v.observe(state(5_000, [msg(5_000, 'You have been poisoned!')]));
        v.observe(state(12, []));
        expect(v.poisonDuring(0, 6_000)).toBeNull();
    });
});
