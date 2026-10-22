import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import type { BotWorldState } from '../../sdk/types';
import { baseState, FakeSdk, flush, runToggleServer } from '../lib/fake-sdk';
import { IF_RUN_ON, runIsOn } from '../lib/run-mode';
import { TickLog } from '../lib/ticks';
import { onTutorialIsland } from '../lib/world';
import type { StepContext } from '../runner/step';
import { IDLE_TICKS } from '../lib/wait';
import { CHOICE_TICKS, LANDING_IDLE_TICKS, LUMBRIDGE_SPAWN, PLAYER_KIT, REPLY_TICKS, TALK_TICKS, tutorialSkip } from './start';

const prevTick = process.env.SPEEDRUN_TICK_MS;
beforeAll(() => { process.env.SPEEDRUN_TICK_MS = '5'; });
afterAll(() => { if (prevTick === undefined) delete process.env.SPEEDRUN_TICK_MS; else process.env.SPEEDRUN_TICK_MS = prevTick; });

const KIT = ['Bronze axe', 'Tinderbox', 'Small fishing net', 'Shrimps', 'Bronze pickaxe'].map((name, slot) => ({ slot, id: slot, name, count: 1, optionsWithIndex: [] }));
const guide = { kind: 'npc', index: 7, name: 'RuneScape Guide', optionsWithIndex: [{ text: 'Talk-to', opIndex: 1 }], options: ['Talk-to'] };
const cont = { isOpen: true, isWaiting: false, pageId: 'p1', options: [{ index: 0, text: 'Click here to continue' }] };
const choice = (yes: string) => ({ isOpen: true, isWaiting: false, pageId: 'p2', options: [{ index: 1, text: yes, buttonType: 1 }, { index: 2, text: 'No, thank you.', buttonType: 1 }] });

/**
 * A fresh account in the design screen, and a server that answers the way the content does.
 * `landAfterMs`: how long the tab stays silent after "Yes please." (the region rebuild) before it
 * publishes the landing as the next tick; null never lands.
 */
class TutorialSdk extends FakeSdk {
    /** `drop`: how many of the first talk / continue clicks the engine never answers. */
    constructor(private readonly offer: string, landAfterMs: number | null = 1, drop: { talk?: number; cont?: number; cantReach?: boolean } = {}) {
        super(baseState({ tick: 3, player: { worldX: 3094, worldZ: 3106 } as BotWorldState['player'], modalOpen: true, modalInterface: PLAYER_KIT, nearbyNpcs: [guide] as unknown as BotWorldState['nearbyNpcs'] }));
        let talks = drop.talk ?? 0;
        let conts = drop.cont ?? 0;
        this.onSend = (a, sdk) => {
            if (a.method === 'sendInteractNpc' && talks-- > 0) {
                // The engine's refusal when the guide steps off the tile next to the player that tick.
                if (drop.cantReach) {
                    const tick = sdk.getState()!.tick;
                    setTimeout(() => sdk.tick(s => ({ gameMessages: [...s.gameMessages, { type: 0, text: "I can't reach that!", sender: '', tick, fromSelf: false }] })), 1);
                }
                return;
            }
            if (a.method === 'sendClickDialog' && conts-- > 0) return;
            if (a.method === 'sendInteractNpc') setTimeout(() => sdk.tick({ modalOpen: false, modalInterface: -1, dialog: cont as BotWorldState['dialog'] }), 1);
            if (a.method === 'sendClickDialog') setTimeout(() => sdk.tick({ dialog: choice(this.offer) as BotWorldState['dialog'] }), 1);
            if (a.method === 'clickDialogByText' && landAfterMs !== null) setTimeout(() => sdk.tick({ dialog: { isOpen: false, options: [], isWaiting: false }, player: { worldX: LUMBRIDGE_SPAWN.x, worldZ: LUMBRIDGE_SPAWN.z } as BotWorldState['player'], inventory: KIT as BotWorldState['inventory'] }), landAfterMs);
        };
    }
    sendAcceptCharacterDesign() { return this.sendAction({ method: 'sendAcceptCharacterDesign', args: [] }); }
    sendInteractNpc(i: number, op: number) { return this.sendAction({ method: 'sendInteractNpc', args: [i, op] }); }
    override clickDialogByText(p: string | RegExp) { return this.sendAction({ method: 'clickDialogByText', args: [p] }); }
}

const ctx = (sdk: FakeSdk, log = TickLog.memory('t')) => ({ sdk, bot: {}, session: { sdk }, c: {}, log }) as unknown as StepContext<unknown>;

/** Run `p` with the server ticking every 2 ms, as it does while a dropped click goes unanswered. */
async function ticking<T>(sdk: FakeSdk, p: () => Promise<T>): Promise<T> {
    const ticker = setInterval(() => sdk.tick(), 2);
    try {
        return await p();
    } finally {
        clearInterval(ticker);
    }
}

/**
 * Run `p` at a nominal tick length of `ms`. S00 puts a click's server tick at the later of the tick
 * the client executed it and the wall time since its first state over the tick length; at 50 ms the
 * wall-time side never passes these fakes' 1-2 ms ticks, so the observed ticks alone decide.
 */
async function atTickMs<T>(ms: number, p: () => Promise<T>): Promise<T> {
    const prev = process.env.SPEEDRUN_TICK_MS;
    process.env.SPEEDRUN_TICK_MS = String(ms);
    try {
        return await p();
    } finally {
        process.env.SPEEDRUN_TICK_MS = prev;
    }
}

const sentMethods = (sdk: FakeSdk) => sdk.sent.map(s => s.method).filter(m => m !== 'sendClickComponent');

describe('S00 tutorial skip', () => {
    test('accepts the design, talks, continues once and takes "Yes please.": three server round trips', async () => {
        const sdk = new TutorialSdk('Yes please.');
        expect(tutorialSkip.preconditions(sdk.getState()!, {})).toBe(true);
        await tutorialSkip.run(ctx(sdk));
        expect(sdk.sent.map(s => s.method)).toEqual(['sendAcceptCharacterDesign', 'sendInteractNpc', 'sendClickDialog', 'clickDialogByText']);
        expect(sdk.getState()!.tick).toBe(6);
        expect(tutorialSkip.postconditions(sdk.getState()!, {})).toBe(true);
        expect(tutorialSkip.done!({ state: sdk.getState()!, probed: {} }, {})).toBe(true);
    });

    test('a first Talk-to the server drops (the browser still building the region) is re-sent once it draws no reply', async () => {
        const sdk = new TutorialSdk('Yes please.');
        const content = sdk.onSend;
        let talks = 0;
        sdk.onSend = (a, s) => {
            if (a.method === 'sendInteractNpc' && ++talks === 1) return;
            content(a, s);
        };
        const run = tutorialSkip.run(ctx(sdk));
        for (let i = 0; i < 6 && talks < 2; i++) {
            await flush();
            sdk.tick();
        }
        await run;
        expect(sdk.sent.filter(a => a.method === 'sendInteractNpc')).toHaveLength(2);
        expect(tutorialSkip.postconditions(sdk.getState()!, {})).toBe(true);
    });

    test('turns run on once it lands: no login could, the controls tab is hidden on the island', async () => {
        const sdk = new TutorialSdk('Yes please.');
        sdk.push({ varps: { option_run: 0 } });
        const content = sdk.onSend;
        const serve = runToggleServer(sdk);
        sdk.onSend = (a, s) => { content(a, s); serve(a); };
        const log = TickLog.memory('t');
        await tutorialSkip.run(ctx(sdk, log));
        expect(sdk.sent.map(s => s.method)).toEqual(['sendAcceptCharacterDesign', 'sendInteractNpc', 'sendClickDialog', 'clickDialogByText', 'sendClickComponent']);
        expect(sdk.sent.at(-1)!.args).toEqual([IF_RUN_ON]);
        expect(runIsOn(sdk.getState())).toBe(true);
        expect(tutorialSkip.postconditions(sdk.getState()!, {})).toBe(true);
        expect(log.rows.filter(r => r.step === 'S00:run').map(r => r.meta)).toEqual([{ on: true, presses: 1 }]);
    });

    test('a run toggle that will not take is logged and warned, and the skip still succeeds', async () => {
        const sdk = new TutorialSdk('Yes please.');
        sdk.push({ varps: { option_run: 0 } });
        const content = sdk.onSend;
        const serve = runToggleServer(sdk, { ignore: Infinity });
        sdk.onSend = (a, s) => { content(a, s); serve(a); };
        const ticker = setInterval(() => sdk.tick(), 2);
        const warn = spyOn(console, 'warn').mockImplementation(() => {});
        const log = TickLog.memory('t');
        let warnings = 0;
        try {
            await tutorialSkip.run(ctx(sdk, log));
            warnings = warn.mock.calls.length;
        } finally {
            clearInterval(ticker);
            warn.mockRestore();
        }
        const notes = log.rows.filter(r => r.step === 'S00:run').map(r => r.meta);
        expect(notes).toHaveLength(1);
        expect(notes[0]).toMatchObject({ on: false, presses: 2 });
        expect(String(notes[0]?.reason)).toContain('run did not turn on');
        expect(warnings).toBe(1);
        expect(tutorialSkip.postconditions(sdk.getState()!, {})).toBe(true);
    });

    test('a tab silent through the region rebuild, past 8 ticks and IDLE_TICKS of wall time, is not yet: it lands', async () => {
        const silentMs = 3 * IDLE_TICKS * 5;
        const sdk = new TutorialSdk('Yes please.', silentMs);
        const t0 = Date.now();
        await tutorialSkip.run(ctx(sdk));
        expect(Date.now() - t0).toBeGreaterThanOrEqual(silentMs);
        expect(sdk.getState()!.tick).toBe(6);
        expect(tutorialSkip.postconditions(sdk.getState()!, {})).toBe(true);
    });

    test('a tab that never lands fails after LANDING_IDLE_TICKS, naming the last tick, the position and the silence', async () => {
        const sdk = new TutorialSdk('Yes please.', null);
        const t0 = Date.now();
        const err = await tutorialSkip.run(ctx(sdk)).then(() => null, (e: Error) => e);
        expect(Date.now() - t0).toBeGreaterThanOrEqual(LANDING_IDLE_TICKS * 5);
        expect(err?.message).toMatch(
            new RegExp(`^not at Lumbridge with the starter kit after the skip \\(the tab stayed silent past ${LANDING_IDLE_TICKS} ticks, 0\\.5 s\\): last state tick 5 \\(choice page at 5\\), at 3094,3106 without the kit, silent 0\\.\\d s$`)
        );
    });

    test('a dropped talk is sent once more REPLY_TICKS after it executed, logged, and the skip goes on', async () => {
        const sdk = new TutorialSdk('Yes please.', 1, { talk: 1 });
        const log = TickLog.memory('t');
        await atTickMs(50, () => ticking(sdk, () => tutorialSkip.run(ctx(sdk, log))));
        expect(sentMethods(sdk)).toEqual(['sendAcceptCharacterDesign', 'sendInteractNpc', 'sendInteractNpc', 'sendClickDialog', 'clickDialogByText']);
        expect(tutorialSkip.postconditions(sdk.getState()!, {})).toBe(true);
        const notes = log.rows.filter(r => r.step === 'S00:resend').map(r => r.meta);
        expect(notes).toEqual([{ click: 'talk', resends: 1, clicks: `sent 3, executed 3 (ok); sent ${3 + REPLY_TICKS}, executed ${3 + REPLY_TICKS} (ok)` }]);
    });

    test('two dropped talks fail after TALK_TICKS with every click and the last state in the message', async () => {
        const sdk = new TutorialSdk('Yes please.', 1, { talk: 2 });
        const err = await atTickMs(50, () => ticking(sdk, () => tutorialSkip.run(ctx(sdk)).then(() => null, (e: Error) => e)));
        expect(sentMethods(sdk)).toEqual(['sendAcceptCharacterDesign', 'sendInteractNpc', 'sendInteractNpc']);
        expect(err?.message).toBe(
            `the guide did not answer within ${TALK_TICKS} ticks of the click: 2 clicks (sent 3, executed 3 (ok); sent 7, executed 7 (ok)); ` +
            `last state tick 16 at 3094,3106, no page, modal ${PLAYER_KIT}`
        );
    });

    test('a dropped continue is sent once more and the choice page is answered', async () => {
        const sdk = new TutorialSdk('Yes please.', 1, { cont: 1 });
        const log = TickLog.memory('t');
        await atTickMs(50, () => ticking(sdk, () => tutorialSkip.run(ctx(sdk, log))));
        expect(sentMethods(sdk)).toEqual(['sendAcceptCharacterDesign', 'sendInteractNpc', 'sendClickDialog', 'sendClickDialog', 'clickDialogByText']);
        expect(tutorialSkip.postconditions(sdk.getState()!, {})).toBe(true);
        expect(log.rows.filter(r => r.step === 'S00:resend').map(r => r.meta?.click)).toEqual(['continue']);
    });

    test('a talk refused with "I can\'t reach that!" is sent once more on the next tick', async () => {
        const sdk = new TutorialSdk('Yes please.', 1, { talk: 1, cantReach: true });
        const log = TickLog.memory('t');
        await atTickMs(50, () => ticking(sdk, () => tutorialSkip.run(ctx(sdk, log))));
        expect(sentMethods(sdk)).toEqual(['sendAcceptCharacterDesign', 'sendInteractNpc', 'sendInteractNpc', 'sendClickDialog', 'clickDialogByText']);
        expect(log.rows.filter(r => r.step === 'S00:resend').map(r => r.meta?.clicks)).toEqual(['sent 3, executed 3 (ok); sent 4, executed 4 (ok)']);
        expect(tutorialSkip.postconditions(sdk.getState()!, {})).toBe(true);
    });

    test('a tab far behind the server: the reply bound counts from the server tick the click reached, not its execution', async () => {
        // As at 30x throttle: the continue executes while the tab is ~10 ticks behind the server, and
        // the choice page comes once the tab has decoded that far, 9 observed ticks after execution.
        await atTickMs(20, async () => {
            const sdk = new TutorialSdk('Yes please.');
            const content = sdk.onSend;
            sdk.onSend = (a, s) => { if (a.method !== 'sendClickDialog') content(a, s); };
            sdk.sendClickDialog = (...args: unknown[]) => {
                sdk.sent.push({ method: 'sendClickDialog', args });
                return (async () => {
                    // ~10 server ticks of wall time pass while the tab decodes two.
                    await Bun.sleep(100); sdk.tick();
                    await Bun.sleep(110); sdk.tick();
                    setTimeout(async () => {
                        for (let i = 0; i < 8; i++) { await Bun.sleep(1); sdk.tick(); }
                        sdk.tick({ dialog: choice('Yes please.') as BotWorldState['dialog'] });
                    }, 1);
                    return { success: true, message: 'ok' };
                })();
            };
            const log = TickLog.memory('t');
            await tutorialSkip.run(ctx(sdk, log));
            expect(sentMethods(sdk)).toEqual(['sendAcceptCharacterDesign', 'sendInteractNpc', 'sendClickDialog', 'clickDialogByText']);
            expect(log.rows.filter(r => r.step === 'S00:resend')).toHaveLength(0);
            expect(tutorialSkip.postconditions(sdk.getState()!, {})).toBe(true);
        });
    });

    test('a lagging tab that executes the continue 8 ticks after it was sent is waited for, never re-sent', async () => {
        // As measured with the tab throttled 14x from login: the client decodes a backlog of ticks before
        // it runs the queued click, and the choice page comes 2 ticks after the click executed.
        const sdk = new TutorialSdk('Yes please.');
        const content = sdk.onSend;
        sdk.onSend = (a, s) => { if (a.method !== 'sendClickDialog') content(a, s); };
        let sentAt = -1;
        sdk.sendClickDialog = (...args: unknown[]) => {
            sdk.sent.push({ method: 'sendClickDialog', args });
            sentAt = sdk.getState()!.tick;
            return (async () => {
                for (let i = 0; i < 8; i++) { await Bun.sleep(1); sdk.tick(); }
                setTimeout(() => sdk.tick(), 1);
                setTimeout(() => sdk.tick({ dialog: choice('Yes please.') as BotWorldState['dialog'] }), 3);
                return { success: true, message: 'ok' };
            })();
        };
        const log = TickLog.memory('t');
        await tutorialSkip.run(ctx(sdk, log));
        expect(sentMethods(sdk)).toEqual(['sendAcceptCharacterDesign', 'sendInteractNpc', 'sendClickDialog', 'clickDialogByText']);
        expect(log.rows.filter(r => r.step === 'S00:resend')).toHaveLength(0);
        expect(sentAt).toBe(4);
        // The landing is 1 tick after the choice page, which was 10 ticks after the send: past the old 6-tick bound.
        expect(sdk.getState()!.tick).toBeGreaterThan(sentAt + CHOICE_TICKS + 1);
        expect(tutorialSkip.postconditions(sdk.getState()!, {})).toBe(true);
    });

    test('stops when the skip is not offered', async () => {
        const sdk = new TutorialSdk('Tell me more.');
        await expect(tutorialSkip.run(ctx(sdk))).rejects.toThrow('the skip is not offered');
        await flush();
        expect(sdk.sent.map(s => s.method)).not.toContain('clickDialogByText');
    });

    test('an account off the island has already done S00', () => {
        const s = baseState({ player: { worldX: 3222, worldZ: 3222 } as BotWorldState['player'] });
        expect(tutorialSkip.preconditions(s, {})).toContain('not on Tutorial Island');
        expect(onTutorialIsland({ worldX: 3094, worldZ: 3106 })).toBe(true);
        expect(onTutorialIsland({ worldX: 3100, worldZ: 9500 })).toBe(true);
        expect(onTutorialIsland({ worldX: 3222, worldZ: 3222 })).toBe(false);
    });
});
