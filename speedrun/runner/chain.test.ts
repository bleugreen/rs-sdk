import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { BotWorldState, PlayerState } from '../../sdk/types';
import { CUE_FILE, CueWatcher, CueWriter, type Cue, type CueScope } from '../helpers/altar-cue';
import { PLAN_FILE } from '../helpers/anvil';
import { runAttempt } from '../lib/attempt';
import { baseState, FakeSdk } from '../lib/fake-sdk';
import { ReservationWatch } from '../lib/host-reservation';
import type { Session } from '../lib/session';
import { TickLog } from '../lib/ticks';
import { sleep, waitUntil } from '../lib/wait';
import { MANIFEST } from '../tools/slot-ledger';
import {
    ALTERNATIVES, anvilAnnounce, buildChain, CENSUS_STEP, chainIds, CANNON_PENDING, ledgerCoverage, ledgerRows, missingOnPath, missingStep, parseStepTable, PLACEMENT, resolveFrom, sliceUntil, tag,
    whenNeeded, withCue, type ChainStep, type CueSink, type RunConfig,
} from './chain';
import { CueKeeper, prepareCueDir } from './cue-keeper';
import { FencedError } from './fence';
import { legsFor, netTotal, type LegStep } from './legs';
import { Observation, resolveResume, type Link } from './resume';
import type { RunnerSession, Step, StepContext } from './step';

const prevTick = process.env.SPEEDRUN_TICK_MS;
beforeAll(() => { process.env.SPEEDRUN_TICK_MS = '5'; });
afterAll(() => { if (prevTick === undefined) delete process.env.SPEEDRUN_TICK_MS; else process.env.SPEEDRUN_TICK_MS = prevTick; });

const MANIFEST_TEXT = readFileSync(MANIFEST, 'utf8');
const RUN_ORDER = readFileSync(join(import.meta.dir, '../../docs/speedrun/RUN-ORDER.md'), 'utf8');

const PARTNERS = Object.fromEntries([...Object.keys(PLACEMENT), 'H6', 'H7', 'H8', 'H16', 'H22'].map(id => [id, `p_${id.toLowerCase()}`]));
const CONFIG: RunConfig = {
    partners: PARTNERS,
    firemakingTiles: '3240,3296;3239,3296;3238,3296',
    rings: { giver: 'ring_giver' },
    bones: { giver: 'bone_giver' },
    courier: { giver: 'courier', below: 3 },
    anvil: { giver: 'anvil_helper' },
    cueDir: join(tmpdir(), 'chain-test-cue'),
};

function recorder() {
    const opened: { scope: CueScope; fresh: boolean }[] = [];
    const stopped: CueScope[] = [];
    const cues: CueSink = { open: async (scope, _ctx, o) => void opened.push({ scope, fresh: o.fresh }), stop: scope => void stopped.push(scope) };
    return { cues, opened, stopped };
}

const chain = buildChain(CONFIG, { cues: recorder().cues });

/** The fold-in 23 ledger shape: H12 split into H12a and H12b (rs/158). */
const H12_ROW = MANIFEST_TEXT.split('\n').find(l => l.startsWith('| H12 |'))!;
const FOLD_IN_23 = MANIFEST_TEXT.replace(H12_ROW, `${H12_ROW.replace('| H12 |', '| H12a |')}\n${H12_ROW.replace('| H12 |', '| H12b |')}`);

const ctxFor = (sdk: FakeSdk, log = TickLog.memory('chain-test')): StepContext<unknown> => {
    const session = { sdk, bot: {}, name: 'lab', sessionId: 1 } as unknown as RunnerSession;
    return { session, sdk: session.sdk, bot: session.bot, c: {}, log };
};

describe('the chain', () => {
    test("its id order is RUN-ORDER.md section 2's step table", () => {
        const table = parseStepTable(RUN_ORDER).filter(r => r.chained).map(r => r.id);
        expect(table.length).toBeGreaterThan(30);
        expect(chainIds(chain)).toEqual(table);
    });

    test('every body-altar leg appears exactly once (whole, or as its two split parts), between its after and before', () => {
        const legs = chain.filter(s => s.kind === 'leg') as unknown as (ChainStep & LegStep)[];
        for (const l of legsFor({ s21Altar: 'body' })) {
            const id = l.def.id;
            const whole = legs.filter(s => s.id === id).length;
            const parts = legs.filter(s => s.id === `${id}a` || s.id === `${id}b`).length;
            expect([whole, parts]).toEqual(Object.values(PLACEMENT).some(p => 'leg' in p && p.leg === id) ? [0, 2] : [1, 0]);
        }
        // A leg's neighbours, skipping the hand-offs, cue stops and fallbacks between them.
        const skip = (s: ChainStep) => (s.kind === 'handoff' && s.id !== 'S01') || s.kind === 'cue' || s.kind === 'fallback';
        const refers = (s: ChainStep, ref: string) => s.id === ref || s.name === ref || (s.id.startsWith(ref) && /^[a-z]$/.test(s.id.slice(ref.length)));
        chain.forEach((s, i) => {
            if (s.kind !== 'leg') return;
            const def = (s as unknown as LegStep).def;
            let p = i - 1;
            while (p >= 0 && skip(chain[p]!)) p--;
            let n = i + 1;
            while (n < chain.length && skip(chain[n]!)) n++;
            expect(`${def.id} after ${refers(chain[p]!, def.after) ? def.after : `${chain[p]!.id} (${chain[p]!.name})`}`).toBe(`${def.id} after ${def.after}`);
            expect(`${def.id} before ${refers(chain[n]!, def.before) ? def.before : `${chain[n]!.id} (${chain[n]!.name})`}`).toBe(`${def.id} before ${def.before}`);
        });
    });

    test("the splits keep the legs' net total", () => {
        const legs = chain.filter(s => s.kind === 'leg') as unknown as LegStep[];
        const sum = Math.round(legs.reduce((a, l) => a + l.def.expected.net, 0) * 10) / 10;
        expect(sum).toBe(netTotal(legsFor({ s21Altar: 'body' })));
    });

    test('the Ardougne-landing rows sit between their leg parts; the others before their step', () => {
        const at = (id: string) => chain.findIndex(s => s.id === id);
        for (const [row, p] of Object.entries(PLACEMENT)) {
            if (at(row) < 0 && !('as' in p)) continue; // an alternative row the ledger in force does not carry
            if ('leg' in p) expect([at(`${p.leg}a`) < at(row), at(row) < at(`${p.leg}b`)]).toEqual([true, true]);
            if ('before' in p) expect(at(row)).toBeLessThan(at(p.before));
            if ('as' in p) expect(chain[at(p.as)]!.name).toBe(`${row} hand-off`);
        }
        // H11r, then the S14 cue stop, then the run on from the landing.
        expect(chain.slice(at('H11r'), at('T14-15b') + 1).map(s => s.id)).toEqual(['H11r', 'S14 cue stop', 'T14-15b']);
    });

    test('the cannon rows refuse until the one cannon receiver lands', () => {
        for (const id of ['H11', 'H23']) {
            const s = chain.find(x => x.id === id)!;
            expect(s.kind).toBe('handoff');
            expect(s.preconditions(baseState(), {})).toBe(`${id} not built (${CANNON_PENDING})`);
        }
    });

    test('the steps keep their modules: S09 drops the travel steps, S07 the module walk, S17 the walk to the pipe', () => {
        const names = (id: string) => chain.filter(s => s.id === id && s.kind === 'step').map(s => s.name);
        expect(names('S09')).toEqual(['mining.iron-63', 'mining.exit']);
        expect(names('S07')).toEqual(['woodcutting:walk-oaks', 'woodcutting:normal-1-15', 'woodcutting:oak-15-73', 'woodcutting:willow-73-99', 'woodcutting:drop-axe']);
        expect(names('S17')).toEqual(['agility:wilderness']);
        expect(names('S22')).toEqual(['fishing:fly-78-99']);
        expect(names('S18')).toEqual(['thieving:knights']);
        expect(chain.filter(s => s.id === 'S25b-fallback').map(s => s.kind)).toEqual(['fallback']);
        // With the zoo kit giver configured, S09 takes H4p itself.
        const withKit = buildChain({ ...CONFIG, partners: { ...PARTNERS, H4p: 'zoo' } }, { cues: recorder().cues });
        expect(withKit.filter(s => s.id === 'S09').map(s => s.name)).toEqual(['mining.kit: H4p', 'mining.iron-63', 'mining.exit']);
    });

    test('a config that names no partner for a placed row is refused, every missing name at once', () => {
        const { H9: _9, H20: _20, ...rest } = PARTNERS;
        expect(() => buildChain({ ...CONFIG, partners: rest }, { cues: recorder().cues })).toThrow('names no partner for H9, H20');
    });
});

describe('ledger coverage', () => {
    test('every H row of the ledger in force is placed, internal to a module, or not a trade', () => {
        expect(ledgerCoverage(ledgerRows(MANIFEST_TEXT))).toEqual([]);
    });

    test("fold-in 23's H12a + H12b are placed, both before S15, with no change to the chain code", () => {
        expect(ledgerCoverage(ledgerRows(FOLD_IN_23))).toEqual([]);
        const c = buildChain(CONFIG, { cues: recorder().cues, manifest: FOLD_IN_23 });
        const ids = c.map(s => s.id);
        expect(ids.includes('H12')).toBe(false);
        expect(ids.indexOf('H12a')).toBeLessThan(ids.indexOf('H12b'));
        expect(ids.indexOf('H12b')).toBeLessThan(ids.indexOf('S15'));
        expect(ALTERNATIVES[0]).toEqual([['H12'], ['H12a', 'H12b']]);
    });

    test('a new row, half an alternative, or both alternatives refuse', () => {
        const added = MANIFEST_TEXT.replace(H12_ROW, `${H12_ROW}\n${H12_ROW.replace('| H12 |', '| H12m |')}`);
        expect(ledgerCoverage(ledgerRows(added)).join('\n')).toContain('H12m');
        const both = MANIFEST_TEXT.replace(H12_ROW, `${H12_ROW}\n${H12_ROW.replace('| H12 |', '| H12a |')}`);
        expect(ledgerCoverage(ledgerRows(both)).join('\n')).toContain('exactly one of H12 or H12a + H12b');
        expect(() => buildChain(CONFIG, { cues: recorder().cues, manifest: added })).toThrow('ledger coverage');
    });
});

describe('wrappers', () => {
    const player = (x: number, z: number) => ({ name: 'lab', x, z, worldX: x, worldZ: z, level: 0 }) as PlayerState;
    const at = (more: Partial<BotWorldState> = {}) => baseState({ tick: 10, inGame: true, player: player(3200, 3200), ...more });
    const toy = (trace: string[]): Step<unknown> => ({
        name: 'toy', logoutSafe: true, preconditions: () => 'toy refuses', postconditions: () => 'toy unfinished',
        run: async () => void trace.push('run'), resume: async () => void trace.push('resume'),
    });

    test('supersededBy: a hand-off counts as done once the next milestone is done, whatever the pack shows', () => {
        const h9 = chain.find(s => s.id === 'H9')!;
        const empty = new Observation(at({ quests: {} }));
        const started = new Observation(at({ quests: { arena: 'started' } }));
        expect(h9.done!(empty, {})).toBe(false);
        expect(h9.done!(started, {})).toBe(true);
    });

    test('whenNeeded: a 0-tick note when met, the step itself when not', async () => {
        const trace: string[] = [];
        const met = (s: BotWorldState) => s.skills.some(k => k.name === 'Prayer' && k.baseLevel >= 99);
        const f = whenNeeded('S25b-fallback', toy(trace), met, 'Prayer 99 inside S07');
        const done = at({ skills: [{ name: 'Prayer', level: 99, baseLevel: 99, experience: 13_034_431 }] });
        const short = at({ skills: [{ name: 'Prayer', level: 94, baseLevel: 94, experience: 0 }] });
        expect([f.preconditions(done, {}), f.postconditions(done, {}), f.done!(new Observation(done), {})]).toEqual([true, true, true]);
        expect([f.preconditions(short, {}), f.done!(new Observation(short), {})]).toEqual(['toy refuses', false]);
        const log = TickLog.memory('t');
        await f.run(ctxFor(new FakeSdk(done), log));
        expect(trace).toEqual([]);
        expect(log.rows.map(r => [r.step, r.ticks, r.kind])).toEqual([['toy (not needed)', 0, 'note']]);
        await f.run(ctxFor(new FakeSdk(short)));
        await f.resume!(ctxFor(new FakeSdk(short)));
        expect(trace).toEqual(['run', 'resume']);
    });

    test('missingStep refuses with its owner; its done is the quest, so a finished quest is walked past', () => {
        const m = missingStep('S05', "S05 Doric's Quest", 'rs/416', 'doric');
        expect(m.preconditions(at(), {})).toBe('S05 not built (rs/416)');
        expect(m.done!(new Observation(at({ quests: { doric: 'complete' } })), {})).toBe(true);
        expect(m.done!(new Observation(at({ quests: {} })), {})).toBe(false);
    });

    test('--dry-run lists every refusing step on the path; --until=S04 has none', () => {
        expect(missingOnPath(chain).map(m => `${m.id} ${m.owner}`)).toEqual([
            'S05 rs/416', `H11 ${CANNON_PENDING}`, 'S15 rs/185', 'S19 rs/185 (rs/414)', 'S23 rs/416', 'S24 rs/416', 'S24 rs/416', 'S24 rs/416', 'S24 rs/416', `H23 ${CANNON_PENDING}`,
        ]);
        expect(missingOnPath(sliceUntil(chain, 'S04'))).toEqual([]);
    });

    test('every step is censused: a 0-tick (census) note of the pack, free slots and worn items before it runs', async () => {
        const sdk = new FakeSdk(at({ inventory: [{ slot: 0, id: 1, name: 'Shark', count: 2, optionsWithIndex: [] }] as unknown as BotWorldState['inventory'] }));
        const log = TickLog.memory('t');
        const m = chain.find(s => s.id === 'S05')!;
        await m.run(ctxFor(sdk, log)).catch(() => {});
        expect(log.rows[0]).toMatchObject({ step: CENSUS_STEP, kind: 'note', ticks: 0, meta: { before: "S05 Doric's Quest", id: 'S05', free: 27, inventory: [{ name: 'Shark', count: 2 }], worn: [] } });
    });
});

describe('slicing', () => {
    test('--until=<id> ends after the last step of that group; a step or leg name works too', () => {
        expect(sliceUntil(chain, 'S04').at(-1)!.name).toBe('S04 magic');
        expect(sliceUntil(chain, 'S07').at(-1)!.name).toBe('woodcutting:drop-axe');
        expect(sliceUntil(chain, 'S14').at(-1)!.name).toBe('S14 cannon session');
        expect(sliceUntil(chain, 'woodcutting:oak-15-73').at(-1)!.name).toBe('woodcutting:oak-15-73');
        expect(sliceUntil(chain, undefined)).toHaveLength(chain.length);
        expect(() => sliceUntil(chain, 'S99')).toThrow('no step');
    });

    test('--from=<id> is the first step of that group; a name or an index works too', () => {
        expect(chain[resolveFrom(chain, 'S07')!]!.name).toBe('woodcutting:walk-oaks');
        expect(chain[resolveFrom(chain, 'T13-14b')!]!.id).toBe('T13-14b');
        expect(resolveFrom(chain, '3')).toBe(3);
        expect(resolveFrom(chain, undefined)).toBeUndefined();
        expect(() => resolveFrom(chain, 'nope')).toThrow('no step');
    });
});

describe('resume from every boundary', () => {
    test('with every milestone before step i done and step i able to start, the walk resumes at i, for every i', async () => {
        for (let i = 0; i < chain.length; i++) {
            const scripted = chain.map((s, j) => ({
                name: s.name, logoutSafe: s.logoutSafe, run: async () => {}, postconditions: () => true,
                preconditions: () => (j === i ? true : `#${j} cannot start`),
                ...(s.done ? { done: () => j < i } : {}),
            })) as Step<unknown>[];
            const p = await resolveResume(scripted, new Observation(baseState()), {});
            if (p.index !== i) throw new Error(`boundary ${i} (${chain[i]!.id} ${chain[i]!.name}) resolved to ${p.index} (${p.reason})`);
        }
    });
});

describe('a drop through runAttempt', () => {
    test('the abandoned attempt sends nothing after the abort, and the chain resumes', async () => {
        const sdk = new FakeSdk(baseState({ tick: 0, inGame: true, skills: [{ name: 'Mining', level: 1, baseLevel: 1, experience: 0 }] }));
        const session = { sdk, bot: {}, name: 'lab', sessionId: 1, expectInWorld: true } as unknown as Session;
        let online = true;
        let detected = false;
        let clicks = 0;
        let lateSends = 0;
        let fenced = 0;
        sdk.onSend = a => {
            if (!online && detected) lateSends++;
            if (a.method === 'sendClickComponent') clicks++;
        };
        const mining = (s: BotWorldState) => s.skills.find(k => k.name === 'Mining')?.baseLevel ?? 1;
        const timer = setInterval(() => {
            if (!online) return;
            const gain = clicks > 0 ? 1 : 0;
            clicks = 0;
            sdk.tick(s => ({ skills: [{ name: 'Mining', level: mining(s) + gain, baseLevel: mining(s) + gain, experience: 0 }] }));
        }, 2);
        const link: Link = {
            isLost: () => !online,
            lost: async signal => { while (!signal.aborted) { if (!online) { detected = true; return 'client out of game'; } await sleep(2); } return 'stopped'; },
            restored: async () => { while (!online) await sleep(2); await sleep(10); },
        };
        const loop = async ({ sdk: s }: { sdk: RunnerSession['sdk'] }) => {
            while (mining(s.getState()!) < 5) {
                const t = s.getState()!.tick;
                try { await s.sendClickComponent(1); } catch (e) { if (e instanceof FencedError) fenced++; throw e; }
                await waitUntil(s, st => st.tick > t, { maxTicks: 3 });
            }
        };
        const steps: ChainStep[] = [tag('S09', 'step', {
            name: 'mine', logoutSafe: true, preconditions: () => true, postconditions: s => mining(s) >= 5 || 'below 5', run: loop, resume: loop,
            done: o => mining(o.state) >= 5, inProgress: o => mining(o.state) > 1,
        })];
        let dropped = false;
        sdk.onStateUpdate(s => {
            if (!dropped && s.inGame && mining(s) >= 3) {
                dropped = true;
                queueMicrotask(() => { online = false; sdk.push({ inGame: false }); });
                setTimeout(() => { (session as { sessionId: number }).sessionId++; sdk.push({ inGame: true, tick: 0, skills: [{ name: 'Mining', level: 2, baseLevel: 2, experience: 0 }] }); online = true; detected = false; }, 150);
            }
        });
        const dir = mkdtempSync(join(tmpdir(), 'chain-attempt-'));
        const r = await runAttempt(session, steps, {
            log: TickLog.memory('t'), account: 'lab', link, reservation: new ReservationWatch(join(dir, 'none.json')),
            stopAsked: () => false, gateStop: () => null, logout: async () => ({ ok: true }) as never, label: 'run',
        });
        // The session comes back after the abandoned attempt's wait has ended on its idle bound (~100 ms here, the
        // states it would see being fenced), so its next send meets the fence before the new attempt finishes.
        await sleep(200);
        clearInterval(timer);
        rmSync(dir, { recursive: true, force: true });
        expect(r.code).toBe(0);
        expect(mining(sdk.getState()!)).toBe(5);
        expect(lateSends).toBe(0);
        expect(fenced).toBeGreaterThanOrEqual(1);
    });
});

describe('cues', () => {
    let dir = '';
    beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'chain-cue-')); });
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    test('withCue opens {step, family} before S07, S14, S18, S25a and S27; S06 and S21 write their own', () => {
        const scopes = new Map<string, string>();
        for (const s of chain) if (s.cue) scopes.set(s.id, `${s.cue.step}/${s.cue.family}`);
        expect(Object.fromEntries(scopes)).toEqual({ S07: 'S07/bone', S14: 'S14/cannon', S18: 'S18/courier', S25a: 'S25a/anvil', S27: 'S27/cannon' });
        expect(chain.filter(s => s.id === 'S07' && s.kind === 'step').every(s => s.cue?.family === 'bone')).toBe(true);
        expect(chain.filter(s => s.id === 'S06' || s.id === 'S21').some(s => s.cue)).toBe(false);
        expect(chain.filter(s => s.kind === 'cue').map(s => s.id)).toEqual(['S14 cue stop', 'S27 cue stop']);
    });

    test('withCue opens on run (kept when the scope is already open) and afresh on every resume', async () => {
        const r = recorder();
        const trace: string[] = [];
        const s = withCue(tag('S07', 'step', { name: 'band', logoutSafe: true, preconditions: () => true, postconditions: () => true, run: async () => void trace.push('run') }), { step: 'S07', family: 'bone' }, r.cues);
        await s.run(ctxFor(new FakeSdk()));
        await s.resume!(ctxFor(new FakeSdk()));
        expect(r.opened).toEqual([{ scope: { step: 'S07', family: 'bone' }, fresh: false }, { scope: { step: 'S07', family: 'bone' }, fresh: true }]);
        expect(trace).toEqual(['run', 'run']);
    });

    test("after S06's altar stop, S07's bone cue is a new session with no stop: a bone watcher fires, an altar watcher gets nothing new", async () => {
        const sdk = new FakeSdk(baseState({ tick: 1, inGame: true }));
        const keeper = new CueKeeper(dir, 'Scored Name');
        const off = keeper.attach(sdk);
        const timer = setInterval(() => sdk.tick(), 2);
        // runecraft's own S06 cue, then its stop.
        const altar = new CueWriter(dir, 'Scored Name', { step: 'S06', family: 'altar' });
        altar.write({ beacons: [{ tick: 1, ms: Date.now() }], turns: [] });
        const altarSeen: Cue[] = [];
        const altarWatch = new CueWatcher(dir, { step: 'S06', family: 'altar' }, c => altarSeen.push(c), { pollMs: 2, log: () => {} });
        altar.stop([{ tick: 2, ms: Date.now() }]);
        await waitUntil(sdk, () => altarSeen.some(c => c.stop), { maxTicks: 50 });
        const before = altarSeen.length;
        const boneSeen: Cue[] = [];
        const boneWatch = new CueWatcher(dir, { step: 'S07', family: 'bone' }, c => boneSeen.push(c), { pollMs: 2, log: () => {} });
        await keeper.open({ step: 'S07', family: 'bone' }, { sdk: sdk as unknown as RunnerSession['sdk'] }, { fresh: false });
        await waitUntil(sdk, () => boneSeen.length > 0, { maxTicks: 50 });
        await sleep(20);
        clearInterval(timer);
        off();
        altarWatch.close();
        boneWatch.close();
        expect(boneSeen).toHaveLength(1);
        expect(boneSeen[0]!.stop ?? false).toBe(false);
        expect(boneSeen[0]!.session).not.toBe(altar.session);
        expect(boneSeen[0]!.beacons.length).toBeGreaterThanOrEqual(4);
        expect(altarSeen.length).toBe(before);
        expect(JSON.stringify(boneSeen[0])).not.toContain('Scored Name');
        // The final logout writes the open cue's stop.
        keeper.close();
        const last = JSON.parse(readFileSync(join(dir, CUE_FILE), 'utf8')) as Cue;
        expect([last.scope.step, last.stop]).toEqual(['S07', true]);
        expect(keeper.open_).toBeNull();
    });

    test("S25a's announce reaches the anvil helper's plan file", () => {
        anvilAnnounce(dir)({ session: 'r/1', seq: 0, give: { bronze_bar: 25 } });
        expect(JSON.parse(readFileSync(join(dir, PLAN_FILE), 'utf8'))).toMatchObject({ v: 1, session: 'r/1', seq: 0, give: { bronze_bar: 25 } });
    });

    test("the cue directory: created 0700, the run's own stale files removed at a fresh start only", () => {
        const d = join(dir, 'run-cue');
        expect(prepareCueDir(d, { fresh: true })).toEqual([]);
        expect(statSync(d).mode & 0o777).toBe(0o700);
        for (const f of [CUE_FILE, PLAN_FILE, 'topup-ask.json', 'status-cairn_b01.json']) writeFileSync(join(d, f), '{}');
        expect(prepareCueDir(d, { fresh: false })).toEqual([]);
        expect(existsSync(join(d, CUE_FILE))).toBe(true);
        expect(prepareCueDir(d, { fresh: true }).sort()).toEqual([PLAN_FILE, CUE_FILE, 'topup-ask.json'].sort());
        expect(existsSync(join(d, 'status-cairn_b01.json'))).toBe(true);
        expect(() => prepareCueDir(join(import.meta.dir, 'never-a-cue-dir'), { fresh: true })).toThrow();
    });
});
