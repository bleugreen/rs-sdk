import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { labBotEnv, openSecureLabSession } from './browser';

const LAB = import.meta.dir;
const sources = (readdirSync(LAB, { recursive: true }) as string[]).filter(f => /\.tsx?$/.test(f) && !f.endsWith('.test.ts')).map(f => join(LAB, f));
const rel = (f: string) => relative(LAB, f);
const withMatch = (re: RegExp) => sources.filter(f => re.test(readFileSync(f, 'utf8'))).map(rel);

describe('the lab browser launcher', () => {
    test('browser.ts is the only file under speedrun/lab that launches Chrome', () => {
        expect(withMatch(/puppeteer\s*\.\s*launch\b/)).toEqual(['browser.ts']);
    });

    test('no other lab file loads puppeteer, statically or lazily', () => {
        // `import type` is erased; any value import or import() would load puppeteer outside the launcher
        const loads = /^\s*import\s+(?!type\b)[^;]*from\s+['"]puppeteer['"]|import\(\s*['"]puppeteer['"]\s*\)/m;
        expect(withMatch(loads)).toEqual(['browser.ts']);
    });

    test('browser.ts loads puppeteer only at launch, never at module load (Bun 1.4.3 crashes loading it)', () => {
        const src = readFileSync(join(LAB, 'browser.ts'), 'utf8');
        expect(/^\s*import\s+(?!type\b)[^;]*from\s+['"]puppeteer['"]/m.test(src)).toBe(false);
        expect(src).toMatch(/await import\(\s*'puppeteer'\s*\)/);
    });

    test('every lab Chrome uses the basic password store (no keyring wait or D-Bus hang on first navigation)', () => {
        expect(readFileSync(join(LAB, 'browser.ts'), 'utf8')).toContain("'--password-store=basic'");
    });
});

describe('labBotEnv', () => {
    test('replaces CLIENT_URL and drops every CDP_URL, keeping the rest', () => {
        const before = 'BOT_USERNAME=a\nCLIENT_URL=http://old/bot\nPASSWORD=p\nCDP_URL=http://127.0.0.1:9397\nSERVER=localhost:9300\n';
        expect(labBotEnv(before, 'http://localhost:9300/bot?gateway=x')).toBe('BOT_USERNAME=a\nPASSWORD=p\nSERVER=localhost:9300\nCLIENT_URL=http://localhost:9300/bot?gateway=x\n');
    });

    test('adds CLIENT_URL to an env without one', () => {
        expect(labBotEnv('BOT_USERNAME=a\nPASSWORD=p', 'u')).toBe('BOT_USERNAME=a\nPASSWORD=p\nCLIENT_URL=u\n');
    });
});

describe('secure lab session ownership', () => {
    for (const failure of ['none', 'ready', 'browser', 'session', 'close'] as const) {
        test(`token proxy and every acquired handle are cleaned up: ${failure}`, async () => {
            const root = mkdtempSync(join(tmpdir(), 'lab-browser-test-'));
            const botDir = join(root, 'bots', 'lab_test');
            mkdirSync(botDir, { recursive: true });
            writeFileSync(join(botDir, 'bot.env'), 'BOT_USERNAME=lab_test\nPASSWORD=secret\nSERVER=localhost:9740\n');
            const events: string[] = [];
            let scratch = '';
            const result = openSecureLabSession('lab_test', { root, webPort: 9740, agentPort: 8740 }, {
                spawn: (args, dir) => {
                    events.push('proxy'); scratch = dir;
                    expect(args).toEqual(['bun', 'proxy.ts', '--world=http://127.0.0.1:9740', '--port=9746', '--gateway=ws://127.0.0.1:8740', `--bots-dir=${join(dir, 'bots')}`]);
                    const env = join(dir, 'bots', 'lab_test', 'bot.env');
                    expect(statSync(env).mode & 0o777).toBe(0o600);
                    expect(readFileSync(env, 'utf8')).toContain('PASSWORD=secret');
                    return {} as never;
                },
                ready: async (_proxy, url) => {
                    events.push('ready');
                    expect(new URL(url).searchParams.get('server')).toBe('localhost:9740');
                    if (failure === 'ready') throw new Error('ready failed');
                },
                launch: async (_bot, opts) => {
                    events.push('browser');
                    expect(opts?.cdpPort).toBe(9745);
                    const url = new URL(opts!.clientUrl!);
                    expect(url.origin).toBe('http://127.0.0.1:9746');
                    expect(url.searchParams.get('gateway')).toBe('ws://127.0.0.1:8740');
                    expect(url.searchParams.has('password')).toBe(false);
                    if (failure === 'browser') throw new Error('browser failed');
                    return { browser: {} as never, kill: async () => { events.push('kill browser'); } };
                },
                open: async (_bot, opts) => {
                    events.push('session');
                    expect(opts).toEqual({ client: 'browser', launch: true, insecureQueryLogin: false });
                    if (failure === 'session') throw new Error('session failed');
                    return {} as never;
                },
                close: async () => {
                    events.push('close session');
                    if (failure === 'close') throw new Error('close failed');
                },
                stopProxy: async () => { events.push('kill proxy'); },
            });
            try {
                if (failure === 'none' || failure === 'close') {
                    const live = await result;
                    const closed = live.close();
                    expect(live.close()).toBe(closed);
                    if (failure === 'close') await expect(closed).rejects.toThrow('close failed');
                    else await closed;
                } else await expect(result).rejects.toThrow(`${failure} failed`);
                expect(events.at(-1)).toBe('kill proxy');
                expect(events.filter(e => e === 'kill proxy')).toHaveLength(1);
                expect(events.includes('kill browser')).toBe(!['ready', 'browser'].includes(failure));
                expect(events.includes('close session')).toBe(['none', 'close'].includes(failure));
            } finally {
                rmSync(root, { recursive: true, force: true });
                if (scratch) rmSync(scratch, { recursive: true, force: true });
            }
        });
    }
});
