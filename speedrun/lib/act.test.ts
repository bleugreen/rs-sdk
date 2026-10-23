import { describe, expect, setSystemTime, test } from 'bun:test';
import type { BotWorldState, DialogState, InventoryItem, NearbyLoc, NearbyNpc, PlayerState } from '../../sdk/types';
import { act, actConverse, castTeleport, ClickGuard, openDoor, opLoc, pickup, talkTo, useOn, wield } from './act';
import { baseState, FakeSdk, flush } from './fake-sdk';
import { configId } from './world';

const player = (worldX: number, worldZ: number, level = 0) => ({ worldX, worldZ, level, hp: 10, maxHp: 10 }) as PlayerState;
const loc = (id: number, name: string, x: number, z: number, ops: string[]): NearbyLoc =>
    ({ id, name, x, z, level: 0, distance: 1, optionsWithIndex: ops.map((text, i) => ({ text, opIndex: i + 1 })), options: ops });
const npc = (index: number, name: string): NearbyNpc =>
    ({ kind: 'npc', id: 5, index, name, x: 1, z: 1, distance: 1, hp: null, maxHp: null, optionsWithIndex: [{ text: 'Talk-to', opIndex: 1 }, { text: 'Pickpocket', opIndex: 3 }], options: ['Talk-to', 'Pickpocket'] }) as NearbyNpc;
const cont = (pageId: string): DialogState => ({ isOpen: true, isWaiting: false, pageId, options: [{ index: 1, text: 'Click here to continue', buttonType: 6, componentId: 10 }] });
const closed: DialogState = { isOpen: false, options: [], isWaiting: false };

/** talkTo's use of ClickGuard, bare: the guard listens while the caller waits for `answered`. */
async function talkFake(sdk: FakeSdk, click: () => Promise<unknown>, answered: () => boolean): Promise<{ unansweredResends?: number }> {
    const guard = new ClickGuard(sdk as never, click, () => answered());
    const stop = sdk.onStateUpdate(s => void guard.step(s));
    const sent = guard.send();
    await new Promise<void>(r => {
        const off = sdk.onStateUpdate(() => {
            if (!answered()) return;
            off();
            r();
        });
    });
    stop();
    await sent;
    return guard.report();
}

async function ticks(sdk: FakeSdk, n: number, patch: (i: number) => Partial<BotWorldState> = () => ({})) {
    for (let i = 0; i < n; i++) {
        await flush();
        sdk.tick(patch(i));
    }
    await flush();
}

describe('act', () => {
    test('re-sends a click dropped while the player stands still, and stops once done holds', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1, player: player(10, 10) }));
        let done = false;
        const p = act(sdk as never, () => sdk.sendWalk(0, 0), () => done, { resendEvery: 3 });
        await ticks(sdk, 4);
        expect(sdk.sent.length).toBe(2);
        done = true;
        await ticks(sdk, 1);
        expect(await p).toMatchObject({ ok: true, resends: 1, ticks: 5 });
    });

    test('a moving player has the click: no re-send', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1, player: player(10, 10) }));
        const p = act(sdk as never, () => sdk.sendWalk(0, 0), () => false, { resendEvery: 3, maxTicks: 6 });
        await ticks(sdk, 8, i => ({ player: player(10 - i, 10) }));
        expect(await p).toMatchObject({ ok: false, resends: 0, reason: 'timeout' });
    });

    test("\"I can't reach that!\" triggers a re-send", async () => {
        const sdk = new FakeSdk(baseState({ tick: 1, player: player(10, 10) }));
        const p = act(sdk as never, () => sdk.sendWalk(0, 0), () => false, { resendEvery: 50, maxTicks: 3 });
        await ticks(sdk, 1, () => ({ gameMessages: [{ type: 0, text: "I can't reach that!", sender: '', tick: 2, fromSelf: false }] }));
        await ticks(sdk, 3);
        expect((await p).resends).toBe(1);
    });
});

describe('the jump guard', () => {
    // A forced move (agility_walk) steps by p_teleport (no jump bit): teleportTick is the tick of each step.
    const placed = (x: number, z: number, tick: number, level = 0) => ({ ...player(x, z, level), teleportTick: tick, teleportJump: false }) as PlayerState;
    // A ladder or a spell lands by p_telejump.
    const jumped = (x: number, z: number, tick: number, level = 0) => ({ ...player(x, z, level), teleportTick: tick, teleportJump: true }) as PlayerState;
    const sentAt = (sdk: FakeSdk, method: string) => sdk.sent.filter(a => a.method === method).length;

    test('act holds the first click while the player was placed this tick, then sends it once and it lands', async () => {
        const sdk = new FakeSdk(baseState({ tick: 10, player: placed(2465, 3493, 10) }));
        let done = false;
        const p = act(sdk as never, () => sdk.sendInteractLoc(2466, 3495, 1, 1), () => done);
        await flush();
        expect(sentAt(sdk, 'sendInteractLoc')).toBe(0);
        await ticks(sdk, 1); // tick 11: settled
        expect(sentAt(sdk, 'sendInteractLoc')).toBe(1);
        await ticks(sdk, 1, () => ({ player: placed(2465, 3494, 10) })); // the click lands: a step
        done = true;
        await ticks(sdk, 1);
        const r = await p;
        expect(r).toMatchObject({ ok: true, resends: 0, settleTicks: 1 });
        expect(r.unansweredResends).toBeUndefined();
        expect(sentAt(sdk, 'sendInteractLoc')).toBe(1);
    });

    test("\"I can't reach that!\" after a post-jump click is not a reply: the click is re-sent", async () => {
        const sdk = new FakeSdk(baseState({ tick: 30, player: jumped(10, 10, 30) }));
        let done = false;
        const p = act(sdk as never, () => sdk.sendInteractNpc(7, 1), () => done, { resendEvery: 0 });
        await ticks(sdk, 1, () => ({ gameMessages: [{ type: 0, text: "I can't reach that!", sender: '', tick: 31, fromSelf: false }] }));
        await ticks(sdk, 2);
        expect(sentAt(sdk, 'sendInteractNpc')).toBe(2);
        done = true;
        await ticks(sdk, 1);
        expect(await p).toMatchObject({ ok: true, unansweredResends: 1 });
    });

    test('a ladder landing (p_telejump) holds nobody: the click goes out on the landing tick', async () => {
        const sdk = new FakeSdk(baseState({ tick: 50, player: jumped(2466, 3496, 50, 3) }));
        const p = act(sdk as never, () => sdk.sendInteractLoc(2466, 3495, 1, 1), () => true);
        await flush();
        expect(sentAt(sdk, 'sendInteractLoc')).toBe(1);
        expect((await p).settleTicks).toBeUndefined();
    });

    test('the reply bound runs from the tick the client executed the click, not the send tick', async () => {
        const sdk = new FakeSdk(baseState({ tick: 20, player: jumped(2465, 3493, 20) }));
        let release: (() => void) | null = null;
        let n = 0;
        const click = () => {
            n++;
            sdk.sent.push({ method: 'sendInteractNpc', args: [7, 1] });
            // the first click executes 4 ticks after the send (a lagging tab)
            return n === 1 ? new Promise<unknown>(r => { release = () => r({ success: true, message: 'ok' }); }) : Promise.resolve({ success: true, message: 'ok' });
        };
        let done = false;
        const p = act(sdk as never, click, () => done, { resendEvery: 0 });
        await ticks(sdk, 4);
        release!();
        await ticks(sdk, 2); // 2 ticks after execution: not yet re-sent
        expect(n).toBe(1);
        await ticks(sdk, 1); // 3 ticks after execution, no reply
        expect(n).toBe(2);
        done = true;
        await ticks(sdk, 1);
        expect(await p).toMatchObject({ ok: true, unansweredResends: 1 });
    });

    /**
     * A tab behind the server: the click sent at tab tick 20 executes when the tab is at 21, while
     * 10 ticks of wall time have passed, so the server had it at tick 30 (wait.ts serverClock).
     */
    async function lagging(run: (sdk: FakeSdk, click: () => Promise<unknown>, release: () => void, count: () => number) => Promise<void>) {
        const prev = process.env.SPEEDRUN_TICK_MS;
        process.env.SPEEDRUN_TICK_MS = '300';
        const wall0 = Date.now();
        setSystemTime(wall0);
        try {
            const sdk = new FakeSdk(baseState({ tick: 20, player: jumped(2465, 3493, 20) }));
            let n = 0;
            let release: (() => void) | null = null;
            const click = () => {
                n++;
                sdk.sent.push({ method: 'sendInteractNpc', args: [7, 1] });
                return n === 1 ? new Promise<unknown>(r => { release = () => r({ success: true, message: 'ok' }); }) : Promise.resolve({ success: true, message: 'ok' });
            };
            const go = () => {
                setSystemTime(wall0 + 10 * 300);
                release!();
            };
            await run(sdk, click, go, () => n);
        } finally {
            setSystemTime();
            if (prev === undefined) delete process.env.SPEEDRUN_TICK_MS;
            else process.env.SPEEDRUN_TICK_MS = prev;
        }
    }

    test('on a tab behind the server, the reply watch counts from the server tick the click reached', async () => {
        await lagging(async (sdk, click, release, count) => {
            let done = false;
            const p = talkFake(sdk, click, () => done);
            await ticks(sdk, 1); // tab tick 21; the click has not executed
            release(); // executes at 21; the server is at 30
            await ticks(sdk, 11); // tab tick 32: 2 ticks past the server's 30, the reply can still come
            expect(count()).toBe(1);
            await ticks(sdk, 1); // 33: REPLY_TICKS from the server tick
            expect(count()).toBe(2);
            done = true;
            await ticks(sdk, 1);
            expect(await p).toMatchObject({ unansweredResends: 1 });
        });
    });

    test('a caller clock anchored before the send (a tab already behind at the send) lengthens the reply bound', async () => {
        await lagging(async (sdk, click, release, count) => {
            // The caller knew the server at tick 34 by the time the click executed (its own anchor).
            const guard = new ClickGuard(sdk as never, click, () => false, { alwaysWatch: true, clock: () => 34 });
            const stop = sdk.onStateUpdate(s => void guard.step(s));
            const sent = guard.send();
            await ticks(sdk, 1);
            release();
            await sent;
            expect(guard.replyFrom).toBe(34);
            await ticks(sdk, 15); // tab tick 36: 2 past the caller's 34
            expect(count()).toBe(1);
            await ticks(sdk, 1);
            expect(count()).toBe(2);
            stop();
        });
    });

    test("on a tab behind the server, act's idle re-send counts from the server tick the click reached", async () => {
        await lagging(async (sdk, click, release, count) => {
            // Not just after a jump: only the idle re-send can fire.
            sdk.state = { ...sdk.state!, player: { ...sdk.state!.player!, teleportTick: 1 } };
            let done = false;
            const p = act(sdk as never, click, () => done, { resendEvery: 6 });
            await ticks(sdk, 1);
            release();
            await flush();
            await ticks(sdk, 14); // tab tick 35: 5 ticks past the server's 30
            expect(count()).toBe(1);
            await ticks(sdk, 1); // 36
            expect(count()).toBe(2);
            done = true;
            await ticks(sdk, 1);
            expect(await p).toMatchObject({ ok: true, resends: 1 });
        });
    });

    // The browser stamps a click's message reply with the click's own tick (rs/308); lite with the next one.
    test('a post-jump click answered by a message stamped with its own tick, after a message on that tick, is not re-sent', async () => {
        const rum = { type: 0, text: 'Your Karamjan rum gets broken and spilled.', sender: '', tick: 30, observationId: 10, fromSelf: false };
        const sdk = new FakeSdk(baseState({ tick: 30, player: jumped(2662, 3305, 30), gameMessages: [rum] }));
        const p = act(sdk as never, () => sdk.sendInteractLoc(2661, 3306, 1, 1), () => false, { resendEvery: 0, maxTicks: 4 });
        await ticks(sdk, 1, () => ({ gameMessages: [rum, { type: 0, text: 'The door is locked.', sender: '', tick: 30, observationId: 11, fromSelf: false }] }));
        await ticks(sdk, 4);
        expect(sentAt(sdk, 'sendInteractLoc')).toBe(1);
        expect((await p).unansweredResends).toBeUndefined();
    });

    test("act's idle re-send takes \"I can't reach that!\" stamped with the click's own tick as a refusal", async () => {
        const sdk = new FakeSdk(baseState({ tick: 1, player: player(10, 10) }));
        const p = act(sdk as never, () => sdk.sendWalk(0, 0), () => false, { resendEvery: 50, maxTicks: 3 });
        await ticks(sdk, 1, () => ({ gameMessages: [{ type: 0, text: "I can't reach that!", sender: '', tick: 1, observationId: 4, fromSelf: false }] }));
        await ticks(sdk, 3);
        expect((await p).resends).toBe(1);
    });

    test('act re-sends once a post-jump click that draws no reply in REPLY_TICKS', async () => {
        const sdk = new FakeSdk(baseState({ tick: 20, player: placed(2465, 3493, 19) }));
        let done = false;
        const p = act(sdk as never, () => sdk.sendInteractLoc(2466, 3495, 1, 1), () => done, { resendEvery: 6 });
        await ticks(sdk, 2);
        expect(sentAt(sdk, 'sendInteractLoc')).toBe(1);
        await ticks(sdk, 1); // 3 ticks since the send, nothing happened
        expect(sentAt(sdk, 'sendInteractLoc')).toBe(2);
        await ticks(sdk, 3); // the re-send is not itself re-sent by the jump rule
        expect(sentAt(sdk, 'sendInteractLoc')).toBe(2);
        done = true;
        await ticks(sdk, 1);
        expect(await p).toMatchObject({ ok: true, unansweredResends: 1 });
    });

    test('a click that is not just after a jump keeps the old rule (no early re-send)', async () => {
        const sdk = new FakeSdk(baseState({ tick: 50, player: placed(10, 10, 30) }));
        const p = act(sdk as never, () => sdk.sendInteractLoc(5, 5, 1, 1), () => false, { resendEvery: 6, maxTicks: 4 });
        await ticks(sdk, 5);
        expect(await p).toMatchObject({ ok: false, resends: 0 });
        expect(sentAt(sdk, 'sendInteractLoc')).toBe(1);
    });

    test('act re-sends a refused send on the next settled tick and counts it', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1, player: player(10, 10) }));
        let refuse = 2;
        const click = () => {
            sdk.sent.push({ method: 'sendInteractNpc', args: [8143, 1] });
            return Promise.resolve(refuse-- > 0 ? { success: false, message: 'no route', reason: 'cant_reach' } : { success: true, message: 'ok' });
        };
        let done = false;
        const p = act(sdk as never, click, () => done, { resendEvery: 0 });
        await ticks(sdk, 1);
        expect(sentAt(sdk, 'sendInteractNpc')).toBe(2);
        await ticks(sdk, 1);
        expect(sentAt(sdk, 'sendInteractNpc')).toBe(3);
        await ticks(sdk, 2);
        expect(sentAt(sdk, 'sendInteractNpc')).toBe(3);
        done = true;
        await ticks(sdk, 1);
        expect(await p).toMatchObject({ ok: true, refusedResends: 2 });
    });

    test('a send reported as scene_loading that drew a reply is not re-sent', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1, player: player(10, 10) }));
        const click = () => {
            sdk.sent.push({ method: 'sendInteractLoc', args: [5, 5, 1, 1] });
            return Promise.resolve({ success: false, message: 'sent while loading', reason: 'scene_loading' });
        };
        let done = false;
        const p = act(sdk as never, click, () => done, { resendEvery: 0 });
        await ticks(sdk, 1, () => ({ player: player(9, 10) })); // it landed: the player steps
        await ticks(sdk, 2);
        expect(sentAt(sdk, 'sendInteractLoc')).toBe(1);
        done = true;
        await ticks(sdk, 1);
        const r = await p;
        expect(r.ok).toBe(true);
        expect(r.refusedResends).toBeUndefined();
    });

    test('act waits out a region load (sceneReady false) before the first click', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1, sceneReady: false, player: player(10, 10) }));
        let done = false;
        const p = act(sdk as never, () => sdk.sendInteractLoc(5, 5, 1, 1), () => done);
        await ticks(sdk, 4);
        expect(sentAt(sdk, 'sendInteractLoc')).toBe(0);
        await ticks(sdk, 1, () => ({ sceneReady: true }));
        expect(sentAt(sdk, 'sendInteractLoc')).toBe(1);
        done = true;
        await ticks(sdk, 1);
        expect(await p).toMatchObject({ ok: true, settleTicks: 5 });
    });

    test('talkTo after the Grand Tree door: the dropped first click is re-sent in REPLY_TICKS, not after openTicks', async () => {
        const narnode = npc(7, 'King Narnode Shareen');
        // The door's last p_teleport step lands on tick 41 and still holds the player then.
        const sdk = new FakeSdk(baseState({ tick: 41, player: placed(2465, 3493, 41), nearbyNpcs: [narnode] }));
        let clicks = 0;
        sdk.onSend = a => {
            if (a.method !== 'sendInteractNpc') return;
            clicks++;
            // the server drops the first click it gets (the script still held the player); the second lands
            if (clicks === 2) setTimeout(() => sdk.tick({ dialog: cont('n1') }), 1);
        };
        const p = talkTo(sdk as never, narnode, [], { idle: 1 });
        await ticks(sdk, 4); // 42: settled, first click; 45: no reply in 3 ticks, re-sent
        expect(clicks).toBe(2);
        await flush();
        await ticks(sdk, 1, () => ({ dialog: closed }));
        await ticks(sdk, 2);
        const r = await p;
        expect(r).toMatchObject({ ok: true, opened: true, clicks: 1, settleTicks: 1, unansweredResends: 1 });
        expect(r.firstTick - 41).toBeLessThanOrEqual(6);
    });

    test('talkTo at the top of the tree: a send refused as unroutable after the ladder is re-sent the next tick', async () => {
        const charlie = npc(8143, 'Charlie');
        const sdk = new FakeSdk(baseState({ tick: 46, player: placed(2467, 3495, 45, 3), nearbyNpcs: [charlie] }));
        let n = 0;
        (sdk as unknown as { sendInteractNpc: (i: number, o: number) => Promise<unknown> }).sendInteractNpc = (i, o) => {
            sdk.sent.push({ method: 'sendInteractNpc', args: [i, o] });
            if (++n === 1) return Promise.resolve({ success: false, message: 'no route', reason: 'cant_reach' });
            setTimeout(() => sdk.tick({ dialog: cont('c1') }), 1);
            return Promise.resolve({ success: true, message: 'ok' });
        };
        const p = talkTo(sdk as never, charlie, [], { idle: 1 });
        await flush();
        expect(n).toBe(1);
        await ticks(sdk, 1);
        expect(n).toBe(2);
        await flush();
        await ticks(sdk, 1, () => ({ dialog: closed }));
        await ticks(sdk, 2);
        expect(await p).toMatchObject({ ok: true, opened: true, clicks: 1, refusedResends: 1 });
    });

    test('talkTo with no jump and a click that lands sends exactly one click', async () => {
        const bob = npc(3, 'Bob');
        const sdk = new FakeSdk(baseState({ tick: 5, player: player(1, 1), nearbyNpcs: [bob] }));
        sdk.onSend = a => {
            if (a.method === 'sendInteractNpc') setTimeout(() => sdk.tick({ dialog: cont('b1') }), 1);
        };
        const p = talkTo(sdk as never, bob, [], { idle: 1 });
        await flush();
        await ticks(sdk, 1, () => ({ dialog: closed }));
        await ticks(sdk, 2);
        const r = await p;
        expect(sentAt(sdk, 'sendInteractNpc')).toBe(1);
        expect([r.settleTicks, r.refusedResends, r.unansweredResends]).toEqual([undefined, undefined, undefined]);
    });
});

describe('a landed click is not re-sent while its script runs', () => {
    test("Dwarf Cannon's railing at the demo's timing: the message lands on the next tick, the choice 7 ticks later; no re-send", async () => {
        // railings.rs2: mes(...), p_delay(2), mes(...), p_delay(2), then the choice; 6-7 ticks on the demo
        const sdk = new FakeSdk(baseState({ tick: 1, player: player(2556, 3475) }));
        const msg = (text: string, tick: number) => ({ type: 0, text, sender: '', tick, fromSelf: false });
        const p = actConverse(sdk as never, () => sdk.sendInteractLoc(2555, 3475, 15, 1), [/^try to replace/i], { resendEvery: 6, done: s => s.gameMessages.some(m => /you attempt/i.test(m.text)) });
        await ticks(sdk, 1, () => ({ gameMessages: [msg('You inspect the railing...', 2)] }));
        await ticks(sdk, 6);
        expect(sdk.sent.filter(a => a.method === 'sendInteractLoc')).toHaveLength(1);
        await ticks(sdk, 1, () => ({ dialog: { isOpen: true, isWaiting: false, pageId: 'r', options: [{ index: 1, text: 'Try to replace the railing.', buttonType: 1, componentId: 1 }, { index: 2, text: 'Leave it be.', buttonType: 1, componentId: 2 }] } }));
        await ticks(sdk, 1, () => ({ dialog: closed, gameMessages: [msg('You attempt to replace the railing...', 10)] }));
        await ticks(sdk, 3);
        const r = await p;
        expect(r.ok).toBe(true);
        expect(sdk.sent.filter(a => a.method === 'sendInteractLoc')).toHaveLength(1);
    });

    test('a click that drew nothing is still re-sent after the idle ticks; a walk that stops short is re-clicked', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1, player: player(10, 10) }));
        // waitUntil gives up once more than maxTicks ticks have passed: maxTicks + 1 ticks end each wait.
        const p = act(sdk as never, () => sdk.sendInteractLoc(5, 5, 1, 1), () => false, { resendEvery: 3, maxTicks: 4 });
        await ticks(sdk, 5);
        expect((await p).resends).toBe(1);

        const w = new FakeSdk(baseState({ tick: 1, player: player(10, 10) }));
        const q = act(w as never, () => w.sendWalk(0, 10), () => false, { resendEvery: 3, maxTicks: 5 });
        await ticks(w, 1, () => ({ player: player(8, 10) })); // it moves (a landed walk), then stops short
        await ticks(w, 5);
        expect((await q).resends).toBe(1);
    });

    test("a click sent while an earlier script still answers is re-sent: that script's later message is not the click's answer", async () => {
        // grand-tree.ts climbToPillars: the climb goes out as the potion's boost shows, while the drink
        // script still holds the player (dropped); the drink's second message follows a tick later.
        const msg = (text: string, tick: number) => ({ type: 0, text, sender: '', tick, fromSelf: false });
        const drink = msg('You drink some of your agility potion.', 1);
        const sdk = new FakeSdk(baseState({ tick: 1, player: { ...player(10, 10), animId: 829 }, gameMessages: [drink] }));
        const p = act(sdk as never, () => sdk.sendInteractLoc(5, 5, 1, 1), () => false, { resendEvery: 3, maxTicks: 4 });
        await ticks(sdk, 1, () => ({ player: { ...player(10, 10), animId: -1 }, gameMessages: [drink, msg('You have 3 doses of potion left.', 2)] }));
        await ticks(sdk, 4);
        expect((await p).resends).toBe(1);
        expect(sdk.sent.filter(a => a.method === 'sendInteractLoc')).toHaveLength(2);
    });

    test("a blocked hit's animation is the fight's, not the click's answer: the dropped loc click is re-sent once (rs/391, TGV H)", async () => {
        // SCORED idle by the door between hits; the Khazard commander's next swing is blocked under
        // Protect from Melee (a 0 hit) and SCORED's block anim 420 shows; the retaliation swallowed the click.
        const sdk = new FakeSdk(baseState({ tick: 1, player: player(10, 10) }));
        const p = act(sdk as never, () => sdk.sendInteractLoc(11, 10, 1, 1), () => false, { resendEvery: 6, maxTicks: 8 });
        const hit = { tick: 2, observationId: 2, type: 'damage_taken' as const, damage: 0, sourceType: 'npc' as const, sourceIndex: 7, targetType: 'player' as const, targetIndex: -1 };
        await ticks(sdk, 1, () => ({ player: { ...player(10, 10), animId: 420 }, combatEvents: [hit] }));
        await ticks(sdk, 1, () => ({ player: { ...player(10, 10), animId: -1 } }));
        await ticks(sdk, 7);
        expect((await p).resends).toBe(1);
        expect(sdk.sent.filter(a => a.method === 'sendInteractLoc')).toHaveLength(2);
    });

    test("upkeep's eat in a fight (its message and the inventory change) is not the click's answer either", async () => {
        // rs/201, MM segment K: a hit, then "You eat the shark." one tick after the ladder click; the eat clears the op.
        const shark = { slot: 0, id: 385, name: 'Shark', count: 1 } as InventoryItem;
        const sdk = new FakeSdk(baseState({ tick: 1, player: player(10, 10), inventory: [shark] }));
        const p = act(sdk as never, () => sdk.sendInteractLoc(11, 10, 1, 1), () => false, { resendEvery: 6, maxTicks: 8 });
        const hit = { tick: 2, observationId: 2, type: 'damage_taken' as const, damage: 6, sourceType: 'npc' as const, sourceIndex: 7, targetType: 'player' as const, targetIndex: -1 };
        await ticks(sdk, 1, () => ({ player: { ...player(10, 10), animId: 424 }, combatEvents: [hit] }));
        await ticks(sdk, 1, () => ({ player: { ...player(10, 10), animId: 829 }, inventory: [], gameMessages: [{ type: 0, text: 'You eat the shark.', sender: '', tick: 3, observationId: 3, fromSelf: false }] }));
        await ticks(sdk, 7, () => ({ player: { ...player(10, 10), animId: -1 } }));
        expect((await p).resends).toBe(1);
    });

    test('in a fight, a dialogue the click opened still answers it: no re-send', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1, player: player(10, 10) }));
        const p = act(sdk as never, () => sdk.sendInteractNpc(3, 1), s => s.dialog.isOpen, { resendEvery: 3, maxTicks: 8 });
        const hit = { tick: 2, observationId: 2, type: 'damage_taken' as const, damage: 2, sourceType: 'npc' as const, sourceIndex: 7, targetType: 'player' as const, targetIndex: -1 };
        await ticks(sdk, 1, () => ({ player: { ...player(10, 10), animId: 424 }, combatEvents: [hit] }));
        await ticks(sdk, 1, () => ({ dialog: cont('npc') }));
        expect((await p).resends).toBe(0);
    });

    // rs/391, rs/457 (TGV H on lite): the Khazard commander faces SCORED from t81; SCORED's blocks come at
    // t81, t85, t89 with inCombat false and no combat event (both start at t91). A door click at t88 was
    // dropped; the block at t89 latched it as answered and nothing re-sent it to the 40-tick bound.
    for (const anim of [420, 424, 1156]) {
        test(`a block (anim ${anim}) with no combat event and inCombat false is the fight's, not the click's: re-sent at the bound`, async () => {
            const sdk = new FakeSdk(baseState({ tick: 88, player: player(2509, 3255) }));
            const p = act(sdk as never, () => sdk.sendInteractLoc(2510, 3255, 1, 1), () => false, { maxTicks: 8 });
            await ticks(sdk, 1, () => ({ player: { ...player(2509, 3255), animId: anim } }));
            await ticks(sdk, 8, () => ({ player: { ...player(2509, 3255), animId: -1 } }));
            expect((await p).resends).toBe(1);
        });
    }

    const commander = (targetIndex: number, options = ['Attack']): NearbyNpc =>
        ({ ...npc(7, 'Khazard commander'), tileX: 2510, tileZ: 3256, size: 1, targetIndex, options, optionsWithIndex: options.map((text, i) => ({ text, opIndex: i + 1 })) }) as NearbyNpc;

    test('an attacker beside the player facing them makes it a fight: the retaliation swing is not the answer', async () => {
        // Auto-retaliate on (the regression's own shape): SCORED's swing shows before any event or inCombat.
        const sdk = new FakeSdk(baseState({ tick: 81, player: player(2509, 3255), nearbyNpcs: [commander(32769)] }));
        const p = act(sdk as never, () => sdk.sendInteractLoc(2510, 3255, 1, 1), () => false, { maxTicks: 8 });
        await ticks(sdk, 1, () => ({ player: { ...player(2509, 3255), animId: 419 } }));
        await ticks(sdk, 8, () => ({ player: { ...player(2509, 3255), animId: -1 } }));
        expect((await p).resends).toBe(1);
    });

    test("a talker facing the player (no Attack option), or an attacker facing nobody, is no fight: the click's animation answers it", async () => {
        for (const near of [commander(32769, ['Talk-to']), commander(-1)]) {
            const sdk = new FakeSdk(baseState({ tick: 1, player: player(2509, 3255), nearbyNpcs: [near] }));
            const p = act(sdk as never, () => sdk.sendInteractLoc(2510, 3255, 1, 1), () => false, { maxTicks: 8 });
            await ticks(sdk, 1, () => ({ player: { ...player(2509, 3255), animId: 832 } }));
            await ticks(sdk, 8, () => ({ player: { ...player(2509, 3255), animId: -1 } }));
            expect((await p).resends).toBe(0);
        }
    });

    test("the player's own attack animation out of a fight still answers (Sea Slug's kick at the panel: human_unarmedkick)", async () => {
        const sdk = new FakeSdk(baseState({ tick: 1, player: player(10, 10) }));
        const p = act(sdk as never, () => sdk.sendInteractLoc(11, 10, 1, 1), () => false, { maxTicks: 8 });
        await ticks(sdk, 1, () => ({ player: { ...player(10, 10), animId: 423 } }));
        await ticks(sdk, 8, () => ({ player: { ...player(10, 10), animId: -1 } }));
        expect((await p).resends).toBe(0);
    });

    test("other players' chat is not the engine answering the click", async () => {
        const sdk = new FakeSdk(baseState({ tick: 1, player: player(10, 10) }));
        const p = act(sdk as never, () => sdk.sendInteractLoc(5, 5, 1, 1), () => false, { resendEvery: 3, maxTicks: 4 });
        await ticks(sdk, 1, () => ({ gameMessages: [{ type: 2, text: 'hi', sender: 'someone', tick: 2, fromSelf: false }] }));
        await ticks(sdk, 4);
        expect((await p).resends).toBe(1);
    });
});

describe('act interrupts', () => {
    const page = (pageId: string, text: string): DialogState => ({ ...cont(pageId), allComponents: [{ id: 1, type: 4, buttonType: 0, option: '', text }] });
    const monkey = { name: 'monkey', match: (s: BotWorldState) => /monkey in your backpack/i.test(s.dialog.allComponents?.[0]?.text ?? ''), dismiss: 'continue' as const };

    test('an unsolicited page is dismissed and the click re-sent once it has gone', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1, player: player(10, 10) }));
        let done = false;
        const p = act(sdk as never, () => sdk.sendWalk(0, 0), () => done, { resendEvery: 0, interrupts: [monkey] });
        await ticks(sdk, 1, () => ({ dialog: page('m', 'The monkey in your backpack... I\'m tired!') }));
        expect(sdk.sent.map(s => s.method)).toEqual(['sendWalk', 'clickDialogByText']);
        await ticks(sdk, 1, () => ({ dialog: closed }));
        expect(sdk.sent.map(s => s.method)).toEqual(['sendWalk', 'clickDialogByText', 'sendWalk']);
        done = true;
        await ticks(sdk, 1);
        expect(await p).toMatchObject({ ok: true, resends: 1, interrupts: 1 });
    });

    test('a dialogue that is not an interrupt only holds off re-sends, as before', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1, player: player(10, 10) }));
        const p = act(sdk as never, () => sdk.sendWalk(0, 0), () => false, { resendEvery: 2, maxTicks: 4, interrupts: [monkey] });
        await ticks(sdk, 5, () => ({ dialog: page('q', 'Hello traveller.') }));
        expect(await p).toMatchObject({ ok: false, resends: 0, interrupts: 0 });
        expect(sdk.sent.map(s => s.method)).toEqual(['sendWalk']);
    });

    // rs/201, MM U: the backpack monkey's chatter page opened right after the talk click to Waydar and was
    // taken as its answer, so the dropped talk was never re-sent.
    const npcChat = (speaker: string, line: string): DialogState =>
        ({ ...cont(speaker), allComponents: [{ id: configId('interface', 'npcchat1:com_1'), type: 4, buttonType: 0, option: '', text: speaker }, { id: configId('interface', 'npcchat1:com_2'), type: 4, buttonType: 0, option: '', text: line }] });
    const watched = async (opts: ConstructorParameters<typeof ClickGuard>[3], page: DialogState) => {
        const sdk = new FakeSdk(baseState({ tick: 20, player: player(10, 10) }));
        const guard = new ClickGuard(sdk as never, () => sdk.sendInteractNpc(4, 1), undefined, { alwaysWatch: true, ...opts });
        const stop = sdk.onStateUpdate(s => void guard.step(s));
        await guard.send();
        await ticks(sdk, 5, () => ({ dialog: page }));
        stop();
        return sdk.sent.filter(a => a.method === 'sendInteractNpc').length;
    };

    test("another NPC's chat page is not a talk click's answer: the click is re-sent at REPLY_TICKS", async () => {
        expect(await watched({ npc: 'Waydar' }, npcChat('Monkey', 'Ook ook!'))).toBe(2);
        expect(await watched({ npc: 'Waydar' }, npcChat('Waydar', 'Shall we return to Crash Island?'))).toBe(1);
    });

    test("a page the caller dismisses as an interrupt is not the click's answer; the player's own page is", async () => {
        expect(await watched({ interrupts: [monkey] }, page('m', 'The monkey in your backpack... I\'m tired!'))).toBe(2);
        expect(await watched({ npc: 'Waydar', interrupts: [monkey] }, page('p', 'Hello.'))).toBe(1);
    });

    test('interrupts need an sdk that can dismiss pages', async () => {
        const src = { getState: () => baseState(), onStateUpdate: () => () => {} };
        await expect(act(src as never, async () => {}, () => true, { interrupts: [monkey] })).rejects.toThrow(/interrupts need an sdk/);
    });
});

describe('loc, npc and item helpers', () => {
    test('opLoc resolves the loc and its option; without done it only sends', async () => {
        const sdk = new FakeSdk(baseState({ nearbyLocs: [loc(1, 'Ladder', 5, 5, ['Climb-up', 'Climb-down'])] }));
        const r = await opLoc(sdk as never, { x: 5, z: 5 }, /climb-down/i);
        expect(r.ok).toBe(true);
        expect(sdk.sent).toEqual([{ method: 'sendInteractLoc', args: [5, 5, 1, 2] }]);
        await expect(opLoc(sdk as never, { x: 5, z: 5 }, 'Search')).rejects.toThrow(/no loc/);
    });

    test('openDoor: done once no closed door is left on the tile; an open door is a no-op', async () => {
        const door = loc(1530, 'Door', 3, 3, ['Open']);
        const sdk = new FakeSdk(baseState({ tick: 1, nearbyLocs: [door] }));
        const p = openDoor(sdk as never, 3, 3);
        await ticks(sdk, 1, () => ({ nearbyLocs: [loc(1531, 'Door', 3, 4, ['Close'])] }));
        expect(await p).toMatchObject({ ok: true, ticks: 1 });
        expect(await openDoor(sdk as never, 3, 3)).toMatchObject({ ok: true, ticks: 0 });
    });

    test('talkTo uses the Talk-to option, answers the dialogue, and re-clicks when nothing opens', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1, nearbyNpcs: [npc(9, 'Monk')] }));
        let interacts = 0;
        sdk.onSend = (a, f) => {
            if (a.method === 'sendInteractNpc' && ++interacts === 2) queueMicrotask(() => f.tick({ dialog: cont('p') }));
            if (a.method === 'clickDialogByText') queueMicrotask(() => f.tick({ dialog: closed }));
        };
        const p = talkTo(sdk as never, /monk/i, [], { openTicks: 2, idle: 1 });
        await ticks(sdk, 8);
        const r = await p;
        expect(r).toMatchObject({ opened: true, pages: 1, clicks: 2 });
        expect(sdk.sent.filter(a => a.method === 'sendInteractNpc').map(a => a.args)).toEqual([[9, 1], [9, 1]]);
    });

    test('wield and pickup confirm on state', async () => {
        const sword = { slot: 4, id: 1, name: 'Rune scimitar', count: 1, optionsWithIndex: [{ text: 'Wield', opIndex: 2 }] };
        const sdk = new FakeSdk(baseState({ tick: 1, inventory: [sword] }));
        const w = wield(sdk as never, /scimitar/i);
        await ticks(sdk, 1, () => ({ inventory: [], equipment: [sword] }));
        expect(await w).toMatchObject({ ok: true });
        expect(sdk.sent[0]).toEqual({ method: 'sendUseItem', args: [4, 2] });

        const g = new FakeSdk(baseState({ tick: 1, groundItems: [{ id: 7, name: 'Bucket', count: 1, x: 2, z: 2, distance: 1 }] }));
        const p = pickup(g as never, /bucket/i);
        await ticks(g, 1, () => ({ inventory: [{ slot: 0, id: 7, name: 'Bucket', count: 1, optionsWithIndex: [] }] }));
        expect(await p).toMatchObject({ ok: true, ticks: 1 });
    });

    test("wield takes a held item by its Hold op (a gree-gree's only wear op)", async () => {
        const gree = { slot: 3, id: 4031, name: 'Monkey greegree', count: 1, optionsWithIndex: [{ text: 'Hold', opIndex: 2 }, { text: 'Drop', opIndex: 5 }] };
        const sdk = new FakeSdk(baseState({ tick: 1, inventory: [gree] }));
        const w = wield(sdk as never, 4031);
        await ticks(sdk, 1, () => ({ inventory: [], equipment: [gree] }));
        expect(await w).toMatchObject({ ok: true });
        expect(sdk.sent[0]).toEqual({ method: 'sendUseItem', args: [3, 2] });
    });

    test('castTeleport waits for the jump', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1, player: player(3000, 3000) }));
        const p = castTeleport(sdk as never, 'varrock');
        await ticks(sdk, 4, i => (i === 3 ? { player: player(3213, 3424) } : {}));
        expect(await p).toMatchObject({ ok: true, ticks: 4, at: { x: 3213, z: 3424, level: 0 } });
        expect(sdk.sent[0]).toEqual({ method: 'sendClickComponent', args: [1164] });
    });

    test('castTeleport ends on the refusal message at once, ok false, instead of waiting out its timeout', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1, player: player(3000, 3000) }));
        const p = castTeleport(sdk as never, 'varrock');
        await ticks(sdk, 1, () => ({ gameMessages: [{ type: 0, text: 'A mysterious force blocks your teleport spell!', sender: '', tick: 2, fromSelf: false }] }));
        expect(await p).toMatchObject({ ok: false, ticks: 1, reason: 'refused: A mysterious force blocks your teleport spell!', at: { x: 3000, z: 3000 } });
        expect(sdk.sent).toEqual([{ method: 'sendClickComponent', args: [1164] }]);
    });

    test('castTeleport with a landing predicate takes a jump of 30 tiles or less onto the landing', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1, player: player(3241, 3248) }));
        const landing = (s: BotWorldState) => Math.abs(s.player!.worldX - 3221) <= 2 && Math.abs(s.player!.worldZ - 3218) <= 2;
        const p = castTeleport(sdk as never, 'lumbridge', 25, landing);
        await ticks(sdk, 4, i => (i === 3 ? { player: player(3222, 3219) } : {}));
        expect(await p).toMatchObject({ ok: true, ticks: 4, at: { x: 3222, z: 3219 } });
    });

    test('castTeleport re-casts a cast that drew nothing at the 6-tick bound of any world click', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1, player: player(3000, 3000) }));
        const p = castTeleport(sdk as never, 'ardougne');
        await ticks(sdk, 5); // tick 6: no animation, no runes taken, no message
        expect(sdk.sent.length).toBe(1);
        await ticks(sdk, 1); // tick 7: +6
        expect(sdk.sent).toEqual([{ method: 'sendClickComponent', args: [1540] }, { method: 'sendClickComponent', args: [1540] }]);
        await ticks(sdk, 3, i => (i === 2 ? { player: player(2661, 3302) } : {}));
        expect(await p).toMatchObject({ ok: true, resends: 1, ticks: 9 });
    });

    test('castTeleport never re-casts a cast that answered, however slow the landing', async () => {
        const runes: InventoryItem[] = [{ slot: 0, id: 563, name: 'Law rune', count: 2, optionsWithIndex: [] }];
        const sdk = new FakeSdk(baseState({ tick: 1, player: player(3000, 3000), inventory: runes }));
        const p = castTeleport(sdk as never, 'ardougne');
        // The cast animation and the runes taken on its first tick; the landing published 11 ticks later.
        await ticks(sdk, 12, i => (i === 0 ? { player: { ...player(3000, 3000), animId: 714 }, inventory: [{ ...runes[0]!, count: 1 }] } : i === 11 ? { player: player(2661, 3302) } : {}));
        expect(await p).toMatchObject({ ok: true, resends: 0, ticks: 12 });
        expect(sdk.sent.length).toBe(1);
    });

    test("castTeleport ends on a refusal the browser stamped with the cast's own tick", async () => {
        const sdk = new FakeSdk(baseState({ tick: 1, player: player(3000, 3000) }));
        const p = castTeleport(sdk as never, 'ardougne');
        await ticks(sdk, 1, () => ({ gameMessages: [{ type: 0, text: 'You must have completed Plague City to use this spell.', sender: '', tick: 1, observationId: 7, fromSelf: false }] }));
        expect(await p).toMatchObject({ ok: false, ticks: 1, reason: 'refused: You must have completed Plague City to use this spell.' });
        expect(sdk.sent.length).toBe(1);
    });

    test('castTeleport ignores a refusal message older than the cast', async () => {
        const old = { type: 0, text: 'You do not have enough Law Runes to cast this spell.', sender: '', tick: 1, fromSelf: false };
        const sdk = new FakeSdk(baseState({ tick: 1, player: player(3000, 3000), gameMessages: [old] }));
        const p = castTeleport(sdk as never, 'varrock');
        await ticks(sdk, 4, i => (i === 3 ? { player: player(3213, 3424) } : {}));
        expect(await p).toMatchObject({ ok: true, ticks: 4 });
    });
});

describe('actConverse', () => {
    const effect = (s: BotWorldState) => s.player?.worldX === 20;
    const click = (sdk: FakeSdk) => () => sdk.sendUseItem(0, 1);

    test('effect before dialogue still answers the later page and measures its closing tick', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1, player: player(10, 10) }));
        let settled = false;
        const p = actConverse(sdk, click(sdk), [], { done: effect, idle: 3 }).then(r => { settled = true; return r; });
        await ticks(sdk, 1, () => ({ player: player(20, 10) }));
        expect(settled).toBe(false);
        await ticks(sdk, 1, () => ({ dialog: cont('after-effect') }));
        await ticks(sdk, 1, () => ({ dialog: closed }));
        await ticks(sdk, 3);
        expect(await p).toMatchObject({ ok: true, startTick: 1, endTick: 4, ticks: 3, effectTick: 2, resends: 0, dialogue: { opened: true, pages: 1 } });
        expect(sdk.sent.map(a => a.method)).toEqual(['sendUseItem', 'clickDialogByText']);
    });

    test('dialogue closing does not complete a step until its required effect arrives', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1, player: player(10, 10) }));
        let settled = false;
        const p = actConverse(sdk, click(sdk), [], { done: effect, idle: 1, resendEvery: 2 }).then(r => { settled = true; return r; });
        await ticks(sdk, 1, () => ({ dialog: cont('before-effect') }));
        await ticks(sdk, 1, () => ({ dialog: closed }));
        await ticks(sdk, 4);
        expect(settled).toBe(false);
        expect(sdk.sent.filter(a => a.method === 'sendUseItem')).toHaveLength(1);
        await ticks(sdk, 1, () => ({ player: player(20, 10) }));
        expect(await p).toMatchObject({ ok: true, ticks: 7, endTick: 8, effectTick: 8, dialogue: { pages: 1 } });
    });

    test('remembers an effect that held only while dialogue was open', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1, player: player(10, 10) }));
        const p = actConverse(sdk, click(sdk), [], { done: effect, idle: 1 });
        await ticks(sdk, 1, () => ({ dialog: cont('first') }));
        await ticks(sdk, 1, () => ({ player: player(20, 10), dialog: cont('second') }));
        await ticks(sdk, 1, () => ({ player: player(10, 10), dialog: closed }));
        await ticks(sdk, 1);
        expect(await p).toMatchObject({ ok: true, effectTick: 3, endTick: 4, ticks: 3, dialogue: { pages: 2 } });
    });

    test('an initially true done still sends the click and allows delayed dialogue', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1, player: player(20, 10) }));
        let settled = false;
        const p = actConverse(sdk, click(sdk), [], { done: effect, idle: 3 }).then(r => { settled = true; return r; });
        await ticks(sdk, 2);
        expect(settled).toBe(false);
        await ticks(sdk, 1, () => ({ dialog: cont('already-had-item') }));
        await ticks(sdk, 1, () => ({ dialog: closed }));
        await ticks(sdk, 3);
        expect(await p).toMatchObject({ ok: true, effectTick: 1, endTick: 5, ticks: 4, dialogue: { pages: 1 } });
        expect(sdk.sent.filter(a => a.method === 'sendUseItem')).toHaveLength(1);
    });

    test('a required effect can succeed without dialogue, excluding the grace wait from ticks', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1, player: player(10, 10) }));
        const p = actConverse(sdk, click(sdk), [], { done: effect, idle: 2 });
        await ticks(sdk, 1, () => ({ player: player(20, 10) }));
        await ticks(sdk, 3);
        expect(await p).toMatchObject({ ok: true, ticks: 1, endTick: 2, effectTick: 2, dialogue: { opened: false } });
    });

    test('missing dialogue without an effect predicate is a failure', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1 }));
        const p = actConverse(sdk, click(sdk), [], { openTicks: 3, resendEvery: 0 });
        await ticks(sdk, 4);
        expect(await p).toMatchObject({ ok: false, ticks: 4, reason: 'no dialogue opened' });
    });

    test('a dropped click is retried until dialogue opens, then choices and continues are counted', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1 }));
        let clicks = 0;
        sdk.onSend = (a, f) => {
            if (a.method === 'sendUseItem' && ++clicks === 2) f.push({ dialog: cont('retry') });
        };
        const p = actConverse(sdk, click(sdk), ['Yes'], { resendEvery: 2, idle: 1 });
        await ticks(sdk, 3);
        await ticks(sdk, 1, () => ({ dialog: { isOpen: true, isWaiting: false, pageId: 'choice', options: [{ index: 1, text: 'Yes', buttonType: 1, componentId: 20 }] } }));
        await ticks(sdk, 1, () => ({ dialog: closed }));
        await ticks(sdk, 1);
        expect(await p).toMatchObject({ ok: true, resends: 1, endTick: 6, ticks: 5, dialogue: { pages: 1, options: 1, remaining: [] } });
        expect(clicks).toBe(2);
    });

    test('a required effect that never arrives fails even after dialogue was answered', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1 }));
        const p = actConverse(sdk, click(sdk), [], { done: effect, idle: 1, maxTicks: 6 });
        await ticks(sdk, 3);
        await ticks(sdk, 1, () => ({ dialog: cont('late') }));
        await ticks(sdk, 1, () => ({ dialog: closed }));
        await ticks(sdk, 2);
        expect(await p).toMatchObject({ ok: false, endTick: 8, ticks: 7, effectTick: -1, reason: 'timeout', dialogue: { opened: true, pages: 1 } });
    });

    test('missing both effect and dialogue exhausts the action budget', async () => {
        const sdk = new FakeSdk(baseState({ tick: 1 }));
        const p = actConverse(sdk, click(sdk), [], { done: effect, maxTicks: 4, resendEvery: 0 });
        await ticks(sdk, 5);
        expect(await p).toMatchObject({ ok: false, ticks: 5, effectTick: -1, reason: 'done never held' });
    });
});

describe('action segment recording', () => {
    test('records the later dialogue end, page counts and original interaction', async () => {
        const { step } = await import('../../docs/speedrun/scripts/quest-plague-city-segments');
        const { Recorder } = await import('../lab/record');
        const sdk = new FakeSdk(baseState({ tick: 1, player: player(10, 10) }));
        const rec = new Recorder(sdk, 'test');
        const p = step(rec, sdk as never, 'use item', () => sdk.sendUseItem(0, 1), {
            done: s => s.player?.worldX === 20, idle: 2,
        });
        await ticks(sdk, 1, () => ({ player: player(20, 10) }));
        await ticks(sdk, 1, () => ({ dialog: cont('message') }));
        await ticks(sdk, 1, () => ({ dialog: closed }));
        await ticks(sdk, 2);
        expect(await p).toMatchObject({ startTick: 1, endTick: 4, ticks: 3, pages: 1, interactions: 1, runs: '1c' });
        expect(rec.segments).toHaveLength(1);
        expect(rec.cur).toBeNull();
    });

    test('records timeout at the stop tick, not an earlier dialogue close', async () => {
        const { step } = await import('../../docs/speedrun/scripts/quest-plague-city-segments');
        const { Recorder } = await import('../lab/record');
        const sdk = new FakeSdk(baseState({ tick: 1 }));
        const rec = new Recorder(sdk, 'test');
        const p = step(rec, sdk as never, 'missing effect', () => sdk.sendUseItem(0, 1), {
            done: () => false, idle: 1, maxTicks: 4,
        });
        await ticks(sdk, 1, () => ({ dialog: cont('message') }));
        await ticks(sdk, 1, () => ({ dialog: closed }));
        await ticks(sdk, 3);
        expect(await p).toMatchObject({ startTick: 1, endTick: 6, ticks: 5, pages: 1, interactions: 1, note: 'timeout' });
    });
});

describe('useOn', () => {
    const inv = (...items: Array<[number, string, number?]>) =>
        items.map(([slot, name, count]) => ({ slot, id: 100 + slot, name, count: count ?? 1, optionsWithIndex: [] }));
    const holding = (extra: Partial<BotWorldState> = {}) => new FakeSdk(baseState({ tick: 1, player: { ...player(10, 10), animId: -1 }, inventory: inv([3, 'Key'], [5, 'Twigs']), ...extra }));
    const keyGone = (s: BotWorldState) => !s.inventory.some(i => i.name === 'Key');

    test('a loc given by tile and id is sent as is, without a lookup', async () => {
        const sdk = holding();
        sdk.scanNearbyLocs = async () => { throw new Error('no scan expected'); };
        const p = useOn(sdk as never, 'Key', { loc: { x: 2480, z: 3463, id: 2436 } }, keyGone);
        await ticks(sdk, 2);
        await ticks(sdk, 1, () => ({ inventory: inv([5, 'Twigs']) }));
        expect(await p).toMatchObject({ ok: true, resends: 0, landed: true, target: { kind: 'loc', x: 2480, z: 3463, id: 2436 } });
        expect(sdk.sent).toEqual([{ method: 'sendUseItemOnLoc', args: [3, 2480, 3463, 2436] }]);
    });

    test('no blind re-send by default: a walk toward the target, then a slow effect', async () => {
        const sdk = holding();
        const p = useOn(sdk as never, 'Key', { loc: { x: 0, z: 0, id: 1 } }, keyGone);
        await ticks(sdk, 4, i => ({ player: { ...player(10 - i, 10), animId: -1 } }));
        await ticks(sdk, 3, () => ({ player: { ...player(6, 10), animId: 832 } }));
        await ticks(sdk, 5);
        await ticks(sdk, 1, () => ({ inventory: inv([5, 'Twigs']) }));
        expect(await p).toMatchObject({ ok: true, resends: 0 });
    });

    test('a click that evidently did nothing is sent once more after droppedAfter ticks', async () => {
        const sdk = holding();
        const p = useOn(sdk as never, 'Key', { loc: { x: 0, z: 0, id: 1 } }, keyGone, { droppedAfter: 4 });
        await ticks(sdk, 3);
        expect(sdk.sent.length).toBe(1);
        await ticks(sdk, 1);
        expect(sdk.sent.length).toBe(2);
        await ticks(sdk, 1, () => ({ inventory: inv([5, 'Twigs']) }));
        expect(await p).toMatchObject({ ok: true, resends: 1 });
    });

    test('a use that landed and did not satisfy done is never re-sent', async () => {
        const sdk = holding();
        const p = useOn(sdk as never, 'Key', { loc: { x: 0, z: 0, id: 1 } }, keyGone, { droppedAfter: 2, maxTicks: 8 });
        await ticks(sdk, 1, () => ({ gameMessages: [{ type: 0, text: 'Nothing interesting happens.', sender: '', tick: 2, fromSelf: false }] }));
        await ticks(sdk, 9);
        expect(await p).toMatchObject({ ok: false, resends: 0, landed: true, reason: 'done never held' });
    });

    test("\"I can't reach that!\" is a drop: re-sent at once", async () => {
        const sdk = holding();
        const p = useOn(sdk as never, 'Key', { loc: { x: 0, z: 0, id: 1 } }, keyGone, { maxTicks: 3 });
        await ticks(sdk, 1, () => ({ gameMessages: [{ type: 0, text: "I can't reach that!", sender: '', tick: 2, fromSelf: false }] }));
        await ticks(sdk, 3);
        expect((await p).resends).toBe(1);
    });

    test("\"I can't reach that!\" stamped with the click's own tick (the browser) is a drop too", async () => {
        const sdk = holding();
        const t = sdk.state!.tick;
        const p = useOn(sdk as never, 'Key', { loc: { x: 0, z: 0, id: 1 } }, keyGone, { maxTicks: 3 });
        await ticks(sdk, 1, () => ({ gameMessages: [{ type: 0, text: "I can't reach that!", sender: '', tick: t, observationId: 50, fromSelf: false }] }));
        await ticks(sdk, 3);
        expect((await p).resends).toBe(1);
    });

    test('resendEvery opts in to act\'s blind re-send', async () => {
        const sdk = holding();
        const p = useOn(sdk as never, 'Key', { loc: { x: 0, z: 0, id: 1 } }, () => false, { resendEvery: 2, droppedAfter: 0, maxResends: 3, maxTicks: 7 });
        await ticks(sdk, 1, () => ({ gameMessages: [{ type: 0, text: 'Nothing interesting happens.', sender: '', tick: 2, fromSelf: false }] }));
        await ticks(sdk, 8);
        expect((await p).resends).toBe(3);
    });

    test('on an npc by name, and on another item (never its own slot)', async () => {
        const sdk = holding({ nearbyNpcs: [npc(42, 'Zooknock')], inventory: inv([3, 'Twigs'], [5, 'Twigs']) });
        const a = useOn(sdk as never, 'Twigs', { npc: /zooknock/i }, () => true);
        await ticks(sdk, 1);
        expect(await a).toMatchObject({ ok: true, target: { kind: 'npc', index: 42 } });
        const b = useOn(sdk as never, 'Twigs', { item: 'Twigs' }, () => true);
        await ticks(sdk, 1);
        expect(await b).toMatchObject({ target: { kind: 'item', slot: 5 } });
        expect(sdk.sent.map(s => [s.method, ...s.args])).toEqual([['sendUseItemOnNpc', 3, 42], ['sendUseItemOnItem', 3, 5]]);
    });

    test('throws when the item is not held', async () => {
        const sdk = holding({ inventory: [] });
        await expect(useOn(sdk as never, 'Key', { loc: { x: 0, z: 0, id: 1 } }, () => true)).rejects.toThrow(/no Key in the inventory/);
    });
});
