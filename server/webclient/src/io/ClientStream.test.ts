import { describe, expect, test } from 'bun:test';

import ClientStream from './ClientStream.js';

/** A socket the test drives: open until it says otherwise, sends recorded. */
function fakeSocket() {
    const sent: Uint8Array[] = [];
    const s = {
        url: 'ws://world:43594/',
        readyState: 1,
        bufferedAmount: 0,
        binaryType: '',
        onclose: null as ((e: unknown) => void) | null,
        onerror: null as ((e: unknown) => void) | null,
        onmessage: null as ((e: unknown) => void) | null,
        send: (b: Uint8Array) => void sent.push(b),
        close: () => void (s.readyState = 3),
    };
    return { s, socket: s as unknown as WebSocket, sent };
}

const caught = (f: () => void): unknown => {
    try {
        f();
    } catch (e) {
        return e;
    }
    return null;
};

// Client.ts calls lostCon on the throw from the next per-second write (or a read) of a closed socket,
// so a socket that closes is noticed within about a second; only a silent open one waits for
// NO_DATA_TIMEOUT_MS.
describe('ClientStream: a closed socket fails at once, a silent open one never does', () => {
    test('silent and open: writes go out and nothing reads as an error', () => {
        const { socket, sent } = fakeSocket();
        const stream = new ClientStream(socket);
        for (let i = 0; i < 120; i++) expect(caught(() => stream.write(new Uint8Array([1]), 1))).toBeNull();
        expect(sent.length).toBe(120);
        expect(stream.available).toBe(0);
        expect(stream.isClosed).toBe(false);
    });

    for (const how of ['onclose', 'onerror'] as const) {
        test(`closed by the far end (${how}): the next write throws the socket, and a read ends`, async () => {
            const { s, socket } = fakeSocket();
            const stream = new ClientStream(socket);
            s.readyState = 3;
            s[how]!({});
            expect(caught(() => stream.write(new Uint8Array([1]), 1))).toBe(socket);
            expect(await stream.read()).toBe(-1);
            expect(stream.isClosed).toBe(true);
        });
    }
});
