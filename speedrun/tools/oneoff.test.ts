import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ONEOFF_GATEWAY_URL } from '../lib/oneoff';
import { aliasEnvText, countBotConnected, isolationVerdict, resolveTool, runWrapper, summarize, WRAPPER_EXIT, type WrapperIO } from './oneoff';

// A made-up account: the real scored name never appears in the repo.
const ACCT = 'test_scored';
const connected = (n: number) => `[Gateway] Bot connected: bot-${n} (${ACCT})\n`;

describe('the isolation check', () => {
    test('counts the gateway\'s "Bot connected" lines only', () => {
        const log = `[Gateway] Starting Gateway Service on port 7780...\n${connected(1)}[Gateway] SDK connected: sdk-1 -> ${ACCT} (mode: control)\n${connected(2)}[Gateway] Bot disconnected: bot-1 (${ACCT})\n`;
        expect(countBotConnected(log)).toBe(2);
        expect(countBotConnected('')).toBe(0);
    });

    test('an unchanged count passes; any change is a breach', () => {
        expect(isolationVerdict(5, 5)).toEqual({ breach: false, line: '7780 untouched (Bot connected count 5)' });
        expect(isolationVerdict(5, 6)).toEqual({ breach: true, line: 'ISOLATION BREACH: 7780 gained 1 bot connection(s)' });
        expect(isolationVerdict(5, 0).breach).toBe(true);
    });
});

describe('pieces', () => {
    test("aliasEnvText replaces SCORED's GATEWAY_URL with the one-off gateway's", () => {
        const text = aliasEnvText(`BOT_USERNAME=${ACCT}\nPASSWORD=pw\nGATEWAY_URL=ws://127.0.0.1:7780\nSERVER=rs-sdk-demo.fly.dev\n\n`);
        expect(text).toBe(`BOT_USERNAME=${ACCT}\nPASSWORD=pw\nSERVER=rs-sdk-demo.fly.dev\nGATEWAY_URL=${ONEOFF_GATEWAY_URL}\n`);
    });

    test('resolveTool takes only scripts in speedrun/tools/oneoff/', () => {
        expect(resolveTool('read')).toEndWith('speedrun/tools/oneoff/read.ts');
        expect(resolveTool('drop.ts')).toEndWith('speedrun/tools/oneoff/drop.ts');
        expect(resolveTool('speedrun/tools/oneoff/walk.ts')).toEndWith('speedrun/tools/oneoff/walk.ts');
        expect(resolveTool('speedrun/tools/relog-now.ts')).toBeNull();
        expect(resolveTool('../relog-now')).toBeNull();
        expect(resolveTool('rekit')).toBeNull();
    });

    test('summarize: login and logout UTC and the ticks in the world', () => {
        const s = summarize([
            '{"one_off":"drop-1351","k":"preflight","v":{}}',
            '{"one_off":"drop-1351","k":"login","v":{"tick":1000,"utc":"2026-10-24T14:18:40.000Z"}}',
            'not json',
            '{"one_off":"drop-1351","k":"logout","v":{"ok":true,"lastInWorldTick":1012,"tick":1013,"utc":"2026-10-24T14:18:46.000Z"}}',
            '{"one_off":"drop-1351","k":"offline","v":{"confirmed":true}}',
        ]);
        expect(s).toEqual({
            kind: 'drop-1351',
            loginUtc: '2026-10-24T14:18:40.000Z',
            loginTick: 1000,
            logoutUtc: '2026-10-24T14:18:46.000Z',
            lastInWorldTick: 1012,
            ticksInWorld: 12,
            offline: 'confirmed',
        });
    });
});

let root: string;
let home: string;
let runDir: string;
let runLog: string;

beforeEach(() => {
    const base = mkdtempSync(join(tmpdir(), 'oneoff-wrapper-'));
    root = join(base, 'rs-sdk');
    home = join(base, 'home');
    runDir = join(base, 'run');
    mkdirSync(join(root, 'speedrun', 'tools', 'oneoff'), { recursive: true });
    writeFileSync(join(root, 'speedrun', 'tools', 'oneoff', 'read.ts'), '');
    mkdirSync(join(root, 'bots', ACCT), { recursive: true });
    writeFileSync(join(root, 'bots', ACCT, 'bot.env'), `BOT_USERNAME=${ACCT}\nPASSWORD=pw\nGATEWAY_URL=ws://127.0.0.1:7780\n`);
    mkdirSync(join(home, 'rs-run'), { recursive: true });
    writeFileSync(join(home, 'rs-run', '.scored-account'), ACCT + '\n');
    runLog = join(home, 'rs-run', 'gateway.log');
    writeFileSync(runLog, connected(1) + connected(2));
});

afterEach(() => rmSync(join(root, '..'), { recursive: true, force: true }));

interface Fake {
    io: WrapperIO;
    out: string[];
    tmux: string[][];
    toolEnv: Record<string, string> | null;
    aliasDuringTool: string | null;
    aliasModeDuringTool: number | null;
}

/** A run host in miniature: `ss` sees 7781 between gw1's start and its kill; the tool is `tool`. */
function fake(o: { ps?: string; taken?: boolean; tool?: (f: Fake) => number; lines?: string[] } = {}): Fake {
    let gw = o.taken ?? false;
    const f: Fake = { io: null as unknown as WrapperIO, out: [], tmux: [], toolEnv: null, aliasDuringTool: null, aliasModeDuringTool: null };
    f.io = {
        ps: () => o.ps ?? '',
        listening: async () => gw,
        tmux: async args => {
            f.tmux.push(args);
            if (args[0] === 'new-session') gw = true;
            if (args[0] === 'kill-session') gw = false;
            return 0;
        },
        runTool: async (_argv, t) => {
            f.toolEnv = t.env;
            f.aliasDuringTool = readFileSync(t.env.LITE_BOT_ENV!, 'utf8');
            f.aliasModeDuringTool = statSync(t.env.LITE_BOT_ENV!).mode & 0o777;
            t.onSpawn(() => {});
            for (const l of o.lines ?? []) t.onLine(l);
            return o.tool ? o.tool(f) : 0;
        },
        sleep: async () => {},
        now: () => new Date('2026-10-24T14:18:36.000Z'),
        print: l => f.out.push(l),
        onSignal: () => () => {},
    };
    return f;
}

const wrap = (f: Fake, argv: string[] = ['read', '--go']) => runWrapper(argv, f.io, { root, home, runDir, bun: '/opt/bun/bin/bun' });
const ledger = () => readFileSync(join(runDir, 'oneoff-drop.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));

describe('runWrapper', () => {
    test('the breach check fires when the run gateway gains a bot connection during the tool', async () => {
        const f = fake({
            tool: () => {
                appendFileSync(runLog, connected(3));
                return 0;
            },
        });
        expect(await wrap(f)).toBe(WRAPPER_EXIT.breach);
        expect(f.out).toContain('ISOLATION BREACH: 7780 gained 1 bot connection(s)');
        // The teardown still runs.
        expect(existsSync(join(root, 'bots', 'host-oneoff'))).toBe(false);
        expect(f.tmux.at(-1)).toEqual(['kill-session', '-t', 'gw1']);
        expect(f.out).toContain('one-off gateway stopped');
        const last = ledger().at(-1);
        expect(last.k).toBe('wrapper');
        expect(last.v.runGateway).toEqual({ before: 2, after: 3, breach: true });
        expect(last.v.exit).toBe(WRAPPER_EXIT.breach);
    });

    test("an unchanged count passes and the tool's exit is the wrapper's", async () => {
        const f = fake({ tool: () => 4 });
        expect(await wrap(f)).toBe(4);
        expect(f.out).toContain('7780 untouched (Bot connected count 2)');
        expect(f.out).toContain('alias dir removed');
    });

    test('the tool gets the alias env on 7781 (mode 600) and LITE_BOT_ENV, GATEWAY_URL and ONEOFF_LEDGER', async () => {
        const f = fake();
        await wrap(f);
        expect(f.toolEnv!.LITE_BOT_ENV).toBe(join(root, 'bots', 'host-oneoff', 'bot.env'));
        expect(f.toolEnv!.GATEWAY_URL).toBe(ONEOFF_GATEWAY_URL);
        expect(f.toolEnv!.ONEOFF_LEDGER).toBe(join(runDir, 'oneoff-drop.jsonl'));
        expect(f.aliasDuringTool).toContain(`GATEWAY_URL=${ONEOFF_GATEWAY_URL}`);
        expect(f.aliasDuringTool).not.toContain('7780');
        expect(f.aliasModeDuringTool).toBe(0o600);
        const gw = f.tmux[0]!;
        expect(gw.slice(0, 4)).toEqual(['new-session', '-d', '-s', 'gw1']);
        expect(gw.at(-1)).toStartWith('exec timeout --kill-after=30s 35m env AGENT_PORT=7781 GATEWAY_HOSTNAME=127.0.0.1 ');
    });

    test('prints only JSON and usage lines, redacted; the summary carries the stay', async () => {
        const f = fake({
            lines: [
                `{"one_off":"read-only","k":"login","v":{"tick":100,"utc":"2026-10-24T14:18:40.000Z"}}`,
                `Error: something about ${ACCT}`,
                `{"one_off":"read-only","k":"logout","v":{"lastInWorldTick":109,"utc":"2026-10-24T14:18:44.000Z"}}`,
            ],
        });
        await wrap(f);
        expect(f.out.join('\n')).not.toContain(ACCT);
        expect(f.out.some(l => l.startsWith('Error'))).toBe(false);
        expect(f.out).toContain('TOOL_EXIT 0 (1 other output line(s) in ' + join(runDir, 'oneoff-20261024T141836Z.out') + ')');
        expect(readFileSync(join(runDir, 'oneoff-20261024T141836Z.out'), 'utf8')).toContain('Error: something about SCORED');
        const v = ledger().at(-1).v;
        expect(v.loginUtc).toBe('2026-10-24T14:18:40.000Z');
        expect(v.logoutUtc).toBe('2026-10-24T14:18:44.000Z');
        expect(v.ticksInWorld).toBe(9);
    });

    test('refuses, raising nothing, while run.ts runs, 7781 is taken or the alias dir is left over', async () => {
        const runts = fake({ ps: 'bun bun speedrun/run.ts --bot=x' });
        expect(await wrap(runts)).toBe(WRAPPER_EXIT.refused);
        expect(runts.tmux).toEqual([]);
        const taken = fake({ taken: true });
        expect(await wrap(taken)).toBe(WRAPPER_EXIT.refused);
        expect(taken.tmux).toEqual([]);
        mkdirSync(join(root, 'bots', 'host-oneoff'));
        const left = fake();
        expect(await wrap(left)).toBe(WRAPPER_EXIT.refused);
        expect(left.tmux).toEqual([]);
        expect(existsSync(join(root, 'bots', 'host-oneoff'))).toBe(true);
    });

    test("refuses without the run gateway's log or for a tool outside speedrun/tools/oneoff/", async () => {
        const other = fake();
        expect(await wrap(other, ['../relog-now', '--go'])).toBe(WRAPPER_EXIT.refused);
        rmSync(runLog);
        const nolog = fake();
        expect(await wrap(nolog)).toBe(WRAPPER_EXIT.refused);
        expect(nolog.tmux).toEqual([]);
    });
});
