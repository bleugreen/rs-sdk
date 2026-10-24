// A session takeover lands mid-fight: a dropped player stays in the world for 500 ticks, and a
// relogin inside that window is the same player on the same tile with the fight still on. The
// walk must not re-enter a logoutSafe:false step from the top there (runner/resume.ts).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { BotWorldState, PlayerState } from '../../sdk/types';
import { baseState, FakeSdk } from '../lib/fake-sdk';
import { TickLog } from '../lib/ticks';
import { COMBAT_LOGOUT_TICKS, inCombatWindow } from '../lib/world';
import { cannonSessionStep, combatFinishStep } from '../skills/ranged';
import { steps as fightArenaSteps } from '../quests/fight-arena';
import { steps as fishingContestSteps } from '../quests/fishing-contest';
import { steps as grandTreeSteps } from '../quests/grand-tree';
import { steps as mageArenaSteps } from '../quests/mage-arena';
import { steps as mmSteps } from '../quests/monkey-madness';
import { steps as tgvSteps } from '../quests/tree-gnome-village';
import { MidStepError, Observation, RESUME_STEP, ResumeError, resolveResume, runResumable, type Link, type MidStepHold, type ResumePoint } from './resume';
import type { RunnerSession, Step, StepContext } from './step';

const prevTick = process.env.SPEEDRUN_TICK_MS;
beforeAll(() => { process.env.SPEEDRUN_TICK_MS = '5'; });
afterAll(() => { if (prevTick === undefined) delete process.env.SPEEDRUN_TICK_MS; else process.env.SPEEDRUN_TICK_MS = prevTick; });

// A toy fight over a toy world: enter the arena (x=30), win the fight (Stage 0 -> 1), leave (x=0).
type C = { trace: string[] };
const ARENA = 30;
const stage = (s: BotWorldState) => s.skills.find(k => k.name === 'Stage')?.baseLevel ?? 0;
const x = (s: BotWorldState) => s.player?.x ?? 0;
const stageSkill = (n: number) => [{ name: 'Stage', level: n, baseLevel: n, experience: 0 }];

type Fight = { engaged: boolean; hitAgo: number | null };
const NO_FIGHT: Fight = { engaged: false, hitAgo: null };
const combatOf = (tick: number, f: Fight) => ({ inCombat: f.engaged, lastDamageTick: f.hitAgo === null ? -1 : tick - f.hitAgo, targetIndex: -1, targetType: f.engaged ? 'npc' : 'none' });
function world(o: { x: number; stage?: number; tick?: number; fight?: Fight }): Partial<BotWorldState> {
    const tick = o.tick ?? 100;
    return {
        tick, inGame: true, skills: stageSkill(o.stage ?? 0),
        player: { name: 'lab', x: o.x, z: 0, worldX: o.x, worldZ: 0, level: 0, combat: combatOf(tick, o.fight ?? NO_FIGHT) } as unknown as PlayerState,
    };
}
const moveTo = (s: BotWorldState, px: number): Partial<BotWorldState> => ({ player: { ...s.player!, x: px, worldX: px } });
const withCombat = (s: BotWorldState, c: Partial<ReturnType<typeof combatOf>>): Partial<BotWorldState> => ({ player: { ...s.player!, combat: { ...s.player!.combat!, ...c } } as PlayerState });

interface Shape {
    /** 'arena': in progress whenever in the arena (Mage Arena C's shape); 'combat': in the arena and in the combat window. */
    inProgress?: 'arena' | 'combat';
    resume?: boolean;
    logoutSafe?: boolean;
    startsInCombat?: boolean;
    /** Every step logoutSafe (the equivalence grid). */
    allSafe?: boolean;
    /** A 0-tick marker between the fight and the exit. */
    marker?: boolean;
}

function manifest(shape: Shape = {}): Step<C>[] {
    const fake = (ctx: StepContext<C>) => ctx.sdk as unknown as FakeSdk;
    const fightEntry = (label: string) => async (ctx: StepContext<C>) => {
        ctx.c.trace.push(`${label}${inCombatWindow(ctx.sdk.getState()) ? ' (in combat)' : ''}`);
        fake(ctx).push({ skills: stageSkill(1) });
    };
    const inProgress = shape.inProgress === 'arena'
        ? { inProgress: (o: { state: BotWorldState }) => x(o.state) === ARENA && stage(o.state) < 1 }
        : shape.inProgress === 'combat'
          ? { inProgress: (o: { state: BotWorldState }) => x(o.state) === ARENA && stage(o.state) < 1 && inCombatWindow(o.state) }
          : {};
    const steps: Step<C>[] = [
        {
            name: 'enter', logoutSafe: true, preconditions: s => x(s) < ARENA || 'already in the arena', postconditions: s => x(s) === ARENA || 'not in the arena',
            run: async ctx => { ctx.c.trace.push('enter'); fake(ctx).push(s => moveTo(s, ARENA)); },
        },
        {
            name: 'fight', logoutSafe: shape.allSafe || (shape.logoutSafe ?? false),
            preconditions: s => x(s) === ARENA || 'not in the arena', postconditions: s => stage(s) >= 1 || 'not won',
            run: fightEntry('fight:run'), done: o => stage(o.state) >= 1,
            ...inProgress,
            ...(shape.resume ? { resume: fightEntry('fight:resume') } : {}),
            ...(shape.startsInCombat ? { startsInCombat: true as const } : {}),
        },
        ...(shape.marker ? [{ name: 'cue', marker: true as const, logoutSafe: shape.allSafe ?? false, preconditions: () => true as const, postconditions: () => true as const, run: async (ctx: StepContext<C>) => void ctx.c.trace.push('cue') }] : []),
        {
            name: 'leave', logoutSafe: true, preconditions: s => stage(s) >= 1 || 'not won', postconditions: s => x(s) === 0 || 'still in the arena',
            run: async ctx => { ctx.c.trace.push('leave'); fake(ctx).push(s => moveTo(s, 0)); },
            done: o => stage(o.state) >= 1 && x(o.state) === 0,
        },
    ];
    return steps;
}

const observe = (w: Partial<BotWorldState>) => new Observation(baseState(w), {}, {} as RunnerSession);
const c = (): C => ({ trace: [] });
const takeover = (fight: Fight = { engaged: true, hitAgo: 1 }) => world({ x: ARENA, fight });

describe('resolveResume on a takeover that lands mid-fight', () => {
    test('a resume hook whose inProgress holds is entered through resume, in combat as out of it', async () => {
        const p = await resolveResume(manifest({ inProgress: 'combat', resume: true }), observe(takeover()), c());
        expect([p.step, p.mode]).toEqual(['fight', 'resume']);
    });

    test('no hook, preconditions hold, in combat: a MidStepError at the fight, not run from the top and not the walk back to enter', async () => {
        const err = await resolveResume(manifest(), observe(takeover()), c()).catch(e => e);
        expect(err).toBeInstanceOf(MidStepError);
        expect(err).toBeInstanceOf(ResumeError);
        const m = err as MidStepError;
        expect([m.step, m.index, m.combat]).toEqual(['fight', 1, true]);
        expect(m.message).toBe(`fight cannot be re-entered mid-step (logoutSafe: false): in combat (engaged, hit 1 ticks ago; the window ends ${COMBAT_LOGOUT_TICKS} ticks after the last hit)`);
        expect(m.candidates).toEqual([{ step: 'fight', why: m.why }]);
    });

    test('the combat window is the server logout rule: hit within 16 ticks or engaged holds, past 16 and disengaged runs', async () => {
        for (const [fight, held] of [
            [{ engaged: false, hitAgo: COMBAT_LOGOUT_TICKS }, true],
            [{ engaged: true, hitAgo: null }, true],
            [{ engaged: false, hitAgo: COMBAT_LOGOUT_TICKS + 1 }, false],
            [NO_FIGHT, false],
        ] as const) {
            const r = await resolveResume(manifest(), observe(takeover(fight)), c()).catch(e => e);
            if (held) expect(r).toBeInstanceOf(MidStepError);
            else expect([(r as ResumePoint).step, (r as ResumePoint).mode]).toEqual(['fight', 'run']);
        }
    });

    test("Mage Arena C's shape (inProgress, no resume) refuses in or out of combat; only the combat case may wait", async () => {
        const inFight = await resolveResume(manifest({ inProgress: 'arena' }), observe(takeover()), c()).catch(e => e);
        expect(inFight).toBeInstanceOf(MidStepError);
        expect((inFight as MidStepError).combat).toBe(true);
        expect((inFight as MidStepError).why).toBe('in progress with no resume entry, and run would restart it from the top');
        const quiet = await resolveResume(manifest({ inProgress: 'arena' }), observe(takeover(NO_FIGHT)), c()).catch(e => e);
        expect(quiet).toBeInstanceOf(MidStepError);
        expect((quiet as MidStepError).combat).toBe(false);
    });

    test('startsInCombat, markers and logoutSafe steps are not held for combat', async () => {
        expect((await resolveResume(manifest({ startsInCombat: true }), observe(takeover()), c())).mode).toBe('run');
        expect((await resolveResume(manifest({ logoutSafe: true }), observe(takeover()), c())).mode).toBe('run');
        // Fight won, still in the arena and in its window: the marker after it is entered as before.
        const p = await resolveResume(manifest({ marker: true }), observe(world({ x: ARENA, stage: 1, fight: { engaged: false, hitAgo: 2 } })), c());
        expect([p.step, p.mode]).toEqual(['leave', 'run']);
    });

    test("S14 and S27 (cannon set up among aggressive spiders) declare startsInCombat", () => {
        expect(cannonSessionStep().startsInCombat).toBe(true);
        expect(combatFinishStep().startsInCombat).toBe(true);
    });

    /**
     * What a takeover that lands in combat does at each logout-unsafe step of the chain modules, its
     * preconditions holding (rs/186's table; the quest rows reviewed by rs/185). Before the rule every
     * row was 'run from the top' (through `resume` mode where inProgress held, which defaulted to run).
     * - resume: inProgress holds and a resume entry is named (MM E's is its own run);
     * - run: its run picks up the fight (startsInCombat), never held;
     * - hold: held until the combat window ends (refused at once on a new hit, or at the bound);
     * - refuse: in progress with no resume entry, refused after any hold (none in the chain today; the
     *   toy manifest's Mage-Arena-C shape above keeps the path tested).
     */
    const TAKEOVER: Record<string, 'resume' | 'run' | 'hold' | 'refuse'> = {
        'S10b:M-bolren-orbs': 'hold',
        'S11b:N1-trapdoor': 'run',
        'S12:F-jeremy': 'hold', 'S12:G-ogre': 'run', 'S12:H-scorpion': 'run', 'S12:I-bouncer': 'run', 'S12:J-arena-door': 'run',
        'S14 cannon session': 'resume',
        'S15:E-hangar': 'resume', 'S15:G-lumdo': 'run', 'S15:Q-greegree': 'run', 'S15:W-sigil': 'hold', 'S15:X-demon': 'run',
        'S16:B-kolodion': 'hold', 'S16:C-fight': 'resume',
        'S20:H-gate': 'hold', 'S20:I-bonzo-enter': 'hold', 'S20:J-garlic-pipe': 'hold', 'S20:K-carp': 'hold',
        'S27 combat finish': 'resume',
    };
    test('the takeover table: every logout-unsafe step of the chain modules, classified', () => {
        const all = [...tgvSteps(), ...grandTreeSteps(), ...fightArenaSteps(), cannonSessionStep(), ...mmSteps(), ...mageArenaSteps(), ...fishingContestSteps(), combatFinishStep()];
        const got = Object.fromEntries(all.filter(s => !s.logoutSafe).map(s => [s.name, s.inProgress ? (s.resume ? 'resume' : 'refuse') : s.startsInCombat ? 'run' : 'hold']));
        expect(got).toEqual(TAKEOVER);
        // S14 and S27 resume when in progress and run in combat otherwise (the cannon among the spiders).
        expect([cannonSessionStep().startsInCombat, combatFinishStep().startsInCombat]).toEqual([true, true]);
        // Monkey Madness E re-enters through its own run, as it did before the rule.
        const e = mmSteps().find(s => s.name.startsWith('S15:E-'))!;
        expect(e.resume).toBe(e.run);
    });
});

/** A client that ticks every 2 ms, `each` patching every tick; its link never drops. */
function ticking(start: Partial<BotWorldState>, each: (s: BotWorldState) => Partial<BotWorldState> = () => ({})) {
    const sdk = new FakeSdk(baseState(start));
    const session = { sdk, bot: {}, name: 'lab', sessionId: 1 } as unknown as RunnerSession;
    const timer = setInterval(() => sdk.tick(each), 2);
    const link: Link = {
        isLost: () => false,
        lost: signal => new Promise(res => signal.addEventListener('abort', () => res('stopped watching'))),
        restored: async () => {},
    };
    return { sdk, session, link, stop: () => clearInterval(timer) };
}

const holdOf = (log: TickLog) => log.rows.find(r => r.step === RESUME_STEP)?.meta?.hold as MidStepHold | undefined;

describe('runResumable on a takeover that lands mid-fight', () => {
    const run = (client: ReturnType<typeof ticking>, steps: Step<C>[], ctx: C, log: TickLog, extra: { midStepHoldTicks?: number } = {}) =>
        runResumable(client.session, steps, { log, c: ctx, link: client.link, shouldStop: () => false, ...extra });

    test('resume hook: entered at once through resume, no hold', async () => {
        const client = ticking(world({ x: ARENA, fight: { engaged: true, hitAgo: 0 } }));
        const ctx = c();
        const log = TickLog.memory('t');
        await run(client, manifest({ inProgress: 'combat', resume: true }), ctx, log);
        client.stop();
        expect(ctx.trace).toEqual(['fight:resume (in combat)', 'leave']);
        expect(holdOf(log)).toBeUndefined();
    });

    test('wait then resolve: the fight disengages, the walk waits out the window, then runs the fight from the top out of combat', async () => {
        const client = ticking(world({ x: ARENA, tick: 100, fight: { engaged: true, hitAgo: 0 } }), s => (s.tick >= 105 && s.player!.combat!.inCombat ? withCombat(s, { inCombat: false }) : {}));
        const ctx = c();
        const log = TickLog.memory('t');
        await run(client, manifest(), ctx, log);
        client.stop();
        expect(ctx.trace).toEqual(['fight:run', 'leave']);
        const hold = holdOf(log)!;
        expect(hold.step).toBe('fight');
        expect(hold.why).toMatch(/^in combat \(engaged, hit \d+ ticks ago/);
        expect(hold.ticks).toBeGreaterThanOrEqual(COMBAT_LOGOUT_TICKS);
    });

    test('wait then resolve: auto-retaliate wins the fight during the hold, so the walk goes on past it', async () => {
        const client = ticking(world({ x: ARENA, tick: 100, fight: { engaged: true, hitAgo: 0 } }), s =>
            s.tick === 108 ? { ...withCombat(s, { inCombat: false }), skills: stageSkill(1) } : {});
        const ctx = c();
        const log = TickLog.memory('t');
        const r = await run(client, manifest(), ctx, log);
        client.stop();
        expect(ctx.trace).toEqual(['leave']);
        expect(r.points.map(p => [p.step, p.mode])).toEqual([['leave', 'run']]);
        expect(holdOf(log)?.step).toBe('fight');
    });

    test('refuse at once: SCORED is hit again during the hold, so the run stops on that tick, not at the bound; nothing ran', async () => {
        // Hit every 3 ticks: the attacker is still attacking.
        const client = ticking(world({ x: ARENA, tick: 100, fight: { engaged: true, hitAgo: 0 } }), s => (s.tick % 3 === 2 ? withCombat(s, { inCombat: true, lastDamageTick: s.tick + 1 }) : {}));
        const ctx = c();
        const err = await run(client, manifest(), ctx, TickLog.memory('t')).catch(e => e);
        client.stop();
        expect(err).toBeInstanceOf(MidStepError);
        expect(err).toBeInstanceOf(ResumeError);
        expect((err as Error).message).toMatch(/^fight cannot be re-entered mid-step \(logoutSafe: false\): in combat \(engaged, hit 0 ticks ago; .*\): hit again \d ticks into the hold, so something is still attacking$/);
        expect(client.sdk.getState()!.tick).toBeLessThan(100 + 12);
        expect(ctx.trace).toEqual([]);
    });

    test('refuse at the bound: engaged with no new hit (a fight under a protect prayer, say) past midStepHoldTicks', async () => {
        const client = ticking(world({ x: ARENA, fight: { engaged: true, hitAgo: 0 } }));
        const ctx = c();
        const err = await run(client, manifest(), ctx, TickLog.memory('t'), { midStepHoldTicks: 8 }).catch(e => e);
        client.stop();
        expect(err).toBeInstanceOf(MidStepError);
        expect((err as Error).message).toMatch(/^fight cannot be re-entered mid-step \(logoutSafe: false\): in combat \(engaged, hit \d+ ticks ago; .*\) after a 8-tick wait for the fight to end$/);
        expect(ctx.trace).toEqual([]);
    });

    test("Mage Arena C's shape: the hold ends, the step is still in progress with no resume entry, so the run refuses and run is never called", async () => {
        const client = ticking(world({ x: ARENA, tick: 100, fight: { engaged: true, hitAgo: 0 } }), s => (s.tick >= 103 && s.player!.combat!.inCombat ? withCombat(s, { inCombat: false }) : {}));
        const ctx = c();
        const err = await run(client, manifest({ inProgress: 'arena' }), ctx, TickLog.memory('t')).catch(e => e);
        client.stop();
        expect(err).toBeInstanceOf(MidStepError);
        expect((err as MidStepError).combat).toBe(false);
        expect((err as Error).message).toBe('fight cannot be re-entered mid-step (logoutSafe: false): in progress with no resume entry, and run would restart it from the top');
        expect(ctx.trace).toEqual([]);
        expect(client.sdk.getState()!.tick).toBeGreaterThan(100 + COMBAT_LOGOUT_TICKS);
    });
});

// ------------------------------------------------------------ off the new path, nothing changed

/** resolveResume as it was before the logoutSafe:false rule (runner/resume.ts at 1a1fe3af), verbatim. */
async function resolveBefore<Ctx>(steps: ReadonlyArray<Step<Ctx>>, obs: Observation, cx: Ctx): Promise<Omit<ResumePoint, 'observed'>> {
    let lastDone = -1;
    let firstUndone = steps.length;
    for (let i = 0; i < steps.length; i++) {
        const s = steps[i]!;
        if (!s.done) continue;
        await obs.ensure(s.probes);
        if (s.done(obs, cx)) lastDone = i;
        else {
            firstUndone = i;
            break;
        }
    }
    const point = (index: number, mode: ResumePoint['mode'], reason: string) => ({ index, mode, step: steps[index]?.name ?? null, lastDone, firstUndone, reason });
    const top = Math.min(firstUndone, steps.length - 1);
    if (top <= lastDone) return point(steps.length, 'finished', 'every milestone is done');
    const why: { step: string; why: string }[] = [];
    for (let j = top; j > lastDone; j--) {
        const s = steps[j]!;
        await obs.ensure(s.probes);
        if (s.inProgress?.(obs, cx)) return point(j, 'resume', `${s.name} is in progress`);
        const pre = s.preconditions(obs.state, cx);
        if (pre === true && !s.marker) return point(j, 'run', `${s.name} can start`);
        const at = pre === true ? await markerBefore(steps, j, obs, cx) : pre;
        if (at === true) return point(j, 'run', `${s.name} can start`);
        why.push({ step: s.name, why: at });
    }
    throw new ResumeError(why, lastDone, firstUndone);
}

async function markerBefore<Ctx>(steps: ReadonlyArray<Step<Ctx>>, j: number, obs: Observation, cx: Ctx): Promise<true | string> {
    const prev = steps[j - 1];
    const next = steps[j + 1];
    if (!prev || !next) return true;
    await obs.ensure(prev.probes);
    if (prev.postconditions(obs.state, cx) === true && !prev.inProgress?.(obs, cx)) return true;
    await obs.ensure(next.probes);
    if (next.inProgress?.(obs, cx) || next.preconditions(obs.state, cx) === true) return true;
    return `a marker: ${prev.name} has not finished and ${next.name} cannot start`;
}

const outcome = (p: Promise<Omit<ResumePoint, 'observed'> | ResumePoint>) =>
    p.then(({ index, mode, step, lastDone, firstUndone, reason }) => ({ index, mode, step, lastDone, firstUndone, reason }), (e: unknown) => ({ error: (e as Error).message }));

describe('every step off the new path resolves exactly as before', () => {
    const fights: Fight[] = [NO_FIGHT, { engaged: true, hitAgo: 0 }, { engaged: false, hitAgo: 5 }, { engaged: false, hitAgo: COMBAT_LOGOUT_TICKS + 4 }, { engaged: true, hitAgo: null }];
    const states = [0, ARENA, 50].flatMap(px => [0, 1].flatMap(st => fights.map(f => world({ x: px, stage: st, fight: f }))));
    const shapes: Shape[] = [{}, { inProgress: 'arena' }, { inProgress: 'combat' }, { inProgress: 'arena', resume: true }, { inProgress: 'combat', resume: true }, { marker: true }, { marker: true, inProgress: 'arena' }];

    test(`logoutSafe:true everywhere: ${shapes.length} manifests x ${states.length} states, in and out of combat, identical to the old walk`, async () => {
        let compared = 0;
        for (const shape of shapes) {
            const steps = manifest({ ...shape, allSafe: true });
            for (const w of states) {
                expect(await outcome(resolveResume(steps, observe(w), c()))).toEqual(await outcome(resolveBefore(steps, observe(w), c())));
                compared++;
            }
        }
        expect(compared).toBe(shapes.length * states.length);
    });

    test('logoutSafe:false out of the combat window, with a resume entry wherever inProgress is declared: identical to the old walk', async () => {
        const quiet = states.filter(w => !inCombatWindow(baseState(w)));
        expect(quiet.length).toBeGreaterThan(0);
        for (const shape of shapes.filter(s => !s.inProgress || s.resume)) {
            const steps = manifest(shape);
            for (const w of quiet) expect(await outcome(resolveResume(steps, observe(w), c()))).toEqual(await outcome(resolveBefore(steps, observe(w), c())));
        }
    });

    test('the real S14 and S27 steps, in combat at their site, resolve as before (startsInCombat)', async () => {
        for (const step of [cannonSessionStep(), combatFinishStep()]) {
            for (const f of fights) {
                const w = { ...world({ x: 3000, fight: f }) };
                expect(await outcome(resolveResume([step], observe(w), {}))).toEqual(await outcome(resolveBefore([step], observe(w), {})));
            }
        }
    });
});
