// rs/511: the resume walk after a drop never re-picks the S03 go cue, the S14/S27 cue stops or the
// S21 relog's halves once they ran, and never runs a marker ahead of the unfinished step before it.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { BotWorldState, PlayerState } from '../../sdk/types';
import type { CueScope } from '../helpers/altar-cue';
import { GO_FILE } from '../helpers/fm-row';
import { baseState, FakeSdk } from '../lib/fake-sdk';
import { TickLog } from '../lib/ticks';
import { buildChain, cueStop, dropperGoCue, isCueStop, KIT_PARTNER_ROWS, PLACEMENT, tag, type ChainStep, type CueSink, type RunConfig } from './chain';
import { RunCues } from './cue-keeper';
import { RelogBudget } from './relog-budget';
import { Observation, ResumeError, resolveResume } from './resume';
import { SCORED_RELOG, scoredLoginStep, scoredLogoutStep } from './scored-relog';
import type { RunnerSession, Step, StepContext } from './step';

const prevTick = process.env.SPEEDRUN_TICK_MS;
beforeAll(() => { process.env.SPEEDRUN_TICK_MS = '5'; });
afterAll(() => { if (prevTick === undefined) delete process.env.SPEEDRUN_TICK_MS; else process.env.SPEEDRUN_TICK_MS = prevTick; });

const x = (s: BotWorldState) => s.player?.x ?? 0;
const at = (px: number, extra: Partial<BotWorldState> = {}) => baseState({ tick: 10, inGame: true, player: { name: 'lab', x: px, z: 0, worldX: px, worldZ: 0, level: 0 } as PlayerState, ...extra });
const walk = (s: readonly Step<unknown>[], state: BotWorldState) => resolveResume(s, new Observation(state, {}, {} as RunnerSession), {});
const ctxOf = (sdk: FakeSdk, log = TickLog.memory('m')) => ({ session: { name: 'lab', sessionId: 1 }, sdk, bot: {}, c: {}, log }) as unknown as StepContext<unknown>;

/** A milestone done when `doneAt` holds. */
const milestone = (name: string, doneAt: (s: BotWorldState) => boolean, pre: (s: BotWorldState) => true | string = () => 'cannot start'): ChainStep =>
    tag(name, 'step', { name, logoutSafe: true, preconditions: pre, postconditions: () => true, run: async () => {}, done: o => doneAt(o.state) });
/** A leg from x=a to x=b: in progress strictly between, can start at a, finished at b. */
const leg = (name: string, a: number, b: number): ChainStep =>
    tag(name, 'leg', {
        name, logoutSafe: true, run: async () => {},
        preconditions: s => x(s) === a || `not at ${a}`, postconditions: s => x(s) === b || `not at ${b}`,
        inProgress: o => x(o.state) > a && x(o.state) < b,
    });

describe('the S03 go cue', () => {
    test('done once the go file is there; a resume walks past it and a second run never rewrites it', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'go-cue-'));
        const go = dropperGoCue(dir);
        // H1's trade cut by the drop: its partner gone, so it cannot start.
        const chain = [milestone('S00', () => true), go, milestone('S01 H1', () => false, () => 'partner not in view')];
        expect(go.done!({ state: at(0), probed: {} }, {})).toBe(false);
        expect((await walk(chain, at(0))).step).toBe('S03 dropper go cue');
        await go.run(ctxOf(new FakeSdk()));
        const first = readFileSync(join(dir, GO_FILE), 'utf8');
        // Before rs/511 the walk fell back to the go cue here (preconditions () => true) and rewrote it.
        const e = await walk(chain, at(0)).catch(err => err);
        expect(e).toBeInstanceOf(ResumeError);
        expect((e as ResumeError).candidates.map(c => c.step)).toEqual(['S01 H1']);
        await new Promise(r => setTimeout(r, 5));
        await go.run(ctxOf(new FakeSdk()));
        expect(readFileSync(join(dir, GO_FILE), 'utf8')).toBe(first);
    });
});

describe('the S14 and S27 cue stops', () => {
    const s14: CueScope = { step: 'S14', family: 'cannon' };
    const s27: CueScope = { step: 'S27', family: 'cannon' };
    const same = (a: CueScope, b: CueScope) => a.step === b.step && a.family === b.family;

    /** A cue sink whose one open scope the test sets (the keeper's isOpen: owned and not terminally closed). */
    function sink(open: CueScope | null) {
        const state = { open, stops: [] as string[] };
        const cues = {
            stop: (scope: CueScope) => {
                if (state.open && same(state.open, scope)) {
                    state.stops.push(scope.step);
                    state.open = null;
                }
            },
            isOpen: (scope: CueScope) => !!state.open && same(state.open, scope),
        } as unknown as CueSink;
        return { cues, state };
    }

    /** S14, T14-15a (x 0 to 10), the S14 stop, T14-15b (x 10 to 20), S15 (done at x 20). */
    const chainOf = (cues: CueSink) => [milestone('S14', () => true), leg('T14-15a', 0, 10), cueStop(s14, cues), leg('T14-15b', 10, 20), milestone('S15', s => x(s) >= 20)];

    test('a drop mid leg a resumes leg a, not the stop (a plain done would have stopped the cue and skipped the leg)', async () => {
        const p = await walk(chainOf(sink(s14).cues), at(5));
        expect([p.step, p.mode]).toEqual(['T14-15a', 'resume']);
    });

    test('at the end of leg a with the cue still open: the stop, then leg b', async () => {
        const p = await walk(chainOf(sink(s14).cues), at(10));
        expect([p.step, p.mode]).toEqual(['S14 cannon cue stop', 'run']);
    });

    test('after the stop, a drop mid leg b resumes leg b and never writes a late stop', async () => {
        const { cues, state } = sink(s14);
        const chain = chainOf(cues);
        await chain[2]!.run(ctxOf(new FakeSdk()));
        expect(state.stops).toEqual(['S14']);
        const p = await walk(chain, at(15));
        expect([p.step, p.mode, p.lastDone]).toEqual(['T14-15b', 'resume', 2]);
    });

    test("once a later scope's session is open (S27), the S14 stop is done and the walk never reaches it", async () => {
        const { cues, state } = sink(s27);
        const chain = [milestone('S14', () => true), leg('T14-15a', 0, 10), cueStop(s14, cues), leg('T14-15b', 10, 20), milestone('S27', () => false, () => 'not yet')];
        expect((await walk(chain, at(15))).step).toBe('T14-15b');
        expect(chain[2]!.done!({ state: at(15), probed: {} }, {})).toBe(true);
        expect(state.open).toEqual(s27);
    });

    test('a sink without isOpen leaves the stop without a done (the old behaviour), still a marker', async () => {
        const stop = cueStop(s14, { stop: () => {} } as unknown as CueSink);
        expect(stop.done).toBeUndefined();
        expect(stop.marker).toBe(true);
    });
});

describe("the S21 relog's halves (rs/523's split) in the resume walk", () => {
    function halves(dir: string) {
        const budget = new RelogBudget(dir);
        const opts = { budget, beforeLogin: async () => {} };
        return { budget, logout: tag('S21', 'step', scoredLogoutStep(opts)) as ChainStep, login: tag('S21', 'step', scoredLoginStep(opts)) as ChainStep };
    }

    test('once the relog is closed in the budget, a drop in the band walks past both halves: no second relog', async () => {
        const { budget, logout, login } = halves(mkdtempSync(join(tmpdir(), 's21-closed-')));
        budget.beginPlanned(SCORED_RELOG, 4_210, { sends: 1, confirmTicks: 0 });
        budget.endPlanned(SCORED_RELOG, 'page', { wallMs: 1_800 });
        const band = milestone('S21 runecraft', () => false, () => 'givers not in view');
        const e = await walk([milestone('S20', () => true), logout, milestone('S21 runecraft:pre-login', () => true), login, band], at(0)).catch(err => err);
        expect(e).toBeInstanceOf(ResumeError);
        expect((e as ResumeError).candidates.map(c => c.step)).toEqual(['S21 runecraft']);
        expect(budget.used()).toEqual({ planned: 1, unplanned: 0 });
    });

    test('between the halves the logout is done and the login is the one to run', async () => {
        const { budget, logout, login } = halves(mkdtempSync(join(tmpdir(), 's21-open-')));
        budget.beginPlanned(SCORED_RELOG, 4_210);
        expect(logout.done!({ state: at(0), probed: {} }, {})).toBe(true);
        expect(login.done!({ state: at(0), probed: {} }, {})).toBe(false);
        const p = await walk([milestone('S20', () => true), logout, milestone('S21 runecraft:pre-login', () => true), login, milestone('S21 runecraft', () => false)], at(0));
        expect(p.step).toBe(login.name);
    });
});

describe('the built chain after a crash-restart', () => {
    // The resume walk's forward pass takes each `done` in order and passes steps without one, and a
    // fresh process's RunCues has no scope open, so every cue stop reads done there. A done-less step
    // between a band and its stop would be walked past.
    test('every cue stop with a done directly follows a step with its own done', () => {
        const d = mkdtempSync(join(tmpdir(), 'markers-chain-'));
        try {
            const partners = Object.fromEntries([...Object.keys(PLACEMENT), ...KIT_PARTNER_ROWS].map(id => [id, 'p_' + id.toLowerCase()]));
            const cfg: RunConfig = { partners, firemakingTiles: '3240,3296;3239,3296;3238,3296', rings: { giver: 'ring_giver' }, bones: { giver: 'bone_giver' }, courier: { giver: 'courier', below: 3 }, anvil: { giver: 'anvil_helper' }, cueDir: d };
            const chain = buildChain(cfg, { cues: new RunCues({ main: d, mule: join(d, 'mule') }, 'Scored') });
            const stops = chain.flatMap((s, i) => (isCueStop(s) && s.done ? [i] : []));
            expect(stops.length).toBeGreaterThanOrEqual(5);
            for (const i of stops) expect(chain[i]!.done!({ state: at(0), probed: {} }, {})).toBe(true);
            expect(stops.filter(i => !chain[i - 1]?.done).map(i => chain[i - 1]?.name + ' before ' + chain[i]!.name)).toEqual([]);
        } finally {
            rmSync(d, { recursive: true, force: true });
        }
    });
});
