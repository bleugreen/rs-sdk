import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { BotWorldState, PlayerState } from '../../sdk/types';
import { ASK_FILE, CUE_FILE, CueWatcher, CueWriter, type Cue, type CueScope, type TopUpAsk } from '../helpers/altar-cue';
import * as monkeyMadness from '../quests/monkey-madness';
import { PLAN_FILE } from '../helpers/anvil';
import { GO_FILE } from '../helpers/fm-row';
import { handOffFrom, HandOffRecord } from './handoff';
import { runAttempt } from '../lib/attempt';
import { baseState, FakeSdk } from '../lib/fake-sdk';
import { ReservationWatch } from '../lib/host-reservation';
import type { Session } from '../lib/session';
import { TickLog } from '../lib/ticks';
import { RelogBudget } from './relog-budget';
import { SCORED_RELOG, SCORED_LOGOUT, SCORED_LOGIN } from './scored-relog';
import { SPELLS } from '../lib/travel';
import { sleep, waitUntil } from '../lib/wait';
import { MANIFEST } from '../tools/slot-ledger';
import * as cooking from '../skills/cooking';
import * as mining from '../skills/mining';
import * as woodcutting from '../skills/woodcutting';
import {
    ALTERNATIVES, anvilAnnounce, CANNON_ROWS, cueAround, cueMuleRows, FAMILY_CUES, KIT_PARTNER_ROWS, KIT_SEGMENTS, buildChain, CENSUS_STEP, chainIds, chainProbes, ledgerCoverage, ledgerRows, missingOnPath, missingStep, MULE_ROWS, muleCued, muleCueDir, muleScope, s07PrayerTo, S07_PRAYER_TO, s07Woodcutting, S09_MINING, parseStepTable, PLACEMENT, resolveFrom, sliceUntil, tag,
    whenNeeded, withCue, askedOnTrade, h12oLogin, h12oLoginRefusal, h12oTopUp, H12O_LOGIN, type ChainStep, type CueSink, type RunConfig,
    BIG_BONE_BASE, chainPartners, H4M_MIN_PRAYER, H4M_ROW, H4M_TRADE_TILE, S09_PRAYER_TO, type ChainOptions,
} from './chain';
import { CUE_BEACONS, CueKeeper, exitStopIsFinal, prepareCueDir, RunCues } from './cue-keeper';
import { ScopeSessions } from '../helpers/standalone';
import { FencedError } from './fence';
import { legsFor, netTotal, type LegStep } from './legs';
import { Observation, resolveResume, type Link } from './resume';
import type { RunnerSession, Step, StepContext } from './step';

const prevTick = process.env.SPEEDRUN_TICK_MS;
beforeAll(() => { process.env.SPEEDRUN_TICK_MS = '5'; });
afterAll(() => { if (prevTick === undefined) delete process.env.SPEEDRUN_TICK_MS; else process.env.SPEEDRUN_TICK_MS = prevTick; });

const MANIFEST_TEXT = readFileSync(MANIFEST, 'utf8');
const RUN_ORDER = readFileSync(join(import.meta.dir, '../../docs/speedrun/RUN-ORDER.md'), 'utf8');

// Fold-in 23's H12a and H12b share one giver: Monkey Madness's one gtSwap trades both.
const PARTNERS: Record<string, string> = { ...Object.fromEntries([...Object.keys(PLACEMENT), ...KIT_PARTNER_ROWS].map(id => [id, `p_${id.toLowerCase()}`])), H12a: 'p_h12', H12b: 'p_h12' };
const CONFIG: RunConfig = {
    partners: PARTNERS,
    firemakingTiles: '3240,3296;3239,3296;3238,3296',
    rings: { giver: 'ring_giver' },
    bones: { giver: 'bone_giver' },
    courier: { giver: 'courier', below: 3 },
    anvil: { giver: 'anvil_helper' },
    cueDir: join(tmpdir(), 'chain-test-cue'),
};
/** CONFIG with h45's block: everything the full path needs, so nothing on it refuses. */
const COMPLETE: RunConfig = { ...CONFIG, h12o: { account: 'cairn_h45', cueDir: join(tmpdir(), 'chain-test-h45-cue'), loginDir: join(tmpdir(), 'chain-test-h45-login'), leadTicks: 300 } };

function recorder() {
    const opened: { scope: CueScope; fresh: boolean }[] = [];
    const stopped: CueScope[] = [];
    /** Each stop's `final` as the sink received it (undefined: the keeper's default, final). */
    const finals: (boolean | undefined)[] = [];
    const cues: CueSink = { open: async (scope, _ctx, o) => void opened.push({ scope, fresh: o.fresh }), stop: (scope, _ctx, o) => { stopped.push(scope); finals.push(o?.final); } };
    return { cues, opened, stopped, finals };
}

const chain = buildChain(CONFIG, { cues: recorder().cues });

/** Four mule carriers, each with several rows; the cannon rows stay h92's. Last rows: H4 (h03, a kit segment), H14 (mule2), H21d (h55), H22 (mule1). */
const CARRIERS: Record<string, readonly string[]> = {
    h03: ['H1', 'H4'],
    mule1: ['H4k', 'H6', 'H9', 'H13', 'H22'],
    mule2: ['H4p', 'H7', 'H8', 'H10', 'H14'],
    h55: ['H12', 'H12a', 'H12b', 'H15', 'H16', 'H18', 'H19', 'H20', 'H21d'],
    h92: ['H11', 'H11r', 'H23'],
};
const CARRIER_CONFIG: RunConfig = { ...CONFIG, partners: Object.fromEntries(Object.entries(CARRIERS).flatMap(([who, rows]) => rows.map(r => [r, who]))) };
/** Each mule-cued step of `c`: its row and whether a success stops it final. */
const muleStops = (c: readonly ChainStep[]) => c.filter(s => s.cue?.family === 'mule').map(s => `${s.cue!.step}:${s.finalStop ? 'final' : 'plain'}`);

describe('chainProbes', () => {
    test("every probe the chain's steps read, S25c's wineBank from cooking.ts's PROBES, none missing", () => {
        const p = chainProbes(chain);
        const declared = new Set(chain.flatMap(s => s.probes ?? []));
        expect(declared.has('wineBank')).toBe(true);
        expect(Object.keys(p).sort()).toEqual([...declared].sort());
        expect(p.wineBank).toBe(cooking.PROBES.wineBank);
    });

    test('a step reading a probe no module exports refuses', () => {
        expect(() => chainProbes([...chain, tag('S99', 'step', { name: 'S99 x', preconditions: () => true, postconditions: () => true, run: async () => {}, logoutSafe: true, probes: ['nowhere'] })])).toThrow('no probe for "nowhere" (S99 x)');
    });
});

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
        // Strict (plan v37): a leg's key is a chain step's id or its name, nothing looser.
        const refers = (s: ChainStep, ref: string) => s.id === ref || s.name === ref;
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

    test('the cannon rows are served on their cue: the scope opened through the run\'s CueSink before anything else, no partner needed in view', async () => {
        const r = recorder();
        const c = buildChain(CONFIG, { cues: r.cues });
        for (const [id, step] of [['H11', 'S14'], ['H23', 'S27']] as const) {
            const s = c.find(x => x.id === id)!;
            expect([s.kind, s.cue]).toEqual(['handoff', { step, family: 'cannon' }]);
            expect(s.preconditions(baseState({ inGame: true, nearbyPlayers: [] }), {})).toBe(true);
        }
        // A holder that never comes: the cue was opened (kept, not fresh), then the step gives up with a reason.
        const sdk = new FakeSdk(baseState({ tick: 1, inGame: true, nearbyPlayers: [] }));
        const h11 = c.find(x => x.id === 'H11')!;
        await expect(h11.run(ctxFor(sdk))).rejects.toThrow('did not come into sight');
        expect(r.opened).toEqual([{ scope: { step: 'S14', family: 'cannon' }, fresh: false }]);
        expect(sdk.sent.filter(a => a.method === 'sendTradeRequest')).toEqual([]);
    });

    // rs/700: S07's close target is run config (main's H4m lever); absent, the options are today's byte for byte.
    test("S07's prayerTo is the run config's s07PrayerTo: absent it is S07_PRAYER_TO (99) and s07Woodcutting is byte-identical; 98 closes at 98; a bad one is refused", () => {
        const group: RunConfig = { ...CONFIG, bones: { group: ['cairn_b01', 'cairn_b02', 'cairn_b03', 'cairn_b04'] } };
        expect(S07_PRAYER_TO).toBe(99);
        expect(CONFIG.s07PrayerTo).toBeUndefined();
        // the literal s07Woodcutting returned before the config value, key for key and in order
        expect(JSON.stringify(s07Woodcutting(CONFIG, 'run-x'))).toBe(JSON.stringify({ bury: true, bones: CONFIG.bones, dropAxe: true, prayerTo: 99 }));
        expect(JSON.stringify(s07Woodcutting(group, 'run-x'))).toBe(JSON.stringify({ bury: true, bones: group.bones, dropAxe: true, prayerTo: 99, boneSession: 'run-x.S07.bone' }));
        expect(JSON.stringify(s07Woodcutting({ ...CONFIG, s07PrayerTo: 99 }, 'run-x'))).toBe(JSON.stringify(s07Woodcutting(CONFIG, 'run-x')));
        const at98 = s07Woodcutting({ ...group, s07PrayerTo: 98 }, 'run-x');
        expect(at98.prayerTo).toBe(98);
        expect(s07PrayerTo({ s07PrayerTo: 98 })).toBe(98);
        // the willow band's postcondition closes at 98, not 99
        const willow = woodcutting.steps(at98).find(s => s.name === 'woodcutting:willow-73-99')!;
        const at = (prayer: number) => baseState({
            player: { worldX: 2920, worldZ: 3406 } as PlayerState,
            skills: [{ name: 'Woodcutting', level: 99, baseLevel: 99, experience: 0 }, { name: 'Prayer', level: prayer, baseLevel: prayer, experience: 0 }],
            inventory: ['Rune axe', 'Knife', 'Logs'].map((name, slot) => ({ slot, id: 100 + slot, name, count: 1, optionsWithIndex: [] }))
        });
        expect(willow.postconditions(at(98), {})).toBe(true);
        expect(willow.postconditions(at(97), {})).toBe('Prayer 97, below 98');
        for (const bad of [0, 100, 98.5, '98' as unknown as number]) expect(() => s07PrayerTo({ s07PrayerTo: bad })).toThrow(/s07PrayerTo must be an integer from 1 to 99/);
    });

    // rs/642: attempt 3's willow band probed 15/20, ran plain, neither buried nor loaded, and stopped on a slot count that held its own bones.
    test("S07's oak and willow bands run the knife with bury, the normal band plain; the chain's willow band admits attempt 3's census at the stand", () => {
        const group: RunConfig = { ...CONFIG, bones: { group: ['cairn_b01', 'cairn_b02', 'cairn_b03', 'cairn_b04'] } };
        for (const cfg of [CONFIG, group]) {
            const opts = s07Woodcutting(cfg, 'run-x');
            expect(['normal', 'oak', 'willow'].map(t => woodcutting.bandTechnique(opts, t as woodcutting.Tree))).toEqual(['plain', 'knife', 'knife']);
            expect(woodcutting.bandParams(opts, 'oak', 73)('knife').bury).toBe(true);
            expect(woodcutting.bandParams(opts, 'willow', 99)('knife').bury).toBe(true);
            expect(opts.prayerTo).toBe(99);
        }
        expect(s07Woodcutting(group, 'run-x').boneSession).toBe('run-x.S07.bone');
        expect(s07Woodcutting(CONFIG, 'run-x')).not.toHaveProperty('boneSession');
        // rs/663: S07's early last load fires at the band's own targets, which the run sets to Woodcutting 99 (the default `to`) and Prayer 99
        for (const cfg of [CONFIG, group]) {
            const opts = s07Woodcutting(cfg, 'run-x');
            expect([opts.to, opts.prayerTo]).toEqual([undefined, 99]);
            expect(woodcutting.steps(opts).map(s => s.name)).toContain('woodcutting:willow-73-99');
        }
        const item = (slot: number, name: string) => ({ slot, id: 100 + slot, name, count: 1, optionsWithIndex: [] });
        const census = baseState({
            player: { worldX: 2920, worldZ: 3406 } as PlayerState,
            skills: [
                { name: 'Woodcutting', level: 73, baseLevel: 73, experience: 0 },
                { name: 'Fletching', level: 1, baseLevel: 1, experience: 0 },
                { name: 'Prayer', level: 53, baseLevel: 53, experience: 0 }
            ],
            inventory: [...['Rune axe', 'Knife', 'Logs', 'Oak logs'], ...Array.from({ length: 23 }, () => 'Dragon bones')].map((n, i) => item(i, n))
        });
        expect(census.inventory).toHaveLength(27);
        for (const cfg of [CONFIG, group]) {
            const willow = buildChain(cfg, { cues: recorder().cues }).find(s => s.id === 'S07' && s.name === 'woodcutting:willow-73-99')!;
            expect(willow.preconditions(census, {})).toBe(true);
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
        expect(chain.filter(s => s.id === 'S18d-fallback').map(s => [s.kind, s.name])).toEqual([['fallback', 'S18d-fallback fletching (fallback)']]);
        expect(names('S05')[0]).toBe('S05:A-h4-swap');
        expect(names('S23').length).toBeGreaterThanOrEqual(3);
        // H4p is the run's only rune pickaxe: a config without its giver does not build.
        const { H4p: _h4p, ...noKit } = PARTNERS;
        expect(() => buildChain({ ...CONFIG, partners: noKit }, { cues: recorder().cues })).toThrow('names no partner for H4p');
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

    test("H12 (or fold-in 23's H12a + H12b) is Monkey Madness's own trade, in segment A's gtSwap: covered, never placed", () => {
        expect(ledgerCoverage(ledgerRows(FOLD_IN_23))).toEqual([]);
        for (const text of [MANIFEST_TEXT, FOLD_IN_23]) {
            const ids = buildChain(CONFIG, { cues: recorder().cues, manifest: text }).map(s => s.id);
            for (const row of ['H12', 'H12a', 'H12b']) expect(`${row} ${ids.includes(row)}`).toBe(`${row} false`);
        }
        for (const row of ['H12', 'H12a', 'H12b']) expect(PLACEMENT[row]).toBeUndefined();
        expect(ALTERNATIVES[0]).toEqual([['H12'], ['H12a', 'H12b']]);
    });

    test('the quest kit rows are placed hand-offs just before their quest, after the leg into it (rs/185: none is traded mid-quest)', () => {
        const ids = chain.map(s => s.id);
        for (const [row, quest] of [['H6', 'S08'], ['H4p', 'S09'], ['H7', 'S10b'], ['H8', 'S11b'], ['H16', 'S20'], ['H22', 'S26']] as const) {
            expect(`${row} ${ids.indexOf(row) + 1 === ids.indexOf(quest)}`).toBe(`${row} true`);
            expect(chain[ids.indexOf(row) - 1]!.kind).toBe('leg');
        }
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

    test('--dry-run lists every refusing step on the path: none with a complete run config, the H12o login without h45\'s block; --until=S04 has none', () => {
        expect(missingOnPath(buildChain(COMPLETE, { cues: recorder().cues }))).toEqual([]);
        expect(missingOnPath(chain).map(m => `${m.id}: ${m.owner}`)).toEqual([`H12o login: ${h12oLoginRefusal(CONFIG)}`]);
        expect(missingOnPath(sliceUntil(chain, 'S04'))).toEqual([]);
    });

    test('every step is censused: a 0-tick (census) note of the pack, free slots and worn items before it runs', async () => {
        const sdk = new FakeSdk(at({ inventory: [{ slot: 0, id: 1, name: 'Shark', count: 2, optionsWithIndex: [] }] as unknown as BotWorldState['inventory'] }));
        const log = TickLog.memory('t');
        // CONFIG has no h12o block, so the login step refuses at once: after its census.
        const m = chain.find(s => s.id === 'H12o login')!;
        await expect(m.run(ctxFor(sdk, log))).rejects.toThrow('no h12o block');
        expect(log.rows[0]).toMatchObject({ step: CENSUS_STEP, kind: 'note', ticks: 0, meta: { before: 'H12o h45 login trigger', id: 'H12o login', free: 27, inventory: [{ name: 'Shark', count: 2 }], worn: [] } });
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

    test('withCue opens {step, family} before S07, S14, S18, S25a and S27; S03 and S04 are cued around; S06 and S21 write their own', () => {
        const scopes = new Map<string, string>();
        for (const s of chain) if (s.cue) scopes.set(s.id, `${s.cue.step}/${s.cue.family}`);
        expect(Object.fromEntries(scopes)).toEqual({
            S01: 'H1/mule', S03: 'S03/fmrow', S04: 'S04/ring', S05: 'H4/mule', H4k: 'H4k/mule', S07: 'S07/bone', H6: 'H6/mule', H4p: 'H4p/mule', H7: 'H7/mule', H8: 'H8/mule', H9: 'H9/mule', H10: 'H10/mule', H11: 'S14/cannon', S14: 'S14/cannon',
            S15: 'H12/mule', H13: 'H13/mule', H14: 'H14/mule', S18: 'S18/courier', H15: 'H15/mule', H16: 'H16/mule', H18: 'H18/mule', H19: 'H19/mule', H20: 'H20/mule', S25a: 'S25a/anvil', H21d: 'H21d/mule', H22: 'H22/mule',
            H23: 'S27/cannon', S27: 'S27/cannon',
        });
        expect(chain.filter(s => s.id === 'S07' && s.kind === 'step').every(s => s.cue?.family === 'bone')).toBe(true);
        // A giver group's S07 cue is woodcutting.ts's own (BoneCue): the chain opens none for it.
        const grouped = buildChain({ ...CONFIG, bones: { group: ['cairn_b01', 'cairn_b02', 'cairn_b03', 'cairn_b04'], lastLoad: 21 } }, { cues: recorder().cues });
        expect(grouped.filter(s => s.id === 'S07').map(s => s.name)).toEqual(chain.filter(s => s.id === 'S07').map(s => s.name));
        expect(grouped.filter(s => s.id === 'S07').some(s => s.cue)).toBe(false);
        expect(chain.filter(s => s.id === 'S06' || s.id === 'S21').some(s => s.cue)).toBe(false);
        expect(chain.filter(s => s.kind === 'cue').map(s => s.id)).toEqual(['S03 go cue', 'S06 cue stop', 'S14 cue stop', 'H12o login', 'S18 cue stop', 'S21 cue stop', 'S25a cue stop', 'S27 cue stop']);
    });

    test("S03's {S03, fmrow} and S04's {S04, ring} open afresh before their step and stop after it, failed or not", async () => {
        expect(FAMILY_CUES).toEqual({ S03: { step: 'S03', family: 'fmrow' }, S04: { step: 'S04', family: 'ring' } });
        for (const [id, scope] of Object.entries(FAMILY_CUES)) expect(chain.filter(s => s.id === id).map(s => s.cue)).toEqual([scope]);
        // The chain's own S03 step (Firemaking already 99: its module returns at once) between its open and its stop.
        const r = recorder();
        const s03 = buildChain(CONFIG, { cues: r.cues }).find(s => s.id === 'S03')!;
        const sdk = new FakeSdk(baseState({ tick: 1, inGame: true, skills: [{ name: 'Firemaking', level: 99, baseLevel: 99, experience: 13_034_431 }] }));
        await s03.run(ctxFor(sdk));
        expect([r.opened, r.stopped]).toEqual([[{ scope: FAMILY_CUES.S03, fresh: true }], [FAMILY_CUES.S03]]);
        // A step that throws still writes its stop; a resume opens afresh.
        const trace: string[] = [];
        const stub = (fail: boolean) => tag('S04', 'step', { name: 'S04 magic', logoutSafe: true, preconditions: () => true, postconditions: () => true, run: async () => {
            trace.push(`opened ${r.opened.length}, stopped ${r.stopped.length}`);
            if (fail) throw new Error('rings ran out');
        } });
        await expect(cueAround(stub(true), FAMILY_CUES.S04, r.cues).run(ctxFor(new FakeSdk()))).rejects.toThrow('rings ran out');
        await cueAround(stub(false), FAMILY_CUES.S04, r.cues).resume!(ctxFor(new FakeSdk()));
        expect(trace).toEqual(['opened 2, stopped 1', 'opened 3, stopped 2']);
        expect(r.opened.slice(1)).toEqual([{ scope: FAMILY_CUES.S04, fresh: true }, { scope: FAMILY_CUES.S04, fresh: true }]);
        expect(r.stopped.slice(1)).toEqual([FAMILY_CUES.S04, FAMILY_CUES.S04]);
        // Done: final (the family's logout); the throw: non-final, so the resume's open re-arms the givers.
        expect(r.finals).toEqual([true, false, true]);
    });

    test('courier and anvil stop at their actual family end, before any later scope opens', async () => {
        const r = recorder();
        const full = buildChain(CONFIG, { cues: r.cues });
        for (const [id, family] of [['S18', 'courier'], ['S25a', 'anvil']] as const) {
            const last = full.findLastIndex(s => s.id === id);
            const stop = full[last + 1]!;
            expect(stop.id).toBe(`${id} cue stop`);
            expect(stop.kind).toBe('cue');
            await stop.run(ctxFor(new FakeSdk()));
            await stop.resume!(ctxFor(new FakeSdk()));
            expect(r.stopped.slice(-2)).toEqual([{ step: id, family }, { step: id, family }]);
        }
        expect(full.findIndex(s => s.id === 'S18 cue stop')).toBeLessThan(full.findIndex(s => s.id === 'S21'));
        expect(full.findIndex(s => s.id === 'S25a cue stop')).toBeLessThan(full.findIndex(s => s.id === 'H21d'));
    });

    test("S21 after its leg: logout, giver ready wait, login, band; --s21-relog=off keeps a single session", () => {
        const s21 = (c: ChainStep[]) => c.filter(s => s.id === 'S21').map(s => s.name);
        expect(s21(chain)).toEqual(['S21 relog:logout', 'S21 runecraft:pre-login', 'S21 relog:login', 'S21 runecraft']);
        expect(chain[chain.findIndex(s => s.id === 'S21') - 1]!.id).toBe('T20-21');
        expect(s21(buildChain(CONFIG, { cues: recorder().cues, s21Relog: false }))).toEqual(['S21 runecraft:pre-login', 'S21 runecraft']);
        expect(resolveFrom(chain, 'S21')).toBe(chain.findIndex(s => s.name === 'S21 relog:logout'));
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

    test("H4 is cued {H4, mule} around Doric's segment A, the trade that runs h4Plan, and around no other S05 segment", () => {
        const s05 = chain.filter(s => s.id === 'S05');
        expect(s05.filter(s => s.cue).map(s => [s.name, s.cue])).toEqual([[KIT_SEGMENTS.H4, { step: 'H4', family: 'mule' }]]);
        expect(s05[0]!.name).toBe(KIT_SEGMENTS.H4!);
        expect(MULE_ROWS).toContain('H4');
    });

    test('two mule rows inside one step (H4k beside S07, H4e on its fallback) get distinct cues: each its own scope and session', async () => {
        const d = mkdtempSync(join(tmpdir(), 'chain-mule-'));
        const sdk = new FakeSdk(baseState({ tick: 1, inGame: true }));
        const keeper = new CueKeeper(d, 'Scored Name');
        const off = keeper.attach(sdk);
        const timer = setInterval(() => sdk.tick(), 2);
        const ctx = { sdk: sdk as unknown as RunnerSession['sdk'] };
        await keeper.open(muleScope('H4k'), ctx, { fresh: true });
        const a = JSON.parse(readFileSync(join(d, CUE_FILE), 'utf8')) as Cue;
        keeper.stop(muleScope('H4k'));
        const stopped = JSON.parse(readFileSync(join(d, CUE_FILE), 'utf8')) as Cue;
        await keeper.open(muleScope('H4e'), ctx, { fresh: true });
        const b = JSON.parse(readFileSync(join(d, CUE_FILE), 'utf8')) as Cue;
        clearInterval(timer);
        off();
        expect(a.scope).toEqual({ step: 'H4k', family: 'mule' });
        expect(stopped.stop).toBeTruthy();
        expect(b.scope).toEqual({ step: 'H4e', family: 'mule' });
        expect(b.stop ?? false).toBe(false);
        expect(b.session).not.toBe(a.session);
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
        keeper.close({ final: true });
        const last = JSON.parse(readFileSync(join(dir, CUE_FILE), 'utf8')) as Cue;
        expect([last.scope.step, last.stop]).toEqual(['S07', true]);
        expect(keeper.open_).toBeNull();
    });

    test('owned Runecraft sessions keep S21 on disk through segment stops, abort and stale handles', async () => {
        const d = mkdtempSync(join(tmpdir(), 'chain-rc-owned-'));
        const cues = new RunCues({ main: d, mule: join(d, 'mule') }, 'Scored Name');
        const read = () => JSON.parse(readFileSync(join(d, CUE_FILE), 'utf8')) as Cue;
        const scope = { step: 'S21', family: 'altar' } as const;
        const fields = { beacons: [{ tick: 12, ms: Date.now() }], turns: [] };
        try {
            const courier = cues.writer({ step: 'S18', family: 'courier' });
            courier.write(fields);
            cues.stop({ step: 'S18', family: 'courier' });
            expect(read()).toMatchObject({ scope: { step: 'S18', family: 'courier' }, stop: true });
            const prelogin = cues.writer(scope);
            prelogin.write(fields);
            expect(cues.isOpen(scope)).toBe(true);
            const band = cues.writer(scope);
            expect(read().final).toBeUndefined();
            band.write({ ...fields, stop: true });
            expect(read().final).toBeUndefined();
            expect(cues.isOpen(scope)).toBe(true);
            expect(() => prelogin.write(fields)).toThrow('no longer owned');
            expect(() => courier.write(fields)).toThrow('no longer owned');
            expect(read().scope).toEqual(scope);
            cues.close({ final: true });
            expect(read()).toMatchObject({ scope, session: band.session, stop: true, final: true });
            const stopped = readFileSync(join(d, CUE_FILE), 'utf8');
            cues.close({ final: true });
            cues.stop({ step: 'S18', family: 'courier' });
            expect(readFileSync(join(d, CUE_FILE), 'utf8')).toBe(stopped);
            expect(cues.isOpen(scope)).toBe(false);
            expect(() => band.write(fields)).toThrow('no longer owned');
        } finally {
            rmSync(d, { recursive: true, force: true });
        }
    });

    test('shutdown never adopts or overwrites a foreign disk session', () => {
        const d = mkdtempSync(join(tmpdir(), 'chain-rc-foreign-'));
        const keeper = new CueKeeper(d, 'Scored Name');
        const fields = { beacons: [{ tick: 12, ms: Date.now() }], turns: [] };
        try {
            keeper.writer({ step: 'S21', family: 'altar' }).write(fields);
            new CueWriter(d, 'Other Receiver', { step: 'S21', family: 'altar' }).write(fields);
            const foreign = readFileSync(join(d, CUE_FILE), 'utf8');
            expect(() => keeper.close({ final: true })).toThrow('ownership changed');
            expect(readFileSync(join(d, CUE_FILE), 'utf8')).toBe(foreign);
        } finally {
            rmSync(d, { recursive: true, force: true });
        }
    });

    describe("the run end's stop: final only on a completed chain or the operator's abort, so a recoverable exit's re-run is served", () => {
        const S04 = FAMILY_CUES.S04;
        const S07 = { step: 'S07', family: 'bone' } as const;
        // The real keeper on a ticking FakeSdk, read back through the launcher's own view of the scope.
        const harness = (scope: CueScope) => {
            const d = mkdtempSync(join(tmpdir(), 'chain-exit-'));
            const since = Date.now() - 1000;
            const launcher = new ScopeSessions(scope, since);
            const read = () => JSON.parse(readFileSync(join(d, CUE_FILE), 'utf8')) as Cue;
            const keeper = (sdk: FakeSdk) => {
                const k = new CueKeeper(d, 'Scored Name');
                k.attach(sdk);
                for (let i = 0; i < CUE_BEACONS; i++) sdk.tick();
                return k;
            };
            return { d, launcher, read, keeper, done: () => rmSync(d, { recursive: true, force: true }) };
        };
        const failing = (seen: (c: Cue) => void, read: () => Cue) => tag('S04', 'step', { name: 'S04 magic', logoutSafe: true, preconditions: () => true, postconditions: () => true, run: async () => {
            seen(read());
            throw new Error('rings ran out');
        } });

        test('a throw through cueAround writes a plain stop on the same session; the failed run closes nothing more; the re-run opens a new session the launcher re-arms', async () => {
            const h = harness(S04);
            try {
                const sdk = new FakeSdk(baseState({ tick: 1, inGame: true }));
                const first = h.keeper(sdk);
                let opened: Cue | null = null;
                const events: (string | null)[] = [];
                await expect(cueAround(failing(c => { opened = c; events.push(h.launcher.own(c)); }, h.read), S04, first).run(ctxFor(sdk))).rejects.toThrow('rings ran out');
                const stop = h.read();
                expect(stop).toMatchObject({ scope: S04, session: opened!.session, seq: opened!.seq + 1, stop: true });
                expect(stop.final).toBeUndefined();
                events.push(h.launcher.own(stop));
                // runChainOnSession's close on a StepError (code 1): non-final, and it has nothing open.
                first.close({ final: exitStopIsFinal({ completed: false, signal: null }) });
                expect(h.read()).toEqual(stop);
                // The re-run: a new process, its own keeper, the same scope opened afresh.
                const rerun = h.keeper(sdk);
                await rerun.open(S04, ctxFor(sdk), { fresh: true });
                const again = h.read();
                expect(again.session).not.toBe(opened!.session);
                expect(again.stop ?? false).toBe(false);
                events.push(h.launcher.own(again));
                expect(events).toEqual(['open', 'stood-down', 'open']);
            } finally {
                h.done();
            }
        });

        test("SIGTERM's race: the orphaned step's plain stop lands first, the close still finalizes that session, and a re-run's open is never re-armed", async () => {
            const h = harness(S04);
            try {
                const sdk = new FakeSdk(baseState({ tick: 1, inGame: true }));
                const keeper = h.keeper(sdk);
                const events: (string | null)[] = [];
                await expect(cueAround(failing(c => events.push(h.launcher.own(c)), h.read), S04, keeper).run(ctxFor(sdk))).rejects.toThrow();
                const plain = h.read();
                events.push(h.launcher.own(plain));
                keeper.close({ final: exitStopIsFinal({ completed: false, signal: 'SIGTERM' }) });
                const fin = h.read();
                expect(fin).toMatchObject({ scope: S04, session: plain.session, seq: plain.seq + 1, stop: true, final: true });
                events.push(h.launcher.own(fin));
                // A second close (the caller's teardown) and a late stop change nothing.
                keeper.close({ final: true });
                keeper.stop(S04);
                expect(h.read()).toEqual(fin);
                const rerun = h.keeper(sdk);
                await rerun.open(S04, ctxFor(sdk), { fresh: true });
                events.push(h.launcher.own(h.read()));
                expect(events).toEqual(['open', 'stood-down', 'closed', null]);
            } finally {
                h.done();
            }
        });

        test("SIGTERM's other order: the close finalizes the open session first, the orphan's stop then writes nothing", async () => {
            const h = harness(S07);
            try {
                const sdk = new FakeSdk(baseState({ tick: 1, inGame: true }));
                const keeper = h.keeper(sdk);
                await keeper.open(S07, ctxFor(sdk), { fresh: false });
                const open = h.read();
                keeper.close({ final: exitStopIsFinal({ completed: false, signal: 'SIGTERM' }) });
                const fin = h.read();
                expect(fin).toMatchObject({ scope: S07, session: open.session, seq: open.seq + 1, stop: true, final: true });
                keeper.stop(S07, undefined, { final: false });
                expect(h.read()).toEqual(fin);
                expect([h.launcher.own(open), h.launcher.own(fin)]).toEqual(['open', 'closed']);
            } finally {
                h.done();
            }
        });

        test('a band left open at a recoverable exit (pause 4, host reserved 5, SIGHUP, a crash) is closed with a plain stop; at completion with a final one', async () => {
            for (const [end, final] of [[{ completed: false, signal: null }, false], [{ completed: false, signal: 'SIGHUP' }, false], [{ completed: true, signal: null }, true]] as const) {
                const h = harness(S07);
                try {
                    const sdk = new FakeSdk(baseState({ tick: 1, inGame: true }));
                    const keeper = h.keeper(sdk);
                    await keeper.open(S07, ctxFor(sdk), { fresh: false });
                    const open = h.read();
                    keeper.close({ final: exitStopIsFinal(end) });
                    const last = h.read();
                    expect([last.session, last.stop, last.final ?? false]).toEqual([open.session, true, final]);
                    expect([h.launcher.own(open), h.launcher.own(last)]).toEqual(['open', final ? 'closed' : 'stood-down']);
                } finally {
                    h.done();
                }
            }
        });

        test('a mule hand-off stood down by its own plain stop is finalized by a final close, left alone by a plain one', async () => {
            for (const final of [false, true]) {
                const h = harness(muleScope('H22'));
                try {
                    const sdk = new FakeSdk(baseState({ tick: 1, inGame: true }));
                    const keeper = h.keeper(sdk);
                    await muleCued(tag('H22', 'handoff', { name: 'H22 hand-off', logoutSafe: true, preconditions: () => true, postconditions: () => true, run: async () => {} }), 'H22', keeper).run(ctxFor(sdk));
                    const plain = h.read();
                    expect([plain.stop, plain.final ?? false]).toEqual([true, false]);
                    keeper.close({ final });
                    expect(h.read().final ?? false).toBe(final);
                    expect(h.read().seq).toBe(final ? plain.seq + 1 : plain.seq);
                } finally {
                    h.done();
                }
            }
        });

        test("a carrier's last mule row ends its session final on success, so the run-end close writes nothing more; a throw there stops plain and the close behaves as before", async () => {
            const row = (fail: boolean) => tag('H22', 'handoff', { name: 'H22 hand-off', logoutSafe: true, preconditions: () => true, postconditions: () => true, run: async () => {
                if (fail) throw new Error('trade failed');
            } });
            for (const [fail, final] of [[false, false], [false, true], [true, false], [true, true]] as const) {
                const h = harness(muleScope('H22'));
                try {
                    const sdk = new FakeSdk(baseState({ tick: 1, inGame: true }));
                    const keeper = h.keeper(sdk);
                    const s = row(fail);
                    const [last] = cueMuleRows([s], new Map([[s, 'H22']]), () => 'mule1', keeper);
                    const ran = last!.run(ctxFor(sdk));
                    if (fail) await expect(ran).rejects.toThrow('trade failed');
                    else await ran;
                    const stop = h.read();
                    expect([stop.stop, stop.final ?? false]).toEqual([true, !fail]);
                    expect(h.launcher.own(stop)).toBe(fail ? 'stood-down' : 'closed');
                    keeper.close({ final });
                    // Already final: nothing more. Plain after a throw: finalized by a final close only, as before.
                    expect(h.read().seq).toBe(fail && final ? stop.seq + 1 : stop.seq);
                    expect(h.read().final ?? false).toBe(!fail || final);
                } finally {
                    h.done();
                }
            }
        });
    });

    test("every placed mule1 row gets a cue scoped to its own id ({row, mule}) before its hand-off; the cannon rows keep theirs", () => {
        const cues = chain.filter(s => s.kind === 'handoff').map(s => `${s.name.replace(/ hand-off.*$/, '')}:${s.cue ? `${s.cue.step}/${s.cue.family}` : '-'}`);
        expect(cues).toEqual(['H1:H1/mule', 'H4k:H4k/mule', 'H6:H6/mule', 'H4p:H4p/mule', 'H7:H7/mule', 'H8:H8/mule', 'H9:H9/mule', 'H10:H10/mule', 'H11:S14/cannon', 'H11r:-', 'H13:H13/mule', 'H14:H14/mule', 'H15:H15/mule', 'H16:H16/mule', 'H18:H18/mule', 'H19:H19/mule', 'H20:H20/mule', 'H21d:H21d/mule', 'H22:H22/mule', 'H23:S27/cannon']);
        for (const s of chain.filter(x => x.kind === 'handoff' && x.cue?.family === 'mule')) expect(MULE_ROWS).toContain(s.cue!.step);
    });

    test('the top-up ask carries the same {row, mule} scope as the package cue: one scope per hand-off', async () => {
        const ledger = readFileSync(MANIFEST, 'utf8');
        for (const row of ['H10', 'H12', 'H14']) expect(handOffFrom(ledger, row).receive.some(r => r.topUp)).toBe(true);
        expect(muleScope('H12')).toEqual({ step: 'H12', family: 'mule' });
    });

    test('a repeated or skipped mule hand-off cannot leave another package named: each cue is opened afresh and stopped after its own step, failed or not', async () => {
        const r = recorder();
        const stub = (id: string, fail = false): ChainStep => ({ id, kind: 'handoff', name: `${id} hand-off`, logoutSafe: true, preconditions: () => true, postconditions: () => true, run: async () => { if (fail) throw new Error('trade failed'); } });
        const ctx = ctxFor(new FakeSdk());
        await muleCued(stub('H9'), 'H9', r.cues).run(ctx);
        // H10 skipped as done: its step never runs, so nothing opens; H12 next names H12.
        await expect(muleCued(stub('H12', true), 'H12', r.cues).run(ctx)).rejects.toThrow('trade failed');
        await muleCued(stub('H12'), 'H12', r.cues).resume!(ctx);
        expect(r.opened).toEqual([{ scope: muleScope('H9'), fresh: true }, { scope: muleScope('H12'), fresh: true }, { scope: muleScope('H12'), fresh: true }]);
        expect(r.stopped).toEqual([muleScope('H9'), muleScope('H12'), muleScope('H12')]);
        expect(r.finals).toEqual([false, false, false]);
    });

    test("each mule carrier's last row in the chain stops final, every other mule row plain; the cannon rows are not mule rows", () => {
        const c = buildChain(CARRIER_CONFIG, { cues: recorder().cues });
        expect(muleStops(c)).toEqual([
            'H1:plain', 'H4:final', 'H4k:plain', 'H6:plain', 'H4p:plain', 'H7:plain', 'H8:plain', 'H9:plain', 'H10:plain', 'H12:plain',
            'H13:plain', 'H14:final', 'H15:plain', 'H16:plain', 'H18:plain', 'H19:plain', 'H20:plain', 'H21d:final', 'H22:final',
        ]);
        // H4's final is on Doric's segment A, the kit segment that trades it.
        expect(c.find(s => s.cue?.step === 'H4')!.name).toBe(KIT_SEGMENTS.H4!);
        for (const id of ['H11', 'H11r', 'H23']) expect(c.find(s => s.id === id)!.cue?.family ?? null).not.toBe('mule');
        // The fold-in 23 ledger (H12a + H12b, both in S15's one gtSwap) places the same rows; its split kit is not cued.
        expect(muleStops(buildChain(CARRIER_CONFIG, { cues: recorder().cues, manifest: FOLD_IN_23 }))).toEqual(muleStops(c).filter(s => !s.startsWith('H12:')));
    });

    test("'last' is over the rows in the ledger in force: without H22, mule1's last row is H13", () => {
        const h22 = MANIFEST_TEXT.split('\n').find(l => l.startsWith('| H22 |'))!;
        const c = buildChain(CARRIER_CONFIG, { cues: recorder().cues, manifest: MANIFEST_TEXT.replace(`${h22}\n`, '') });
        expect(c.some(s => s.id === 'H22')).toBe(false);
        expect(muleStops(c).filter(s => s.endsWith(':final'))).toEqual(['H4:final', 'H13:final', 'H14:final', 'H21d:final']);
    });

    test("cueMuleRows: a carrier's last row writes a final stop, its others plain; a throw on the last row stops plain and the resume's success final; a done-skipped last row writes nothing", async () => {
        const r = recorder();
        const ran: string[] = [];
        const failOnce = new Set(['H14']);
        const stub = (id: string): ChainStep => ({ id, kind: 'handoff', name: `${id} hand-off`, logoutSafe: true, preconditions: () => true, postconditions: () => true, run: async () => {
            ran.push(id);
            if (failOnce.delete(id)) throw new Error('trade failed');
        } });
        const ids = ['H1', 'H4k', 'S07', 'H4', 'H10', 'H14', 'H21d', 'H22', 'H20'];
        const steps = ids.map(stub);
        const rows = new Map(steps.filter(s => s.id !== 'S07').map(s => [s, s.id] as const));
        const carrierOf = (row: string) => CARRIER_CONFIG.partners[row]!;
        const c = cueMuleRows(steps, rows, carrierOf, r.cues);
        expect(c.map(s => `${s.id}:${s.cue ? (s.finalStop ? 'final' : 'plain') : '-'}`)).toEqual(['H1:plain', 'H4k:plain', 'S07:-', 'H4:final', 'H10:plain', 'H14:final', 'H21d:plain', 'H22:final', 'H20:final']);
        // A step outside `rows` is the same object, untouched.
        expect(c[2]).toBe(steps[2]!);
        const ctx = ctxFor(new FakeSdk());
        for (const s of c) {
            // H20, h55's last row, is skipped as done: the runner never calls it.
            if (s.id === 'H20') continue;
            if (s.id === 'H14') {
                await expect(s.run(ctx)).rejects.toThrow('trade failed');
                await s.resume!(ctx);
                continue;
            }
            await s.run(ctx);
        }
        expect(ran).toEqual(['H1', 'H4k', 'S07', 'H4', 'H10', 'H14', 'H14', 'H21d', 'H22']);
        expect(r.stopped.map(s => s.step)).toEqual(['H1', 'H4k', 'H4', 'H10', 'H14', 'H14', 'H21d', 'H22']);
        expect(r.finals).toEqual([false, false, true, false, false, true, false, true]);
        expect(r.opened.map(o => o.scope.step)).toEqual(r.stopped.map(s => s.step));
    });

    test("H11r is neither a mule nor a cannon row: it trades on S14's open cannon scope, and S14's one cue stop comes after it", async () => {
        expect(MULE_ROWS).not.toContain('H11r');
        expect(Object.keys(CANNON_ROWS)).not.toContain('H11r');
        const r = recorder();
        const c = buildChain(CONFIG, { cues: r.cues });
        const at = (pred: (s: ChainStep) => boolean) => c.findIndex(pred);
        const h11r = c[at(s => s.id === 'H11r')]!;
        expect([h11r.kind, h11r.cue, h11r.finalStop]).toEqual(['handoff', undefined, undefined]);
        const band = c.findLastIndex(s => s.id === 'S14');
        const stops = c.flatMap((s, i) => (s.id === 'S14 cue stop' ? [i] : []));
        expect(stops).toHaveLength(1);
        // Between S14's band and its stop: the leg's first part and H11r, neither opening nor stopping a cue.
        expect(c.slice(band + 1, stops[0]).map(s => [s.id, s.cue ?? null])).toEqual([['T14-15a', null], ['H11r', null]]);
        await c[stops[0]!]!.run(ctxFor(new FakeSdk()));
        expect(r.stopped).toEqual([{ step: 'S14', family: 'cannon' }]);
    });

    test("S09 mines with the contested-rock fallback 'auto' and never acceptHazards: only sites whose hunters leave SCORED's combat alone", () => {
        expect(S09_MINING.fallback).toBe('auto');
        expect('acceptHazards' in S09_MINING).toBe(false);
        const fb = mining.parseFallback(S09_MINING.fallback);
        expect(fb.acceptHazards).toBe(false);
        expect(fb.sites.length).toBeGreaterThan(0);
        expect(fb.sites).not.toContain('zoo');
        // No SCORED path sets it: the chain and run.ts never name it.
        for (const f of ['chain.ts', '../run.ts']) expect(readFileSync(join(import.meta.dir, f), 'utf8').replace(/^\s*(\/\/|\*).*$/gm, '')).not.toContain('acceptHazards');
        expect(chain.filter(s => s.id === 'S09').length).toBeGreaterThan(0);
    });

    test("mule1's cue directory is the run config's muleCueDir, else <cueDir>/mule", () => {
        expect(muleCueDir({ cueDir: '/run/rc-cue' })).toBe(join('/run/rc-cue', 'mule'));
        expect(muleCueDir({ cueDir: '/run/rc-cue', muleCueDir: '/elsewhere/mule1' })).toBe('/elsewhere/mule1');
    });

    test('a mule hand-off during S07 (H4k) leaves the bone cue alone: the mule cue and its stop go to <cueDir>/mule, the bone cue stays open with no stop', async () => {
        const d = mkdtempSync(join(tmpdir(), 'chain-runcues-'));
        const muleDir = muleCueDir({ cueDir: d });
        prepareCueDir(d, { fresh: true });
        prepareCueDir(muleDir, { fresh: true });
        const sdk = new FakeSdk(baseState({ tick: 1, inGame: true }));
        const cues = new RunCues({ main: d, mule: muleDir }, 'Scored Name');
        const off = cues.attach(sdk);
        const timer = setInterval(() => sdk.tick(), 2);
        const ctx = { sdk: sdk as unknown as RunnerSession['sdk'] } as StepContext<unknown>;
        const read = (dir: string) => JSON.parse(readFileSync(join(dir, CUE_FILE), 'utf8')) as Cue;
        try {
            await cues.open({ step: 'S07', family: 'bone' }, ctx, { fresh: true });
            const bone = read(d);
            let during: Cue | null = null;
            const h4k: ChainStep = { id: 'H4k', kind: 'handoff', name: 'H4k hand-off', logoutSafe: true, preconditions: () => true, postconditions: () => true, run: async () => { during = read(muleDir); } };
            await muleCued(h4k, 'H4k', cues).run(ctx);
            const boneAfter = read(d);
            const muleAfter = read(muleDir);
            expect(during!.scope).toEqual({ step: 'H4k', family: 'mule' });
            expect(during!.stop ?? false).toBe(false);
            expect(muleAfter.session).toBe(during!.session);
            expect(muleAfter.stop).toBeTruthy();
            expect(boneAfter).toEqual(bone);
            expect(boneAfter.scope).toEqual({ step: 'S07', family: 'bone' });
            expect(boneAfter.stop ?? false).toBe(false);
            expect(cues.main.open_).toEqual({ step: 'S07', family: 'bone' });
        } finally {
            clearInterval(timer);
            off();
        }
    });

    test("S03's droppers are cued at S01, the run's first login: the go file between S00 and the H1 hand-off", async () => {
        const ids = chain.map(s => s.id);
        expect(ids.indexOf('S03 go cue')).toBe(ids.lastIndexOf('S00') + 1);
        expect(ids.indexOf('S03 go cue') + 1).toBe(ids.indexOf('S01'));
        const go = buildChain({ ...CONFIG, cueDir: dir }, { cues: recorder().cues }).find(s => s.id === 'S03 go cue')!;
        const log = TickLog.memory('go');
        const before = Date.now();
        await go.run(ctxFor(new FakeSdk(), log));
        const cue = JSON.parse(readFileSync(join(dir, GO_FILE), 'utf8'));
        expect(cue.v).toBe(1);
        expect(cue.ms).toBeGreaterThanOrEqual(before);
        expect(log.rows.filter(r => r.step !== '(census)').map(r => [r.step, r.ticks])).toEqual([['S03 dropper go cue', 0]]);
    });

    test("S25a's announce reaches the anvil helper's plan file", () => {
        anvilAnnounce(dir)({ session: 'r/1', seq: 0, give: { bronze_bar: 25 } });
        expect(JSON.parse(readFileSync(join(dir, PLAN_FILE), 'utf8'))).toMatchObject({ v: 1, session: 'r/1', seq: 0, give: { bronze_bar: 25 } });
    });

    test("the cue directory: created 0700, the run's own stale files removed at a fresh start only", () => {
        const d = join(dir, 'run-cue');
        expect(prepareCueDir(d, { fresh: true })).toEqual([]);
        expect(statSync(d).mode & 0o777).toBe(0o700);
        for (const f of [CUE_FILE, PLAN_FILE, 'topup-ask.json', GO_FILE, 'status-cairn_b01.json']) writeFileSync(join(d, f), '{}');
        expect(prepareCueDir(d, { fresh: false })).toEqual([]);
        expect(existsSync(join(d, CUE_FILE))).toBe(true);
        expect(prepareCueDir(d, { fresh: true }).sort()).toEqual([PLAN_FILE, CUE_FILE, 'topup-ask.json', GO_FILE].sort());
        expect(existsSync(join(d, 'status-cairn_b01.json'))).toBe(true);
        expect(() => prepareCueDir(join(import.meta.dir, 'never-a-cue-dir'), { fresh: true })).toThrow();
    });
});

describe('S21 arrival and the real resume chain', () => {
    test('before logout resumes the approach until canonical arrival; open and closed halves retain their milestones', async () => {
        const relogs = new RelogBudget(mkdtempSync(join(tmpdir(), 's21-arrival-')));
        const full = buildChain(CONFIG, { cues: recorder().cues, relogs });
        // Keep the real chain's predicates and leg; earlier completed quests are outside this slice.
        const start = full.findIndex(s => s.id === 'T20-21');
        const steps = full.slice(start, full.findIndex(s => s.id === 'T21-22'));
        const leg = steps[0] as ChainStep & LegStep;
        const state = (tile: { x: number; z: number; level?: number }, inGame = true) => baseState({
            inGame, player: { x: tile.x, z: tile.z, worldX: tile.x, worldZ: tile.z, level: tile.level ?? 0 } as PlayerState,
            skills: [{ name: 'Magic', level: 99, baseLevel: 99, experience: 0 }, { name: 'Runecraft', level: 44, baseLevel: 44, experience: 61_512 }],
            inventory: [
                { slot: 0, id: 0, name: 'Law rune', count: 1, optionsWithIndex: [] },
                { slot: 1, id: 0, name: 'Air rune', count: 3, optionsWithIndex: [] },
                { slot: 2, id: 0, name: 'Water rune', count: 1, optionsWithIndex: [] },
                { slot: 3, id: 0, name: 'Body talisman', count: 1, optionsWithIndex: [] },
            ],
        });
        const resolve = (s: BotWorldState) => resolveResume(steps, new Observation(s), {});
        expect((await resolve(state(leg.def.start)))).toMatchObject({ step: leg.name, mode: 'run' });
        const teleport = leg.def.hops[0]!;
        if (teleport.kind !== 'teleport') throw new Error('expected canonical teleport');
        expect((await resolve(state(SPELLS[teleport.spell].landing)))).toMatchObject({ step: leg.name, mode: 'resume' });
        // Arrived still holding the runes T20-21 drops: the leg again, which drops them and nothing else.
        expect((await resolve(state(leg.def.dest)))).toMatchObject({ step: leg.name, mode: 'run' });
        // Arrived as the ledger has it, only the talisman held (the teleport spent its runes, the leg dropped the rest).
        const arrived = (inGame = true) => {
            const s = state(leg.def.dest, inGame);
            s.inventory = [{ slot: 3, id: 0, name: 'Body talisman', count: 1, optionsWithIndex: [] }];
            return s;
        };
        expect((await resolve(arrived()))).toMatchObject({ step: SCORED_LOGOUT, mode: 'run' });
        relogs.beginPlanned(SCORED_RELOG, 100);
        expect((await resolve(arrived(false)))).toMatchObject({ step: SCORED_LOGIN, mode: 'run' });
        relogs.endPlanned(SCORED_RELOG, 'page');
        const ready = state(leg.def.dest);
        ready.inventory = [{ slot: 0, id: 0, name: 'Body talisman', count: 1, optionsWithIndex: [] }];
        expect((await resolve(ready)).step).toBe('S21 runecraft');
    });
});

describe('a placed hand-off stays done once the band after it consumes what it brought (rs/562 A)', () => {
    const PLAYER = { name: 'Scored' };
    type Held = [name: string, count: number, id?: number];
    const items = (held: readonly Held[]) => held.map(([name, count, id], slot) => ({ slot, id: id ?? 20_000 + slot, name, count, optionsWithIndex: [] }));
    const level = (name: string, n: number) => ({ name, level: n, baseLevel: n, experience: 0 });
    const at = (x: number, z: number, o: { held: readonly Held[]; worn?: readonly Held[]; skills?: ReturnType<typeof level>[]; partner?: string; level?: number }) =>
        baseState({
            inGame: true,
            player: { ...PLAYER, x, z, worldX: x, worldZ: z, level: o.level ?? 0 } as PlayerState,
            inventory: items(o.held),
            equipment: items(o.worn ?? []),
            skills: o.skills ?? [],
            nearbyPlayers: o.partner ? ([{ index: 9, name: o.partner, x, z, level: 3 }] as unknown as BotWorldState['nearbyPlayers']) : [],
        });
    /** The real chain with this attempt's record, sliced from leg `from` up to (not including) `to`. */
    const sliceWith = (record: HandOffRecord | undefined, from: string, to: string) => {
        const full = buildChain(CONFIG, { cues: recorder().cues, ...(record ? { handOffs: record } : {}) });
        return full.slice(full.findIndex(s => s.id === from), full.findIndex(s => s.id === to));
    };
    const where = async (steps: readonly ChainStep[], s: BotWorldState): Promise<[string | null, string]> => {
        try {
            const p = await resolveResume(steps, new Observation(s), {});
            return [p.step, p.mode];
        } catch (e) {
            return ['refused', (e as Error).message];
        }
    };
    const marked = (row: string) => {
        const r = new HandOffRecord(mkdtempSync(join(tmpdir(), 'chain-handoffs-')), 'attempt-1');
        r.mark(row, 1000);
        return r;
    };
    const unmarked = () => new HandOffRecord(mkdtempSync(join(tmpdir(), 'chain-handoffs-')), 'attempt-1');

    // S18 at the knights' anchor (thieving.ts BANDS), Thieving inside the band, as on arrival from T16-18.
    const KNIGHTS = { x: 2670, z: 3305 };
    const THIEF = [level('Thieving', 57), level('Magic', 80), level('Fletching', 60)];
    /** H14's package, received in full (the ledger's counts), less `used`. */
    const h14Pack = (used: Record<string, number> = {}): Held[] =>
        handOffFrom(MANIFEST_TEXT, 'H14').receive.map(r => [r.name, r.count - (used[r.name] ?? 0), r.ids?.[0]] as Held).filter(h => h[1] > 0);

    test('S18 after one shark eaten: thieving:knights resumes; without the record the walk falls back to H14 and T16-18 (rs/147, measured)', async () => {
        const oneShark = at(KNIGHTS.x, KNIGHTS.z, { held: h14Pack({ shark: 1 }), skills: THIEF });
        expect(await where(sliceWith(marked('H14'), 'T16-18', 'T18-19'), oneShark)).toEqual(['thieving:knights', 'resume']);
        expect(await where(sliceWith(unmarked(), 'T16-18', 'T18-19'), oneShark)).toEqual(['T16-18 Ardougne teleport from the chamber + run to the knights anchor', 'run']);
    });

    test('S18 after the first stocked Superheat (a copper and a tin ore, a nature rune): thieving:knights resumes', async () => {
        const oneCast = at(KNIGHTS.x, KNIGHTS.z, { held: h14Pack({ 'copper ore': 1, 'tin ore': 1, 'nature rune': 1 }), skills: THIEF });
        expect(await where(sliceWith(marked('H14'), 'T16-18', 'T18-19'), oneCast)).toEqual(['thieving:knights', 'resume']);
    });

    test('S18 on arrival, H14 not yet traded (Thieving 57 already reads in progress): H14 runs, record or no record', async () => {
        const arrival = at(KNIGHTS.x, KNIGHTS.z, { held: [['Magic potion(3)', 1], ['Knife', 1, 946]], skills: THIEF, partner: 'p_h14' });
        expect(await where(sliceWith(unmarked(), 'T16-18', 'T18-19'), arrival)).toEqual(['H14 hand-off', 'run']);
        // Marked, but a rollback across the swap handed the potion and knife back: H14 again.
        expect(await where(sliceWith(marked('H14'), 'T16-18', 'T18-19'), arrival)).toEqual(['H14 hand-off', 'run']);
    });

    // S22 at the river standing tile (fishing.ts RIVER), Fishing 78, as on arrival from T21-22.
    const RIVER = { x: 3241, z: 3248 };
    const FISHER = [level('Fishing', 78)];
    const h18Pack = (used: Record<string, number> = {}): Held[] =>
        handOffFrom(MANIFEST_TEXT, 'H18').receive.map(r => [r.name, r.count - (used[r.name] ?? 0), r.ids?.[0]] as Held).filter(h => h[1] > 0);

    test('S22 after the first catch (feathers 609): fishing:fly-78-99 resumes; without the record it does not (rs/147)', async () => {
        const firstCatch = at(RIVER.x, RIVER.z, { held: [...h18Pack({ feather: 1 }), ['Raw trout', 1]], skills: FISHER });
        expect(await where(sliceWith(marked('H18'), 'T21-22', 'T22-23'), firstCatch)).toEqual(['fishing:fly-78-99', 'resume']);
        expect(await where(sliceWith(unmarked(), 'T21-22', 'T22-23'), firstCatch)).toEqual(['T21-22 Lumbridge teleport from the body altar room + run', 'run']);
    });

    test('S22 after the knife cycle used its logs: fishing:fly-78-99 resumes', async () => {
        const noLogs = at(RIVER.x, RIVER.z, { held: h18Pack({ feather: 300, logs: 10 }), skills: [level('Fishing', 90)] });
        expect(await where(sliceWith(marked('H18'), 'T21-22', 'T22-23'), noLogs)).toEqual(['fishing:fly-78-99', 'resume']);
    });

    test('S22 on arrival, H18 not yet traded (at the river, Fishing 78, already in progress): H18 runs', async () => {
        const arrival = at(RIVER.x, RIVER.z, { held: [['Law rune', 1]], skills: FISHER, partner: 'p_h18' });
        expect(await where(sliceWith(unmarked(), 'T21-22', 'T22-23'), arrival)).toEqual(['H18 hand-off', 'run']);
    });

    test('S16 mid-fight, runes spent (the in-progress segment is C, not the milestone D): C-fight resumes', async () => {
        const h13 = handOffFrom(MANIFEST_TEXT, 'H13');
        const held: Held[] = h13.receive.filter(r => !h13.wield.some(w => w.name === r.name)).map(r => [r.name, /rune$/.test(r.name) ? Math.floor(r.count / 2) : r.count, r.ids?.[0]] as Held);
        const worn: Held[] = h13.wield.map(w => [w.name, 1]);
        const midFight = at(3105, 3935, { held, worn, skills: [level('Magic', 80)] });
        const steps = sliceWith(marked('H13'), 'T15-16a', 'T16-18');
        expect(await where(steps, midFight)).toEqual(['S16:C-fight', 'resume']);
        expect((await where(sliceWith(unmarked(), 'T15-16a', 'T16-18'), midFight))[0]).not.toBe('S16:C-fight');
    });

    test('every placed hand-off: recorded in this attempt and nothing it gave held, done with its package spent; another attempt\'s record is not this one', () => {
        const record = marked('none');
        const other = new HandOffRecord(record.dir, 'attempt-0');
        const full = buildChain(CONFIG, { cues: recorder().cues, handOffs: record });
        const handOffs = full.filter(s => s.kind === 'handoff');
        expect(handOffs.length).toBeGreaterThan(15);
        const spent = new Observation(at(0, 0, { held: [] }));
        for (const s of handOffs) {
            const row = s.name.replace(/ hand-off$/, '');
            other.mark(row, 1);
            expect([row, s.done!(spent, {})]).toEqual([row, false]);
            record.mark(row, 1);
            expect([row, s.done!(spent, {})]).toEqual([row, true]);
        }
    });
});

describe("H12o: h45's login trigger", () => {
    const dirs = () => {
        const base = mkdtempSync(join(tmpdir(), 'chain-h12o-'));
        return { base, cueDir: join(base, 'rc-cue'), role: join(base, 'h45-cue'), login: join(base, 'h45-login') };
    };
    const frame = () => new FakeSdk(baseState({ tick: 4321, inGame: true, player: { name: 'Scored Name', x: 0, z: 0, worldX: 0, worldZ: 0, level: 0 } as PlayerState }));

    test('writes one H12o/mule cue into the login-only folder and nothing into the role folder', async () => {
        const d = dirs();
        try {
            await h12oLogin({ cueDir: d.cueDir, h12o: { account: 'cairn_h45', cueDir: d.role, loginDir: d.login, leadTicks: 100 } }).run(ctxFor(frame()));
            const cue = JSON.parse(readFileSync(join(d.login, CUE_FILE), 'utf8')) as Cue;
            expect(cue.scope).toEqual(H12O_LOGIN);
            expect([cue.seq, cue.stop, cue.final, cue.turns]).toEqual([1, undefined, undefined, []]);
            expect(cue.beacons.map(b => b.tick)).toEqual([4321]);
            expect(existsSync(d.role)).toBe(false);
            expect(existsSync(join(d.cueDir, CUE_FILE))).toBe(false);
        } finally {
            rmSync(d.base, { recursive: true, force: true });
        }
    });

    test('refuses, writing nothing and with the top-ups off, with no h12o block, no account, no lead time, a lead that is not a positive whole number, or a role folder for the login folder', async () => {
        const d = dirs();
        try {
            const h = { account: 'cairn_h45', cueDir: d.role, loginDir: d.login };
            const cases: [Pick<RunConfig, 'cueDir' | 'muleCueDir' | 'h12o'>, string][] = [
                [{ cueDir: d.cueDir }, 'no h12o block'],
                [{ cueDir: d.cueDir, h12o: { cueDir: d.role, loginDir: d.login, leadTicks: 100 } }, 'no h12o.account'],
                [{ cueDir: d.cueDir, h12o: h }, 'no h12o.leadTicks'],
                [{ cueDir: d.cueDir, h12o: { ...h, leadTicks: 0 } }, 'not a positive whole number'],
                [{ cueDir: d.cueDir, h12o: { ...h, leadTicks: 2.5 } }, 'not a positive whole number'],
                [{ cueDir: d.cueDir, h12o: { ...h, loginDir: d.role, leadTicks: 100 } }, 'is a role folder'],
                [{ cueDir: d.cueDir, h12o: { ...h, loginDir: join(d.cueDir, 'mule'), leadTicks: 100 } }, 'is a role folder'],
                [{ cueDir: d.cueDir, h12o: { ...h, loginDir: `${d.cueDir}/.`, leadTicks: 100 } }, 'is a role folder'],
            ];
            for (const [cfg, why] of cases) {
                expect(h12oLoginRefusal(cfg)).toContain(why);
                expect(h12oLogin(cfg).refuses).toBe(h12oLoginRefusal(cfg)!);
                expect(h12oTopUp(cfg)).toBeUndefined();
                await expect(h12oLogin(cfg).run(ctxFor(frame()))).rejects.toThrow(why);
            }
            expect([d.role, d.login, d.cueDir].some(p => existsSync(p))).toBe(false);
            const ok = { cueDir: d.cueDir, h12o: { ...h, leadTicks: 100 } };
            expect(h12oLoginRefusal(ok)).toBeNull();
            expect(h12oLogin(ok).refuses).toBeUndefined();
            // Both legs from h45, in its role folder; no item list (the module sizes each leg).
            expect(h12oTopUp(ok)).toEqual({ from: 'cairn_h45', m: true, p: true, cueDir: d.role });
        } finally {
            rmSync(d.base, { recursive: true, force: true });
        }
    });

    test("the chain writes no H12o cue of its own: both legs' cues are Monkey Madness's", () => {
        const chain = buildChain(CONFIG, { cues: recorder().cues });
        expect(chain.filter(s => s.cue?.step.startsWith('H12o')).map(s => s.id)).toEqual([]);
        expect(chain.filter(s => s.kind === 'cue' && s.id.startsWith('H12o') && s.id !== 'H12o login').map(s => s.id)).toEqual([]);
    });
});

describe("H13 for attempt 1: the landing hand-off only", () => {
    test('H13 trades at the Ardougne landing inside T15-16 on its own mule cue; no cellar cue, login trigger or h41/h52 staging is on the chain', () => {
        const chain = buildChain(CONFIG, { cues: recorder().cues });
        const a = chain.findIndex(s => s.id === 'T15-16a');
        const b = chain.findIndex(s => s.id === 'T15-16b');
        expect(a).toBeGreaterThan(0);
        const between = chain.slice(a + 1, b);
        expect(between.map(s => `${s.kind}:${s.cue ? `${s.cue.step}/${s.cue.family}` : '-'}`)).toEqual(['handoff:H13/mule']);
        // T15-16's own route ends on the ladder to the cellar; that is travel, not the cellar helpers. S15's
        // J-cellar is the atoll's cellar, nothing of H13's.
        const text = chain.filter(s => s.kind !== 'leg' && s.id !== 'S15').map(s => `${s.id} ${s.name} ${s.cue ? `${s.cue.step}/${s.cue.family}` : ''}`).join('\n');
        expect(text).not.toMatch(/cellar|\bh41\b|\bh52\b/i);
    });
});

describe('S15: Monkey Madness on the chain', () => {
    const full = buildChain(COMPLETE, { cues: recorder().cues });
    const s15 = full.filter(s => s.id === 'S15');
    const st = (more: Partial<BotWorldState> = {}) => baseState({ tick: 10, inGame: true, player: { name: 'Scored Name', x: 3200, z: 3200, worldX: 3200, worldZ: 3200, level: 0 } as PlayerState, ...more });
    const inv = (...items: [id: number, name: string, count: number][]) => items.map(([id, name, count], slot) => ({ slot, id, name, count, optionsWithIndex: [] })) as unknown as BotWorldState['inventory'];

    test("S15 is monkey-madness's own segments A-Z in order, and nothing on the full path refuses", () => {
        expect(s15.map(s => s.name)).toEqual(monkeyMadness.steps().map(s => s.name));
        expect(s15.every(s => s.kind === 'step')).toBe(true);
        expect(full.some(s => s.kind === 'missing')).toBe(false);
        expect(missingOnPath(full)).toEqual([]);
        expect(() => chainProbes(full)).not.toThrow();
    });

    test("h45's login trigger is the one step between segments L and M; its done is past M, so a resume into N..Z walks past it and one into M fires it", () => {
        const i = full.findIndex(s => s.id === 'H12o login');
        expect([full[i - 1]!.name, full[i]!.name, full[i + 1]!.name]).toEqual(['S15:L-amulet', 'H12o h45 login trigger', 'S15:M-jail2']);
        expect(full.filter(s => s.id === 'H12o login')).toHaveLength(1);
        const login = full[i]!;
        expect(login.probes).toEqual([monkeyMadness.JOURNAL_PROBE]);
        const holding = (id: number) => new Observation(st({ quests: { mm: 'started' }, inventory: inv([id, 'quest item', 1]) }));
        // L done (the enchanted bar held), M's travel to the H12o-M leg still ahead: it fires.
        expect(login.done!(holding(monkeyMadness.MM_OBJ.enchantedBar), {})).toBe(false);
        // N done (the strung amulet held): past M, walked past.
        expect(login.done!(holding(monkeyMadness.MM_OBJ.amulet), {})).toBe(true);
    });

    test("H12 is cued {H12, mule} around segment A, the gtSwap, and no other S15 segment; A trades the kit with H12's partner", () => {
        expect(s15.filter(s => s.cue).map(s => [s.name, s.cue])).toEqual([[KIT_SEGMENTS.H12, { step: 'H12', family: 'mule' }]]);
        expect(s15[0]!.name).toBe(KIT_SEGMENTS.H12!);
        expect(MULE_ROWS).toContain('H12');
        // A short kit passes A's kit check (it has a kitFrom), so A's next check, the place, refuses.
        const away = st({ quests: { tree: 'complete', grandtree: 'complete' } });
        expect(s15[0]!.preconditions(away, {})).toContain('not at the Grand Tree');
        const split = buildChain(COMPLETE, { cues: recorder().cues, manifest: FOLD_IN_23 }).find(s => s.id === 'S15')!;
        expect([split.name, split.cue, split.preconditions(away, {})]).toEqual([KIT_SEGMENTS.H12, undefined, expect.stringContaining('not at the Grand Tree')]);
        expect(() => buildChain({ ...COMPLETE, partners: { ...PARTNERS, H12a: 'p_one', H12b: 'p_two' } }, { cues: recorder().cues, manifest: FOLD_IN_23 })).toThrow('not one partner for both');
        expect(() => buildChain({ ...COMPLETE, partners: Object.fromEntries(Object.entries(PARTNERS).filter(([r]) => r !== 'H12')) }, { cues: recorder().cues })).toThrow('names no partner for H12');
    });

    test("H12's ask names exactly its row's `to N` entries at what SCORED lacks, written once on the trade's open frame; nothing is asked when they are met", async () => {
        const plan = handOffFrom(MANIFEST_TEXT, 'H12');
        const tops = plan.receive.filter(r => r.topUp);
        expect(tops.map(r => [r.pattern.source, r.count])).toEqual([[expect.stringMatching(/shark/i), 15]]);
        const d = mkdtempSync(join(tmpdir(), 'chain-h12-ask-'));
        try {
            const sharks = (n: number) => inv([385, 'Shark', 1]).flatMap(() => Array.from({ length: n }, (_, slot) => ({ slot, id: 385, name: 'Shark', count: 1, optionsWithIndex: [] }))) as unknown as BotWorldState['inventory'];
            const trade = (isOpen: boolean, partner = 'p_h12') => ({ trade: { isOpen, partner } as unknown as BotWorldState['trade'] });
            const asks: TopUpAsk[] = [];
            const step = (sdk: FakeSdk): ChainStep => tag('S15', 'step', {
                name: KIT_SEGMENTS.H12!, logoutSafe: true, preconditions: () => true, postconditions: () => true,
                run: async () => {
                    sdk.push(trade(true, 'someone else'));
                    expect(existsSync(join(d, ASK_FILE))).toBe(false);
                    for (let k = 0; k < 3; k++) {
                        sdk.push(trade(true));
                        if (existsSync(join(d, ASK_FILE))) asks.push(JSON.parse(readFileSync(join(d, ASK_FILE), 'utf8')) as TopUpAsk);
                        rmSync(join(d, ASK_FILE), { force: true });
                    }
                    sdk.push(trade(false));
                },
            });
            const sdk = new FakeSdk(st({ inventory: sharks(4) }));
            await askedOnTrade(step(sdk), plan, 'p_h12', d).run(ctxFor(sdk));
            expect(asks.map(a => [a.items, a.scope])).toEqual([[[{ item: tops[0]!.pattern.source, count: 11 }], { step: 'H12', family: 'mule' }]]);
            // Unsubscribed once the step returns: a later open writes nothing.
            sdk.push(trade(true));
            expect(existsSync(join(d, ASK_FILE))).toBe(false);
            // Fifteen held: met, so no ask at all.
            const met = new FakeSdk(st({ inventory: sharks(15) }));
            asks.length = 0;
            await askedOnTrade(step(met), plan, 'p_h12', d).run(ctxFor(met));
            expect(asks).toEqual([]);
        } finally {
            rmSync(d, { recursive: true, force: true });
        }
    });
});

describe('S11a: the gnome course to Agility 25', () => {
    test("S11a's one step is agility:gnome and it ends at Agility 25, the Grand Tree's pillar climb without a potion", () => {
        const s11a = chain.filter(s => s.id === 'S11a');
        expect(s11a.map(s => s.name)).toEqual(['agility:gnome']);
        const at = (level: number) => baseState({ tick: 1, inGame: true, skills: [{ name: 'Agility', level, baseLevel: level, experience: 0 }] } as never);
        expect(s11a[0]!.postconditions(at(24), {})).not.toBe(true);
        expect(s11a[0]!.postconditions(at(25), {})).toBe(true);
    });
});

// rs/701: main's H4m lever. S07 closes at s07PrayerTo below 99 and S09 buries the rest from H4m's carrier
// (the fallback table's H4m.1-H4m.N, rs/705's h4mLoadRows); at 99 the chain is today's.
describe('H4m: S07 closes below 99 and S09 buries the rest', () => {
    const H4E = MANIFEST_TEXT.split('\n').find(l => l.startsWith('| H4e |'))!;
    // rs/158's draft row (STEP-MANIFEST.md, 'H4m draft'): not in force, so put in by hand here
    const H4M_LINE = '| H4m.1-H4m.10 | big bones @532 x20 [u] | - | - | 20 | fixture: rs/158\'s draft row |';
    const WITH_H4M = MANIFEST_TEXT.replace(`${H4E}\n`, `${H4E}\n${H4M_LINE}\n`);
    const H4M: RunConfig = { ...CONFIG, s07PrayerTo: 98, partners: { ...PARTNERS, H4m: 'p_h4m' } };
    const record = () => new HandOffRecord(mkdtempSync(join(tmpdir(), 'chain-h4m-')), 'attempt-1');
    const build = (cfg: RunConfig = H4M, o: Partial<ChainOptions> = {}) => buildChain(cfg, { cues: recorder().cues, manifest: WITH_H4M, handOffs: record(), ...o });
    const s09 = (c: readonly ChainStep[]) => c.slice(c.findIndex(s => s.id === 'H4p'), c.findIndex(s => s.id === 'T09-10')).map(s => `${s.id}: ${s.name}`);
    const shape = (c: readonly ChainStep[]) => c.map(s => [s.id, s.kind, s.name, s.cue ?? null, s.finalStop ?? null]);
    const LOADS = Array.from({ length: 10 }, (_, i) => `H4m.${i + 1}`);

    type Held = [name: string, count: number, id?: number];
    const KIT: Held[] = [['Knife', 1, 946], ['Logs', 1, 1511], ['Rune pickaxe', 1, 1275], ['Logs', 1, 1511]];
    const zoo = (o: { bones?: number; prayer?: number; mining?: number; extra?: number; partner?: boolean; x?: number; z?: number } = {}) => {
        const held: Held[] = [...KIT, ...Array.from({ length: o.bones ?? 0 }, (): Held => ['Big bones', 1, 532]), ...Array.from({ length: o.extra ?? 0 }, (): Held => ['Shark', 1, 385])];
        return baseState({
            tick: 1,
            inGame: true,
            player: { name: 'Scored', x: o.x ?? 2604, z: o.z ?? 3235, worldX: o.x ?? 2604, worldZ: o.z ?? 3235, level: 0 } as PlayerState,
            inventory: held.map(([name, count, id], slot) => ({ slot, id: id ?? 20_000 + slot, name, count, optionsWithIndex: [] })),
            skills: [
                { name: 'Mining', level: o.mining ?? 80, baseLevel: o.mining ?? 80, experience: 0 },
                { name: 'Prayer', level: o.prayer ?? 98, baseLevel: o.prayer ?? 98, experience: 0 },
                { name: 'Defence', level: 1, baseLevel: 1, experience: 0 }, { name: 'Hitpoints', level: 10, baseLevel: 10, experience: 0 }, { name: 'Magic', level: 59, baseLevel: 59, experience: 0 },
            ],
            nearbyPlayers: o.partner ? ([{ index: 9, name: 'p_h4m', x: 2606, z: 3234, level: 3 }] as unknown as BotWorldState['nearbyPlayers']) : [],
        });
    };

    test('s07PrayerTo absent or 99: the chain is the same, with no H4m load and no bury step; a manifest carrying H4m refuses', () => {
        const today = buildChain(CONFIG, { cues: recorder().cues });
        expect(shape(buildChain({ ...CONFIG, s07PrayerTo: 99 }, { cues: recorder().cues }))).toEqual(shape(today));
        expect(s09(today)).toEqual(['H4p: H4p hand-off', 'S09: mining.iron-63', 'S09: mining.exit']);
        expect(today.filter(s => /H4m|mining\.bury/.test(`${s.id} ${s.name}`))).toEqual([]);
        // the ledger in force carries no H4m row, so nothing changes until main rules it in (rs/158)
        expect(MANIFEST_TEXT).not.toContain('| H4m.1-H4m.');
        expect(() => buildChain(CONFIG, { cues: recorder().cues, manifest: WITH_H4M })).toThrow(/carry H4m \(10 loads for the carrier\), but the run config's s07PrayerTo is 99/);
        expect(chainPartners(CONFIG, today)).toBe(CONFIG.partners);
    });

    test('s07PrayerTo 98: S07 closes at 98; at the zoo H4p, then each load and its bury step, then the band to 99 and the exit', () => {
        const c = build();
        expect(s09(c)).toEqual(['H4p: H4p hand-off', ...LOADS.flatMap((row, i) => [`${row}: ${row} hand-off`, `S09: mining.bury: load ${i + 1}`]), 'S09: mining.iron-63', 'S09: mining.exit']);
        for (const row of LOADS) {
            const s = c.find(x => x.id === row)!;
            expect([s.kind, s.cue]).toEqual(['handoff', { step: row, family: 'mule' }]);
        }
        // one carrier: only its last row stops final, so it stands on between loads
        expect(LOADS.map(row => c.find(x => x.id === row)!.finalStop)).toEqual([...Array(9).fill(false), true]);
        // the delivery preflight's partners: every load is H4m's carrier
        const partners = chainPartners(H4M, c);
        expect(LOADS.map(row => partners[row])).toEqual(Array(10).fill('p_h4m'));
        expect(partners.H4p).toBe(PARTNERS.H4p);
        // S07's willow band closes at 98
        const willow = c.find(s => s.id === 'S07' && s.name === 'woodcutting:willow-73-99')!;
        const wc = (prayer: number) => baseState({
            player: { worldX: 2920, worldZ: 3406 } as PlayerState,
            skills: [{ name: 'Woodcutting', level: 99, baseLevel: 99, experience: 0 }, { name: 'Prayer', level: prayer, baseLevel: prayer, experience: 0 }],
            inventory: ['Rune axe', 'Knife', 'Logs'].map((name, slot) => ({ slot, id: 100 + slot, name, count: 1, optionsWithIndex: [] })),
        });
        expect(willow.postconditions(wc(98), {})).toBe(true);
        // the bury steps' lap and drop level
        const all = mining.steps({ ...S09_MINING, bury: mining.BIG_BONES, buryLoads: 10, buryPrayerTo: 99 });
        expect(all.filter(s => s.name.startsWith('mining.bury')).length).toBe(10);
    });

    test('the chain refuses: s07PrayerTo below 94, loads that cannot reach 99 from its floor, no H4m row, no carrier, no hand-off record', () => {
        expect(() => build({ ...H4M, s07PrayerTo: 93 })).toThrow("s07PrayerTo 93 < 94: S09's combat 43 needs Prayer 94 (rs/360)");
        // 10 x 20 x 15 = 3,000 base: 98's floor (37,263.00) to 99 (39,938.32) is 2,675.32, 179 bones; 97's needs 345
        expect(H4M_MIN_PRAYER).toBe(94);
        expect(() => build({ ...H4M, s07PrayerTo: 97 })).toThrow('H4m: 10 loads of 20 big bones bring 3000.00 base, and from Prayer 97\'s floor (34766.80 base) to 99 (39938.32) needs 5171.52: 345 bones');
        expect(() => build({ ...H4M, s07PrayerTo: 94 })).toThrow(/needs 11701\.48: 781 bones/);
        expect(() => build(H4M, { manifest: WITH_H4M.replace('H4m.1-H4m.10', 'H4m.1-H4m.8') })).toThrow(/8 loads of 20 big bones bring 2400\.00 base.*179 bones/);
        expect(build(H4M, { manifest: WITH_H4M.replace('H4m.1-H4m.10', 'H4m.1-H4m.9') }).filter(s => s.name.startsWith('mining.bury')).length).toBe(9);
        expect(() => build(H4M, { manifest: MANIFEST_TEXT })).toThrow("s07PrayerTo 98 leaves Prayer 99 to S09's H4m loads, and STEP-MANIFEST.md's fallback hand-offs have no H4m row");
        expect(() => build({ ...H4M, partners: PARTNERS })).toThrow('names no partner for H4m');
        expect(() => buildChain(H4M, { cues: recorder().cues, manifest: WITH_H4M })).toThrow(/hand-off record/);
        expect(() => build(H4M, { manifest: WITH_H4M.replace('big bones @532 x20 [u]', 'babydragon bones @534 x20 [u]') })).toThrow(/must receive only big bones @532/);
        expect([BIG_BONE_BASE, S09_PRAYER_TO, H4M_ROW]).toEqual([15, 99, 'H4m']);
    });

    test("a load: room for 20 is its precondition, not the carrier in view; it opens its own mule cue fresh (the carrier's readiness), walks onto the east stay, then waits for the carrier", async () => {
        const r = recorder();
        const c = buildChain(H4M, { cues: r.cues, manifest: WITH_H4M, handOffs: record() });
        const load = c.find(s => s.id === 'H4m.1')!;
        expect(load.preconditions(zoo(), {})).toBe(true);
        // 24 free less 20 is S09's 4; with 5 more items held the load does not fit
        expect(load.preconditions(zoo({ extra: 5 }), {})).toBe('H4m.1: 19 free slots, 0 freed by what it gives: the trade adds 20, 1 short');
        const walks: Array<[number, number, number]> = [];
        const sdk = new FakeSdk(zoo());
        const ctx = { ...ctxFor(sdk), bot: { walkTo: async (x: number, z: number, tol: number) => (walks.push([x, z, tol]), sdk.push({ player: { ...sdk.state!.player!, worldX: x, worldZ: z } }), { success: true, message: '' }) } } as unknown as StepContext<unknown>;
        await expect(load.run(ctx)).rejects.toThrow('did not come into sight');
        expect(r.opened[0]).toEqual({ scope: { step: 'H4m.1', family: 'mule' }, fresh: true });
        expect(walks).toEqual([[H4M_TRADE_TILE.x, H4M_TRADE_TILE.z, 0]]);
        expect(H4M_TRADE_TILE).toEqual({ x: 2605, z: 3234 });
        expect(sdk.sent.filter(a => a.method === 'sendTradeRequest')).toEqual([]);
        // a failed load's stop is not final: the carrier stays for the retry
        expect(r.finals.at(-1)).toBe(false);
        // already on the stay: no walk
        walks.length = 0;
        const there = new FakeSdk(zoo({ x: 2605, z: 3234 }));
        await expect(load.run({ ...ctx, sdk: there, session: { ...ctx.session, sdk: there } } as StepContext<unknown>)).rejects.toThrow('did not come into sight');
        expect(walks).toEqual([]);
    });

    test("the last bury step carries the chain's Prayer 99; the booth fallback stays behind it", () => {
        const c = build();
        const last = c.find(s => s.name === 'mining.bury: load 10')!;
        expect(last.postconditions(zoo({ prayer: 99 }), {})).toBe(true);
        expect(last.postconditions(zoo({ prayer: 98 }), {})).toBe("Prayer 98 < 99 after H4m's 10 loads (S07 closed at 98): the chain's Prayer 99");
        expect(last.postconditions(zoo({ prayer: 99, bones: 3 }), {})).toBe('3 bones (^big bones$) still held');
        // the points do not count: a drained Prayer 99 is 99
        const drained = zoo({ prayer: 99 });
        drained.skills = drained.skills.map(k => (k.name === 'Prayer' ? { ...k, level: 60 } : k));
        expect(last.postconditions(drained, {})).toBe(true);
        expect(c.find(s => s.name === 'mining.bury: load 9')!.postconditions(zoo({ prayer: 98 }), {})).toBe(true);
        expect(c.filter(s => s.id === 'S25b-fallback').length).toBe(1);
    });

    test('resume: the record tells the load steps apart; Prayer 99 walks past the loads left', async () => {
        const h = record();
        for (const row of ['H4p', 'H4m.1', 'H4m.2', 'H4m.3']) h.mark(row, 100);
        const full = buildChain(H4M, { cues: recorder().cues, manifest: WITH_H4M, handOffs: h });
        const slice = full.slice(full.findIndex(s => s.id === 'H4p'), full.findIndex(s => s.id === 'T09-10'));
        const where = async (s: BotWorldState) => {
            const p = await resolveResume(slice, new Observation(s), {});
            return [p.step, p.mode];
        };
        // load 3's bones half buried: its step resumes
        expect(await where(zoo({ bones: 12 }))).toEqual(['mining.bury: load 3', 'resume']);
        // load 3's buried, load 4 not yet traded: load 3's step runs (a 0-tick pass), then H4m.4
        expect(await where(zoo())).toEqual(['mining.bury: load 3', 'run']);
        // Prayer 99: every bury step is done, the loads left are superseded, the band resumes
        expect(await where(zoo({ prayer: 99 }))).toEqual(['mining.iron-63', 'resume']);
        // every load recorded and none held: the band resumes
        for (const row of LOADS) h.mark(row, 200);
        expect(await where(zoo())).toEqual(['mining.iron-63', 'resume']);
    });
});
