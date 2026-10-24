import { describe, expect, test } from 'bun:test';
import type { BotWorldState, DialogState, NearbyLoc, NearbyNpc, PlayerState } from '../../sdk/types';
import { converse } from '../lib/converse';
import { baseState, drive, FakeSdk, flush, simulateWalking } from '../lib/fake-sdk';
import { TickLog } from '../lib/ticks';
import type { StepContext } from '../runner/step';
import { COMPLETION_PAGE_TICKS, questMoves } from './small-quest';

const closed: DialogState = { isOpen: false, isWaiting: false, options: [] };
const page = (pageId: string, text: string): DialogState => ({
    isOpen: true, isWaiting: false, pageId,
    options: [{ index: 1, text: 'Click here to continue', buttonType: 6, componentId: 10 }],
    allComponents: [{ id: 0, type: 4, buttonType: 0, option: '', text }],
});
const rewardText = 'Congratulations, you just advanced a Mining level.';
const reward = page('reward', rewardText);
const complete: Partial<BotWorldState> = { quests: { doric: 'complete' } as BotWorldState['quests'] };
const scroll: Partial<BotWorldState> = { modalOpen: true, modalInterface: 277 };
const message = (tick: number) => ({ type: 0, tick, text: rewardText, sender: '', fromSelf: false });
const moves = questMoves('S05');

function fixture(over: Partial<BotWorldState> = {}) {
    const sdk = new FakeSdk(baseState({ tick: 100, ...complete, ...over }));
    const log = TickLog.memory('completion');
    const ctx = { sdk, bot: {}, session: { sdk, name: 'lab', sessionId: 0 }, c: {}, log } as unknown as StepContext<unknown>;
    const clicks: { tick: number; page: string | undefined }[] = [];
    sdk.onSend = (a, f) => {
        if (a.method !== 'clickDialogByText') return;
        const d = f.state!.dialog;
        clicks.push({ tick: f.state!.tick, page: d.pageId });
        queueMicrotask(() => f.push({ dialog: { ...d, isWaiting: true } }));
    };
    return { sdk, ctx, log, clicks };
}

async function finish(f: ReturnType<typeof fixture>, at: Record<number, Partial<BotWorldState>>, levelUp = true, since = 98) {
    await drive(f.sdk, moves.completion(f.ctx, 'C', 'doric', levelUp, since), 40, s => at[s.tick + 1] ?? {});
    return f.sdk.state!.tick;
}

describe('small quest completion', () => {
    test('waits for the quest tab, then a delayed reward; each page is answered once without the full opening timeout', async () => {
        const f = fixture({ quests: { doric: 'started' } as BotWorldState['quests'] });
        const end = await finish(f, {
            101: complete,
            103: { dialog: reward },
            104: { dialog: page('unlock', 'You can now mine Iron.') },
            105: { dialog: closed },
        });
        expect(end).toBe(106);
        expect(f.clicks).toEqual([{ tick: 103, page: 'reward' }, { tick: 104, page: 'unlock' }]);
        expect(f.log.rows.at(-1)?.meta).toMatchObject({ completion: true, levelUps: 2, pages: 0, ticks: 6 });
    });

    test('a quest scroll is not the queued level-up: close it and keep listening for the reward', async () => {
        const f = fixture(scroll);
        const end = await finish(f, {
            101: { modalOpen: false },
            102: { dialog: reward },
            103: { dialog: closed },
        });
        expect(end).toBe(104);
        expect(f.clicks).toEqual([{ tick: 102, page: 'reward' }]);
        expect(f.sdk.sent.filter(a => a.method === 'sendCloseModal')).toHaveLength(1);
        expect(f.sdk.state!.dialog.isOpen).toBe(false);
        expect(f.sdk.state!.modalOpen).toBe(false);
    });

    test('a reward already answered by the talk does not incur another reward opening window', async () => {
        const f = fixture({ gameMessages: [message(99)] });
        expect(await finish(f, {})).toBe(101);
        expect(f.sdk.sent).toEqual([]);
        expect(f.log.rows.at(-1)?.meta).toMatchObject({ levelUps: 0, pages: 0, ticks: 1 });
    });

    test('an already-answered reward with its scroll still open only waits for scroll closure', async () => {
        const f = fixture({ ...scroll, gameMessages: [message(99)] });
        expect(await finish(f, { 101: { modalOpen: false } })).toBe(101);
        expect(f.sdk.sent.map(a => a.method)).toEqual(['sendCloseModal']);
    });

    test('a stale level-up message cannot suppress the new queued reward', async () => {
        const f = fixture({ gameMessages: [message(97)] });
        expect(await finish(f, { 102: { dialog: reward }, 103: { dialog: closed } })).toBe(104);
        expect(f.clicks).toEqual([{ tick: 102, page: 'reward' }]);
    });

    test('a reward message is not evidence of dismissal while its page is still open', async () => {
        const f = fixture({ dialog: reward, gameMessages: [message(99)] });
        expect(await finish(f, { 101: { dialog: closed } })).toBe(102);
        expect(f.clicks).toEqual([{ tick: 100, page: 'reward' }]);
    });

    test('no-levelup rewards close the modal without waiting for a nonexistent level-up', async () => {
        const f = fixture(scroll);
        expect(await finish(f, { 101: { modalOpen: false } }, false)).toBe(101);
        expect(f.sdk.sent.map(a => a.method)).toEqual(['sendCloseModal']);
        expect(f.log.rows.at(-1)?.meta).toMatchObject({ levelUps: 0, pages: 0, ticks: 1 });
    });

    test('a modal-only reward waits for confirmed closure even when the first close is dropped', async () => {
        const f = fixture(scroll);
        expect(await finish(f, { 103: { modalOpen: false } }, false)).toBe(103);
        expect(f.sdk.sent.map(a => a.method)).toEqual(['sendCloseModal', 'sendCloseModal']);
    });

    test('a modal that never closes is a failure, not a clean next-step boundary', async () => {
        const f = fixture(scroll);
        await expect(finish(f, {}, false)).rejects.toThrow(/quest scroll closed/);
        expect(f.log.rows).toEqual([]);
    });

    test('a conversation timeout is a failed completion, not a successful note', async () => {
        const f = fixture({ dialog: { ...reward, isWaiting: true } });
        await expect(drive(f.sdk, moves.completion(f.ctx, 'C', 'doric', true, 98), 420)).rejects.toThrow(/completion: timeout/);
        expect(f.log.rows).toEqual([]);
    });

    test('an unexpected choice cannot be reported as successful completion', async () => {
        const f = fixture({ dialog: { isOpen: true, isWaiting: false, pageId: 'choice', options: [{ index: 1, text: 'Stay here', buttonType: 1, componentId: 20 }] } });
        await expect(finish(f, {})).rejects.toThrow(/no choice/);
        expect(f.log.rows).toEqual([]);
    });

    test('the opening wait remains bounded if the reward raises no level despite the caller expecting one', async () => {
        const f = fixture();
        expect(await finish(f, {})).toBe(100 + COMPLETION_PAGE_TICKS + 1);
        expect(f.sdk.sent).toEqual([]);
    });

    test('neither a scroll nor a level-up substitutes for the quest-complete tab evidence', async () => {
        const f = fixture({ ...scroll, quests: { doric: 'started' } as BotWorldState['quests'] });
        await expect(finish(f, {})).rejects.toThrow(/quest complete/);
        expect(f.sdk.sent).toEqual([]);
        expect(f.log.rows).toEqual([]);
    });

    test('waiting copies are not clicked twice, and completion leaves no listener to consume the next step page', async () => {
        const f = fixture();
        await finish(f, {
            101: { dialog: reward },
            103: { dialog: page('unlock', 'You can now mine Iron.') },
            104: { dialog: closed, ...scroll },
            105: { modalOpen: false },
        });
        expect(f.sdk.state!.tick).toBe(105);
        expect(f.clicks.map(c => c.page)).toEqual(['reward', 'unlock']);
        f.sdk.tick({ dialog: page('next-step', 'Welcome to the next quest.') });
        await flush();
        expect(f.clicks.map(c => c.page)).toEqual(['reward', 'unlock']);
        const next = converse(f.sdk, [], { idle: 0 });
        await flush();
        f.sdk.tick({ dialog: closed });
        expect(await next).toMatchObject({ ok: true, pages: 1, levelUps: 0 });
        expect(f.clicks.map(c => c.page)).toEqual(['reward', 'unlock', 'next-step']);
    });
});

// ------------------------------------------------------------------ the talk's approach (lib/approach.ts)

const who = (worldX: number, worldZ: number) => ({ name: 'lab', x: worldX, z: worldZ, worldX, worldZ, level: 0, hp: 10, maxHp: 10 }) as PlayerState;
const doorLoc = (x: number, z: number, open: boolean): NearbyLoc => {
    const ops = open ? ['Close'] : ['Open'];
    return { id: open ? 1531 : 1530, name: 'Door', x, z, level: 0, distance: 1, optionsWithIndex: ops.map((text, i) => ({ text, opIndex: i + 1 })), options: ops };
};
const doric = (x: number, z: number, reachable: boolean): NearbyNpc =>
    ({ kind: 'npc', id: 284, index: 7, name: 'Doric', x, z, tileX: x, tileZ: z, size: 1, distance: 1, reachable, optionsWithIndex: [{ text: 'Talk-to', opIndex: 1 }], options: ['Talk-to'] }) as unknown as NearbyNpc;

/**
 * Doric shut in: SCORED at (3200,3200), his door at (3203,3200) (`open` or not), Doric at (3206,3200).
 * The door opens a tick after its Open click. A Talk-to opens his one page only while the client can
 * route to him (the door open); a click on the page closes it.
 */
function talkWorld(o: { open: boolean; doricAt?: { x: number; z: number }; npcs?: boolean }) {
    const at = o.doricAt ?? { x: 3206, z: 3200 };
    let open = o.open;
    const sdk = new FakeSdk(baseState({ tick: 100, player: who(3200, 3200), nearbyLocs: [doorLoc(3203, 3200, open)], nearbyNpcs: o.npcs === false ? [] : [doric(at.x, at.z, open)] }));
    const log = TickLog.memory('talk');
    const ctx = { sdk, bot: { walkTo: async () => ({ success: false, message: 'test' }) }, session: { sdk, name: 'lab', sessionId: 0 }, c: {}, log } as unknown as StepContext<unknown>;
    simulateWalking(sdk, { blocked: x => !open && x > 3203 });
    const prev = sdk.onSend;
    let next: Partial<BotWorldState> | null = null;
    sdk.onSend = (a, f) => {
        prev(a, f);
        if (a.method === 'sendInteractLoc' && !open) {
            open = true;
            next = { nearbyLocs: [doorLoc(3203, 3200, true)], nearbyNpcs: f.state!.nearbyNpcs.map(n => ({ ...n, reachable: true })) };
        } else if (a.method === 'sendInteractNpc' && open) next = { dialog: page('doric-1', 'Hello, traveller.') };
        else if (/ClickDialog|clickDialogByText/.test(a.method) && f.state!.dialog.isOpen) next = { dialog: closed };
    };
    const each = (): Partial<BotWorldState> => {
        const n = next ?? {};
        next = null;
        return n;
    };
    const talk = () => moves.talk(ctx, 'B', undefined, { who: 'Doric (start)', npc: /^doric$/i, near: { x: 3206, z: 3200 }, shape: '1c', maxTicks: 30 });
    return { sdk, log, each, talk };
}

describe('small quest talk: the way to the NPC first', () => {
    test('the NPC in reach: the Talk-to is the first send, and the note carries no approach', async () => {
        const f = talkWorld({ open: true });
        const r = await drive(f.sdk, f.talk(), 60, f.each);
        expect(r.opened).toBe(true);
        expect(f.sdk.sent[0]?.method).toBe('sendInteractNpc');
        expect(f.sdk.sent.some(a => a.method === 'sendInteractLoc' || a.method === 'sendWalk')).toBe(false);
        expect(f.log.rows.at(-1)?.meta).not.toHaveProperty('approach');
    });

    test('shut behind his closed door: the door opened, the run to him, then the talk opens; the note says so', async () => {
        const f = talkWorld({ open: false });
        const r = await drive(f.sdk, f.talk(), 120, f.each);
        expect(r.opened).toBe(true);
        const methods = f.sdk.sent.map(a => a.method);
        expect(methods[0]).toBe('sendInteractLoc');
        const talkAt = methods.indexOf('sendInteractNpc');
        expect(methods.slice(1, talkAt)).toContain('sendWalk');
        expect(f.sdk.state!.player!.worldX).toBeGreaterThanOrEqual(3205);
        expect(f.log.rows.at(-1)?.meta).toMatchObject({ who: 'Doric (start)', approach: { finds: 1, doors: ['3203,3200'], runs: 1 } });
    });

    test('the NPC never in sight: the talk refuses with the reason, and no Talk-to goes out', async () => {
        const f = talkWorld({ open: true, npcs: false });
        await expect(drive(f.sdk, f.talk(), 60, f.each)).rejects.toThrow(/S05:B: Doric \(start\): not in sight within 10 ticks/);
        expect(f.sdk.sent).toEqual([]);
        expect(f.log.rows).toEqual([]);
    });
});
