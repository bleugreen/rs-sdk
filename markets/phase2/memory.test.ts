import { describe, expect, test } from 'bun:test';
import { emptyArrays, LoadMeter, memoryLine, shareLoads, type LocIndexLoader, type LocIndexOptions } from './memory.ts';

const MB = 1_048_576;

describe('memoryLine', () => {
    test('MB to one decimal', () => {
        expect(memoryLine({ rss: 512.34 * MB, heapUsed: 100 * MB, external: 0.05 * MB, arrayBuffers: 13.86 * MB })).toEqual({ rssMb: 512.3, heapUsedMb: 100, externalMb: 0.1, arrayBuffersMb: 13.9 });
    });
});

describe('LoadMeter', () => {
    const meter = () => {
        const clock = { t: 0, cpu: 0 };
        const m = new LoadMeter(
            100,
            () => clock.t,
            () => ({ user: clock.cpu, system: 0 })
        );
        m.stop();
        return { m, clock };
    };

    test('lag is how late each 100 ms timer fired; CPU is a share of one core', () => {
        const { m, clock } = meter();
        for (const late of [0, 0, 5, 300, 0]) {
            clock.t += 100 + late;
            m.tick();
        }
        clock.cpu += 201_250; // 201.25 ms of CPU over 805 ms
        expect(m.read()).toEqual({ cpuPct: 25, lagP50Ms: 0, lagP99Ms: 300, lagMaxMs: 300 });
    });

    test('a read starts the next window', () => {
        const { m, clock } = meter();
        clock.t += 900;
        m.tick();
        m.read();
        clock.t += 100;
        m.tick();
        expect(m.read()).toEqual({ cpuPct: 0, lagP50Ms: 0, lagP99Ms: 0, lagMaxMs: 0 });
    });

    test('samples stay bounded when nothing reads them, and the max still counts', () => {
        const { m, clock } = meter();
        for (let i = 0; i < 20_000; i++) {
            clock.t += i === 19_999 ? 1_100 : 100;
            m.tick();
        }
        expect(m.held).toBe(6_000);
        expect(m.read().lagMaxMs).toBe(1_000);
        expect(m.held).toBe(0);
    });
});

describe('emptyArrays', () => {
    test('empties every array in place, so other holders of the same arrays see them empty', () => {
        const tiles = [
            [0, 1, 2, 3],
            [0, 4, 5, 6]
        ];
        const source = { tiles, zones: [[0, 1, 1]], doors: [] as number[][], version: 3 };
        expect(emptyArrays(source)).toBe(3);
        expect(tiles).toHaveLength(0);
        expect(source.zones).toHaveLength(0);
        expect(source.version).toBe(3);
        expect(emptyArrays(source)).toBe(0);
    });
});

describe('shareLoads', () => {
    const opts = (crc: number): LocIndexOptions => ({ origin: 'http://localhost:1', cacheDir: '/tmp/x', versionlistCrc: crc });
    const loader = (fail = false) => {
        const calls: number[] = [];
        const l: LocIndexLoader = {
            load(o) {
                calls.push(o.versionlistCrc);
                return fail && calls.length === 1 ? Promise.reject(new Error('read failed')) : Promise.resolve({ crc: o.versionlistCrc, n: calls.length });
            }
        };
        return { l, calls };
    };

    test('every login after the first gets the first copy', async () => {
        const { l, calls } = loader();
        shareLoads(l);
        const copies = await Promise.all(Array.from({ length: 16 }, () => l.load(opts(7))));
        expect(calls).toEqual([7]);
        expect(new Set(copies).size).toBe(1);
    });

    test('a new versionlist CRC loads again and drops the old copy', async () => {
        const { l, calls } = loader();
        shareLoads(l);
        const a = await l.load(opts(7));
        const b = await l.load(opts(8));
        expect(b).not.toBe(a);
        await l.load(opts(7));
        expect(calls).toEqual([7, 8, 7]);
    });

    test('a failed load is not kept', async () => {
        const { l, calls } = loader(true);
        shareLoads(l);
        await expect(l.load(opts(7))).rejects.toThrow('read failed');
        await Promise.resolve();
        expect(await l.load(opts(7))).toEqual({ crc: 7, n: 2 });
        expect(calls).toEqual([7, 7]);
    });

    test('sharing twice wraps once', async () => {
        const { l, calls } = loader();
        shareLoads(l);
        const wrapped = l.load;
        shareLoads(l);
        expect(l.load).toBe(wrapped);
        await l.load(opts(7));
        await l.load(opts(7));
        expect(calls).toEqual([7]);
    });
});
