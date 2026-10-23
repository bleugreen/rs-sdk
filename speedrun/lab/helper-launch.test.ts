import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parseLaunchConfig } from '../helpers/standalone';
import { S21_HAND_BACK } from '../skills/runecraft';
import { altarGiverLaunch } from './altar-launch';
import { anvilLaunch } from './anvil-launch';
import { boneGiverLaunch } from './bone-launch';
import { cannonHolderLaunch } from './cannon-launch';
import { LANDING_HELPER_TILE, S06_BAND } from './dress-rehearsal';
import { dropperLaunch } from './fm-row-launch';
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

describe('rehearsal launcher entries never stop the whole launcher on a role exit', () => {
    const common = { botsDir: '/tmp/bots', runDir: '/tmp/run', gatewayPort: 8305 };
    const names = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `cairn_${prefix}${i + 1}`);
    const cases = [
        { name: 'S03 log droppers', role: 'fm-row', accounts: names('drop', 6), make: () => dropperLaunch({ ...common, droppers: names('drop', 6), tiles: '3222-3218@3219;3218-3243@3218;3242-3223@3219', cueDir: '/tmp/cue' }) },
        { name: 'S07 bone givers', role: 'bone-giver', accounts: names('bone', 4), make: () => boneGiverLaunch({ ...common, givers: names('bone', 4) }) },
        { name: 'S25a anvil', role: 'anvil', accounts: ['cairn_anvil'], make: () => anvilLaunch({ ...common, account: 'cairn_anvil' }) },
        { name: 'H23 cannon holder', role: 'cannon', accounts: ['cairn_holder'], make: () => cannonHolderLaunch({ ...common, account: 'cairn_holder', tile: LANDING_HELPER_TILE }) },
        ...([undefined, 'relay', 'direct'] as const).flatMap(path => [
            { name: `S06 altar (${path ?? 'default'})`, role: 'altar-giver', accounts: names('air', 7), make: () => altarGiverLaunch({ ...common, givers: names('air', 7), band: S06_BAND, ...(path ? { path } : {}) }) },
            { name: `S21 altar with hand-back (${path ?? 'default'})`, role: 'altar-giver', accounts: [...names('body', 22), 'cairn_return'], make: () => altarGiverLaunch({ ...common, givers: names('body', 22), band: { id: 'S21', altar: 'body' }, handBack: { account: 'cairn_return', items: S21_HAND_BACK.items }, ...(path ? { path } : {}) }) },
        ]),
    ];

    for (const c of cases) {
        test(c.name, () => {
            // The same JSON boundary as spawnLauncher, then the launcher's actual parser.
            const raw = JSON.parse(JSON.stringify(c.make())) as { accounts: { account: string; final?: boolean }[] };
            expect(raw.accounts.map(a => a.account)).toEqual(c.accounts);
            expect(raw.accounts.filter(a => a.final === true)).toEqual([]);
            const parsed = parseLaunchConfig(raw);
            expect(parsed.accounts.map(a => [a.account, a.role, a.final])).toEqual(c.accounts.map(account => [account, c.role, false]));
        });
    }
});
