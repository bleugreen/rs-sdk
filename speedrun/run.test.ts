import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { TickLog } from './lib/ticks';
import { MANIFEST } from './tools/slot-ledger';
import { returnExtrasFromLedger } from './helpers/cannon-receiver';
import { readFileSync } from 'fs';
import { aliasAccount, cannonServeDrift, chainOrRefusal, type GateIO, LOG_ACCOUNT, loadRunConfig, parseArgs, startGates, TARGET_TOTAL, tickBeforeLogin, totalLevel, UsageError } from './run';
import { tickPreflight, type FeedRead } from './lib/feed-hello';

const feed400: FeedRead & { ok: true } = { ok: true, url: 'wss://rs-sdk-demo.fly.dev/worldfeed', hello: { tickMs: 400, players: 12, tick: 5000 }, wallMs: 80 };
import { buildChain, KIT_PARTNER_ROWS, PLACEMENT, sliceUntil } from './runner/chain';

const cues = { open: async () => {}, stop: () => {} };
const partners = Object.fromEntries([...Object.keys(PLACEMENT), ...KIT_PARTNER_ROWS].map(id => [id, `p_${id}`]));
const cfg = { partners, firemakingTiles: '3240,3296', rings: { giver: 'r' }, bones: { giver: 'b' }, courier: { giver: 'c', below: 3 }, anvil: { giver: 'a' }, cueDir: '/tmp/x' };
const full = buildChain(cfg, { cues });

describe('parseArgs', () => {
    test('defaults: browser, the run dir, no slice; the log is stable in the run dir, so the same command again resumes into it', () => {
        const a = parseArgs(['--bot=scored', '--config=run.json', '--run-dir=/runs/m']);
        expect(a).toMatchObject({ bot: 'scored', config: 'run.json', client: 'browser', dryRun: false, log: '/runs/m/run.jsonl', cannonServe: '/runs/m/cannon-serve.json' });
        expect(a.until).toBeUndefined();
        expect(parseArgs(['--bot=scored', '--config=run.json', '--run-dir=/runs/m']).log).toBe(a.log);
    });
    test('every flag', () => {
        expect(parseArgs(['--bot=s', '--config=c', '--client=lite', '--from=S07', '--until=S14', '--dry-run', '--log=/l.jsonl', '--run-commit=abc', '--run-dir=/r', '--host-reservation=/h', '--claim-owner=rs/393', '--cannon-serve=/c.json']))
            .toEqual({ bot: 's', config: 'c', client: 'lite', from: 'S07', until: 'S14', dryRun: true, tickOverride: false, s21Relog: true, log: '/l.jsonl', runCommit: 'abc', runDir: '/r', hostReservation: '/h', claimOwner: 'rs/393', cannonServe: '/c.json' });
        expect(parseArgs(['--bot=s', '--config=c', '--tick-override']).tickOverride).toBe(true);
        expect(() => parseArgs(['--bot=s', '--config=c', '--tick-override=yes'])).toThrow('takes no value');
        expect([parseArgs(['--bot=s', '--config=c', '--s21-relog=off']).s21Relog, parseArgs(['--bot=s', '--config=c', '--s21-relog=on']).s21Relog]).toEqual([false, true]);
        expect(() => parseArgs(['--bot=s', '--config=c', '--s21-relog=no'])).toThrow('--s21-relog must be on or off');
    });
    test('refusals', () => {
        expect(() => parseArgs(['--config=c'])).toThrow(UsageError);
        expect(() => parseArgs(['--bot=s'])).toThrow('--config');
        expect(() => parseArgs(['--bot=s', '--config=c', '--client=tab'])).toThrow('browser or lite');
        expect(() => parseArgs(['--bot=s', '--config=c', '--force'])).toThrow('unknown flag');
        expect(() => parseArgs(['--bot=s', '--config=c', '--dry-run=1'])).toThrow('takes no value');
    });
});

describe('loadRunConfig', () => {
    test('the cue dir is the run dir\'s rc-cue unless RC_CUE_DIR says otherwise, and RC_CUE_DIR is set to it', () => {
        const dir = mkdtempSync(join(tmpdir(), 'run-cfg-'));
        const path = join(dir, 'run.json');
        const { cueDir: _c, ...file } = cfg;
        writeFileSync(path, JSON.stringify(file));
        const env: Record<string, string | undefined> = {};
        expect(loadRunConfig(path, '/runs/m', env).cueDir).toBe('/runs/m/rc-cue');
        expect(env.RC_CUE_DIR).toBe('/runs/m/rc-cue');
        expect(loadRunConfig(path, '/runs/m', { RC_CUE_DIR: '/elsewhere' }).cueDir).toBe('/elsewhere');
        writeFileSync(path, JSON.stringify({ partners: {} }));
        expect(() => loadRunConfig(path, '/r', {})).toThrow('lacks firemakingTiles, rings, bones, courier, anvil');
        rmSync(dir, { recursive: true, force: true });
    });
});

describe('startGates', () => {
    const live = (owner: string) => ({ state: 'live' as const, reservation: { owner, until: '2026-10-23T00:00:00Z', reason: 'run' } });
    const io = (o: Partial<GateIO> = {}): GateIO => ({
        floor: async () => ({ ok: true, floor: 'df332771', runCommit: 'a'.repeat(40), line: 397, tickMs: { ok: true, tickMs: 400, line: 397 } }),
        tick: async recorded => tickPreflight(feed400, recorded, 400),
        reservation: () => ({ owner: 'rs/393', state: live('rs/393'), path: '/h' }),
        slotLedger: async () => ({ code: 0, out: '' }),
        helpersReady: () => true,
        cannonServe: () => ({ path: '/c.json', serve: null, error: 'ENOENT' }),
        ...o,
    });
    const s04 = sliceUntil(full, 'S04');

    test('all six pass on a clean --until=S04 slice', async () => {
        const g = await startGates(s04, io());
        expect(g.map(x => [x.gate, x.ok])).toEqual([['run-commit floor', true], ['demo tick rate', true], ['host reservation', true], ['slot ledger', true], ['no refusing step on the path', true], ['helpers ready', true]]);
        expect(g[1]!.detail).toBe('feed 400 ms (12 players, tick 5000), freeze 400, tickMs() 400: agree');
    });

    test("the tick gate reads the freeze's tickMs from the floor check, and refuses when the floor carries none", async () => {
        const seen: unknown[] = [];
        const tick = async (r: Parameters<GateIO['tick']>[0]) => (seen.push(r), tickPreflight(feed400, r, 400));
        await startGates(s04, io({ tick }));
        expect(seen).toEqual([{ ok: true, tickMs: 400, line: 397 }]);
        const noField = await startGates(s04, io({ tick, floor: async () => ({ ok: true, floor: 'f', runCommit: 'a'.repeat(40), line: 3, tickMs: { ok: false, reason: 'STEP-MANIFEST.md:3: the run-commit floor\'s bullet carries no `tickMs=<ms>`' } }) }));
        expect([noField[1]!.ok, noField[1]!.detail]).toEqual([false, expect.stringContaining('carries no `tickMs=<ms>`')]);
    });

    test('a server at another tick than the freeze refuses; --tick-override passes it and the gate says so', async () => {
        const feed300 = { ...feed400, hello: { ...feed400.hello, tickMs: 300 } };
        const refused = await startGates(s04, io({ tick: async r => tickPreflight(feed300, r, 300) }));
        expect([refused[1]!.ok, refused[1]!.detail]).toEqual([false, expect.stringContaining('the server runs 300 ms ticks, the floor froze at 400')]);
        const over = await startGates(s04, io({ tick: async r => tickPreflight(feed300, r, 300, true) }));
        expect([over[1]!.ok, over[1]!.detail]).toEqual([true, expect.stringContaining('OVERRIDDEN by --tick-override')]);
        expect(over[1]!.meta).toMatchObject({ overridden: true, reading: { feedTickMs: 300, recordedTickMs: 400 } });
    });

    test('before a later login: the reading is recorded every time, and a refusal throws before the login', async () => {
        const seen: boolean[] = [];
        let feed: FeedRead = feed400;
        const hook = tickBeforeLogin({ tick: async r => tickPreflight(feed, r, 400) }, { ok: true, tickMs: 400, line: 1 }, t => seen.push(t.ok));
        await hook();
        feed = { ok: false, url: 'wss://w/worldfeed', reason: 'no hello from wss://w/worldfeed within 10000 ms' };
        await expect(hook()).rejects.toThrow('tick preflight refused the login: the world feed is unreadable');
        expect(seen).toEqual([true, false]);
    });

    test('each refuses on its own, and every gate is still evaluated', async () => {
        const g = await startGates(full, io({
            floor: async () => ({ ok: false, reason: 'RUN_COMMIT abc does not include the run-commit floor df332771' }),
            reservation: () => ({ owner: 'rs/393', state: live('host'), path: '/h' }),
            slotLedger: async () => ({ code: 1, out: 'H12: 29 slots\n' }),
            helpersReady: () => null,
        }));
        expect(g.every(x => !x.ok)).toBe(true);
        expect(g.map(x => x.detail).join('\n')).toContain("live, but host's, not ours");
        expect(g[1]!.detail).toContain("the freeze's tickMs is unknown");
        expect(g[4]!.detail).toContain('S15 Monkey Madness');
        expect(g[5]!.detail).toContain('no launcher.json');
    });

    test('the scored run needs its own claim: none named, or none live, refuses', async () => {
        const res = (g: Awaited<ReturnType<typeof startGates>>) => g.find(x => x.gate === 'host reservation')!;
        expect(res(await startGates(s04, io({ reservation: () => ({ owner: undefined, state: live('rs/393'), path: '/h' }) }))).ok).toBe(false);
        expect(res(await startGates(s04, io({ reservation: () => ({ owner: 'rs/393', state: { state: 'none' }, path: '/h' }) }))).detail).toContain('no live claim');
    });
});

describe('gate 6: the cannon holder\'s serve against the ledger rows', () => {
    const manifest = readFileSync(MANIFEST, 'utf8');
    const h11Row = manifest.split('\n').find(l => l.startsWith('| H11 |'))!;
    // Fold-in 24's shape (rs/158): H11 the set and 100 balls, the scimitar and runes, no sharks.
    const foldIn24 = manifest.replace(h11Row, h11Row.replace(/; shark to 9 \[u\][^|]*/, ' '));
    // The take-back is whatever the H11r row in force gives SCORED (two-way since fold-in 23).
    const h11 = { balls: 100, extras: [{ item: 'Mithril scimitar', count: 1 }, { item: 'Law rune', count: 4 }, { item: 'Water rune', count: 4 }], returnExtras: returnExtrasFromLedger(foldIn24).map(({ item, count }) => ({ item, count })) };

    test('only on a path that reaches a cannon row; a missing serve file refuses with where it should be', async () => {
        const io = { floor: async () => ({ ok: true as const, floor: 'f', runCommit: 'a'.repeat(40), line: 1 }), tick: async (r: Parameters<GateIO['tick']>[0]) => tickPreflight(feed400, r, 400), reservation: () => ({ owner: 'o', state: { state: 'live' as const, reservation: { owner: 'o', until: '2099-01-01T00:00:00Z', reason: '' } }, path: '/h' }), slotLedger: async () => ({ code: 0, out: '' }), helpersReady: () => true, cannonServe: () => ({ path: '/run/cannon-serve.json', serve: null, error: 'ENOENT' }) };
        expect((await startGates(sliceUntil(full, 'S13'), io)).map(g => g.gate)).not.toContain('cannon serve');
        const g = (await startGates(sliceUntil(full, 'S14'), io)).find(x => x.gate === 'cannon serve')!;
        expect([g.ok, g.detail]).toEqual([false, "/run/cannon-serve.json: ENOENT (rs/41 writes h92's run-day serve options there)"]);
    });

    test('a serve equal to the row passes; a short one, a top-up row, or a wrong return refuses', () => {
        expect(cannonServeDrift({ H11: h11 }, ['H11'], foldIn24)).toEqual([]);
        expect(cannonServeDrift({ H11: { ...h11, extras: h11.extras.slice(1) } }, ['H11'], foldIn24).join()).toContain('mithril scimitar served not at all');
        // A cannon row with a top-up (H11's `shark to 9` before fold-in 24): no fixed serve count is safe against it.
        const withTopUp = foldIn24.replace(/^\| H11 \| /m, '| H11 | shark to 9 [u]; ');
        expect(cannonServeDrift({ H11: { ...h11, extras: [...h11.extras, { item: 'Shark', count: 2 }] } }, ['H11'], withTopUp).join()).toContain('top-up to 9');
        expect(cannonServeDrift({ H11: { ...h11, returnExtras: [{ item: 'Magic shortbow', count: 1 }] } }, ['H11'], foldIn24).join()).toContain('H11r: serve.returnExtras');
        expect(cannonServeDrift({ H11: { ...h11, returnExtras: [] } }, ['H11'], foldIn24).join()).toContain('H11r: serve.returnExtras []');
        expect(cannonServeDrift({}, ['H23'], foldIn24)).toEqual(['H23: no serve options for the row']);
    });
});

describe('the run config as a start gate', () => {
    test("a config without S05's H4 giver (or any placed row's partner) refuses with the reason, it does not crash", () => {
        const { H4: _h4, ...noH4 } = partners;
        const r = chainOrRefusal({ ...cfg, partners: noH4 }, cues);
        expect('refusal' in r && r.refusal).toContain('names no partner for H4');
        expect('chain' in chainOrRefusal(cfg, cues)).toBe(true);
    });
});

describe('the log and the end', () => {
    test("rows for the login carry SCORED; a helper's name is left alone", () => {
        const log = TickLog.memory('t');
        const off = aliasAccount(log, 'real_name');
        const row = { v: 1, runId: 't', account: 'real_name', sessionId: 1, step: 'x', startTick: 0, endTick: 0, ticks: 0, wallMs: 0, ok: true, tickMs: 600, at: '' } as const;
        log.append({ ...row });
        log.append({ ...row, account: 'cairn_h92' });
        off();
        log.append({ ...row });
        expect(log.rows.map(r => r.account)).toEqual([LOG_ACCOUNT, 'cairn_h92', 'real_name']);
    });

    test("the total is the 19 real skills' base levels summed (the client's Stat18/Stat19 slots are not skills): 1,881 at 99", () => {
        const skills = Array.from({ length: 19 }, (_, i) => ({ name: `s${i}`, level: 99, baseLevel: 99, experience: 0 }));
        const slots = [{ name: 'Stat18', level: 1, baseLevel: 1, experience: 0 }, { name: 'Stat19', level: 1, baseLevel: 1, experience: 0 }];
        expect(totalLevel({ skills: [...skills, ...slots] })).toBe(TARGET_TOTAL);
        expect(totalLevel({ skills: [...skills.slice(1), { name: 'x', level: 99, baseLevel: 98, experience: 0 }, ...slots] })).toBe(1880);
    });
});
