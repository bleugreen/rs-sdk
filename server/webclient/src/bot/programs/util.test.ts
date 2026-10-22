import { describe, expect, test } from 'bun:test';

import '../../lite/test-support/browser-globals.js';

import type { BotWorldState, GameMessage } from '../types.js';
import { FreshMessages } from './util.js';

const msg = (text: string, id: number | undefined, tick = id ?? 0): GameMessage => ({ type: 0, text, sender: '', tick, observationId: id, fromSelf: false });
const state = (gameMessages: GameMessage[]) => ({ gameMessages }) as unknown as BotWorldState;
const texts = (ms: GameMessage[]) => ms.map(m => `${m.observationId}:${m.text}`);

describe('FreshMessages', () => {
    // Publication shapes recorded from the browser client (rs/356's lab and rs/352's): every
    // message first seen in one publication carries that publication's id.
    const welcome = msg('Welcome to RuneScape.', 40);
    const pick = [msg("You pick the man's pocket.", 44), msg('Congratulations, you just advanced a thieving level.', 44)];
    const blocked = [msg("You're stunned!", 57), msg("You're stunned!", 57), msg("You're stunned!", 57), msg("I can't reach that!", 57)];
    const request = [msg("You're stunned!", 74), msg("You're stunned!", 74), msg('Sending trade offer...', 74)];

    test('delivers every message of a publication once, in order (golden)', () => {
        const fresh = new FreshMessages(state([welcome]));
        const window: GameMessage[] = [welcome];
        const seen: string[][] = [];
        for (const publication of [pick, [], blocked, request]) {
            window.push(...publication);
            seen.push(texts(fresh.take(state(window.slice(-6)))));
            // the next tick republishes the same window: nothing is new
            seen.push(texts(fresh.take(state(window.slice(-6)))));
        }
        expect(seen).toEqual([
            ["44:You pick the man's pocket.", '44:Congratulations, you just advanced a thieving level.'],
            [],
            [],
            [],
            ["57:You're stunned!", "57:You're stunned!", "57:You're stunned!", "57:I can't reach that!"],
            [],
            ["74:You're stunned!", "74:You're stunned!", '74:Sending trade offer...'],
            []
        ]);
    });

    test('a window that has dropped its oldest messages yields only the new ones', () => {
        const fresh = new FreshMessages(state([welcome, ...pick]));
        expect(texts(fresh.take(state([...pick.slice(1), ...blocked])))).toEqual(texts(blocked));
        expect(texts(fresh.take(state(blocked.slice(2))))).toEqual([]);
    });

    test('the state the program starts on is not fresh', () => {
        const fresh = new FreshMessages();
        expect(texts(fresh.take(state([welcome, ...pick])))).toEqual(texts([welcome, ...pick]));
        expect(fresh.take(state([welcome, ...pick]))).toEqual([]);
    });

    test('messages with no observation id (an unpublished collect) are told apart by tick and count', () => {
        const fresh = new FreshMessages();
        const a = [msg('You swing your pick at the rock.', undefined, 9), msg('You swing your pick at the rock.', undefined, 9)];
        expect(fresh.take(state(a.slice(0, 1)))).toHaveLength(1);
        expect(fresh.take(state(a))).toHaveLength(1);
        expect(fresh.take(state(a))).toHaveLength(0);
    });
});
