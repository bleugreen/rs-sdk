import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { BotWorldState } from '../../sdk/types';
import {
    aliasEnvPath,
    byId,
    chebyshev,
    EXIT,
    isolationRefusal,
    loadOneoffEnv,
    ONEOFF_GATEWAY_URL,
    type OneoffIO,
    type OneoffSpec,
    packChanges,
    parseTile,
    Redactor,
    runOneoff,
    type RosterEntry,
    runTsRunning,
} from './oneoff';
import type { BotEnv, LogoutResult, Session } from './session';

// A made-up account: the real scored name never appears in the repo.
const ACCT = 'test_scored';

let root: string;
let scoredFile: string;
let alias: string;

function writeAlias(gateway: string | null): void {
    mkdirSync(join(root, 'bots', 'host-oneoff'), { recursive: true });
    writeFileSync(alias, [`BOT_USERNAME=${ACCT}`, 'PASSWORD=pw', 'SERVER=rs-sdk-demo.fly.dev', ...(gateway ? [`GATEWAY_URL=${gateway}`] : []), ''].join('\n'));
}

function isolated(): Record<string, string> {
    return { LITE_BOT_ENV: alias, GATEWAY_URL: ONEOFF_GATEWAY_URL };
}

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'oneoff-'));
    scoredFile = join(root, '.scored-account');
    writeFileSync(scoredFile, ACCT + '\n');
    alias = aliasEnvPath(root);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const env = (gateway?: string): BotEnv => ({ BOT_USERNAME: ACCT, PASSWORD: 'pw', ...(gateway ? { GATEWAY_URL: gateway } : {}) });

describe('isolationRefusal', () => {
    test("refuses a bot.env on the run's default gateway (7780)", () => {
        expect(isolationRefusal(env('ws://127.0.0.1:7780'), isolated(), alias)).toContain("the run's gateway");
        expect(isolationRefusal(env('ws://localhost:7780'), isolated(), alias)).toContain("the run's gateway");
    });

    test('refuses a bot.env without GATEWAY_URL or on another port', () => {
        expect(isolationRefusal(env(), isolated(), alias)).toContain('no GATEWAY_URL');
        expect(isolationRefusal(env('ws://127.0.0.1:7795'), isolated(), alias)).toContain('not the one-off gateway');
    });

    test("refuses when the lite runner would read another env file (the trap: bots/<login>/bot.env)", () => {
        expect(isolationRefusal(env(ONEOFF_GATEWAY_URL), { GATEWAY_URL: ONEOFF_GATEWAY_URL }, alias)).toContain('LITE_BOT_ENV is unset');
        const scored = join(root, 'bots', ACCT, 'bot.env');
        const why = isolationRefusal(env(ONEOFF_GATEWAY_URL), { LITE_BOT_ENV: scored, GATEWAY_URL: ONEOFF_GATEWAY_URL }, alias)!;
        expect(why).toContain('LITE_BOT_ENV is not');
        expect(why).not.toContain(ACCT);
    });

    test("refuses the process's GATEWAY_URL unset or on the run's gateway", () => {
        expect(isolationRefusal(env(ONEOFF_GATEWAY_URL), { LITE_BOT_ENV: alias }, alias)).toContain('GATEWAY_URL in the environment is unset');
        expect(isolationRefusal(env(ONEOFF_GATEWAY_URL), { LITE_BOT_ENV: alias, GATEWAY_URL: 'ws://127.0.0.1:7780' }, alias)).toContain('7780');
    });

    test('passes only the alias env on 7781 with both process variables set', () => {
        expect(isolationRefusal(env(ONEOFF_GATEWAY_URL), isolated(), alias)).toBeNull();
    });
});

describe('loadOneoffEnv', () => {
    test("throws on an alias env that names the run's gateway", () => {
        writeAlias('ws://127.0.0.1:7780');
        expect(() => loadOneoffEnv(isolated(), root)).toThrow("the run's gateway");
    });

    test('throws without the alias dir: the wrapper did not run', () => {
        expect(() => loadOneoffEnv(isolated(), root)).toThrow('speedrun/tools/oneoff.ts');
    });

    test('returns the alias env when isolated', () => {
        writeAlias(ONEOFF_GATEWAY_URL);
        expect(loadOneoffEnv(isolated(), root).GATEWAY_URL).toBe(ONEOFF_GATEWAY_URL);
    });
});

describe('pieces', () => {
    test('Redactor replaces the name case-blind, with spaces or underscores', () => {
        const r = new Redactor();
        r.add(ACCT, 'SCORED');
        r.add('cairn_h61', 'COURIER');
        expect(r.apply('Test scored traded with Cairn h61; test_scored, TEST_SCORED')).toBe('SCORED traded with COURIER; SCORED, SCORED');
    });

    test('runTsRunning matches a bun running speedrun/run.ts only', () => {
        expect(runTsRunning('COMMAND COMMAND\nbun bun speedrun/run.ts --bot=x\n')).toBe(true);
        expect(runTsRunning('bash bash -c grep speedrun/run.ts\nbun bun speedrun/rehearse.ts\n')).toBe(false);
    });

    test('packChanges: expected ids at their counts, every other id unchanged', () => {
        expect(packChanges({ 1351: 1, 385: 14 }, { 385: 14 }, { 1351: 0 })).toEqual([]);
        expect(packChanges({ 1351: 1, 385: 14 }, { 385: 13 }, { 1351: 0 })).toEqual([{ id: 385, before: 14, after: 13, want: 14 }]);
    });

    test('tiles', () => {
        expect(parseTile('3222,3218')).toEqual({ x: 3222, z: 3218, level: 0 });
        expect(parseTile('2465,3489,1')).toEqual({ x: 2465, z: 3489, level: 1 });
        expect(parseTile('3222')).toBeNull();
        expect(chebyshev({ x: 0, z: 0, level: 0 }, { x: 2, z: -3, level: 0 })).toBe(3);
        expect(chebyshev({ x: 0, z: 0, level: 0 }, { x: 0, z: 0, level: 1 })).toBe(Infinity);
    });
});

function state(over: Partial<BotWorldState> = {}): BotWorldState {
    return {
        tick: 100,
        inGame: true,
        player: { worldX: 3222, worldZ: 3218, level: 0, name: ACCT, hp: 10, maxHp: 10 },
        inventory: [{ slot: 0, id: 385, name: 'Shark', count: 1, optionsWithIndex: [] }],
        equipment: [],
        gameMessages: [],
        ...over,
    } as unknown as BotWorldState;
}

interface Harness {
    io: OneoffIO;
    opened: number;
    loggedOut: number;
    abandoned: number;
    lines: string[];
}

function harness(o: { roster?: RosterEntry[][]; ps?: string; logoutOk?: boolean; st?: BotWorldState } = {}): Harness {
    const h: Harness = { io: null as unknown as OneoffIO, opened: 0, loggedOut: 0, abandoned: 0, lines: [] };
    const rosters = o.roster ?? [[], []];
    let reads = 0;
    const session = { sdk: { getState: () => o.st ?? state() } } as unknown as Session;
    h.io = {
        roster: async () => rosters[Math.min(reads++, rosters.length - 1)]!,
        ps: () => o.ps ?? '',
        open: async () => {
            h.opened++;
            return session;
        },
        logout: async () => {
            h.loggedOut++;
            return { ok: o.logoutOk ?? true, clickTick: 101, lastInWorldTick: 102, latencyTicks: 1, wallMs: 400 } as LogoutResult;
        },
        abandon: async () => {
            h.abandoned++;
            return { ok: true, sends: 1, takeovers: 0, wallMs: 10 };
        },
        close: async () => {},
        sleep: async () => {},
    };
    return h;
}

async function run(h: Harness, spec: Partial<OneoffSpec> & { argv: string[] }, proc: Record<string, string> = isolated()): Promise<number> {
    return runOneoff(
        { kind: 'test', act: async () => true, ...spec },
        { proc: { ...proc, ONEOFF_LEDGER: join(root, 'ledger.jsonl') }, root, scoredFile, io: () => h.io, print: l => h.lines.push(l), offlinePolls: 3 }
    );
}

const ks = (h: Harness) => h.lines.map(l => JSON.parse(l).k);

describe('runOneoff', () => {
    test("STOPs before any login when the alias env is on the run's gateway", async () => {
        writeAlias('ws://127.0.0.1:7780');
        const h = harness();
        expect(await run(h, { argv: ['--go'] })).toBe(EXIT.stop);
        expect(h.opened).toBe(0);
        expect(ks(h)).toEqual(['STOP']);
    });

    test('STOPs when not launched by the wrapper (no LITE_BOT_ENV)', async () => {
        writeAlias(ONEOFF_GATEWAY_URL);
        const h = harness();
        expect(await run(h, { argv: ['--go'] }, { GATEWAY_URL: ONEOFF_GATEWAY_URL })).toBe(EXIT.stop);
        expect(h.opened).toBe(0);
    });

    test('STOPs while SCORED is listed in the world or run.ts runs', async () => {
        writeAlias(ONEOFF_GATEWAY_URL);
        const online = harness({ roster: [[{ name: 'Test scored', x: 0, z: 0, level: 0 }]] });
        expect(await run(online, { argv: ['--go'] })).toBe(EXIT.stop);
        expect(online.opened).toBe(0);
        const runts = harness({ ps: 'bun bun speedrun/run.ts --bot=x' });
        expect(await run(runts, { argv: ['--go'] })).toBe(EXIT.stop);
        expect(runts.opened).toBe(0);
        const blind = harness({ roster: [null as unknown as RosterEntry[]] });
        expect(await run(blind, { argv: ['--go'] })).toBe(EXIT.stop);
    });

    test('without --go: preflight and DRY only', async () => {
        writeAlias(ONEOFF_GATEWAY_URL);
        const h = harness();
        expect(await run(h, { argv: [] })).toBe(EXIT.ok);
        expect(h.opened).toBe(0);
        expect(ks(h)).toEqual(['preflight', 'DRY']);
    });

    test('a tool preflight refusal STOPs', async () => {
        writeAlias(ONEOFF_GATEWAY_URL);
        const h = harness();
        expect(await run(h, { argv: ['--go'], preflight: async () => 'no courier' })).toBe(EXIT.stop);
        expect(h.opened).toBe(0);
    });

    test('with --go: login, act, logout, offline; every line redacted, in the ledger too', async () => {
        writeAlias(ONEOFF_GATEWAY_URL);
        const h = harness({ roster: [[], [{ name: 'Test scored', x: 0, z: 0, level: 0 }], []] });
        const code = await run(h, {
            argv: ['--go'],
            at: { tile: { x: 3222, z: 3219, level: 0 }, within: 2 },
            act: async c => {
                c.out('pack', { who: c.state().player?.name, inv: byId(c.state().inventory) });
                return true;
            },
        });
        expect(code).toBe(EXIT.ok);
        expect(ks(h)).toEqual(['preflight', 'login', 'pack', 'logout', 'offline']);
        expect(h.lines.join('\n')).not.toMatch(/test.scored/i);
        expect(h.lines.join('\n')).toContain('"who":"SCORED"');
        expect(readFileSync(join(root, 'ledger.jsonl'), 'utf8').trim().split('\n')).toEqual(h.lines);
        const login = JSON.parse(h.lines[1]!).v;
        expect(login.tick).toBe(100);
        expect(typeof login.utc).toBe('string');
    });

    test('away from the expected tile: CHECK-FAIL, nothing done, still logged out', async () => {
        writeAlias(ONEOFF_GATEWAY_URL);
        const h = harness();
        let acted = false;
        const code = await run(h, {
            argv: ['--go'],
            at: { tile: { x: 3300, z: 3218, level: 0 }, within: 2 },
            act: async () => (acted = true),
        });
        expect(code).toBe(EXIT.check);
        expect(acted).toBe(false);
        expect(h.loggedOut).toBe(1);
    });

    test('an unconfirmed logout abandons the client; a body still listed is OFFLINE-UNCONFIRMED', async () => {
        writeAlias(ONEOFF_GATEWAY_URL);
        const listed = [{ name: ACCT, x: 0, z: 0, level: 0 }];
        const h = harness({ logoutOk: false, roster: [[], listed] });
        expect(await run(h, { argv: ['--go'] })).toBe(EXIT.offline);
        expect(h.abandoned).toBe(1);
        expect(ks(h)).toContain('OFFLINE-UNCONFIRMED');
    });

    test('an act that throws is an ERROR and still logs out', async () => {
        writeAlias(ONEOFF_GATEWAY_URL);
        const h = harness();
        const code = await run(h, {
            argv: ['--go'],
            act: async () => {
                throw new Error(`boom for ${ACCT}`);
            },
        });
        expect(code).toBe(EXIT.error);
        expect(h.loggedOut).toBe(1);
        expect(h.lines.join('\n')).toContain('boom for SCORED');
    });
});
