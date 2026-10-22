import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { DialogState } from '../../../sdk/types';
import type { ConverseResult } from '../../lib/converse';
import { baseState, FakeSdk, flush } from '../../lib/fake-sdk';
import { LOGOUT_BUTTON, type Session } from '../../lib/session';
import type { DialogueMode } from '../../quests/segments';
import {
    AERECK_CHOICES, answerSteps, assertNoQuestChoice, checkTarget, confirmedLogout, formatSummary, QUEST_OPTION, summarize, talkAereck, talkLoop, talkOrder, type Talk, type TalkSdk,
} from './aereck-burst';

const prevTick = process.env.SPEEDRUN_TICK_MS;
beforeAll(() => { process.env.SPEEDRUN_TICK_MS = '5'; });
afterAll(() => { if (prevTick === undefined) delete process.env.SPEEDRUN_TICK_MS; else process.env.SPEEDRUN_TICK_MS = prevTick; });

const words = (text: string) => [{ id: 0, type: 4, buttonType: 0, option: '', text }];
const cont = (pageId: string): DialogState => ({
    isOpen: true, isWaiting: false, pageId, options: [{ index: 1, text: 'Click here to continue', buttonType: 6, componentId: 10 }], allComponents: words(pageId),
});
const choice = (pageId: string, ...opts: string[]): DialogState => ({
    isOpen: true, isWaiting: false, pageId, options: opts.map((text, i) => ({ index: i + 1, text, buttonType: 1, componentId: 20 + i })),
});
const closed: DialogState = { isOpen: false, options: [], isWaiting: false };
const conts = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => cont(`${prefix}${i + 1}`));

const WELCOME = choice('m1', "Who's Saradomin?", "Nice place you've got here.", QUEST_OPTION);
/** father_aereck.rs2's default branch, page for page. */
const branch = () => [
    cont('welcome'), WELCOME, ...conts('s', 5),
    choice('m2', 'Oh, THAT Saradomin...', "Oh, sorry. I'm not from this world."), ...conts('w', 4),
    choice('m3', "You don't understand. This is a computer game!", 'I am - do you like my disguise?'), ...conts('g', 3),
];

const aereck = { index: 7, name: 'Father Aereck', x: 3244, z: 3206, optionsWithIndex: [{ text: 'Talk-to', opIndex: 1 }] };

/**
 * Father Aereck on a ticking server: a talk click opens `pages`, dialogue clicks queue and each
 * tick applies up to 5 (the engine's cap); a continue that reaches a choice page is dropped.
 */
function aereckServer(sdk: FakeSdk, pages: () => DialogState[]) {
    let cur: DialogState[] = [];
    let i = 0;
    const owed: Array<'continue' | 'option'> = [];
    sdk.onSend = a => {
        if (a.method === 'sendInteractNpc') {
            cur = pages();
            i = 0;
            owed.length = 0;
            owed.push('open' as never);
        } else if (a.method === 'sendClickDialog') owed.push('continue');
        else if (a.method === 'clickDialogByText') owed.push(/continue/i.test(String(a.args[0])) ? 'continue' : 'option');
    };
    let opening = false;
    return {
        async run(ticks: number) {
            for (let t = 0; t < ticks; t++) {
                await flush();
                await flush();
                if ((owed[0] as string) === 'open') {
                    owed.shift();
                    opening = true;
                    sdk.tick({ dialog: cur[0]! });
                    continue;
                }
                for (let n = 0; n < 5 && owed.length && opening; n++) {
                    const kind = owed.shift()!;
                    const page = cur[i];
                    if (!page) continue;
                    if (kind === 'continue' && page.options.some(o => o.buttonType === 1)) continue;
                    i++;
                }
                sdk.tick({ dialog: opening ? (cur[i] ?? closed) : closed });
                if (!cur[i]) opening = false;
            }
        },
    };
}

function aereckSdk() {
    return new FakeSdk(baseState({ tick: 1, player: { worldX: 3243, worldZ: 3208, x: 3243, z: 3208, level: 0 } as never, nearbyNpcs: [aereck as never] }));
}

async function talkOnServer(mode: 'fixed' | 'burst', pages = branch, choices = AERECK_CHOICES) {
    const sdk = aereckSdk();
    const srv = aereckServer(sdk, pages);
    const p = talkAereck(sdk as unknown as TalkSdk, mode, choices);
    let settled = false;
    p.then(() => { settled = true; }, () => { settled = true; });
    for (let t = 0; t < 80 && !settled; t++) await srv.run(1);
    return { sdk, r: await p };
}

describe('talkOrder', () => {
    test('fixed and burst interleaved, fixed first, 8 of each in 16', () => {
        const o = talkOrder(16);
        expect(o).toEqual(['fixed', 'burst', 'fixed', 'burst', 'fixed', 'burst', 'fixed', 'burst', 'fixed', 'burst', 'fixed', 'burst', 'fixed', 'burst', 'fixed', 'burst']);
        expect(o.filter(m => m === 'fixed').length).toBe(8);
        expect(() => talkOrder(15)).toThrow(/even/);
        expect(() => talkOrder(0)).toThrow(/even/);
    });

    test('talkLoop holds the talks in that order and stops at the first failed one', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1 }));
        const seen: DialogueMode[] = [];
        const ok = { ok: true, opened: true } as ConverseResult;
        const all = await talkLoop(sdk as unknown as TalkSdk, talkOrder(4), { talk: async (_s, m) => (seen.push(m), ok) });
        expect(seen).toEqual(['fixed', 'burst', 'fixed', 'burst']);
        expect(all.stopped).toBeUndefined();
        expect(all.talks.map(t => t.mode)).toEqual(seen);

        let n = 0;
        const short = await talkLoop(sdk as unknown as TalkSdk, talkOrder(6), { talk: async () => (++n === 3 ? { ok: false, opened: true, reason: 'timeout' } as ConverseResult : ok) });
        expect(short.talks.length).toBe(3);
        expect(short.stopped).toMatch(/talk 3 \(fixed\) failed: timeout/);
    });

    test('talkLoop stops once its tick budget is spent', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1 }));
        const r = await talkLoop(sdk as unknown as TalkSdk, talkOrder(16), { budgetTicks: 50, talk: async () => (sdk.tick({ tick: sdk.state!.tick + 20 }), { ok: true, opened: true } as ConverseResult) });
        expect(r.talks.length).toBe(3);
        expect(r.stopped).toMatch(/tick budget 50 spent after 3 talks/);
    });
});

describe('talkAereck on the scripted branch', () => {
    test('fixed: every page in the shape, the three choices in order', async () => {
        const { r } = await talkOnServer('fixed');
        expect(r).toMatchObject({ ok: true, pages: 13, options: 3 });
        expect(r.shape).toMatchObject({ matches: true, seen: '1c, opt, 5c, opt, 4c, opt, 3c', bursts: 0 });
        expect(r.transcript.filter(l => / > /.test(l)).map(l => l.replace(/^\[\d+\] > /, ''))).toEqual(AERECK_CHOICES.map(String));
    });

    test('burst: the 5, 4 and 3 page runs go blind, and it is faster', async () => {
        const fixed = (await talkOnServer('fixed')).r;
        const { r } = await talkOnServer('burst');
        expect(r).toMatchObject({ ok: true, pages: 13, options: 3 });
        expect(r.shape).toMatchObject({ matches: true, bursts: 3, failedBursts: 0, burstPages: 12, stepPages: 1 });
        expect(r.ticks).toBeLessThan(fixed.ticks);
    });

    test('never takes the quest option: a welcome menu without our choice stops the talk unclicked', async () => {
        const pages = () => [cont('welcome'), choice('m1', "Nice place you've got here.", QUEST_OPTION)];
        const { sdk, r } = await talkOnServer('fixed', pages);
        expect(r.ok).toBe(false);
        expect(r.reason).toMatch(/no choice for/);
        expect(sdk.sent.filter(s => s.method === 'clickDialogByText' && !/continue/i.test(String(s.args[0])))).toEqual([]);
    });

    test('refuses choices that could pick the quest option, before any click', async () => {
        expect(() => assertNoQuestChoice(['quest'])).toThrow(/Restless Ghost/);
        expect(() => assertNoQuestChoice([/looking for/i])).toThrow(/refusing choice/);
        expect(() => assertNoQuestChoice(AERECK_CHOICES)).not.toThrow();
        const sdk = aereckSdk();
        await expect(talkAereck(sdk as unknown as TalkSdk, 'fixed', ["Who's Saradomin?", 'a quest'])).rejects.toThrow(/refusing choice/);
        expect(sdk.sent).toEqual([]);
    });
});

const res = (o: Partial<ConverseResult> & { transcript: string[] }): ConverseResult =>
    ({ ok: true, opened: true, pages: 0, options: 0, levelUps: 0, startTick: 0, firstTick: 0, endTick: 0, ticks: 0, remaining: [], ...o }) as ConverseResult;

describe('summary arithmetic', () => {
    test('answerSteps: one step per page or option, a burst as one step, gaps to the next step and to the close', () => {
        const t = ['[10] page: hi', '[11] > Yes', '[13] page: a', '[13] page: (burst 2/3)', '[13] page: (burst 3/3)', '[13] shape: x', '[15] page: last'];
        expect(answerSteps(t, 17)).toEqual([
            { tick: 10, pages: 1, kind: 'page', gap: 1 },
            { tick: 11, pages: 1, kind: 'option', gap: 2 },
            { tick: 13, pages: 3, kind: 'burst', gap: 2 },
            { tick: 15, pages: 1, kind: 'page', gap: 2 },
        ]);
    });

    test('per mode: ticks each and mean, first page to closed, per page, bursts, matches, gaps', () => {
        const shape = (bursts: number, failed: number, matches: boolean) => ({ burst: bursts > 0, burstPages: 0, stepPages: 0, bursts, failedBursts: failed, expected: '', seen: '', matches });
        const talks: Talk[] = [
            { mode: 'fixed', r: res({ startTick: 0, firstTick: 2, endTick: 6, ticks: 6, pages: 3, options: 1, shape: shape(0, 0, true), transcript: ['[2] page: a', '[3] > b', '[4] page: c', '[5] page: d'] }) },
            { mode: 'burst', r: res({ startTick: 10, firstTick: 13, endTick: 16, ticks: 6, pages: 3, options: 1, shape: shape(1, 0, true), transcript: ['[13] page: a', '[14] > b', '[15] page: c', '[15] page: (burst 2/2)'] }) },
            { mode: 'fixed', r: res({ startTick: 20, firstTick: 22, endTick: 30, ticks: 10, pages: 3, options: 1, shape: shape(0, 0, false), transcript: ['[22] page: a', '[24] > b', '[26] page: c', '[28] page: d'] }) },
            { mode: 'burst', r: res({ startTick: 40, firstTick: 41, endTick: 46, ticks: 6, pages: 3, options: 1, shape: shape(1, 1, true), transcript: ['[41] page: a', '[42] > b', '[43] page: c', '[45] page: d'] }) },
        ];
        const f = summarize(talks, 'fixed');
        expect(f).toMatchObject({ n: 2, ticks: [6, 10], meanTicks: 8, dialogueTicks: [4, 8], meanDialogueTicks: 6, answered: [4, 4], perPage: 1.5, bursts: 0, failedBursts: 0, matches: 1 });
        expect(f.gaps).toEqual([1, 1, 1, 1, 2, 2, 2, 2]);
        expect(f.gapCounts).toEqual({ 1: 4, 2: 4 });
        expect(f.meanGap).toBe(1.5);
        expect(f.burstSpans).toEqual([]);
        const b = summarize(talks, 'burst');
        expect(b).toMatchObject({ n: 2, ticks: [6, 6], meanTicks: 6, dialogueTicks: [3, 5], meanDialogueTicks: 4, perPage: 1, bursts: 2, failedBursts: 1, matches: 2 });
        expect(b.gaps).toEqual([1, 1, 1, 1, 2, 1]);
        expect(b.burstSpans).toEqual(['2:1']);
        const table = formatSummary([f, b], 'lab');
        expect(table).toContain('| lab | fixed | 2 | 6, 10 | 8 | 4, 8 | 6 | 1.5 | 0 | 0 | 1/2 | 1t×4, 2t×4 | 1.5 | - |');
        expect(table).toContain('| lab | burst | 2 | 6, 6 | 6 | 3, 5 | 4 | 1 | 2 | 1 | 2/2 | 1t×5, 2t×1 | 1.17 | 2:1 |');
    });
});

describe('confirmedLogout', () => {
    const session = (sdk: FakeSdk) =>
        ({ name: 'throwaway', client: 'lite', child: null, childExit: null, sdk, watchdog: null, expectInWorld: true, lastInWorldTick: 1, env: {} }) as unknown as Session;

    test('returns once the published state leaves the world after the logout click', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1, player: { combat: { inCombat: false, lastDamageTick: -1 } } as never }));
        sdk.onSend = (a, f) => { if (a.method === 'sendClickComponent' && a.args[0] === LOGOUT_BUTTON) queueMicrotask(() => f.push({ inGame: false })); };
        const out = await confirmedLogout(session(sdk), { timeoutMs: 500 });
        expect(out).toMatchObject({ ok: true, confirmedBy: 'state' });
        expect(sdk.sent.filter(s => s.method === 'sendClickComponent').map(s => s.args[0])).toEqual([LOGOUT_BUTTON]);
    });

    test('throws when nothing confirms the logout', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1, player: { combat: { inCombat: false, lastDamageTick: -1 } } as never })) as FakeSdk & { checkBotStatus(): Promise<unknown> };
        sdk.checkBotStatus = async () => ({ status: 'active', inGame: true });
        await expect(confirmedLogout(session(sdk), { timeoutMs: 100 })).rejects.toThrow(/logout not confirmed: still in game/);
    });
});

describe('checkTarget', () => {
    test('--lab only on the local engine; the demo path only off it, never a cairn_* account', () => {
        expect(() => checkTarget({ BOT_USERNAME: 'x', SERVER: 'localhost:9300' }, true)).not.toThrow();
        expect(() => checkTarget({ BOT_USERNAME: 'x', SERVER: 'demo.example' }, true)).toThrow(/local lab/);
        expect(() => checkTarget({ BOT_USERNAME: 'x', SERVER: 'localhost:9300' }, false)).toThrow(/demo world/);
        const lo = { GATEWAY_URL: 'ws://127.0.0.1:7787' };
        expect(() => checkTarget({ BOT_USERNAME: 'cairn_row1', SERVER: 'demo.example', ...lo }, false)).toThrow(/unbranded/);
        expect(() => checkTarget({ BOT_USERNAME: 'quietfern', SERVER: 'demo.example', ...lo }, false)).not.toThrow();
        expect(() => checkTarget({ BOT_USERNAME: 'quietfern', SERVER: 'demo.example' }, false)).toThrow(/loopback gateway/);
        expect(() => checkTarget({ BOT_USERNAME: 'quietfern', SERVER: 'demo.example', GATEWAY_URL: 'wss://demo.example/gateway' }, false)).toThrow(/loopback gateway/);
    });
});
