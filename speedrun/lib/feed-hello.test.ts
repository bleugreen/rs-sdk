import { describe, expect, test } from 'bun:test';
import { describePreflight, feedUrl, parseHello, readFeedHello, tickPreflight, watchFeedTicks, type FeedRead } from './feed-hello';

const hello = (tickMs: number) => JSON.stringify({ t: 'hello', v: 1, rev: 254, tick: 5000, tickMs, players: 12 });
const read = (tickMs: number): FeedRead => ({ ok: true, url: 'wss://w/worldfeed', hello: { tickMs, players: 12, tick: 5000 }, wallMs: 50 });
const frozen = (tickMs: number) => ({ ok: true as const, tickMs, line: 397 });

/** A fake socket that answers like the engine's feed, or fails, on the next microtask. */
function fakeSocket(behave: { message?: string; error?: boolean; close?: number; silent?: boolean }) {
    const s: { onmessage: ((e: { data: unknown }) => void) | null; onerror: ((e: unknown) => void) | null; onclose: ((e: { code?: number }) => void) | null; onopen: null; closed: boolean; close(): void } = {
        onopen: null, onmessage: null, onerror: null, onclose: null, closed: false,
        close: () => { s.closed = true; },
    };
    queueMicrotask(() => {
        if (behave.silent) return;
        if (behave.error) s.onerror?.({});
        else if (behave.close !== undefined) s.onclose?.({ code: behave.close });
        else s.onmessage?.({ data: behave.message! });
    });
    return s;
}

describe('tickPreflight: the decision on readings', () => {
    test('the feed, the freeze and tickMs() agree: passes, nothing overridden', () => {
        const p = tickPreflight(read(400), frozen(400), 400);
        expect([p.ok, p.problems, p.overridden]).toEqual([true, [], false]);
        expect(p.reading).toEqual({ url: 'wss://w/worldfeed', feedTickMs: 400, players: 12, feedTick: 5000, recordedTickMs: 400, localTickMs: 400 });
    });

    test('a server off the freeze refuses, naming both', () => {
        const p = tickPreflight(read(300), frozen(400), 300);
        expect(p.ok).toBe(false);
        expect(p.problems).toEqual(['the server runs 300 ms ticks, the floor froze at 400 (STEP-MANIFEST.md:397)']);
    });

    test("tickMs() off the server (SPEEDRUN_TICK_MS unset on a 400 world) refuses with the fix", () => {
        const p = tickPreflight(read(400), frozen(400), 300);
        expect(p.problems).toEqual(["this process's tickMs() is 300 (SPEEDRUN_TICK_MS / NODE_TICKRATE) but the server runs 400: set SPEEDRUN_TICK_MS=400"]);
    });

    test('an unreadable feed refuses with its reason; so does a freeze with no tickMs', () => {
        const down = tickPreflight({ ok: false, url: 'wss://w/worldfeed', reason: 'no hello from wss://w/worldfeed within 10000 ms' }, frozen(400), 400);
        expect([down.ok, down.problems]).toEqual([false, ['the world feed is unreadable: no hello from wss://w/worldfeed within 10000 ms']]);
        expect(down.reading.error).toContain('no hello');
        const none = tickPreflight(read(400), { ok: false, reason: 'STEP-MANIFEST.md:3: no `tickMs=<ms>`' }, 400);
        expect([none.ok, none.problems]).toEqual([false, ['STEP-MANIFEST.md:3: no `tickMs=<ms>`']]);
    });

    test('the override passes every problem and is reported as overridden, never silent', () => {
        const p = tickPreflight(read(300), frozen(400), 400, true);
        expect([p.ok, p.overridden, p.problems.length]).toEqual([true, true, 2]);
        expect(describePreflight(p)).toContain('OVERRIDDEN by --tick-override: the server runs 300 ms ticks');
        expect(tickPreflight(read(400), frozen(400), 400, true).overridden).toBe(false);
    });

    test('no freeze given (a rehearsal): only the feed against tickMs()', () => {
        expect(tickPreflight(read(400), null, 400).ok).toBe(true);
        expect(tickPreflight(read(400), null, 300).ok).toBe(false);
    });
});

describe('reading the hello', () => {
    test('parseHello takes tickMs, players and tick; a tick message or junk is not a hello', () => {
        expect(parseHello(hello(400))).toEqual({ tickMs: 400, players: 12, tick: 5000, rev: 254, v: 1 });
        expect(parseHello('{"t":"tick","k":1,"ms":400}')).toBe('the first message is not a hello (t="tick")');
        expect(parseHello('nope')).toBe('the first message is not JSON');
        expect(parseHello('{"t":"hello"}')).toContain('carries no tickMs');
    });

    test('readFeedHello: the hello, then the socket is closed; an error, a close or silence is a reason, never a throw', async () => {
        let sock: ReturnType<typeof fakeSocket> | null = null;
        const ok = await readFeedHello('wss://w/worldfeed', { connect: () => (sock = fakeSocket({ message: hello(400) })) as never });
        expect(ok).toMatchObject({ ok: true, hello: { tickMs: 400, players: 12 } });
        expect(sock!.closed).toBe(true);
        expect(await readFeedHello('wss://w/worldfeed', { connect: () => fakeSocket({ error: true }) as never })).toMatchObject({ ok: false, reason: expect.stringContaining('connection error') });
        expect(await readFeedHello('wss://w/worldfeed', { connect: () => fakeSocket({ close: 1008 }) as never })).toMatchObject({ ok: false, reason: expect.stringContaining('closed before a hello (code 1008)') });
        expect(await readFeedHello('wss://w/worldfeed', { timeoutMs: 20, connect: () => fakeSocket({ silent: true }) as never })).toMatchObject({ ok: false, reason: 'no hello from wss://w/worldfeed within 20 ms' });
        expect(await readFeedHello('wss://w/worldfeed', { connect: () => { throw new Error('bad url'); } })).toMatchObject({ ok: false, reason: expect.stringContaining('bad url') });
    });

    test('feedUrl: the demo over wss, a lab on its web port, the env override, a token hidden from the reading', async () => {
        expect(feedUrl('rs-sdk-demo.fly.dev', {})).toBe('wss://rs-sdk-demo.fly.dev/worldfeed');
        expect(feedUrl('localhost', { WEB_PORT: '9640' })).toBe('ws://localhost:9640/worldfeed');
        expect(feedUrl('localhost:8888', {})).toBe('ws://localhost:8888/worldfeed');
        expect(feedUrl('x', { SPEEDRUN_FEED_URL: 'ws://127.0.0.1:1/worldfeed', SPEEDRUN_FEED_TOKEN: 'a b' })).toBe('ws://127.0.0.1:1/worldfeed?token=a%20b');
        const r = await readFeedHello('wss://w/worldfeed?token=secret', { connect: () => fakeSocket({ error: true }) as never });
        expect(r.url).toBe('wss://w/worldfeed?token=***');
    });
});


describe('the login-free observed world clock', () => {
    function fixture(idleMs = 50) {
        const socket = {
            onopen: null as null | (() => void),
            onmessage: null as null | ((e: { data: unknown }) => void),
            onerror: null as null | ((e: unknown) => void),
            onclose: null as null | ((e: { code?: number }) => void),
            sent: [] as string[], closed: false,
            send(data: string) { this.sent.push(data); },
            close() { this.closed = true; }
        };
        const clock = watchFeedTicks('ws://world/worldfeed?token=secret', { connect: () => socket, idleMs });
        socket.onopen!();
        const emit = (m: unknown) => socket.onmessage!({ data: JSON.stringify(m) });
        return { clock, socket, emit };
    }

    test('subscribes to a minimal rectangle; hello, junk and duplicate ticks never manufacture advances', async () => {
        const f = fixture();
        try {
            expect(JSON.parse(f.socket.sent[0]!)).toEqual({ t: 'sub', x: 0, z: 0, w: 1, h: 1 });
            const first = f.clock.next(-1);
            f.emit({ t: 'hello', tick: 900, tickMs: 400 });
            f.emit({ t: 'tick', k: '901' });
            f.emit({ t: 'tick', k: 901 });
            expect(await first).toMatchObject({ tick: 901, ms: expect.any(Number) });
            let advanced = false;
            const next = f.clock.next(901).then(b => (advanced = true, b));
            f.emit({ t: 'tick', k: 901 });
            await Promise.resolve();
            expect(advanced).toBe(false);
            f.emit({ t: 'tick', k: 905 });
            expect((await next).tick).toBe(905);
        } finally { f.clock.close(); }
        expect(f.socket.closed).toBe(true);
    });

    test('a stopped feed fails closed without a single client state tick, hiding its token', async () => {
        const f = fixture(10);
        await expect(f.clock.next(-1)).rejects.toThrow('world feed stopped');
        expect(f.socket.closed).toBe(true);
        await expect(f.clock.next(-1)).rejects.not.toThrow('secret');
    });

    test('world tick rollback, connection errors and close reject outstanding waits', async () => {
        for (const fail of ['rollback', 'error', 'close'] as const) {
            const f = fixture();
            f.emit({ t: 'tick', k: 20 });
            const waiting = f.clock.next(20);
            if (fail === 'rollback') f.emit({ t: 'tick', k: 19 });
            else if (fail === 'error') f.socket.onerror!({});
            else f.socket.onclose!({ code: 1006 });
            await expect(waiting).rejects.toThrow('world feed');
            expect(f.socket.closed).toBe(true);
        }
    });

    test('explicit cleanup rejects a pending wait and closes the socket', async () => {
        const f = fixture();
        const waiting = f.clock.next(-1);
        f.clock.close();
        await expect(waiting).rejects.toThrow('world feed closed');
        expect(f.socket.closed).toBe(true);
    });
});
