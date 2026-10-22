import { describe, expect, test } from 'bun:test';
import type { BotWorldState } from '../../sdk/types';
import { commonOptions, parseArgs, runProbe, Sampler, sampleRecord, type ProbeDeps, type ProbeSession, type ProbeSpec, type CommonOptions } from './probe-sampler';

function state(o: { tick?: number; x?: number; z?: number; inv?: [string, number][]; bank?: [string, number][] | null; players?: [string, number, number][] } = {}): BotWorldState {
    return {
        tick: o.tick ?? 100,
        inGame: true,
        player: { name: 'probe', worldX: o.x ?? 3200, worldZ: o.z ?? 3200, level: 0, hp: 10, maxHp: 10 },
        inventory: (o.inv ?? []).map(([name, count], slot) => ({ name, count, slot, id: slot, optionsWithIndex: [] })),
        bank: { isOpen: o.bank !== undefined && o.bank !== null, items: (o.bank ?? []).map(([name, count], slot) => ({ name, count, slot, id: slot })), noteMode: false },
        nearbyPlayers: (o.players ?? []).map(([name, x, z], index) => ({ kind: 'player', index, name, x, z, combatLevel: 3, distance: 0 })),
    } as unknown as BotWorldState;
}

describe('arguments', () => {
    test('positional account, --k v and --k=v', () => {
        const a = parseArgs(['acc', '--minutes', '5', '--out=x.jsonl', '--flag']);
        expect(a).toEqual({ positional: ['acc'], flags: { minutes: '5', out: 'x.jsonl', flag: 'true' } });
    });
    test('common options need an account and --minutes, and refuse unknown flags', () => {
        expect(commonOptions(parseArgs(['acc', '--minutes', '2.5']), [])).toEqual({ account: 'acc', minutes: 2.5, out: null });
        expect(() => commonOptions(parseArgs(['--minutes', '1']), [])).toThrow(/account/);
        expect(() => commonOptions(parseArgs(['acc']), [])).toThrow(/--minutes/);
        expect(() => commonOptions(parseArgs(['acc', '--minutes', 'x']), [])).toThrow(/number/);
        expect(() => commonOptions(parseArgs(['acc', '--minutes', '-1']), [])).toThrow(/at least 0/);
        expect(() => commonOptions(parseArgs(['acc', '--minutes', '1', '--bogus', '2']), [])).toThrow(/--bogus/);
        expect(() => commonOptions(parseArgs(['acc', '--minutes', '1', '--out']), [])).toThrow(/file name/);
    });
});

describe('sample record', () => {
    test('shape: coins and items split inventory / bank, bank null while closed', () => {
        const r = sampleRecord(state({ tick: 150, x: 2670, z: 3305, inv: [['Coins', 120], ['Cake', 1], ['Cake', 1]] }), 'probe-x', 'knights', { food: /^cake$/i }, new Date('2026-10-23T01:00:00Z'));
        expect(r).toEqual({
            kind: 'sample', probe: 'probe-x', t: '2026-10-23T01:00:00.000Z', tick: 150, phase: 'knights', x: 2670, z: 3305, level: 0, hp: 10,
            coins: { inventory: 120, bank: null }, items: { food: { inventory: 2, bank: null } }, playersNear: 0,
        });
    });
    test('the bank counts appear while the bank is open', () => {
        const r = sampleRecord(state({ inv: [['Coal', 3]], bank: [['Coins', 5000], ['Coal', 40]] }), 'p', 'bank', { coal: /^coal$/i });
        expect(r.coins).toEqual({ inventory: 0, bank: 5000 });
        expect(r.items.coal).toEqual({ inventory: 3, bank: 40 });
    });
    test('players within 5 tiles, the probe itself excluded', () => {
        const r = sampleRecord(state({ x: 100, z: 100, players: [['probe', 100, 100], ['a', 105, 95], ['b', 106, 100], ['c', 100, 104]] }), 'p', 'x', {});
        expect(r.playersNear).toBe(2);
    });
});

describe('sampler', () => {
    test('one sample on the first state, then every 50 ticks; ticks counted per phase', () => {
        const out: { tick: number; phase: string }[] = [];
        const sdk = { getState: () => null, onStateUpdate: () => () => {} };
        const smp = new Sampler(sdk as never, r => out.push(r as never), 'p', {});
        for (let t = 10; t <= 130; t++) {
            if (t === 60) smp.phase = 'walk';
            smp.see(state({ tick: t }));
        }
        expect(out.map(r => r.tick)).toEqual([10, 60, 110]);
        expect(out.map(r => r.phase)).toEqual(['start', 'walk', 'walk']);
        expect(smp.phaseTicks).toEqual({ start: 49, walk: 71 });
        expect(smp.lastTick - smp.startTick).toBe(120);
    });
});

// ------------------------------------------------------------------ lifecycle

function harness() {
    const records: Record<string, unknown>[] = [];
    const calls: string[] = [];
    const handlers: Record<string, () => void> = {};
    let tick = 1000;
    const listeners = new Set<(s: BotWorldState) => void>();
    const sdk = {
        getState: () => state({ tick }),
        onStateUpdate: (fn: (s: BotWorldState) => void) => {
            listeners.add(fn);
            return () => listeners.delete(fn);
        },
    };
    const advance = (n: number) => {
        for (let i = 0; i < n; i++) {
            tick++;
            for (const l of listeners) l(state({ tick }));
        }
    };
    const session = { name: 'acc', sessionId: 1, sdk, bot: {}, env: {} } as unknown as ProbeSession;
    const deps: ProbeDeps = {
        open: async () => {
            calls.push('open');
            return session;
        },
        logout: async () => {
            calls.push('logout');
            return { ok: true, latencyTicks: 0 };
        },
        close: async () => {
            calls.push('close');
        },
        onSignal: (sig, h) => {
            handlers[sig] = h;
            return () => delete handlers[sig];
        },
        forceExit: code => {
            calls.push(`exit ${code}`);
        },
        sink: () => r => {
            records.push(r as Record<string, unknown>);
            calls.push(`record ${(r as { kind: string }).kind}`);
        },
        stderr: () => {},
        tickMs: () => 400,
        withSignal: (_signal, work) => work(),
    };
    return { records, calls, handlers, advance, deps };
}

const spec = (run: ProbeSpec<CommonOptions>['run']): ProbeSpec<CommonOptions> => ({
    name: 'probe-test',
    usage: 'usage',
    parse: a => commonOptions(a, []),
    items: {},
    run,
});

describe('runProbe', () => {
    test('a finished run logs out, then writes one totals line, last', async () => {
        const h = harness();
        const code = await runProbe(
            spec(async ctx => {
                ctx.sampler.phase = 'work';
                h.advance(120);
                ctx.totals.widgets = 3;
            }),
            ['acc', '--minutes', '1'],
            h.deps,
        );
        expect(code).toBe(0);
        const totals = h.records.at(-1)!;
        expect(totals).toMatchObject({ kind: 'totals', probe: 'probe-test', account: 'acc', end: 'done', ticks: 120, tickMs: 400, widgets: 3, logout: { ok: true } });
        expect(totals.phaseTicks).toEqual({ work: 120 });
        expect(h.records.filter(r => r.kind === 'totals')).toHaveLength(1);
        expect(h.records.filter(r => r.kind === 'sample').map(r => r.tick)).toEqual([1000, 1050, 1100]);
        expect(h.calls.indexOf('logout')).toBeLessThan(h.calls.lastIndexOf('record totals'));
        expect(h.calls.at(-1)).toBe('close');
    });

    test('SIGTERM aborts the probe, which still logs out cleanly and writes its totals', async () => {
        const h = harness();
        const code = await runProbe(
            spec(async ctx => {
                ctx.totals.loops = 0;
                // a probe loop that only stops on its signal
                while (!ctx.signal.aborted) {
                    h.advance(1);
                    ctx.totals.loops = (ctx.totals.loops as number) + 1;
                    if (ctx.totals.loops === 10) h.handlers.SIGTERM!();
                    await Promise.resolve();
                }
            }),
            ['acc', '--minutes', '60'],
            h.deps,
        );
        expect(code).toBe(0);
        expect(h.calls.filter(c => c === 'logout')).toHaveLength(1);
        expect(h.records.at(-1)).toMatchObject({ kind: 'totals', end: 'signal', loops: 10, logout: { ok: true } });
        expect(h.handlers).toEqual({});
    });

    test('SIGINT during an SDK wait: the rejected wait still ends in a logout', async () => {
        const h = harness();
        const code = await runProbe(
            spec(
                ctx =>
                    new Promise((_, reject) => {
                        ctx.signal.addEventListener('abort', () => reject(new Error('Execution cancelled')));
                        h.handlers.SIGINT!();
                    }),
            ),
            ['acc', '--minutes', '5'],
            h.deps,
        );
        expect(code).toBe(0);
        expect(h.calls).toContain('logout');
        expect(h.records.at(-1)).toMatchObject({ end: 'signal' });
    });

    test('a second signal exits at once with 130', async () => {
        const h = harness();
        await runProbe(
            spec(async ctx => {
                h.handlers.SIGTERM!();
                h.handlers.SIGINT!();
                expect(ctx.signal.aborted).toBe(true);
            }),
            ['acc', '--minutes', '5'],
            h.deps,
        );
        expect(h.calls).toContain('exit 130');
    });

    test('an error still logs out; the totals carry it and the exit code is 1', async () => {
        const h = harness();
        const code = await runProbe(
            spec(async ctx => {
                ctx.totals.partial = true;
                throw new Error('boom');
            }),
            ['acc', '--minutes', '5'],
            h.deps,
        );
        expect(code).toBe(1);
        expect(h.calls).toContain('logout');
        expect(h.records.at(-1)).toMatchObject({ end: 'error', error: 'boom', partial: true });
    });

    test('bad arguments: usage, exit 2, no session', async () => {
        const h = harness();
        expect(await runProbe(spec(async () => {}), ['acc'], h.deps)).toBe(2);
        expect(h.calls).toEqual([]);
    });
});
