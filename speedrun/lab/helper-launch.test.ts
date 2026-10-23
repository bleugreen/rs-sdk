import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { lastRolePhase, roleLogEvents, stopLauncher, waitLauncherReady } from './helper-launch';

const runDir = () => mkdtempSync(join(tmpdir(), 'helper-launch-'));
const launcherJson = (dir: string, helpersReady: boolean, ms = Date.now()) => writeFileSync(join(dir, 'launcher.json'), JSON.stringify({ pid: 1, startedAt: ms, gatewayPort: 8310, helpersReady, accounts: [], ms }));

describe('waitLauncherReady', () => {
    test('returns once launcher.json says helpersReady (written after the wait began) and every account passes its ready check', async () => {
        const dir = runDir();
        const ready = new Set<string>();
        const p = waitLauncherReady({ exitCode: null }, { runDir: dir, accounts: ['cairn_a', 'cairn_b'], ready: a => ready.has(a), pollMs: 10, timeoutMs: 5_000 });
        await Bun.sleep(30);
        launcherJson(dir, true);
        ready.add('cairn_a');
        await Bun.sleep(30);
        ready.add('cairn_b');
        expect(await p).toBeGreaterThanOrEqual(0);
    });

    test("a launcher.json from before the wait (an earlier run's) does not count", async () => {
        const dir = runDir();
        launcherJson(dir, true, Date.now() - 60_000);
        await expect(waitLauncherReady({ exitCode: null }, { runDir: dir, accounts: ['cairn_a'], ready: () => true, pollMs: 10, timeoutMs: 100, what: 'anvil helper' })).rejects.toThrow('anvil helper not ready after 0 s (ready: cairn_a;');
    });

    test('the launcher exiting first throws, naming who was ready', async () => {
        const dir = runDir();
        await expect(waitLauncherReady({ exitCode: 1 }, { runDir: dir, accounts: ['cairn_a', 'cairn_b'], ready: a => a === 'cairn_b', pollMs: 10, what: 'bone givers' })).rejects.toThrow("the bone givers' launcher exited (1) before they were ready (ready: cairn_b;");
    });
});

describe('role logs', () => {
    test('roleLogEvents parses the JSON lines and skips the rest; lastRolePhase is the last phase event', () => {
        const dir = runDir();
        mkdirSync(join(dir, 'logs'));
        writeFileSync(
            join(dir, 'logs', 'cairn_h92.role.log'),
            [
                '[launcher] cairn_h92: role cannon started (pid 7)',
                JSON.stringify({ t: 'x', account: 'cairn_h92', role: 'cannon', message: 'phase', from: '', to: 'serve-load' }),
                '{"partial',
                JSON.stringify({ t: 'x', account: 'cairn_h92', role: 'cannon', message: 'lab tele' }),
                JSON.stringify({ t: 'x', account: 'cairn_h92', role: 'cannon', message: 'phase', from: 'serve-load', to: 'serve-waiting' }),
            ].join('\n')
        );
        expect(roleLogEvents(dir, 'cairn_h92').map(e => e.message)).toEqual(['phase', 'lab tele', 'phase']);
        expect(lastRolePhase(dir, 'cairn_h92')).toBe('serve-waiting');
        expect(lastRolePhase(dir, 'cairn_nobody')).toBeNull();
    });
});

test('stopLauncher sends SIGINT and waits for the exit', async () => {
    const sent: string[] = [];
    await stopLauncher({ kill: (s?: number | NodeJS.Signals) => void sent.push(String(s)), exited: Promise.resolve(0) }, 1_000);
    expect(sent).toEqual(['SIGINT']);
});
