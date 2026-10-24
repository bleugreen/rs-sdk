import { fakeCdp, fakeWorld } from './lib/fake-cdp';
import { baseState, FakeSdk, simulateWalking } from './lib/fake-sdk';
import { cannonSessionStep, inSpiderReach } from './skills/ranged';
import { RETREAT_STEP } from './runner/retreat';
import { inCombatWindow } from './lib/world';
import { deathGate, deathKey, DEATH_STEP, EXIT_DIED, ackRow } from './runner/death';
import type { ReservationWatch } from './lib/host-reservation';
import type { BotWorldState, InventoryItem, PlayerState } from '../sdk/types';
import { TickPeriod } from './lib/wait';
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { TickLog } from './lib/ticks';
import { MANIFEST } from './tools/slot-ledger';
import { returnExtrasFromLedger } from './helpers/cannon-receiver';
import { readFileSync } from 'fs';
import { aliasAccount, attemptOf, censusStart, closeTabAfterStop, openRunSession, resumeLine, runChainOnSession, cannonServeDrift, chainOrRefusal, type GateIO, liveRuneCheck, LOG_ACCOUNT, loadRunConfig, loggedRuneCensus, parseArgs, runeGate, signalShutdown, type SignalDeps, startGates, type TabResetDeps, takeoverGate, TARGET_TOTAL, Terminated, tickBeforeLogin, totalLevel, untilTerminated, UsageError, withScoredSession } from './run';
import { runeCensus, runePlan } from './runner/rune-census';
import { phaseGates, phasePath, statusFileName, type PhaseMember } from './runner/phase-gate';
import { BOUNDARY_STEP } from './runner/step';
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
import { buildChain, CENSUS_STEP, KIT_PARTNER_ROWS, ledgerRows, PLACEMENT, resolveFrom, sliceUntil, STOP_CENSUS_LABEL, tag } from './runner/chain';

const cues = { open: async () => {}, stop: () => {} };
const partners = Object.fromEntries([...Object.keys(PLACEMENT), ...KIT_PARTNER_ROWS, 'H4m'].map(id => [id, `p_${id}`]));
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
        expect('census' in r && r.source).toBe("held as the tick log's last census recorded it before S13:A-lawgof-start (tick 900, by id; taken as that step started)");
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
        // An attempt record that does not parse refuses too, logged out, rather than throwing with SCORED in.
        const broken = () => { throw new Error('/run/attempt-record.json does not parse'); };
        expect(await liveRuneCheck({ name: 's', sdk: {} as Session['sdk'] }, { plan, from: resolveFrom(full, 'T11-12a')!, served: broken, log }, { logout, awaitState: pack(9), say: () => {} })).toBe(3);
        expect(loggedOut).toBe(2);
        expect(log.rows.at(-1)).toMatchObject({ ok: false, error: '/run/attempt-record.json does not parse' });
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
            .toEqual({ bot: 's', config: 'c', client: 'lite', from: 'S07', until: 'S14', dryRun: true, tickOverride: false, closeTabOnStop: false, s21Relog: true, log: '/l.jsonl', runCommit: 'abc', runDir: '/r', hostReservation: '/h', claimOwner: 'rs/393', cannonServe: '/c.json' });
        expect(parseArgs(['--bot=s', '--config=c', '--tick-override']).tickOverride).toBe(true);
        expect(parseArgs(['--bot=s', '--config=c', '--close-tab-on-stop']).closeTabOnStop).toBe(true);
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

describe('a death while the logout after a refused step holds (rs/709, attempt 3)', () => {
    test('S14 refused in the Wilderness; the logout holds through the combat; SCORED dies and respawns: (death) row, DIED, exit 6; the next start refuses until --r8-recovered names it', async () => {
        const fighting = { inCombat: true, targetIndex: 7, targetType: 'npc', lastDamageTick: 231 };
        const p0 = { name: 'lab', worldX: 3288, worldZ: 3810, x: 3288, z: 3810, level: 0, hp: 12, maxHp: 42, isDead: false, lifeId: 1, respawnCount: 0, lastDeathTick: null, combat: fighting } as unknown as PlayerState;
        const sdk = Object.assign(new FakeSdk(baseState({ tick: 231, player: p0 })), { checkBotStatus: async () => ({ status: 'active', inGame: true }) });
        let exit!: (code: number) => void;
        const child = { exited: new Promise<number>(r => (exit = r)), kill: () => exit(137) };
        const now = Date.now();
        const session = {
            name: 'lab', client: 'lite', env: { BOT_USERNAME: 'lab', PASSWORD: 'x' }, sdk, bot: {}, sessionId: 1, launchId: 1, tickBase: 0, expectInWorld: true,
            child, childExit: null, lastInWorldTick: 231, lastAdvanceAt: now, period: new TickPeriod(), launchedAt: now - 60_000, ticksSinceProgress: 0, watchdog: null, logPath: '/dev/null',
        } as unknown as Session;
        void child.exited.then(c => { session.childExit = c; });
        let clicked = false;
        sdk.onSend = a => {
            if (a.method !== 'sendClickComponent' || a.args[0] !== LOGOUT_BUTTON) return;
            clicked = true;
            exit(0);
        };
        // Hit every tick once S14 has refused: down a hitpoint a tick, dead 4 ticks, then the Lumbridge respawn and the engine's message.
        let refused = false;
        let deadAt: number | null = null;
        const script = (s: BotWorldState): Partial<BotWorldState> => {
            const t = s.tick + 1;
            const p = s.player!;
            if (p.worldX === 3222) return {};
            if (!refused || p.hp > 1) return { player: { ...p, hp: refused ? p.hp - 1 : p.hp, combat: { ...p.combat, ...fighting, lastDamageTick: t } } as PlayerState };
            deadAt ??= t;
            if (t < deadAt + 4) return { player: { ...p, hp: 0, isDead: true } };
            return {
                player: { ...p, worldX: 3222, worldZ: 3218, x: 3222, z: 3218, hp: 42, isDead: false, lifeId: 2, respawnCount: 1, combat: { ...p.combat, inCombat: false, targetIndex: -1, targetType: 'none' } } as PlayerState,
                gameMessages: [...s.gameMessages, { type: 0, text: 'Oh dear you are dead!', sender: '', tick: t, fromSelf: false }],
            };
        };
        const timer = setInterval(() => { if (!clicked) sdk.tick(script); }, 5);
        const log = TickLog.memory('run-3');
        const s14: ChainStep = {
            id: 'S14', kind: 'step', name: 'S14 ranged', postconditions: () => true, logoutSafe: true, run: async () => {},
            preconditions: () => ((refused = true), 'Attack 1, not 40 (the scimitar)'),
        };
        const handlers = { on: () => {}, off: () => {}, exit: () => {}, log: () => {} };
        let out: Awaited<ReturnType<typeof runChainOnSession>> | undefined;
        try {
            out = await runChainOnSession(session, { log, chain: [s14], reservation: { boundary: () => null, path: '' } as unknown as ReservationWatch, from: 0, signals: handlers });
        } finally {
            clearInterval(timer);
        }
        const ran = out!;
        expect(ran.result.code).toBe(EXIT_DIED);
        expect(ran.result.outcome).toMatch(/^DIED: SCORED died before the logout landed: \(3288,3810,0\) on tick \d+ to \(3222,3218,0\) on tick \d+ \(dead, respawned, message, respawn-tile; .*\(the chain had ended: FAILED: step "S14 ranged" precondition failed: Attack 1/);
        expect(ran.lastLogout).toMatchObject({ ok: true, death: { signs: ['dead', 'respawned', 'message', 'respawn-tile'] } });
        expect(ran.lastLogout!.held!.ticks).toBeGreaterThanOrEqual(17);
        const deaths = log.rows.filter(r => r.step === DEATH_STEP);
        expect(deaths).toHaveLength(1);
        expect(deaths[0]).toMatchObject({ ok: false, meta: { from: { x: 3288, z: 3810, level: 0 }, to: { x: 3222, z: 3218, level: 0 }, logout: { ok: true } } });
        // The refusal's own row carries SCORED's hp at its end: the fall starts from the log alone.
        const refusal = log.rows.find(r => r.step === 'S14 ranged:precondition')!;
        expect(refusal.meta).toMatchObject({ hp: expect.any(Number), maxHp: 42 });
        expect(refusal.meta!.hp as number).toBeLessThanOrEqual(12);
        expect((deaths[0]!.meta as { logout: { held?: unknown } }).logout.held).toBeDefined();
        expect(session.died).toBe(ran.lastLogout!.death!);

        // The next start, a walk or a --from: refused until --r8-recovered names this death.
        const key = deathKey(deaths[0]!);
        expect(deathGate(log.rows)).toMatchObject({ refusal: expect.stringContaining(`--r8-recovered=${key}`) });
        expect(deathGate(log.rows, key)).toEqual({ acknowledge: [key] });
        expect(deathGate([...log.rows, ackRow(log, LOG_ACCOUNT, [key])])).toEqual({ acknowledge: [] });
        expect(parseArgs(['--bot=b', '--config=c', `--r8-recovered=${key}`, '--from=S14']).r8Recovered).toBe(key);
    });
});

describe('S14 fails among the spiders: the retreat before the logout (rs/725)', () => {
    /**
     * The host's second S14 death (run-20261024-062622): S14 refused on the spot (3288,3810) at tick
     * 235, hp 25 of 38 after T13-14b, the spiders on SCORED. Here the real S14 (Dwarf Cannon not done)
     * refuses at its precondition, the first death's shape. The spiders hit `damage` every
     * `hitEvery` ticks while SCORED is in their reach (skills/ranged.ts inSpiderReach), from the
     * refusal on; a Shark eaten heals 20; at 0 hp SCORED dies and respawns in Lumbridge.
     */
    function spiderRun(o: { hp: number; food: boolean; hitEvery: number; damage: number }) {
        const fighting = { inCombat: true, targetIndex: 7, targetType: 'npc', lastDamageTick: 235 };
        const p0 = { name: 'lab', worldX: 3288, worldZ: 3810, x: 3288, z: 3810, level: 0, hp: o.hp, maxHp: 38, isDead: false, lifeId: 1, respawnCount: 0, lastDeathTick: null, combat: fighting } as unknown as PlayerState;
        const shark = { slot: 0, id: 385, name: 'Shark', count: 1, optionsWithIndex: [{ text: 'Eat', opIndex: 1 }] } as unknown as InventoryItem;
        const sdk = Object.assign(new FakeSdk(baseState({ tick: 235, player: p0, inventory: o.food ? [shark] : [] })), { checkBotStatus: async () => ({ status: 'active', inGame: true }) });
        let exit!: (code: number) => void;
        const child = { exited: new Promise<number>(r => (exit = r)), kill: () => exit(137) };
        const now = Date.now();
        const session = {
            name: 'lab', client: 'lite', env: { BOT_USERNAME: 'lab', PASSWORD: 'x' }, sdk, bot: {}, sessionId: 1, launchId: 1, tickBase: 0, expectInWorld: true,
            child, childExit: null, lastInWorldTick: 235, lastAdvanceAt: now, period: new TickPeriod(), launchedAt: now - 60_000, ticksSinceProgress: 0, watchdog: null, logPath: '/dev/null',
        } as unknown as Session;
        void child.exited.then(c => { session.childExit = c; });
        const seen = { click: null as null | { tick: number; inReach: boolean; inWindow: boolean }, eats: 0 };
        let eat = false;
        sdk.onSend = a => {
            if (a.method === 'sendUseItem' && a.args[0] === 0) { seen.eats++; eat = true; }
            if (a.method !== 'sendClickComponent' || a.args[0] !== LOGOUT_BUTTON) return;
            const s = sdk.state!;
            seen.click = { tick: s.tick, inReach: inSpiderReach(s), inWindow: inCombatWindow(s) };
            exit(0);
        };
        const sim = simulateWalking(sdk);
        let refused = false;
        let deadAt: number | null = null;
        const script = (s: BotWorldState): Partial<BotWorldState> => {
            const t = s.tick + 1;
            const p = s.player!;
            if (p.worldX === 3222) return {};
            if (deadAt !== null) {
                sim.target = null;
                return {
                    player: { ...p, worldX: 3222, worldZ: 3218, x: 3222, z: 3218, hp: 38, isDead: false, lifeId: 2, respawnCount: 1, combat: { ...p.combat, inCombat: false, targetIndex: -1, targetType: 'none' } } as PlayerState,
                    gameMessages: [...s.gameMessages, { type: 0, text: 'Oh dear you are dead!', sender: '', tick: t, fromSelf: false }],
                };
            }
            const ate = eat && s.inventory.length > 0;
            eat = false;
            const healed = ate ? Math.min(p.maxHp, p.hp + 20) : p.hp;
            if (!refused || !inSpiderReach(s)) {
                return { player: { ...p, hp: healed, combat: { ...p.combat, inCombat: refused ? false : p.combat.inCombat, ...(refused ? { targetIndex: -1, targetType: 'none' } : {}) } } as PlayerState, ...(ate ? { inventory: [] } : {}) };
            }
            const hit = t % o.hitEvery === 0;
            const hp = healed - (hit ? o.damage : 0);
            if (hp <= 0) deadAt = t;
            return {
                player: { ...p, hp: Math.max(0, hp), isDead: hp <= 0, combat: { ...p.combat, ...fighting, lastDamageTick: hit ? t : p.combat.lastDamageTick } } as PlayerState,
                ...(ate ? { inventory: [] } : {}),
            };
        };
        const timer = setInterval(() => { if (!seen.click) sdk.tick(script); }, 5);
        const log = TickLog.memory('rehearsal-3');
        const real = tag('S14', 'step', cannonSessionStep());
        const s14: ChainStep = { ...real, preconditions: (s, c) => ((refused = true), real.preconditions(s, c)) };
        const handlers = { on: () => {}, off: () => {}, exit: () => {}, log: () => {} };
        const run = async () => {
            try {
                return await runChainOnSession(session, { log, chain: [s14], reservation: { boundary: () => null, path: '' } as unknown as ReservationWatch, from: 0, signals: handlers });
            } finally {
                clearInterval(timer);
            }
        };
        return { sdk, session, seen, log, run };
    }

    test('in combat on the spot: the retreat walks south out of reach eating on the way, the combat window ends, and the logout lands; the row and the outcome say it retreated', async () => {
        const w = spiderRun({ hp: 25, food: true, hitEvery: 2, damage: 2 });
        const ran = await w.run();
        expect(ran.result.code).toBe(1);
        expect(ran.result.outcome).toMatch(/^FAILED: step "S14 cannon session" precondition failed: Dwarf Cannon is not complete .*; retreated out of reach \(combat window; \(3288,3810\) to \(3288,3768\), \d+ ticks\), then logged out$/);
        expect(ran.lastLogout).toMatchObject({ ok: true, sends: 1 });
        expect(w.seen.click).toMatchObject({ inReach: false, inWindow: false });
        expect(w.seen.eats).toBeGreaterThanOrEqual(1);
        const rows = w.log.rows.filter(r => r.step === RETREAT_STEP);
        expect(rows).toMatchObject([{ ok: true, meta: { step: 'S14 cannon session', why: 'combat window', from: { x: 3288, z: 3810 }, to: { x: 3288, z: 3768 }, logout: { ok: true } } }]);
        expect(w.log.rows.filter(r => r.step === DEATH_STEP)).toEqual([]);
        expect(w.session.died).toBeUndefined();
        // Walks and the one Shark: nothing picked up, the cannon left.
        expect(w.sdk.sent.filter(a => a.method !== 'sendWalk' && a.method !== 'sendUseItem' && a.method !== 'sendClickComponent')).toEqual([]);
    });

    test('SCORED dies during the retreat: DeathWatch sees it, the (death) row, DIED, exit 6', async () => {
        const w = spiderRun({ hp: 6, food: false, hitEvery: 1, damage: 1 });
        const ran = await w.run();
        expect(ran.result.code).toBe(EXIT_DIED);
        expect(ran.result.outcome).toMatch(/^DIED: SCORED died retreating after "S14 cannon session" failed: \(3288,\d+,0\) on tick \d+ to \(3222,3218,0\) on tick \d+ .*\(the chain had ended: FAILED: step "S14 cannon session" precondition failed: .*; DIED retreating \(/);
        const deaths = w.log.rows.filter(r => r.step === DEATH_STEP);
        expect(deaths).toHaveLength(1);
        expect(w.session.died).toBeDefined();
        expect(w.log.rows.filter(r => r.step === RETREAT_STEP)).toMatchObject([{ ok: false, meta: { died: expect.stringContaining('SCORED died retreating') } }]);
        // Out of the world from the respawn; the next start refuses until --r8-recovered names the death.
        expect(ran.lastLogout).toMatchObject({ ok: true });
        expect(deathGate(w.log.rows)).toMatchObject({ refusal: expect.stringContaining(`--r8-recovered=${deathKey(deaths[0]!)}`) });
    });
});

describe('a planned stop after the willow band, then --from (rs/753)', () => {
    const iWillow = full.findIndex(s => s.name === 'woodcutting:willow-73-99');
    const iDrop = full.findIndex(s => s.name === 'woodcutting:drop-axe');
    const iT0708 = resolveFrom(full, 'T07-08')!;
    const now = 1_800_000_000_000;

    test("drop-axe takes nothing from the givers: outside the bone cue, and the phase path from it skips S07, whose finished givers publish 'off'", () => {
        expect([iDrop, iT0708]).toEqual([iWillow + 1, iWillow + 2]);
        expect(full[iDrop]).toMatchObject({ id: 'S07', kind: 'step', helperFree: true });
        expect(full[iDrop]!.cue).toBeUndefined();
        expect(full[iWillow]!.cue).toEqual({ step: 'S07', family: 'bone' });
        expect(phasePath(full, iDrop)).not.toContain('S07');
        expect(phasePath(full, iDrop)[0]).toBe('T07-08');
        expect(phasePath(full, iWillow)[0]).toBe('S07');
        const members: PhaseMember[] = [{ account: 'b', scope: { step: 'S07', family: 'bone' } }, { account: 'c', scope: { step: 'S18', family: 'courier' } }];
        const files: Record<string, unknown> = { [statusFileName('bones', 'b')]: { v: 1, account: 'b', phase: 'off', held: 0, tile: null, readyAt: null, ms: now - 1000 } };
        const at = (start: number) => phaseGates({ path: phasePath(full, start), members, read: f => files[f] ?? null, launcher: [{ account: 'c', state: 'awaiting-cue', cue: { state: 'waiting' } }], now, source: 'helpers.json' });
        expect(at(iDrop).filter(g => !g.ok)).toEqual([]);
        expect(at(iDrop).some(g => g.gate.startsWith('role phase S07'))).toBe(false);
        // Where the givers are still wanted, their phase still refuses.
        expect(at(iWillow).find(g => g.gate === 'role phase S07/bone b')).toEqual({ gate: 'role phase S07/bone b', ok: false, detail: 'bones-b.json: phase off, not waiting' });
    });

    /** What the chain spends of each rune from T07-08 to its next supply, as items by obj id: the true pack after the willow band. */
    const runeIds = new Map([...objPack().names].map(([id, n]) => [n, id] as const));
    const needFromT0708 = runeCensus(fullRunePlan, iT0708, {}).lines.filter(l => l.needed > 0).map(l => ({ rune: l.rune, needed: l.needed }));
    const label = (rune: string) => `${rune[0]!.toUpperCase()}${rune.slice(1, -'rune'.length)} rune`;
    const pack = (short?: string): InventoryItem[] => [
        { slot: 0, id: 1359, name: 'Rune axe', count: 1, optionsWithIndex: [] },
        ...needFromT0708.map((n, i) => ({ slot: i + 1, id: runeIds.get(n.rune)!, name: label(n.rune), count: n.needed - (n.rune === short ? 1 : 0), optionsWithIndex: [] })),
    ] as InventoryItem[];

    /** A lite SCORED session at the willow stand, Woodcutting 99; a logout click lands; a drop leaves the pack. */
    function stand(inventory: InventoryItem[], tick: number) {
        const p0 = { name: 'lab', worldX: 2969, worldZ: 3194, x: 2969, z: 3194, level: 0, hp: 30, maxHp: 40, isDead: false, lifeId: 1, respawnCount: 0, lastDeathTick: null, combat: { inCombat: false, targetIndex: -1, targetType: 'none', lastDamageTick: null } } as unknown as PlayerState;
        const skills = [{ name: 'Woodcutting', level: 99, baseLevel: 99, experience: 13_034_431 }] as BotWorldState['skills'];
        const sdk = Object.assign(new FakeSdk(baseState({ tick, player: p0, skills, inventory })), { checkBotStatus: async () => ({ status: 'active', inGame: true }) });
        let exit!: (code: number) => void;
        const child = { exited: new Promise<number>(r => (exit = r)), kill: () => exit(137) };
        const at = Date.now();
        const session = {
            name: 'lab', client: 'lite', env: { BOT_USERNAME: 'lab', PASSWORD: 'x' }, sdk, bot: {}, sessionId: 1, launchId: 1, tickBase: 0, expectInWorld: true,
            child, childExit: null, lastInWorldTick: tick, lastAdvanceAt: at, period: new TickPeriod(), launchedAt: at - 60_000, ticksSinceProgress: 0, watchdog: null, logPath: '/dev/null',
        } as unknown as Session;
        void child.exited.then(c => { session.childExit = c; });
        let out = false;
        sdk.onSend = a => {
            if (a.method === 'sendDropItem') sdk.push(cur => ({ inventory: cur.inventory.filter(i => i.slot !== a.args[0]) }));
            if (a.method === 'sendClickComponent' && a.args[0] === LOGOUT_BUTTON) { out = true; exit(0); }
        };
        const timer = setInterval(() => { if (!out) sdk.tick(); }, 5);
        return { sdk, session, stop: () => clearInterval(timer) };
    }

    test('Ctrl-C during the willow band: the stop census is the true pack at the logout boundary; --from the next step drops the axe and reaches T07-08', async () => {
        expect(needFromT0708.map(n => n.rune)).toContain('lawrune');
        const log = TickLog.memory('run-753');
        let sigint: (() => void) | null = null;
        const signals: SignalDeps = { on: (s, f) => { if (s === 'SIGINT') sigint = f; }, off: () => {}, exit: () => {}, log: () => {} };
        const reservation = { boundary: () => null, path: '' } as unknown as ReservationWatch;
        let reached: InventoryItem[] | null = null;
        // The willow band: a poison message and a hit during it, then the operator's one Ctrl-C.
        const willow: ChainStep = { id: 'S07', kind: 'step', name: 'woodcutting:willow-73-99', logoutSafe: true, preconditions: () => true, postconditions: () => true, run: async ({ sdk }) => {
            const f = sdk as unknown as FakeSdk;
            f.tick(s => ({ player: { ...s.player!, hp: 27 }, gameMessages: [...s.gameMessages, { type: 0, text: 'You have been poisoned!', sender: '', tick: s.tick + 1, fromSelf: false }] }));
            f.tick();
            sigint!();
        } };
        const t0708: ChainStep = { id: 'T07-08', kind: 'leg', name: 'T07-08', logoutSafe: true, postconditions: () => true,
            preconditions: s => (s.inventory.some(i => /axe/i.test(i.name)) ? 'the axe is still held' : true),
            run: async ({ sdk }) => { reached = sdk.getState()!.inventory; } };
        const chain = [willow, full[iDrop]!, t0708];

        const first = stand(pack(), 2_258);
        let ran: Awaited<ReturnType<typeof runChainOnSession>>;
        try {
            ran = await runChainOnSession(first.session, { log, chain, reservation, from: 0, signals });
        } finally {
            first.stop();
        }
        expect(ran.result).toMatchObject({ code: 4, resumeAt: 1 });
        expect(resumeLine(chain, ran.result.resumeAt)).toBe(', or with --from=1 (#1 woodcutting:drop-axe)');
        expect(ran.lastLogout).toMatchObject({ ok: true });
        // The stop's census, after the band's rows and before the logout: the axe and the band's runes.
        const stopRow = log.rows.filter(r => r.step === CENSUS_STEP).at(-1)!;
        expect(stopRow.meta).toMatchObject({ before: 'woodcutting:drop-axe', id: 'S07', label: STOP_CENSUS_LABEL, hp: 27, maxHp: 40 });
        expect((stopRow.meta!.inventory as { name: string }[]).map(i => i.name)).toEqual(pack().map(i => i.name));
        // The band's own row: hp at its end and the poison seen during it.
        expect(log.rows.find(r => r.step === 'woodcutting:willow-73-99' && r.kind === undefined)!.meta).toMatchObject({ hp: 27, maxHp: 40, poison: { seen: 1, source: 'message', text: 'You have been poisoned!' } });
        // Boundary rows are not stamped.
        expect(log.rows.filter(r => r.step === BOUNDARY_STEP).every(r => !(r.meta && 'hp' in r.meta))).toBe(true);

        // The next start's pre-login census reads the stop's row, says so, and passes on the true pack from either step.
        for (const from of [iDrop, iT0708]) {
            const g = runeGate(loggedRuneCensus(fullRunePlan, full, { from, earlier: log.rows, served: () => false }));
            expect(g.ok).toBe(true);
            expect(g.meta!.source).toBe(`held as the tick log's last census recorded it before woodcutting:drop-axe (tick ${stopRow.startTick}, by id; written at the stop's logout boundary)`);
        }
        // Without --from the run picks up where the stop's census was taken.
        expect(censusStart(full, undefined, log.rows)).toBe(iDrop);

        // --from the next step: the axe goes, and T07-08 starts without it.
        const second = stand(pack(), 2_300);
        let again: Awaited<ReturnType<typeof runChainOnSession>>;
        try {
            again = await runChainOnSession(second.session, { log, chain, reservation, from: 1, signals: { on: () => {}, off: () => {}, exit: () => {}, log: () => {} } });
        } finally {
            second.stop();
        }
        expect(again.result.code).toBe(0);
        expect(reached).not.toBeNull();
        expect(reached!.some(i => /axe/i.test(i.name))).toBe(false);
        expect(second.sdk.sent.filter(a => a.method === 'sendDropItem').map(a => a.args[0])).toEqual([0]);
    });

    test('a genuinely short pack at the stop still refuses before login, naming the rune', () => {
        const row = (inventory: InventoryItem[]): TickRow => ({
            v: 1, kind: 'note', runId: 'run-753', account: LOG_ACCOUNT, sessionId: 1, step: CENSUS_STEP, startTick: 2_260, endTick: 2_260, ticks: 0, wallMs: 0, ok: true, tickMs: 400, at: '2026-10-24T13:00:00Z',
            meta: { before: 'woodcutting:drop-axe', id: 'S07', label: STOP_CENSUS_LABEL, free: 20, worn: [], inventory: inventory.map(i => ({ name: i.name, count: i.count, id: i.id })) },
        });
        // Attempt 4's stale row, before the band (no runes), then the stop's own: the stop's is the one read.
        const stale: TickRow = { ...row([pack()[0]!]), startTick: 2_258, meta: { ...row([pack()[0]!]).meta, before: 'woodcutting:willow-73-99', label: undefined } };
        expect(runeGate(loggedRuneCensus(fullRunePlan, full, { from: iT0708, earlier: [stale], served: () => false })).ok).toBe(false);
        expect(runeGate(loggedRuneCensus(fullRunePlan, full, { from: iT0708, earlier: [stale, row(pack())], served: () => false })).ok).toBe(true);
        const g = runeGate(loggedRuneCensus(fullRunePlan, full, { from: iT0708, earlier: [stale, row(pack('lawrune'))], served: () => false }));
        expect(g.ok).toBe(false);
        expect(g.detail).toContain('law rune short by 1');
        // An operator's labelled row is read and named as such.
        const host = { ...row(pack()), meta: { ...row(pack()).meta, label: 'host one-off by-id read' } };
        expect(runeGate(loggedRuneCensus(fullRunePlan, full, { from: iT0708, earlier: [stale, host], served: () => false })).meta!.source).toContain('labelled "host one-off by-id read"');
    });

    test('the tab reset closes the tab only once SCORED is out and off the world list, and says why it did not otherwise', async () => {
        let t = 0;
        let closes = 0;
        const deps = (listed: (boolean | null)[]): TabResetDeps => ({
            listed: async () => (listed.length > 1 ? listed.shift()! : listed[0]!),
            close: async () => (closes++, { closed: 1, left: ['about:blank'] }),
            sleep: async ms => { t += ms; },
            now: () => t,
        });
        const out = { client: 'browser' as const, expectInWorld: false };
        expect(await closeTabAfterStop(out, deps([true, true, false]))).toBe("tab reset: SCORED is off the world's player list; closed 1 tab(s), 1 page(s) left");
        expect(closes).toBe(1);
        t = 0;
        expect(await closeTabAfterStop(out, deps([true]), 5_000)).toBe("tab reset: the world's player list still lists SCORED 5 s after the logout, so its tab is left open");
        t = 0;
        expect(await closeTabAfterStop(out, deps([null]), 3_000)).toBe("tab reset: the world's player list did not answer 3 s after the logout, so its tab is left open");
        expect(await closeTabAfterStop({ client: 'browser', expectInWorld: true }, deps([false]))).toBe('tab reset: SCORED is not confirmed out, so its tab is left open');
        expect(await closeTabAfterStop({ client: 'lite', expectInWorld: false }, deps([false]))).toBe('tab reset: not a browser session, nothing to close');
        expect(closes).toBe(1);
    });
});
