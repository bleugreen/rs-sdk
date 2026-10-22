import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { CatchUpMeter, DemoMonitor, demoOrigin, formatStatus, listedInWorld, playerNameKey, readStatus, RestartTracker, type DemoSample } from './demo-status';

describe('listedInWorld', () => {
    const serve = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
    test("matches the account against the server's display names", async () => {
        expect(playerNameKey('Cairn T06')).toBe(playerNameKey('cairn_t06'));
        const players = [{ name: 'Cairn T06', x: 3094, z: 3106, level: 0 }, { name: 'someone', x: 0, z: 0, level: 0 }];
        expect(await listedInWorld('https://w', 'cairn_t06', 1000, serve(players))).toBe(true);
        expect(await listedInWorld('https://w', 'cairn_t07', 1000, serve(players))).toBe(false);
        expect(await listedInWorld('https://w', 'cairn_t06', 1000, serve({ players }))).toBe(true);
    });
    test('null when the world does not answer with a list', async () => {
        expect(await listedInWorld('https://w', 'cairn_t06', 1000, serve([], 503))).toBeNull();
        expect(await listedInWorld('https://w', 'cairn_t06', 1000, serve({ error: 'x' }))).toBeNull();
        const down = (async () => Promise.reject(new Error('refused'))) as unknown as typeof fetch;
        expect(await listedInWorld('https://w', 'cairn_t06', 1000, down)).toBeNull();
    });
});

const T = (hms: string) => Date.parse(`2026-10-21T${hms}-07:00`);
const at = (hms: string, players: number | null): DemoSample => ({ at: T(hms), players, ms: 50 });

describe('RestartTracker', () => {
    test('replays the 06:14 PDT restart (rs/102 poll + rs/41 fleet logins)', () => {
        const tr = new RestartTracker('https://rs-sdk-demo.fly.dev');
        for (const [t, n] of [['06:12:58', 1690], ['06:13:18', 1688], ['06:13:38', 1687]] as const) tr.observe(at(t, n));
        expect(tr.status().phase).toBe('up');
        tr.observe(at('06:14:07', null));
        // One unanswered sample is a stall or a blip until the next one agrees.
        expect(tr.status().phase).toBe('up');
        expect(tr.pendingMisses).toBe(1);
        tr.observe(at('06:14:35', null));
        expect(tr.status().phase).toBe('down');
        expect(tr.status().lastRestart?.downAt).toBe(T('06:14:07'));
        expect(tr.status().lastRestart?.lastNormalAt).toBe(T('06:13:38'));
        tr.observe(at('06:14:55', 0));
        expect(tr.status().phase).toBe('refusing');
        tr.noteLoginRefused(T('06:15:30'));
        tr.observe(at('06:16:16', 10));
        expect(tr.status().phase).toBe('refusing');
        tr.noteLoginAccepted(T('06:16:35'));
        expect(tr.status().phase).toBe('recovering');
        tr.observe(at('06:16:36', 473));
        expect(tr.status().phase).toBe('recovering');
        tr.observe(at('06:17:16', 1160));
        const s = tr.status(T('06:17:30'));
        expect(s.phase).toBe('up');
        expect(s.lastRestart).toMatchObject({ downAt: T('06:14:07'), loginAt: T('06:16:35'), refusals: 1, answeringAt: T('06:14:55') });
        expect(formatStatus(s, T('06:17:30'))).toBe('demo up, 1,160 players | last restart 06:14:07, 3m23s ago');
        // A status read long after its last sample says so.
        expect(formatStatus(s, T('07:46:00'))).toBe('demo up, 1,160 players | last restart 06:14:07, 1h31m ago | (sample 1h28m old)');
    });

    test('a collapse is a restart even when the unreachable minute was missed', () => {
        const tr = new RestartTracker('o');
        tr.observe(at('04:52:45', 1680));
        tr.observe(at('04:53:05', 1680));
        tr.observe(at('04:54:18', 21));
        expect(tr.status().phase).toBe('refusing');
        expect(tr.status().lastRestart?.downAt).toBe(T('04:54:18'));
    });

    test('a single unanswered sample (a 2 s stall, a network blip) is not a restart', () => {
        const tr = new RestartTracker('o');
        tr.observe(at('07:50:00', 1600));
        tr.observe(at('07:50:20', null));
        tr.observe(at('07:50:40', 1590));
        expect(tr.status().phase).toBe('up');
        expect(tr.status().lastRestart).toBeNull();
        expect(tr.pendingMisses).toBe(0);
    });

    test('an ordinary dip is not a restart', () => {
        const tr = new RestartTracker('o');
        for (const n of [1700, 1650, 1500, 1400]) tr.observe({ at: Date.now(), players: n, ms: 1 });
        expect(tr.status().phase).toBe('up');
        expect(tr.status().lastRestart).toBeNull();
    });

    test('the lab (one player, no crowd): refused logins open the outage, an accepted one ends it', () => {
        const tr = new RestartTracker('http://localhost:9300');
        tr.observe({ at: 1_000, players: 1, ms: 1 });
        tr.observe({ at: 2_000, players: null, ms: 1 });
        tr.observe({ at: 2_500, players: null, ms: 1 });
        expect(tr.status().phase).toBe('down');
        tr.observe({ at: 3_000, players: 0, ms: 1 });
        tr.noteLoginRefused(3_100);
        expect(tr.inOutage).toBe(true);
        tr.noteLoginAccepted(9_000);
        expect(tr.status().phase).toBe('up');
        expect(tr.status().lastRestart).toMatchObject({ downAt: 2_000, loginAt: 9_000, refusals: 1 });
    });

    test('restartLikely needs every one of the last N minutes at the threshold', () => {
        const tr = new RestartTracker('o', { burstPerMinute: 10, burstMinutes: 3 });
        tr.noteCatchUps([0, 21, 26]);
        expect(tr.restartLikely).toBe(false);
        tr.noteCatchUps([0, 21, 26, 22]);
        expect(tr.restartLikely).toBe(true);
        tr.noteCatchUps([21, 26, 22, 4]);
        expect(tr.restartLikely).toBe(false);
    });
});

describe('CatchUpMeter', () => {
    test('counts an interval under 150 ms right after one over 350 ms, per minute', () => {
        const m = new CatchUpMeter();
        let t = 0;
        const tick = (gap: number) => m.arrival((t += gap));
        tick(0);
        for (let i = 0; i < 10; i++) tick(300); // steady
        tick(420); tick(100); // one catch-up
        tick(600); tick(40); // another
        tick(360); tick(160); // 160 is not under 150
        expect(m.current).toBe(2);
        t = 60_000;
        tick(300);
        expect(m.perMinute()).toEqual([2]);
    });
});

describe('DemoMonitor', () => {
    test('writes the status file and keeps the last restart across monitor restarts', async () => {
        const file = join(mkdtempSync(join(tmpdir(), 'demo-status-')), 'status.json');
        const replies: (number | null)[] = [1700, null, null, 0, 1600];
        const sample = async () => ({ at: Date.now(), players: replies.length ? replies.shift()! : 1600, ms: 1 });
        const lines: string[] = [];
        const mon = new DemoMonitor('o', { file, sample, onLine: l => lines.push(l) });
        for (let i = 0; i < 5; i++) await mon.sampleNow();
        expect(lines[1]).toStartWith('demo up');
        expect(lines[2]).toStartWith('DEMO DOWN since');
        expect(readStatus(file)?.lastRestart).not.toBeNull();
        const again = new DemoMonitor('o', { file, sample });
        expect(again.tracker.status().lastRestart?.downAt).toBe(readStatus(file)!.lastRestart!.downAt);
    });
});

test('demoOrigin', () => {
    expect(demoOrigin('rs-sdk-demo.fly.dev')).toBe('https://rs-sdk-demo.fly.dev');
    expect(demoOrigin('localhost:9300')).toBe('http://localhost:9300');
    expect(demoOrigin('wss://rs-sdk-demo.fly.dev/gateway')).toBe('https://rs-sdk-demo.fly.dev');
    expect(demoOrigin(undefined)).toBe('http://localhost:8888');
});
