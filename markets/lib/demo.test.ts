import { describe, expect, test } from 'bun:test';
import { DEMO_ORIGIN, Gentle, HttpError } from './demo.ts';

/** A fake clock whose sleep advances time, so pacing is measured without waiting. */
function clock() {
    let t = 1_000_000;
    const sleeps: number[] = [];
    return { now: () => t, sleep: async (ms: number) => void (sleeps.push(ms), (t += ms)), sleeps };
}

const reply = (status: number, body = 'ok') => new Response(body, { status });

describe('Gentle', () => {
    test('derives the game HTTP origin from a SERVER value', () => {
        expect(DEMO_ORIGIN).toBe('https://rs-sdk-demo.fly.dev');
        expect(new Gentle({ server: 'wss://rs-sdk-demo.fly.dev/gateway' }).origin).toBe('https://rs-sdk-demo.fly.dev');
        expect(new Gentle({ server: 'localhost:9300' }).origin).toBe('http://localhost:9300');
    });

    test('spaces requests at least minIntervalMs apart', async () => {
        const c = clock();
        const at: number[] = [];
        const g = new Gentle({ minIntervalMs: 3000, now: c.now, sleep: c.sleep, fetchImpl: (async () => (at.push(c.now()), reply(200))) as unknown as typeof fetch });
        await g.text('/a');
        await g.text('/b');
        await g.text('/c');
        expect(at[1]! - at[0]!).toBe(3000);
        expect(at[2]! - at[1]!).toBe(3000);
        expect(g.requests).toBe(3);
    });

    test('retries a 503 with backoff and returns the later answer', async () => {
        const c = clock();
        const statuses = [503, 503, 200];
        const g = new Gentle({ minIntervalMs: 0, now: c.now, sleep: c.sleep, fetchImpl: (async () => reply(statuses.shift()!, 'fine')) as unknown as typeof fetch });
        expect(await g.text('/x')).toBe('fine');
        expect(c.sleeps).toEqual([2000, 4000]);
    });

    test('does not retry a 404', async () => {
        const c = clock();
        let calls = 0;
        const g = new Gentle({ minIntervalMs: 0, now: c.now, sleep: c.sleep, fetchImpl: (async () => (calls++, reply(404))) as unknown as typeof fetch });
        await expect(g.text('/missing')).rejects.toBeInstanceOf(HttpError);
        expect(calls).toBe(1);
    });

    test('gives up after the attempt budget', async () => {
        const c = clock();
        const g = new Gentle({ minIntervalMs: 0, attempts: 2, now: c.now, sleep: c.sleep, fetchImpl: (async () => reply(502)) as unknown as typeof fetch });
        await expect(g.text('/down')).rejects.toThrow('/down: gave up after 2 attempts');
    });
});
