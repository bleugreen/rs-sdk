import { describe, expect, test } from 'bun:test';
import type { BotWorldState } from '../sdk/types';
import { feedTicks, frameStats, isPlumbing, mergeTrace, parseStack, pickSite, schedule, serverTickAt, StateDiff, tickGaps, xpGained, type RawAction } from './trace';

const ROOT = '/repo';
// A real Bun stack from an action sent by the firemaking step loop (paths shortened to /repo).
const STACK = `Error
    at <anonymous> (/repo/film/hook.ts:30:42)
    at sendUseItemOnItem (/repo/sdk/index.ts:1218:21)
    at lightRow (/repo/speedrun/skills/firemaking.ts:963:34)
    at async runIt (/repo/speedrun/skills/firemaking.ts:1043:15)
    at async runSteps (/repo/speedrun/runner/step.ts:290:13)
    at /repo/film/run-steps.ts:41:21
    at asyncModuleEvaluation (native:2)`;

describe('stacks', () => {
    test('parses Bun frames, async frames and anonymous frames; skips native ones', () => {
        const f = parseStack(STACK, ROOT);
        expect(f.map(x => `${x.fn}@${x.file}:${x.line}`)).toEqual([
            '<anonymous>@film/hook.ts:30',
            'sendUseItemOnItem@sdk/index.ts:1218',
            'lightRow@speedrun/skills/firemaking.ts:963',
            'runIt@speedrun/skills/firemaking.ts:1043',
            'runSteps@speedrun/runner/step.ts:290',
            'null@film/run-steps.ts:41'
        ]);
        expect(f[2]!.col).toBe(34);
    });

    test('keeps a path outside the root absolute', () => {
        expect(parseStack('    at x (/elsewhere/a.ts:1:2)', ROOT)[0]!.file).toBe('/elsewhere/a.ts');
    });

    test('the site is the first frame outside the SDK and this package', () => {
        const f = parseStack(STACK, ROOT);
        expect(f.filter(isPlumbing).map(x => x.file)).toEqual(['film/hook.ts', 'sdk/index.ts', 'film/run-steps.ts']);
        expect(pickSite(f)).toEqual({ file: 'speedrun/skills/firemaking.ts', line: 963, col: 34, fn: 'lightRow', site: 'caller' });
    });

    test('a frame in the filmed script wins over a library frame nearer the SDK', () => {
        const f = parseStack(`Error
    at sendWalk (/repo/sdk/index.ts:1155:21)
    at walkTo (/repo/speedrun/lib/act.ts:40:9)
    at async main (/repo/bots/demo/script.ts:12:5)`, ROOT);
        expect(pickSite(f, 'bots/demo/script.ts')).toMatchObject({ file: 'bots/demo/script.ts', line: 12, site: 'script' });
        expect(pickSite(f)).toMatchObject({ file: 'speedrun/lib/act.ts', line: 40, site: 'caller' });
        expect(pickSite(parseStack('    at sendWalk (/repo/sdk/index.ts:1:1)', ROOT)).site).toBe('none');
    });
});

describe('the frame schedule', () => {
    test('each output frame shows the latest capture at or before it', () => {
        // Captures at 0, 30, 90, 95 ms; 25 fps output frames start at 0, 40, 80, 120.
        expect(schedule([0, 30, 90, 95], 25, 0, 120)).toEqual([0, 1, 1, 3]);
        expect(schedule([10, 50], 25, 0, 40)).toEqual([0, 0]);
        expect(schedule([], 25, 0, 100)).toEqual([]);
    });

    test('stats report capture gaps and how stale each shown frame is', () => {
        const s = frameStats([0, 40, 80, 200], 25, 0, 200);
        expect(s.intervalMs.max).toBe(120);
        expect(s.staleMs.max).toBe(80); // output frame at 160 still shows the capture from 80
        expect(s.captureFps).toBe(15);
    });
});

describe('the clock', () => {
    const ticks = [{ rx: 1000, k: 10 }, { rx: 1400, k: 11 }, { rx: 1800, k: 12 }, { rx: 2600, k: 14 }];

    test('the server tick at a time is the latest received at or before it', () => {
        expect(serverTickAt(ticks, 999)).toBeNull();
        expect(serverTickAt(ticks, 1000)).toBe(10);
        expect(serverTickAt(ticks, 1799)).toBe(11);
        expect(serverTickAt(ticks, 9999)).toBe(14);
    });

    test('tick gaps count only consecutive ticks', () => {
        expect(tickGaps(ticks)).toEqual([400, 400]);
    });

    test('reads tick frames from recorder lines', () => {
        const text = ['{"recv":5,"frame":{"t":"hello","v":1}}', '{"recv":6,"sent":{"t":"sub","x":1}}', '{"recv":7,"frame":{"t":"tick","k":3,"ms":400}}', ''].join('\n');
        expect(feedTicks(text)).toEqual([{ rx: 7, k: 3 }]);
    });

    test('merges actions and observed events onto the video clock', () => {
        const action: RawAction = { ms: 1500, clientTick: 7, bot: 'b', action: 'useItemOnItem', args: { type: 'useItemOnItem' }, file: 'x.ts', line: 3, col: 1, fn: null, site: 'caller', stack: [] };
        const early: RawAction = { ...action, ms: 900 };
        const trace = mergeTrace([action, early], [
            { kind: 'start', ms: 800, clientTick: 5, x: 1, z: 2, plane: 0, skills: {} },
            { kind: 'chat', ms: 1450, clientTick: 7, type: 0, sender: '', text: 'hi' }
        ], ticks, 1000, 3000);
        expect(trace.map(e => [e.kind, e.videoMs, e.tick])).toEqual([['start', 0, 10], ['chat', 450, 11], ['action', 500, 11]]);
    });
});

function state(tick: number, o: { x?: number; xp?: number; level?: number; msgs?: string[] } = {}): BotWorldState {
    return {
        tick,
        inGame: true,
        player: { worldX: o.x ?? 3000, worldZ: 3300, level: 0, animId: -1 },
        skills: [{ name: 'Firemaking', level: o.level ?? 80, baseLevel: o.level ?? 80, experience: o.xp ?? 1000 }],
        // A message keeps the tick it arrived on; these all arrived on tick 1.
        gameMessages: (o.msgs ?? []).map(text => ({ type: 0, text, sender: '', tick: 1, fromSelf: false }))
    } as unknown as BotWorldState;
}

describe('StateDiff', () => {
    test('opens with the start state, then a tile per new tick, xp and level changes, and new messages once', () => {
        const d = new StateDiff();
        expect(d.next(state(1, { msgs: ['old'] }), 0)).toEqual([{ kind: 'start', ms: 0, clientTick: 1, x: 3000, z: 3300, plane: 0, skills: { Firemaking: { level: 80, xp: 1000 } } }]);
        // Same tick republished: nothing new.
        expect(d.next(state(1, { msgs: ['old'] }), 10)).toEqual([]);
        const e = d.next(state(2, { x: 2999, xp: 1304, level: 81, msgs: ['old', 'The fire catches.'] }), 400);
        expect(e.map(x => x.kind)).toEqual(['pos', 'xp', 'level', 'chat']);
        expect(e[1]).toMatchObject({ skill: 'Firemaking', delta: 304, level: 81 });
        expect(e[3]).toMatchObject({ text: 'The fire catches.' });
        // The same message lit again is a new message (two copies now).
        const again = d.next(state(3, { x: 2998, xp: 1304, level: 81, msgs: ['old', 'The fire catches.', 'The fire catches.'] }), 800);
        expect(again.filter(x => x.kind === 'chat')).toHaveLength(1);
        expect(xpGained([...e, ...again, { kind: 'start', ms: 0, clientTick: 1, x: 0, z: 0, plane: 0, skills: { Firemaking: { level: 80, xp: 1000 } } }])).toEqual({ Firemaking: 304 });
    });

    test('ignores states out of the game', () => {
        expect(new StateDiff().next({ ...state(1), inGame: false } as BotWorldState, 0)).toEqual([]);
    });
});
