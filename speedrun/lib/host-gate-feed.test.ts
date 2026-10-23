import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compactFeedLog, type FeedTick, parseFeedLog, pathCheck } from '../../docs/speedrun/scripts/host-gate-feed';

const T = 400;
const K0 = 5000;
const T0 = 1_792_700_000_000;
const SCRIPT = join(import.meta.dir, '../../docs/speedrun/scripts/host-gate-feed.ts');
// a login-free feed read of the demo, 190 s on an empty 1x1 tile at T = 400 (22 Oct, 20:37Z)
const LIVE = join(import.meta.dir, 'fixtures/host-gate-feed.log');

/** A feed whose frames arrive 0.5 ms after each cycle; `ms` is the engine's interval per tick. */
function feedOf(ms: number[]): FeedTick[] {
    let at = T0;
    return ms.map((m, i) => ({ k: K0 + i, ms: i === 0 ? null : m, at: (at += i === 0 ? 0 : m) + 0.5 }));
}
const steady = (n: number) => Array.from({ length: n }, () => T);

/**
 * The gate probe's view of feed ticks [from, from + count): the same frames `offset` ms later, each
 * held by `hold[k]` more, in order on one socket (a held frame holds the ones behind it). Returns
 * tickArrivalsMs as the gate writes them and the end time the probe prints, 2 ms after its last frame.
 */
function probeOf(feed: readonly FeedTick[], from: number, count: number, opts: { offset?: number; hold?: Record<number, number>; jitter?: () => number } = {}) {
    const abs: number[] = [];
    for (const f of feed.filter(f => f.k >= from && f.k < from + count)) {
        const at = f.at + (opts.offset ?? 1.2) + (opts.hold?.[f.k] ?? 0) + (opts.jitter?.() ?? 0);
        abs.push(Math.max(at, abs.at(-1) ?? -Infinity));
    }
    return { arrivalsMs: abs.map(a => Math.round((a - abs[0]!) * 10) / 10), endEpochMs: abs.at(-1)! + 2 };
}
/** Hold a probe frame until the next one arrives: the glued pair of 21 Oct. */
const glue = (k: number) => ({ [k]: T + 0.2 });

function check(feed: FeedTick[], probe: ReturnType<typeof probeOf>) {
    return pathCheck(feed, probe.arrivalsMs, probe.endEpochMs, T);
}

describe('pathCheck', () => {
    // an overrun tick and, on the engine's fixed grid, the next one run at once
    const overrun = () => {
        const ms = steady(200);
        ms[60] = 610;
        ms[61] = 190;
        return ms;
    };

    test('a server overrun and its catch-up read as the server', () => {
        const ms = overrun();
        const feed = feedOf(ms);
        const r = check(feed, probeOf(feed, K0 + 20, 151));
        expect(r).not.toBeNull();
        expect(r!.probeFirstTick).toBe(K0 + 20);
        expect(r!.offsetMs).toBeCloseTo(3.2, 1);
        expect(r!.offsetSpreadMs).toBe(0);
        expect(r!.ticksMatched).toBe(151);
        expect([r!.serverSlow, r!.serverCatchUp, r!.pathHeld, r!.unmatched]).toEqual([1, 1, 0, 0]);
        expect(r!.anomalies).toEqual([
            { k: K0 + 60, probeMs: 610, serverMs: 610, heldMs: 0, label: 'server slow' },
            { k: K0 + 61, probeMs: 190, serverMs: 190, heldMs: 0, label: 'server catch-up' },
        ]);
    });

    test('a frame held on the path reads path-held, glued or not', () => {
        const feed = feedOf(steady(200));
        const r = check(feed, probeOf(feed, K0 + 20, 151, { hold: { ...glue(K0 + 80), [K0 + 100]: 180 } }));
        expect([r!.serverSlow, r!.serverCatchUp, r!.pathHeld, r!.unmatched]).toEqual([0, 0, 3, 0]);
        expect(r!.anomalies.map(a => [a.k - K0, a.probeMs, a.serverMs, a.heldMs, a.label])).toEqual([
            [80, 800.2, 400, 400.2, 'path-held'],
            [81, 0, 400, 0.2, 'path-held'],
            [100, 580, 400, 180, 'path-held'],
        ]);
        expect(r!.offsetMs).toBeCloseTo(3.2, 1);
    });

    test('both in one minute', () => {
        const feed = feedOf(overrun());
        const r = check(feed, probeOf(feed, K0 + 20, 151, { hold: glue(K0 + 120) }));
        expect([r!.serverSlow, r!.serverCatchUp, r!.pathHeld, r!.unmatched]).toEqual([1, 1, 2, 0]);
        expect(r!.anomalies.map(a => `${a.k - K0} ${a.label}`)).toEqual(['60 server slow', '61 server catch-up', '120 path-held', '121 path-held']);
    });

    test('an overrun the path held as well stays the server', () => {
        const feed = feedOf(overrun());
        // the overrun tick held 100 ms more: still the server's late tick, then its catch-up
        const r = check(feed, probeOf(feed, K0 + 20, 151, { hold: { [K0 + 60]: 100 } }));
        expect(r!.anomalies.map(a => `${a.k - K0} ${a.label} ${a.heldMs}`)).toEqual(['60 server slow 100', '61 server catch-up 0']);
    });

    test('a held last frame does not shift the match', () => {
        const feed = feedOf(steady(200));
        const r = check(feed, probeOf(feed, K0 + 20, 151, { hold: { [K0 + 170]: 260 } }));
        expect(r!.probeFirstTick).toBe(K0 + 20);
        expect(r!.offsetMs).toBeCloseTo(3.2, 1);
        expect(r!.anomalies.map(a => `${a.k - K0} ${a.label} ${a.heldMs}`)).toEqual(['170 path-held 260']);
    });

    test('a 300-500 ms tick after an overrun is not a catch-up (under T/2 only)', () => {
        const ms = steady(200);
        ms[60] = 560;
        ms[61] = 240;
        const feed = feedOf(ms);
        expect(check(feed, probeOf(feed, K0 + 20, 151))!.anomalies.map(a => `${a.k - K0} ${a.label}`)).toEqual(['60 server slow']);
    });

    test('ticks past the end of the feed are unmatched', () => {
        const all = feedOf(steady(200));
        const probe = probeOf(all, K0 + 20, 151, { hold: glue(K0 + 150) });
        const r = check(all.slice(0, 140), probe);
        expect(r!.ticksMatched).toBe(120);
        expect([r!.serverSlow, r!.serverCatchUp, r!.pathHeld, r!.unmatched]).toEqual([0, 0, 0, 2]);
        expect(r!.anomalies[0]).toEqual({ k: K0 + 150, probeMs: 800.2, serverMs: null, heldMs: null, label: 'unmatched' });
    });

    test('no match is null, never a guess', () => {
        const feed = feedOf(steady(200));
        const probe = probeOf(feed, K0 + 20, 151);
        // an end time half a tick off can't place the frames
        expect(pathCheck(feed, probe.arrivalsMs, probe.endEpochMs + T / 2, T)).toBeNull();
        // a probe mostly outside the feed
        expect(check(feed.slice(0, 60), probe)).toBeNull();
        expect(pathCheck([], probe.arrivalsMs, probe.endEpochMs, T)).toBeNull();
        expect(pathCheck(feed, [0], probe.endEpochMs, T)).toBeNull();
        expect(pathCheck(feed, probe.arrivalsMs, NaN, T)).toBeNull();
    });
});

describe('the live feed log', () => {
    const feed = parseFeedLog(readFileSync(LIVE, 'utf8'));
    let seed = 7;
    const jitter = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.5;
    const from = feed[150]!.k;

    test('reads as written: consecutive ticks, the first ms unknown', () => {
        expect(feed.length).toBe(474);
        expect(feed[0]!.ms).toBeNull();
        expect(feed.every((f, i) => i === 0 || (f.k === feed[i - 1]!.k + 1 && f.ms! > 0 && f.at > feed[i - 1]!.at))).toBe(true);
    });

    test('aligns with a probe built from the same frames, and labels by the engine', () => {
        const r = check(feed, probeOf(feed, from, 151, { offset: 0.8, jitter }));
        expect(r!.probeFirstTick).toBe(from);
        expect(r!.ticksMatched).toBe(151);
        expect(r!.offsetMs).toBeCloseTo(2.8, 0);
        expect(r!.offsetSpreadMs).toBeLessThan(0.3);
        expect(r!.unmatched).toBe(0);
        // that minute had one engine catch-up (tick 4632: 545 ms, then 197)
        expect(r!.serverCatchUp).toBe(1);
        for (const a of r!.anomalies) {
            expect(Math.abs(a.heldMs!)).toBeLessThan(1);
            // the probe copies the feed's arrivals, so a late gap the engine's ms do not show was
            // added after the engine stamped the tick: path-held
            if (a.label === 'server slow') expect(a.serverMs!).toBeGreaterThan((T * 7) / 6);
            if (a.label === 'path-held') expect(a.serverMs!).toBeLessThanOrEqual((T * 7) / 6);
        }
        expect(r!.serverSlow + r!.serverCatchUp + r!.pathHeld).toBe(r!.anomalies.length);
    });

    test('a frame glued on the probe socket alone shows as held against the feed copy', () => {
        const plain = check(feed, probeOf(feed, from, 151, { offset: 0.8, jitter }))!;
        // a tick the engine ran on time, with on-time neighbours
        const k = feed.find((f, i) => f.k > from + 20 && [0, 1, 2].every(j => Math.abs(feed[i + j]!.ms! - T) < 15))!.k;
        const held = check(feed, probeOf(feed, from, 151, { offset: 0.8, jitter, hold: { [k]: feed.find(f => f.k === k + 1)!.at - feed.find(f => f.k === k)!.at + 0.2 } }))!;
        expect(held.pathHeld).toBe(plain.pathHeld + 2);
        expect(held.anomalies.filter(a => a.k === k || a.k === k + 1).map(a => a.label)).toEqual(['path-held', 'path-held']);
        expect(held.anomalies.find(a => a.k === k)!.heldMs!).toBeGreaterThan(T * 0.9);
    });
});

describe('--pathcheck', () => {
    test('reads a feed log and a gate JSON, and keeps the log compact', () => {
        const dir = mkdtempSync(join(tmpdir(), 'pathcheck-'));
        const feed = parseFeedLog(readFileSync(LIVE, 'utf8'));
        const probe = probeOf(feed, feed[150]!.k, 151, { offset: 0.8 });
        writeFileSync(join(dir, 'gate.json'), JSON.stringify({ result: { tickArrivalsMs: probe.arrivalsMs }, verdict: { path: 'direct' } }));
        const run = (...args: string[]) => JSON.parse(Bun.spawnSync(['bun', SCRIPT, '--pathcheck', ...args]).stdout.toString());
        const end = new Date(probe.endEpochMs).toISOString();
        const out = run(LIVE, join(dir, 'gate.json'), end, `--tick-ms=${T}`);
        // the ISO end time carries whole ms
        expect(out.pathCheck).toEqual(pathCheck(feed, probe.arrivalsMs, Date.parse(end), T));
        expect(out.feedLog).toEqual(compactFeedLog(feed));
        expect(out.feedLog.k.every((k: number, i: number) => k === i)).toBe(true);
        expect(JSON.stringify(out.feedLog, null, 2).length).toBeLessThan(40_000);
        // no gate JSON: the log is still kept, the check is null
        expect(run(LIVE, join(dir, 'missing.json'), end)).toEqual({ pathCheck: null, feedLog: compactFeedLog(feed) });
        expect(run(join(dir, 'missing.log'), join(dir, 'gate.json'), end)).toEqual({ pathCheck: null, feedLog: null });
    });
});
