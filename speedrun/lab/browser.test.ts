import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { labBotEnv } from './browser';

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
