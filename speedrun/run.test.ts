import { fakeCdp, fakeWorld } from './lib/fake-cdp';
import { FakeSdk } from './lib/fake-sdk';
import { TickPeriod } from './lib/wait';
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { TickLog } from './lib/ticks';
import { MANIFEST } from './tools/slot-ledger';
import { returnExtrasFromLedger } from './helpers/cannon-receiver';
import { readFileSync } from 'fs';
import { aliasAccount, attemptOf, censusStart, openRunSession, cannonServeDrift, chainOrRefusal, type GateIO, liveRuneCheck, LOG_ACCOUNT, loadRunConfig, loggedRuneCensus, parseArgs, runeGate, signalShutdown, type SignalDeps, startGates, takeoverGate, TARGET_TOTAL, Terminated, tickBeforeLogin, totalLevel, untilTerminated, UsageError, withScoredSession } from './run';
import { runePlan } from './runner/rune-census';
import { loadModules } from './tools/rune-pins';
import { objPack } from './lib/obj-pack';
import type { TickRow } from './lib/ticks';
import { LOGOUT_BUTTON, type AbandonResult, type OpenOptions, type Session } from './lib/session';
import { RelogBudget } from './runner/relog-budget';
import { exitStopIsFinal } from './runner/cue-keeper';
import { SCORED_LOGIN, SCORED_RELOG } from './runner/scored-relog';
import type { ChainStep } from './runner/chain';
import { tickPreflight, type FeedRead } from './lib/feed-hello';

const feed400: FeedRead & { ok: true } = { ok: true, url: 'wss://rs-sdk-demo.fly.dev/worldfeed', hello: { tickMs: 400, players: 12, tick: 5000 }, wallMs: 80 };
import { buildChain, CENSUS_STEP, KIT_PARTNER_ROWS, ledgerRows, PLACEMENT, resolveFrom, sliceUntil } from './runner/chain';

const cues = { open: async () => {}, stop: () => {} };
const partners = Object.fromEntries([...Object.keys(PLACEMENT), ...KIT_PARTNER_ROWS].map(id => [id, `p_${id}`]));
/** The castle lap's entry and next tile (rehearsals/firemaking.md), where T02-03 ends. */
const cfg = { partners, firemakingTiles: '3222,3219;3221,3219', rings: { giver: 'r' }, bones: { giver: 'b' }, courier: { giver: 'c', below: 3 }, anvil: { giver: 'a' }, cueDir: '/tmp/x' };
const full = buildChain(cfg, { cues });
/** Attempt 1's seam: a row beside the coop, 77 tiles from where T02-03 ends. */
const coopRow = buildChain({ ...cfg, firemakingTiles: '3240,3296' }, { cues });

const fullRunePlan = runePlan(full, ledgerRows(readFileSync(MANIFEST, 'utf8')), await loadModules());

describe('the rune census gate (rs/699)', () => {
    const plan = fullRunePlan;
    const law = [...objPack().names].find(([, n]) => n === 'lawrune')![0];
    const water = [...objPack().names].find(([, n]) => n === 'waterrune')![0];
    const air = [...objPack().names].find(([, n]) => n === 'airrune')![0];
    const s13 = resolveFrom(full, 'S13')!;
    const t1314b = resolveFrom(full, 'T13-14b')!;
    /** The census row the chain writes before S13 (runner/chain.ts censused), with `lawCount` law. */
    const censusRow = (lawCount: number): TickRow => ({
        v: 1, kind: 'note', runId: 'run-a', account: LOG_ACCOUNT, sessionId: 1, step: CENSUS_STEP, startTick: 900, endTick: 900, ticks: 0, wallMs: 0, ok: true, tickMs: 400, at: '2026-10-24T04:30:00Z',
        meta: { before: 'S13:A-lawgof-start', id: 'S13', free: 11, worn: ['Staff of fire'], inventory: [{ name: 'Law rune', count: lawCount, id: law }, { name: 'Water rune', count: 9, id: water }, { name: 'Air rune', count: 300, id: air }] },
    });

    test("before login: --from=S13 with the log's 3 law refuses as a start gate, beside the seams", async () => {
        const r = loggedRuneCensus(plan, full, { from: s13, earlier: [censusRow(3)], served: () => false });
        const io: GateIO = {
            floor: async () => ({ ok: true, floor: 'f', runCommit: 'a'.repeat(40), line: 1, tickMs: { ok: true, tickMs: 400, line: 1 } }),
            tick: async rec => tickPreflight(feed400, rec, 400),
            reservation: () => ({ owner: 'o', state: { state: 'live', reservation: { owner: 'o', until: '2099-01-01T00:00:00Z', reason: '' } }, path: '/h' }),
            slotLedger: async () => ({ code: 0, out: '' }),
            helpersReady: () => true,
            cannonServe: () => ({ path: '/c.json', serve: null, error: 'ENOENT' }),
            runes: () => r,
        };
        const g = await startGates(sliceUntil(full, 'S13'), io);
        const names = g.map(x => x.gate);
        expect(names.indexOf('rune census')).toBe(names.indexOf('seams') + 1);
        const census = g.find(x => x.gate === 'rune census')!;
        expect(census.ok).toBe(false);
        expect(census.detail).toStartWith(`rune census from #${s13} S13:A-lawgof-start: law rune short by 2: held 3, needed 5 before H11 brings more`);
        expect(census.detail).toContain('T13-14a would run short (needs 2, 0 left)');
        expect('census' in r && r.source).toBe("held as the tick log's last census recorded it before S13:A-lawgof-start (tick 900, by id)");
    });

    test("before login: with no --from the census starts where the log's last census was taken; 5 law passes", () => {
        const r = loggedRuneCensus(plan, full, { earlier: [censusRow(5)], served: () => false });
        expect('census' in r && r.census.from).toBe(s13);
        const g = runeGate(r);
        expect(g.ok).toBe(true);
        expect(g.detail).toContain('law rune 5 held, 5 needed until H11');
        expect(censusStart(full, undefined, [censusRow(5)])).toBe(s13);
        expect(censusStart(full, t1314b, [censusRow(5)])).toBe(t1314b);
    });

    test('before login: a fresh run has no pack recorded, so the gate passes and says the census is taken live', () => {
        const g = runeGate(loggedRuneCensus(plan, full, { earlier: [], served: () => false }));
        expect(g).toMatchObject({ gate: 'rune census', ok: true });
        expect(g.detail).toContain('taken on the live pack after login');
        expect(censusStart(full, undefined, [])).toBe(0);
        expect(runeGate({ error: 'the rune plan could not be built: x' }).ok).toBe(false);
    });

    test('after login: a live shortfall logs SCORED out, writes the gate row and refuses with exit 3 before any step', async () => {
        const log = TickLog.memory('run-live');
        let loggedOut = 0;
        const lines: string[] = [];
        const code = await liveRuneCheck(
            { name: 'scored-login', sdk: {} as Session['sdk'] },
            { plan, from: s13, served: () => false, log },
            { logout: async () => (loggedOut++, { ok: true } as never), awaitState: async () => ({ inventory: [{ slot: 0, id: law, name: 'Law rune', count: 3, optionsWithIndex: [] }, { slot: 1, id: water, name: 'Water rune', count: 9, optionsWithIndex: [] }, { slot: 2, id: air, name: 'Air rune', count: 300, optionsWithIndex: [] }] }), say: l => lines.push(l) },
        );
        expect(code).toBe(3);
        expect(loggedOut).toBe(1);
        expect(log.rows).toHaveLength(1);
        expect(log.rows[0]).toMatchObject({ step: '(gate) rune census, live', kind: 'gate', ok: false });
        expect(lines[0]).toStartWith('[gate] REFUSED rune census, live: rune census from');
        expect(lines.some(l => l.includes('SHORT    law rune: held 3, needed 5'))).toBe(true);
        expect(lines.at(-1)).toBe('[run] rune census refused after login: SCORED logged out; no step ran');
    });

    test('after login: a sufficient live pack passes and nothing logs out; an unreadable pack refuses', async () => {
        const log = TickLog.memory('run-live');
        let loggedOut = 0;
        const logout = async () => (loggedOut++, { ok: true } as never);
        const pack = (n: number) => async () => ({ inventory: [{ slot: 0, id: law, name: 'Law rune', count: n, optionsWithIndex: [] }, { slot: 1, id: water, name: 'Water rune', count: 9, optionsWithIndex: [] }, { slot: 2, id: air, name: 'Air rune', count: 300, optionsWithIndex: [] }] });
        expect(await liveRuneCheck({ name: 's', sdk: {} as Session['sdk'] }, { plan, from: s13, served: () => false, log }, { logout, awaitState: pack(5), say: () => {} })).toBeNull();
        expect(loggedOut).toBe(0);
        expect(log.rows[0]).toMatchObject({ step: '(gate) rune census, live', ok: true });
        expect(await liveRuneCheck({ name: 's', sdk: {} as Session['sdk'] }, { plan, from: s13, served: () => false, log }, { logout, awaitState: async () => null, say: () => {} })).toBe(3);
        expect(loggedOut).toBe(1);
        // A hand-off record that does not parse refuses too, logged out, rather than throwing with SCORED in.
        const broken = () => { throw new Error('/run/handoffs.json does not parse'); };
        expect(await liveRuneCheck({ name: 's', sdk: {} as Session['sdk'] }, { plan, from: resolveFrom(full, 'T11-12a')!, served: broken, log }, { logout, awaitState: pack(9), say: () => {} })).toBe(3);
        expect(loggedOut).toBe(2);
        expect(log.rows.at(-1)).toMatchObject({ ok: false, error: '/run/handoffs.json does not parse' });
    });
});

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

    test("h12o's role and login folders resolve against the checkout, as the cue dir does; the lead time is kept as given", () => {
        const dir = mkdtempSync(join(tmpdir(), 'run-cfg-h12o-'));
        const path = join(dir, 'run.json');
        const { cueDir: _c, ...file } = cfg;
        writeFileSync(path, JSON.stringify({ ...file, h12o: { cueDir: 'run-machine/h45-cue', loginDir: 'run-machine/h45-login', leadTicks: 100 } }));
        expect(loadRunConfig(path, '/runs/m', {}).h12o).toEqual({ cueDir: join(process.cwd(), 'run-machine/h45-cue'), loginDir: join(process.cwd(), 'run-machine/h45-login'), leadTicks: 100 });
        writeFileSync(path, JSON.stringify(file));
        expect(loadRunConfig(path, '/runs/m', {}).h12o).toBeUndefined();
        rmSync(dir, { recursive: true, force: true });
    });
});

describe('attemptOf', () => {
    test("a resumed log's attempt is its first row's run id; an empty log's is this process's", () => {
        expect(attemptOf([], 'run-new')).toBe('run-new');
        expect(attemptOf([{ runId: 'run-first' }, { runId: 'run-second' }], 'run-new')).toBe('run-first');
        expect(attemptOf([{}, { runId: '' }, { runId: 'run-second' }], 'run-new')).toBe('run-second');
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

    test('all seven pass on a clean --until=S04 slice', async () => {
        const g = await startGates(s04, io());
        expect(g.map(x => [x.gate, x.ok])).toEqual([['run-commit floor', true], ['demo tick rate', true], ['host reservation', true], ['slot ledger', true], ['no refusing step on the path', true], ['seams', true], ['helpers ready', true]]);
        expect(g[5]!.detail).toBe('2 checked (S02, S03), 0 mismatches');
    });

    test("the seam gate refuses attempt 1's S03: the row's entry 77 tiles from T02-03's end, though no step refuses", async () => {
        const g = await startGates(sliceUntil(coopRow, 'S04'), io());
        expect(g.find(x => x.gate === 'no refusing step on the path')!.ok).toBe(true);
        const seam = g.find(x => x.gate === 'seams')!;
        expect(seam.ok).toBe(false);
        expect(seam.detail).toMatch(/S03 firemaking: T02-03 ends at 3222,3219 tol 0, 77 tiles from 3240,3296; the step starts within 15 \(firemaking\.ts precheck/);
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
        const g = await startGates(coopRow, io({
            floor: async () => ({ ok: false, reason: 'RUN_COMMIT abc does not include the run-commit floor df332771' }),
            reservation: () => ({ owner: 'rs/393', state: live('host'), path: '/h' }),
            slotLedger: async () => ({ code: 1, out: 'H12: 29 slots\n' }),
            helpersReady: () => null,
        }));
        expect(g.every(x => !x.ok)).toBe(true);
        expect(g.map(x => x.detail).join('\n')).toContain("live, but host's, not ours");
        expect(g[1]!.detail).toContain("the freeze's tickMs is unknown");
        // The full path without h45's h12o block: its login trigger refuses.
        expect(g[4]!.detail).toContain('H12o h45 login trigger (H12o login: the run config has no h12o block');
        expect(g[5]!.detail).toContain('S03 firemaking: T02-03 ends at 3222,3219');
        expect(g[6]!.detail).toContain('no launcher.json');
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


describe('startup during the planned S21 logout', () => {
    function setup(status: 'open' | 'closed' | null) {
        const relogs = new RelogBudget(mkdtempSync(join(tmpdir(), 'run-s21-')));
        if (status) relogs.beginPlanned(SCORED_RELOG, 100);
        if (status === 'closed') relogs.endPlanned(SCORED_RELOG, 'page');
        const trace: string[] = [];
        const session = { sdk: { getState: () => null }, bot: {}, name: 'lab', expectInWorld: false, watchdog: null } as unknown as Session;
        const log = TickLog.memory('startup');
        const ready: ChainStep = { id: 'S21', kind: 'step', preconditions: () => true, postconditions: () => true, logoutSafe: true, name: 'S21 runecraft:pre-login', run: async () => { expect(session.expectInWorld).toBe(false); trace.push('ready'); } };
        const login: ChainStep = { id: 'S21', kind: 'step', preconditions: () => true, postconditions: () => true, logoutSafe: true, name: SCORED_LOGIN, run: async () => {
            trace.push('login');
            await session.beforeLogin?.();
            relogs.endPlanned(SCORED_RELOG, 'page'); session.expectInWorld = true;
        } };
        const chain = [ready, login];
        const deps = {
            open: async (_bot: string, options: OpenOptions = {}) => {
                trace.push(`open launch=${options.launch} awaitInWorld=${options.awaitInWorld}`);
                return session;
            },
            close: async () => { trace.push('close'); },
            pageState: async () => ({ inGame: false, loginInProgress: false, message: '', error: '' }),
        };
        return { relogs, trace, session, log, chain, deps };
    }

    test('an open entry attaches offline and waits for the givers before its login, without any SCORED state', async () => {
        const t = setup('open');
        await openRunSession('lab', { client: 'browser', chain: t.chain, relogs: t.relogs, log: t.log,
            beforeLogin: async () => { t.trace.push('tick gate'); } }, t.deps);
        expect(t.trace).toEqual(['open launch=false awaitInWorld=false', 'ready', 'login', 'tick gate']);
        expect(t.relogs.planned(SCORED_RELOG)).toBe('closed');
    });

    test('before logout or after the completed login, normal launch skips both split halves', async () => {
        for (const status of [null, 'closed'] as const) {
            const t = setup(status);
            await openRunSession('lab', { client: 'browser', chain: t.chain, relogs: t.relogs, log: t.log }, t.deps);
            expect(t.trace).toEqual(['open launch=true awaitInWorld=undefined']);
        }
    });

    test('a disabled or sliced login half refuses before opening; failed readiness never logs in', async () => {
        const t = setup('open');
        await expect(openRunSession('lab', { client: 'browser', chain: [], relogs: t.relogs, log: t.log }, t.deps)).rejects.toThrow('requires its giver wait and login half');
        expect(t.trace).toEqual([]);
        t.chain[0]!.run = async () => { throw new Error('givers absent'); };
        await expect(openRunSession('lab', { client: 'browser', chain: t.chain, relogs: t.relogs, log: t.log }, t.deps)).rejects.toThrow('givers absent');
        expect(t.trace).toEqual(['open launch=false awaitInWorld=false', 'close']);
        expect(t.relogs.planned(SCORED_RELOG)).toBe('open');
    });

    test('open ledger reconciles the actual page before any ready cue: live, pending and unknown refuse unchanged', async () => {
        for (const state of ['live', 'pending', 'unknown', 'out'] as const) {
            const cdp = fakeCdp('lab');
            try {
                const t = setup('open');
                Object.assign(t.session, { client: 'browser', env: { CDP_URL: cdp.origin } });
                cdp.client.ingame = state === 'live';
                cdp.client.loginInProgress = state === 'pending';
                cdp.page.hasClient = state !== 'unknown';
                const action = openRunSession('lab', { client: 'browser', chain: t.chain, relogs: t.relogs, log: t.log }, { open: t.deps.open, close: t.deps.close });
                if (state === 'out') {
                    await action;
                    expect(t.trace).toContain('ready');
                    expect(t.relogs.planned(SCORED_RELOG)).toBe('closed');
                } else {
                    await expect(action).rejects.toThrow('manual reconciliation');
                    expect(t.trace).toEqual(['open launch=false awaitInWorld=false', 'close']);
                    expect(t.relogs.planned(SCORED_RELOG)).toBe('open');
                    expect(t.relogs.used()).toEqual({ planned: 1, unplanned: 0 });
                    expect(t.log.rows).toHaveLength(1);
                    expect(t.log.rows[0]!.account).toBe(LOG_ACCOUNT);
                }
                expect(cdp.page.autoLogins).toEqual([]);
                expect(cdp.page.navigations).toEqual([]);
            } finally { cdp.stop(); }
        }
    });

    test('startup ready, login and delayed gate rows are anonymized before they reach the log', async () => {
        const t = setup('open');
        const note = (step: string) => t.log.append({
            v: 1, runId: 'startup', account: t.session.name, sessionId: 1, step,
            startTick: 0, endTick: 0, ticks: 0, wallMs: 0, ok: true, tickMs: 400, at: '',
        });
        for (const s of t.chain) {
            const run = s.run;
            s.run = async ctx => { note(s.name); await run(ctx); };
        }
        await openRunSession('lab', { client: 'browser', chain: t.chain, relogs: t.relogs, log: t.log,
            beforeLogin: async () => { await Promise.resolve(); note('tick gate'); } }, t.deps);
        expect(t.log.rows.map(r => r.step)).toEqual(['S21 runecraft:pre-login', SCORED_LOGIN, 'tick gate']);
        expect(t.log.rows.map(r => r.account)).toEqual([LOG_ACCOUNT, LOG_ACCOUNT, LOG_ACCOUNT]);
    });

    test('a login half that throws once it has started is abandoned, then closed (rs/668)', async () => {
        const t = setup('open');
        t.chain[1]!.run = async () => {
            t.trace.push('login');
            throw new Error('page login failed mid-way');
        };
        const abandon = async (s: Session): Promise<AbandonResult> => {
            t.trace.push('abandon');
            s.expectInWorld = false;
            return { ok: true, sends: 1, takeovers: 0, wallMs: 5 };
        };
        await expect(openRunSession('lab', { client: 'browser', chain: t.chain, relogs: t.relogs, log: t.log }, { ...t.deps, abandon })).rejects.toThrow('page login failed');
        expect(t.trace).toEqual(['open launch=false awaitInWorld=false', 'ready', 'login', 'abandon', 'close']);
        expect(t.log.rows.map(r => [r.account, r.step, r.ok])).toEqual([
            [LOG_ACCOUNT, '(startup) S21 recovery refused', false],
            [LOG_ACCOUNT, '(run) SCORED abandoned: (startup) the S21 login half failed', true],
        ]);
    });
});

describe('startup failures leave SCORED logged out (rs/668)', () => {
    const budget = (alive: (pid: number) => boolean = () => true) => new RelogBudget(mkdtempSync(join(tmpdir(), 'run-abandon-')), undefined, alive);

    /** A browser session on a fake tab, in game, whose world lists it; the logout button takes it out of both. */
    function inGame() {
        const cdp = fakeCdp('srtest', 'x');
        const world = fakeWorld();
        world.players.add('srtest');
        cdp.hooks.onClickComponent = id => {
            if (id !== LOGOUT_BUTTON) return;
            cdp.client.ingame = false;
            world.players.delete('srtest');
        };
        const session = {
            name: 'srtest', client: 'browser', sdk: new FakeSdk(), sessionId: 1, launchTag: null, expectInWorld: true,
            period: new TickPeriod(), watchdog: null, logPath: '/dev/null', lastInWorldTick: 100,
            env: { BOT_USERNAME: 'srtest', PASSWORD: 'x', CDP_URL: cdp.origin, CLIENT_URL: `${cdp.origin}/bot?server=${world.host}` },
        } as unknown as Session;
        return { cdp, world, session, stop: () => (cdp.stop(), world.stop()) };
    }

    test('a throw before the chain, after the page login: the account ends confirmed logged out, logged, then closed', async () => {
        const t = inGame();
        const log = TickLog.memory('t');
        const closed: string[] = [];
        try {
            const err = await withScoredSession(t.session, { relogs: budget(), log }, async () => {
                throw new Error('chainProbes: nothing provides the S03 probe');
            }, { close: async () => void closed.push('close') }).catch((e: Error) => e);
            expect((err as Error).message).toBe('chainProbes: nothing provides the S03 probe');
            expect(t.cdp.page.clicks).toEqual([LOGOUT_BUTTON]);
            expect(t.world.players.has('srtest')).toBe(false);
            expect(t.session.expectInWorld).toBe(false);
            expect(closed).toEqual(['close']);
            expect(log.rows).toHaveLength(1);
            expect(log.rows[0]).toMatchObject({ step: '(run) SCORED abandoned: (exit) the run ended with SCORED still in the world', ok: true, meta: { ok: true, sends: 1, takeovers: 0 } });
        } finally {
            t.stop();
        }
    });

    test('a run that logged out leaves nothing to abandon', async () => {
        const calls: string[] = [];
        const session = { name: 'srtest', expectInWorld: true } as unknown as Session;
        const out = await withScoredSession(session, { relogs: budget(), log: TickLog.memory('t') }, async () => {
            session.expectInWorld = false;
            return 0;
        }, { abandon: async () => (calls.push('abandon'), null), close: async () => void calls.push('close') });
        expect([out, calls]).toEqual([0, ['close']]);
    });

    test("a failed launch is logged as SCORED's, and openSession was given the relog rules' takeover gate", async () => {
        const relogs = budget();
        const log = TickLog.memory('t');
        let given: OpenOptions | null = null;
        const open = async (_bot: string, o: OpenOptions = {}): Promise<Session> => {
            given = o;
            throw new Error('lab: refusing launch 0123456789ab: the page\'s login ended; logged out, confirmed (1 logout click(s), 1 takeover login(s), 4100 ms)');
        };
        await expect(openRunSession('lab', { client: 'browser', chain: [], relogs, log }, { open })).rejects.toThrow('refusing launch');
        expect((given as OpenOptions | null)?.launch).toBe(true);
        expect(typeof (given as OpenOptions | null)?.takeover).toBe('function');
        expect(log.rows).toHaveLength(1);
        expect(log.rows[0]).toMatchObject({ account: LOG_ACCOUNT, step: '(startup) SCORED launch failed', ok: false });
        expect(log.rows[0]!.error).toContain('logged out, confirmed');
    });

    test("takeoverGate: the relog lock and one unplanned relog, recorded before the login; refused while the operator's relog holds the lock or the budget is spent", async () => {
        const relogs = budget();
        const go = await takeoverGate(relogs, '(startup) the launch failed', () => 42)();
        expect(typeof go).toBe('function');
        expect(relogs.holder()).toMatchObject({ by: 'run' });
        expect(relogs.entries()).toMatchObject([{ kind: 'unplanned', by: 'run', step: '(startup) the launch failed', tick: 42, via: 'page' }]);
        (go as () => void)();
        expect(relogs.holder()).toBeNull();

        const operator = new RelogBudget(relogs.dir, undefined, () => true, 99_999);
        const held = operator.tryLock('operator');
        expect(held.ok).toBe(true);
        expect(await takeoverGate(relogs, 'x', () => 0)()).toMatch(/the operator's relog \(pid 99999\) holds the relog lock/);
        if (held.ok) held.release();
        expect(relogs.entries()).toHaveLength(1);

        relogs.record({ kind: 'unplanned', by: 'run', step: 'S05', tick: 1, via: 'page' });
        relogs.record({ kind: 'manual', by: 'operator', step: 'S09', tick: 2, via: 'page' });
        expect(await takeoverGate(relogs, 'x', () => 0)()).toMatch(/relog budget spent: 3\/3/);
        expect(relogs.holder()).toBeNull();
    });
});

describe('signals: a SIGTERM logs out, then the callers clean up once, then the exit', () => {
    const fakeSignals = (cleanupMs = 10_000) => {
        const handlers = new Map<string, () => void>();
        const exits: number[] = [];
        const deps: SignalDeps = {
            on: (s, f) => void handlers.set(s, f),
            off: (s, f) => { if (handlers.get(s) === f) handlers.delete(s); },
            exit: c => void exits.push(c),
            cleanupMs,
            log: () => {},
        };
        return { deps, exits, handlers, emit: (s: string) => handlers.get(s)?.() };
    };
    const running = () => new Promise<never>(() => {});

    test('mid-chunk: one logout, Terminated(143) after it, every cleanup once, then no hard exit once disarmed', async () => {
        const f = fakeSignals(30);
        const trace: string[] = [];
        let leaves = 0;
        const sig = signalShutdown('[t]', async () => { leaves++; await Bun.sleep(5); trace.push('logged out'); }, f.deps);
        const cleanups = { bones: 0, altar: 0, chrome: 0, proxy: 0 };
        // dress-rehearsal's shape: the chain inside try, Terminated caught, the teardown in finally.
        const caller = (async () => {
            let code = 0;
            let term: Terminated | null = null;
            try {
                await untilTerminated(running(), sig);
            } catch (e) {
                if (!(e instanceof Terminated)) throw e;
                term = e;
                code = e.exitCode;
                trace.push('terminated');
            } finally {
                cleanups.bones++; cleanups.altar++; cleanups.chrome++; cleanups.proxy++;
                trace.push('cleanup');
                sig.dispose();
            }
            (term as Terminated | null)?.disarm();
            return code;
        })();
        f.emit('SIGTERM');
        f.emit('SIGTERM');
        f.emit('SIGHUP');
        expect(await caller).toBe(143);
        expect(leaves).toBe(1);
        expect(trace).toEqual(['logged out', 'terminated', 'cleanup']);
        expect(cleanups).toEqual({ bones: 1, altar: 1, chrome: 1, proxy: 1 });
        await Bun.sleep(60);
        expect(f.exits).toEqual([]);
        expect(f.handlers.size).toBe(0);
    });

    test('a step that fails because of the logout still ends in Terminated, after the logout', async () => {
        const f = fakeSignals();
        let fail!: (e: Error) => void;
        const chunk = new Promise<never>((_, r) => (fail = r));
        let out = false;
        const sig = signalShutdown('[t]', async () => { fail(new Error('not in game')); await Bun.sleep(5); out = true; }, f.deps);
        const p = untilTerminated(chunk, sig).catch(e => e);
        f.emit('SIGTERM');
        const e = await p;
        expect(e).toBeInstanceOf(Terminated);
        expect([(e as Terminated).exitCode, (e as Terminated).signal, out]).toEqual([143, 'SIGTERM', true]);
        (e as Terminated).disarm();
        sig.dispose();
    });

    test('a cleanup that hangs is cut off: the hard exit fires with the code after cleanupMs', async () => {
        const f = fakeSignals(20);
        const sig = signalShutdown('[t]', async () => {}, f.deps);
        const p = untilTerminated(running(), sig).catch(e => e);
        f.emit('SIGTERM');
        expect(await p).toBeInstanceOf(Terminated);
        await Bun.sleep(50); // never disarmed: the cleanup never finished
        expect(f.exits).toEqual([143]);
        sig.dispose();
    });

    test('Ctrl-C once asks for a stop and logs nothing out; a second logs out now and ends with 130', async () => {
        const f = fakeSignals();
        let leaves = 0;
        const sig = signalShutdown('[t]', async () => { leaves++; }, f.deps);
        f.emit('SIGINT');
        expect([sig.stopAsked(), leaves, sig.termination()]).toEqual([true, 0, null]);
        const p = untilTerminated(running(), sig).catch(e => e);
        f.emit('SIGINT');
        const e = (await p) as Terminated;
        expect([e.exitCode, e.signal, leaves]).toEqual([130, 'SIGINT', 1]);
        e.disarm();
        sig.dispose();
    });

    test("the run end's cue stop by signal path: final on SIGTERM and a second Ctrl-C; plain on a first Ctrl-C (4), SIGHUP and no signal; final on a completed chain", async () => {
        const signalOf = async (emit: string[]) => {
            const f = fakeSignals();
            const sig = signalShutdown('[t]', async () => {}, f.deps);
            const p = untilTerminated(emit.length && !(emit.length === 1 && emit[0] === 'SIGINT') ? running() : Promise.resolve(4), sig).catch(e => e);
            for (const s of emit) f.emit(s);
            const out = await p;
            if (out instanceof Terminated) out.disarm();
            sig.dispose();
            return sig.termination()?.signal ?? null;
        };
        const cases: [string[], boolean][] = [[['SIGTERM'], true], [['SIGINT', 'SIGINT'], true], [['SIGINT'], false], [['SIGHUP'], false], [[], false]];
        for (const [emit, final] of cases) expect([emit.join('+'), exitStopIsFinal({ completed: false, signal: await signalOf(emit) })]).toEqual([emit.join('+'), final]);
        expect(exitStopIsFinal({ completed: true, signal: null })).toBe(true);
    });

    test("with no signal the chain's own result and errors pass through", async () => {
        const f = fakeSignals();
        const sig = signalShutdown('[t]', async () => {}, f.deps);
        expect(await untilTerminated(Promise.resolve(7), sig)).toBe(7);
        await expect(untilTerminated(Promise.reject(new Error('step failed')), sig)).rejects.toThrow('step failed');
        sig.dispose();
    });
});
