import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { areaAround, hourlyFile, normName, recordFeed, shouldRecentre } from './feed-recorder';

describe('feed recorder rules', () => {
    test('areas are squares around a tile, clamped at 0', () => {
        expect(areaAround(3000, 3300)).toEqual({ x: 2904, z: 3204, w: 192, h: 192 });
        expect(areaAround(10, 10, 64)).toEqual({ x: 0, z: 0, w: 64, h: 64 });
    });

    test('re-centres past 48 tiles, at most every 10 s', () => {
        expect(shouldRecentre({ x: 0, z: 0 }, 49, 0, 10_000)).toBe(true);
        expect(shouldRecentre({ x: 0, z: 0 }, 48, 48, 10_000)).toBe(false);
        expect(shouldRecentre({ x: 0, z: 0 }, 100, 0, 9_999)).toBe(false);
    });

    test('names match blind to case, spaces and underscores; hourly files are named by UTC hour', () => {
        expect(normName('Film_FM 1')).toBe(normName('film fm_1'));
        expect(hourlyFile('/o', Date.UTC(2026, 9, 23, 21, 59))).toBe('/o/feed-2026102321Z.jsonl');
    });
});

describe('recording a feed', () => {
    let dir = '';
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    test('writes frames verbatim with recv, records its subs, and follows the roster', async () => {
        dir = mkdtempSync(join(tmpdir(), 'feed-test-'));
        const got: string[] = [];
        type Sock = { send(s: string): void };
        let client: Sock | null = null;
        const server = Bun.serve({
            port: 0,
            fetch(req, srv) {
                return srv.upgrade(req) ? undefined : new Response('no', { status: 400 });
            },
            websocket: {
                open(ws) {
                    client = ws;
                    ws.send(JSON.stringify({ t: 'hello', v: 1, rev: 225, tick: 41, tickMs: 400, players: 1 }));
                },
                message(_ws, m) {
                    got.push(String(m));
                }
            }
        });
        let clock = 1_000_000;
        const rec = recordFeed({ url: `ws://localhost:${server.port}/worldfeed`, out: join(dir, 'feed.jsonl'), centre: { x: 3000, z: 3300 }, follow: 'Film_Bot', now: () => clock });
        expect((await rec.hello).tickMs).toBe(400);
        const until = async (f: () => boolean) => {
            for (let i = 0; i < 100 && !f(); i++) await Bun.sleep(10);
        };
        await until(() => got.length >= 2);
        expect(got.map(m => JSON.parse(m).t)).toEqual(['roster', 'sub']);
        const tick = '{"t":"tick","k":42,"ms":400,"p":[{"i":3,"x":3001,"z":3300,"l":0,"m":[4]}]}';
        client!.send(tick);
        // Too close to move the area, then far enough but too soon, then far enough and late enough.
        clock += 20_000;
        client!.send(JSON.stringify({ t: 'roster', k: 50, p: [[3, 'film bot', 3040, 3300, 0, 3]], npcs: 9 }));
        clock += 1_000;
        client!.send(JSON.stringify({ t: 'roster', k: 60, p: [[3, 'film bot', 3100, 3300, 0, 3]], npcs: 9 }));
        await until(() => got.length >= 3);
        expect(JSON.parse(got[2]!)).toEqual({ t: 'sub', ...areaAround(3100, 3300) });
        expect(rec.followedSlot).toBe(3);
        expect(rec.ticks()).toEqual([{ rx: 1_000_000, k: 42 }]);
        await rec.stop();
        server.stop(true);

        const lines = readFileSync(join(dir, 'feed.jsonl'), 'utf8').trim().split('\n');
        expect(lines).toContain(`{"recv":1000000,"frame":${tick}}`);
        expect(lines.filter(l => l.includes('"sent"')).map(l => JSON.parse(l).sent.t)).toEqual(['roster', 'sub', 'sub']);
        expect(lines.every(l => typeof JSON.parse(l).recv === 'number')).toBe(true);
        expect(rec.areas).toHaveLength(2);
        expect(readdirSync(dir)).toEqual(['feed.jsonl']);
    });
});
