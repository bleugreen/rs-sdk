import { afterAll, describe, expect, mock, test } from 'bun:test';

import { CollisionFlag } from '#/dash3d/CollisionFlag.js';
import { LocAngle } from '#/dash3d/LocAngle.js';
import { LocShape } from '#/dash3d/LocShape.js';
import { MapFlag } from '#/dash3d/MapFlag.js';
import { ClientProt } from '#/io/ClientProt.js';
import { ServerProt } from '#/io/ServerProt.js';

mock.module('#3rdparty/tinymidipcm.js', () => ({
    stopMidi() {},
    setMidiVolume() {},
    playMidi() {}
}));
mock.module('#/client/MobileKeyboard.js', () => ({
    default: {
        draw() {},
        show() {},
        hide() {},
        isDisplayed: () => false,
        isWithinCanvasKeyboard: () => false,
        captureMouseDown() {},
        captureMouseUp() {},
        notifyTouchMove() {}
    }
}));

(globalThis as any).window = {
    audioContext: {
        currentTime: 0,
        destination: {},
        createGain() {
            return {
                gain: { setValueAtTime() {}, linearRampToValueAtTime() {} },
                connect() {}
            };
        },
        createBuffer() {
            return { copyToChannel() {} };
        },
        createBufferSource() {
            return { connect() {}, start() {}, stop() {} };
        }
    }
};
(globalThis as any).navigator = { userAgent: 'bun-test' };
(globalThis as any).fetch = async () => ({
    arrayBuffer: async () => new ArrayBuffer(0)
});
(globalThis as any).document = {
    hidden: false,
    body: { appendChild() {}, removeChild() {} },
    addEventListener() {},
    removeEventListener() {},
    getElementById() { return null; },
    createElement(tag: string) {
        const element = {
            style: {},
            setAttribute() {},
            addEventListener() {},
            removeEventListener() {},
            dispatchEvent() {},
            focus() {},
            blur() {}
        };
        if (tag === 'canvas') {
            return {
                ...element,
                getContext: () => ({
                    clearRect() {},
                    drawImage() {},
                    getImageData() { return {}; }
                })
            };
        }
        return element;
    }
};

const { Client } = await import('../client/Client.js');
const { default: LocType } = await import('#/config/LocType.js');
const { default: ObjType } = await import('#/config/ObjType.js');
const { default: NpcType } = await import('#/config/NpcType.js');
const { default: IfType } = await import('#/config/IfType.js');
const { default: Packet } = await import('#/io/Packet.js');
const { default: ClientPlayer, PlayerUpdate } = await import('#/dash3d/ClientPlayer.js');
const { ActionExecutor } = await import('./ActionExecutor.js');
const { BotStateCollector } = await import('./StateCollector.js');
const { BotOverlay } = await import('./BotOverlay.js');
const { BotActionQueue } = await import('./ActionQueue.js');
const { LiteClient } = await import('../lite/LiteClient.js');
const { dispatch } = await import('../lite/protocol/incoming.js');
const { captureBaseInterfaces, resetBaseInterfaces } = await import('../lite/interfaces.js');
const { BotSDK } = await import('../../../../sdk/index.js');
const { default: ClientBuild } = await import('../client/ClientBuild.js');
const { default: World } = await import('#/dash3d/World.js');
const { default: CollisionMap, BuildArea } = await import('#/dash3d/CollisionMap.js');
const { default: LinkList } = await import('#/datastruct/LinkList.js');
const { ReachProbe } = await import('./reach.js');

const BUTTON_OK = 1;
const BUTTON_CLOSE = 3;

/** Install a component in the shared IfType registry the client reads from. */
function defineComponent(id: number, com: Record<string, unknown>): void {
    IfType.list[id] = { id, ...com } as never;
}

/** Register an item definition ObjType.list() will hand back untouched. */
function defineObj(id: number, name: string): void {
    const obj = Object.assign(Object.create(ObjType.prototype), { id, name });
    ObjType.recent = [obj];
    ObjType.idx = new Int32Array(id + 1) as never;
    ObjType.dat = {} as never;
}

// Drive real incoming decoders, state collection, SDK selection and outgoing
// packet writers without a game connection or downloaded interface archive.
for (const kind of ['browser', 'lite'] as const) {
    describe(`${kind} guarded dialogue clicks`, () => {
        function fixture() {
            defineComponent(9200, { children: [9201, 9202], text: 'First question' });
            defineComponent(9201, { buttonType: BUTTON_OK, buttonText: 'Select', text: 'Yes' });
            defineComponent(9202, { buttonType: BUTTON_OK, buttonText: 'Select', text: 'No' });
            defineComponent(9210, { children: [9211], text: 'Second question' });
            defineComponent(9211, { buttonType: BUTTON_OK, buttonText: 'Select', text: 'Destroy item' });
            defineComponent(9220, { text: 'Unrelated sidebar text', layerId: -1 });
            const out = new Packet(new Uint8Array(64));
            let client: any;
            if (kind === 'lite') {
                resetBaseInterfaces();
                captureBaseInterfaces();
                client = new LiteClient({
                    connection: { out, isClosed: false } as never,
                    locIndex: {} as never, username: 'dialog-test', password: 'x'
                });
            } else {
                client = Object.assign(Object.create(Client.prototype), {
                    out, ingame: true, chatModalId: -1, sideModalId: -1,
                    mainModalId: -1, resumedPauseButton: false,
                    sideIcon: [], activeIcon: 0, randomIn: null,
                    captureDialogToHistory() {}
                });
            }
            const executor = new ActionExecutor(client);
            const collector = new BotStateCollector(client);
            const snapshot = () => {
                if (kind === 'lite') client.activate();
                return (collector as any).collectDialogState();
            };
            const receive = async (opcode: number, id: number, text?: string | boolean) => {
                const body = new Packet(new Uint8Array(128));
                body.p2(id);
                if (typeof text === 'string') body.pjstr(text);
                else if (typeof text === 'boolean') body.p1(text ? 1 : 0);
                const size = body.pos;
                body.pos = 0;
                if (kind === 'lite') {
                    dispatch(client, opcode, body, size);
                } else {
                    client.ptype = opcode;
                    client.psize = size;
                    client.in = new Packet(new Uint8Array(128));
                    client.stream = {
                        available: size,
                        async readBytes(dst: Uint8Array, offset: number, length: number) {
                            dst.set(body.data.subarray(0, length), offset);
                        }
                    };
                    expect(await client.tcpIn()).toBe(true);
                }
            };
            const choose = async (inFlight?: () => Promise<void>) => {
                const sdk = new BotSDK({ botUsername: 'dialog-test' });
                (sdk as any).state = { dialog: snapshot() };
                (sdk as any).sendAction = async (action: any) => {
                    await inFlight?.();
                    return executor.execute(action);
                };
                return sdk.clickDialogByText(/^Yes$/);
            };
            return { client, out, receive, snapshot, choose, executor };
        }

        test('unchanged page sends the selected IF_BUTTON component', async () => {
            const f = fixture();
            await f.receive(ServerProt.IF_OPENCHAT, 9200);
            const first = f.snapshot();
            expect(first.pageId).toBeDefined();
            expect(f.snapshot().pageId).toBe(first.pageId);
            expect(first.options[0].componentId).toBe(9201);
            expect((await f.choose()).success).toBe(true);
            expect(Array.from(f.out.data.subarray(0, f.out.pos))).toEqual([ClientProt.IF_BUTTON, 9201 >> 8, 9201 & 255]);
        });

        for (const change of ['different interface', 'reopened identical page', 'same buttons, new question', 'unsampled text round trip'] as const) {
            test(`rejects ${change} without writing any game packet`, async () => {
                const f = fixture();
                await f.receive(ServerProt.IF_OPENCHAT, 9200);
                const result = await f.choose(async () => {
                    if (change === 'different interface') await f.receive(ServerProt.IF_OPENCHAT, 9210);
                    else if (change === 'reopened identical page') await f.receive(ServerProt.IF_OPENCHAT, 9200);
                    else {
                        await f.receive(ServerProt.IF_SETTEXT, 9200, 'Second question');
                        if (change === 'unsampled text round trip') await f.receive(ServerProt.IF_SETTEXT, 9200, 'First question');
                    }
                });
                expect(result).toMatchObject({ success: false, phase: 'validation', reason: 'stale_dialog' });
                expect(f.out.pos).toBe(0);
            });
        }

        for (const id of [9200, 9220]) {
            test(`does not reject unchanged dialogue after text packet for ${id}`, async () => {
                const f = fixture();
                await f.receive(ServerProt.IF_OPENCHAT, 9200);
                const result = await f.choose(() => f.receive(ServerProt.IF_SETTEXT, id,
                    id === 9200 ? 'First question' : 'Updated sidebar'));
                expect(result.success).toBe(true);
                expect(f.out.pos).toBe(3);
            });
        }

        test('rejects a component ID that does not match the selected option', async () => {
            const f = fixture();
            await f.receive(ServerProt.IF_OPENCHAT, 9200);
            expect(f.executor.execute({
                type: 'clickDialogOption', optionIndex: 1, reason: 'test',
                guard: { pageId: f.snapshot().pageId, componentId: 9202 }
            })).toMatchObject({ success: false, reason: 'stale_dialog' });
            expect(f.out.pos).toBe(0);
        });

        test('rejects an unsampled hide/unhide round trip', async () => {
            const f = fixture();
            await f.receive(ServerProt.IF_OPENCHAT, 9200);
            // Establish the original boolean value rather than undefined.
            await f.receive(ServerProt.IF_SETHIDE, 9201, false);
            expect(await f.choose(async () => {
                await f.receive(ServerProt.IF_SETHIDE, 9201, true);
                await f.receive(ServerProt.IF_SETHIDE, 9201, false);
            })).toMatchObject({ success: false, reason: 'stale_dialog' });
            expect(f.out.pos).toBe(0);
        });

        test('guarded Continue sends RESUME once and rejects its waiting snapshot', async () => {
            const f = fixture();
            defineComponent(9230, { children: [9231] });
            defineComponent(9231, { buttonType: 6, buttonText: 'Continue', text: '' });
            if (kind === 'lite') {
                f.client.interfaces.list[9230] = IfType.list[9230];
                f.client.interfaces.list[9231] = IfType.list[9231];
            }
            await f.receive(ServerProt.IF_OPENCHAT, 9230);
            const action = {
                type: 'clickDialogOption' as const, optionIndex: 1, reason: 'test',
                guard: { pageId: f.snapshot().pageId, componentId: 9231 }
            };
            expect(f.executor.execute(action)).toMatchObject({ success: true });
            expect(Array.from(f.out.data.subarray(0, f.out.pos))).toEqual([ClientProt.RESUME_PAUSEBUTTON, 9231 >> 8, 9231 & 255]);
            expect(f.executor.execute(action)).toMatchObject({ success: false, reason: 'stale_dialog' });
            expect(f.out.pos).toBe(3);
        });

        test('a continued page keeps its id until the next page arrives', async () => {
            const f = fixture();
            defineComponent(9230, { children: [9231] });
            defineComponent(9231, { buttonType: 6, buttonText: 'Continue', text: '' });
            if (kind === 'lite') {
                f.client.interfaces.list[9230] = IfType.list[9230];
                f.client.interfaces.list[9231] = IfType.list[9231];
            }
            await f.receive(ServerProt.IF_OPENCHAT, 9230);
            const before = f.snapshot();
            expect(f.executor.execute({
                type: 'clickDialogOption', optionIndex: 1, reason: 'test',
                guard: { pageId: before.pageId, componentId: 9231 }
            })).toMatchObject({ success: true });

            // Published while the server has not answered yet: the same page,
            // marked waiting, never a fresh id a script could mistake for the
            // next page and answer early.
            expect(f.snapshot()).toMatchObject({ isOpen: true, isWaiting: true, pageId: before.pageId });

            // The next page is new even when its content is identical.
            await f.receive(ServerProt.IF_OPENCHAT, 9230);
            const next = f.snapshot();
            expect(next.isWaiting).toBe(false);
            expect(next.pageId).toBeDefined();
            expect(next.pageId).not.toBe(before.pageId);
        });

        if (kind === 'lite') {
            test('a token from a different client cannot select an identical page', async () => {
                const a = fixture();
                await a.receive(ServerProt.IF_OPENCHAT, 9200);
                const pageId = a.snapshot().pageId;
                const b = fixture();
                await b.receive(ServerProt.IF_OPENCHAT, 9200);
                expect(b.client.executeBotAction({
                    type: 'clickDialogOption', optionIndex: 1, reason: 'test',
                    guard: { pageId, componentId: 9201 }
                })).toMatchObject({ success: false, reason: 'stale_dialog' });
                expect(b.out.pos).toBe(0);
                // This also reactivates a's component table after b's packet.
                expect(a.client.executeBotAction({
                    type: 'clickDialogOption', optionIndex: 1, reason: 'test',
                    guard: { pageId, componentId: 9201 }
                })).toMatchObject({ success: true });
                expect(a.out.pos).toBe(3);
            });
        }

        test('preserves explicitly unguarded low-level index clicks', async () => {
            const f = fixture();
            await f.receive(ServerProt.IF_OPENCHAT, 9200);
            expect(f.executor.execute({ type: 'clickDialogOption', optionIndex: 2, reason: 'test' })).toMatchObject({ success: true });
            expect(Array.from(f.out.data.subarray(0, f.out.pos))).toEqual([ClientProt.IF_BUTTON, 9202 >> 8, 9202 & 255]);
        });

        describe(`${kind} blind dialogue continue`, () => {
            const BUTTON_CONTINUE = 6;

            /** 9230: a pure continue page. 9240: a continue beside a pending choice. */
            function continueFixture() {
                const f = fixture();
                defineComponent(9230, { children: [9231] });
                defineComponent(9231, { buttonType: BUTTON_CONTINUE, buttonText: 'Continue', text: '' });
                defineComponent(9240, { children: [9241, 9242] });
                defineComponent(9241, { buttonType: BUTTON_CONTINUE, buttonText: 'Continue', text: '' });
                defineComponent(9242, { buttonType: BUTTON_OK, buttonText: 'Select', text: 'Maybe' });
                if (kind === 'lite') {
                    for (const id of [9230, 9231, 9240, 9241, 9242]) f.client.interfaces.list[id] = IfType.list[id];
                }
                const click = (optionIndex: number, blind?: unknown) => f.executor.execute({
                    type: 'clickDialogOption', optionIndex, reason: 'test',
                    ...(blind === undefined ? {} : { blind: blind as boolean })
                });
                const bytes = () => Array.from(f.out.data.subarray(0, f.out.pos));
                return { ...f, click, bytes };
            }

            const resume = (id: number) => [ClientProt.RESUME_PAUSEBUTTON, id >> 8, id & 255];

            for (const [optionIndex, id] of [[0, 9230], [1, 9231]] as const) {
                test(`unflagged option ${optionIndex} still waits for the next page`, async () => {
                    const f = continueFixture();
                    await f.receive(ServerProt.IF_OPENCHAT, 9230);
                    expect(f.click(optionIndex)).toMatchObject({ success: true });
                    expect(f.click(optionIndex)).toMatchObject({ success: false, reason: 'client_rejected' });
                    expect(f.bytes()).toEqual(resume(id));
                });

                test(`blind option ${optionIndex} sends a second RESUME without a new page`, async () => {
                    const f = continueFixture();
                    await f.receive(ServerProt.IF_OPENCHAT, 9230);
                    expect(f.click(optionIndex, true)).toMatchObject({ success: true, message: `Clicked dialog option ${optionIndex} (blind)` });
                    expect(f.click(optionIndex, true)).toMatchObject({ success: true });
                    expect(f.bytes()).toEqual([...resume(id), ...resume(id)]);
                    expect(f.client.isWaitingForDialog()).toBe(true);
                });

                test(`blind option ${optionIndex} is refused with no chat modal`, () => {
                    const f = continueFixture();
                    expect(f.click(optionIndex, true)).toMatchObject({ success: false });
                    expect(f.out.pos).toBe(0);
                });
            }

            test('an unflagged click after a blind one is still latched', async () => {
                const f = continueFixture();
                await f.receive(ServerProt.IF_OPENCHAT, 9230);
                expect(f.click(0, true)).toMatchObject({ success: true });
                expect(f.click(0)).toMatchObject({ success: false });
                expect(f.bytes()).toEqual(resume(9230));
            });

            test('a guard still refuses a blind click while a continue is in flight', async () => {
                const f = continueFixture();
                await f.receive(ServerProt.IF_OPENCHAT, 9230);
                const guard = { pageId: f.snapshot().pageId, componentId: 9231 };
                const action = { type: 'clickDialogOption' as const, optionIndex: 1, reason: 'test', blind: true, guard };
                expect(f.executor.execute(action)).toMatchObject({ success: true });
                expect(f.executor.execute(action)).toMatchObject({ success: false, reason: 'stale_dialog' });
                expect(f.bytes()).toEqual(resume(9231));
            });

            test('only a literal true lifts the latch', async () => {
                const f = continueFixture();
                await f.receive(ServerProt.IF_OPENCHAT, 9230);
                expect(f.click(0, 'yes')).toMatchObject({ success: true, message: 'Clicked dialog option 0' });
                expect(f.click(0, 1)).toMatchObject({ success: false });
                expect(f.bytes()).toEqual(resume(9230));
            });

            test('blind continue is refused while a choice is displayed', async () => {
                const f = continueFixture();
                await f.receive(ServerProt.IF_OPENCHAT, 9200);
                expect(f.click(0, true)).toMatchObject({ success: false });
                expect(f.out.pos).toBe(0);
            });

            test('blind continue beside a pending choice is refused', async () => {
                const f = continueFixture();
                await f.receive(ServerProt.IF_OPENCHAT, 9240);
                expect(f.click(1, true)).toMatchObject({ success: false });
                expect(f.click(0, true)).toMatchObject({ success: false });
                expect(f.out.pos).toBe(0);
            });

            test('blind has no effect on an IF_BUTTON option', async () => {
                const f = continueFixture();
                await f.receive(ServerProt.IF_OPENCHAT, 9200);
                expect(f.click(2, true)).toMatchObject({ success: true });
                expect(f.bytes()).toEqual([ClientProt.IF_BUTTON, 9202 >> 8, 9202 & 255]);
            });
        });
    });
}

describe('browser game tick publication', () => {
    const bytesOf = (bits: string) => bits.padEnd(Math.ceil(bits.length / 8) * 8, '0').match(/.{8}/g)!.map(byte => parseInt(byte, 2));
    // Teleport the local player to plane 1, tile (55, 56), with a hitmark.
    // No old/new visible players; 2047 terminates the new-player bit list.
    const teleportPayload = [
        ...bytesOf('1' + '11' + '01' + '0110111' + '0111000' + '1' + '1' + '00000000' + '11111111111'),
        PlayerUpdate.HITMARK, 7, 1, 23, 30
    ];
    // A tick in which nothing about the local player changed.
    const idlePayload = bytesOf('0' + '00000000' + '11111111111');
    const playerInfo = (payload: number[]) => [ServerProt.PLAYER_INFO, 0, payload.length, ...payload];
    const runEnergy = (value: number) => [ServerProt.UPDATE_RUNENERGY, value];

    // Retain the real packet framing and decoders; only the socket is replaced
    // so these regressions need no game server or browser.
    function browserClient(wireBytes: number[]) {
        const wire = Uint8Array.from(wireBytes);
        let readPos = 0;
        const player = new ClientPlayer();
        player.teleport(true, 50, 50);
        player.health = 30;
        player.totalHealth = 30;
        const client = Object.assign(Object.create(Client.prototype), {
            stream: {
                get available() { return wire.length - readPos; },
                async readBytes(dst: Uint8Array, offset: number, length: number) {
                    dst.set(wire.subarray(readPos, readPos + length), offset);
                    readPos += length;
                }
            },
            in: new Packet(new Uint8Array(64)),
            ptype: -1,
            ptype0: -1,
            ptype1: -1,
            ptype2: -1,
            randomIn: null,
            localPlayer: player,
            players: { 2047: player },
            playerCount: 0,
            playerIds: new Int32Array(2048),
            entityRemovalIds: new Int32Array(2048),
            entityUpdateIds: new Int32Array(2048),
            minusedlevel: 0,
            runenergy: 0,
            awaitingPlayerInfo: true,
            lastTickTime: 0,
            pendingGameTicks: 0
        });
        const published: Array<Record<string, unknown>> = [];
        client.setOnGameTickCallback((ticks: number) => published.push({
            ticks,
            health: player.health,
            x: player.routeX[0],
            z: player.routeZ[0],
            level: client.minusedlevel,
            runenergy: client.runenergy,
            awaitingPlayerInfo: client.awaitingPlayerInfo
        }));
        return { client, published, unread: () => wire.length - readPos };
    }

    test('publishes a tick once, after the packets that follow its PLAYER_INFO', async () => {
        // The engine sends PLAYER_INFO before the tick's inventories, stats and
        // modals. Six more packets than the vanilla 5-per-cycle cap allows.
        const { client, published, unread } = browserClient([
            ...playerInfo(teleportPayload),
            ...[10, 20, 30, 40, 50, 60].flatMap(runEnergy)
        ]);

        await client.drainPackets();
        expect(published).toEqual([{
            ticks: 1, health: 23, x: 55, z: 56, level: 1, runenergy: 60, awaitingPlayerInfo: false
        }]);
        expect(unread()).toBe(0);
        expect(client.ptype).toBe(-1);

        await client.drainPackets();
        expect(published).toHaveLength(1);
    });

    test('keeps the vanilla 5-packet cap when no tick is pending', async () => {
        const { client, published, unread } = browserClient([1, 2, 3, 4, 5, 6, 7].flatMap(runEnergy));

        await client.drainPackets();
        expect(client.runenergy).toBe(5);
        expect(unread()).toBe(2 * 2);
        expect(published).toHaveLength(0);
    });

    test('counts every tick a backed-up cycle decodes in one publication', async () => {
        const { client, published, unread } = browserClient([
            ...playerInfo(teleportPayload),
            ...runEnergy(10),
            ...playerInfo(idlePayload),
            ...runEnergy(20)
        ]);

        await client.drainPackets();
        expect(published).toEqual([{
            ticks: 2, health: 23, x: 55, z: 56, level: 1, runenergy: 20, awaitingPlayerInfo: false
        }]);
        expect(unread()).toBe(0);
    });
});

describe('browser bot overlay action dispatch', () => {
    function overlay(execute: (action: { type: string }) => unknown) {
        const results: Array<[string, boolean]> = [];
        const o = Object.assign(Object.create(BotOverlay.prototype), {
            client: { idleTimer: 0 },
            actionQueue: new BotActionQueue(),
            waitTicks: 0,
            executor: { execute },
            gateway: {
                isConnected: () => false,
                sendActionResult: (id: string, r: { success: boolean }) => results.push([id, r.success])
            },
            ui: { logAction() {} }
        });
        const send = (type: string) => o.onAction({ type, reason: 't' }, type);
        return { o, results, send };
    }

    test('runs a burst of queued actions in one cycle', () => {
        const ran: string[] = [];
        const { o, results, send } = overlay(a => { ran.push(a.type); return { success: true, message: 'ok' }; });
        // knife on logs, the menu button, a drop and a click: one tick's burst
        for (const type of ['useItemOnItem', 'clickComponent', 'dropItem', 'interactNpc']) send(type);

        o.tick();
        expect(ran).toEqual(['useItemOnItem', 'clickComponent', 'dropItem', 'interactNpc']);
        expect(results.map(([id]) => id)).toEqual(ran);
    });

    test('stops the burst at an asynchronous action until it settles', async () => {
        const ran: string[] = [];
        let settle!: (r: unknown) => void;
        const { o, send } = overlay(a => {
            ran.push(a.type);
            return a.type === 'slow' ? new Promise(r => { settle = r; }) : { success: true, message: 'ok' };
        });
        for (const type of ['fast', 'slow', 'after']) send(type);

        o.tick();
        o.tick();
        expect(ran).toEqual(['fast', 'slow']);
        settle({ success: true, message: 'done' });
        await Promise.resolve();
        await Promise.resolve();
        o.tick();
        expect(ran).toEqual(['fast', 'slow', 'after']);
    });
});

describe('ranged spell dispatch', () => {
    test('dispatches a combat spell when adjacency routing fails', () => {
        const opcodes: number[] = [];
        const payload: number[] = [];
        const client = {
            ingame: true,
            out: { p2: (value: number) => payload.push(value) },
            localPlayer: { routeX: [1], routeZ: [1] },
            npc: { 42: { routeX: [5], routeZ: [6] } },
            tryMove: () => false,
            writePacketOpcode: (opcode: number) => opcodes.push(opcode)
        };

        const result = Client.prototype.spellOnNpc.call(client, 42, 1152);

        expect(result).toEqual({ success: true, routed: false });
        expect(opcodes).toEqual([ClientProt.OPNPCT]);
        expect(payload).toEqual([42, 1152]);
    });

    test('dispatches a combat spell at another player (OPPLAYERT)', () => {
        // Without this the only PvP magic was autocast, which needs a staff.
        const opcodes: number[] = [];
        const payload: number[] = [];
        const client = {
            ingame: true,
            out: { p2: (value: number) => payload.push(value) },
            localPlayer: { routeX: [1], routeZ: [1] },
            players: { 3: { routeX: [4], routeZ: [4] } },
            tryMove: () => true,
            writePacketOpcode: (opcode: number) => opcodes.push(opcode)
        };

        const result = Client.prototype.spellOnPlayer.call(client, 3, 1152);

        expect(result).toEqual({ success: true, routed: true });
        expect(opcodes).toEqual([ClientProt.OPPLAYERT]);
        expect(payload).toEqual([3, 1152]);
    });

    test('refuses to cast at a player the client cannot see', () => {
        const client = {
            ingame: true,
            out: { p2: () => { throw new Error('should not send'); } },
            localPlayer: { routeX: [1], routeZ: [1] },
            players: {},
            tryMove: () => true,
            writePacketOpcode: () => { throw new Error('should not send'); }
        };

        expect(Client.prototype.spellOnPlayer.call(client, 9, 1152))
            .toEqual({ success: false, reason: 'target_not_found' });
    });

    test('dispatches Telekinetic Grab even when adjacency routing fails', () => {
        const opcodes: number[] = [];
        const payload: number[] = [];
        const client = {
            ingame: true,
            out: { p2: (value: number) => payload.push(value) },
            localPlayer: { routeX: [1], routeZ: [1] },
            mapBuildBaseX: 3200,
            mapBuildBaseZ: 3200,
            tryMove: () => false,
            writePacketOpcode: (opcode: number) => opcodes.push(opcode)
        };

        const result = Client.prototype.spellOnGroundItem.call(
            client,
            3205,
            3206,
            995,
            1151
        );

        expect(result).toEqual({ success: true, routed: false });
        expect(opcodes).toEqual([ClientProt.OPOBJT]);
        expect(payload).toEqual([3205, 3206, 995, 1151]);
    });
});

describe('interactPlayer', () => {
    function playerClient(opcodes: number[], payload: number[]) {
        return {
            ingame: true,
            out: { p2: (value: number) => payload.push(value) },
            localPlayer: { routeX: [1], routeZ: [1] },
            players: { 5: { routeX: [2], routeZ: [2] } },
            tryMove: () => true,
            writePacketOpcode: (opcode: number) => opcodes.push(opcode)
        };
    }

    test('sends OPPLAYER2 for the attack option', () => {
        const opcodes: number[] = [];
        const payload: number[] = [];

        expect(Client.prototype.interactPlayer.call(playerClient(opcodes, payload), 5, 2))
            .toEqual({ success: true, routed: true });
        expect(opcodes).toEqual([ClientProt.OPPLAYER2]);
        expect(payload).toEqual([5]);
    });

    test('sends OPPLAYER5, which the engine binds but the client used to reject', () => {
        const opcodes: number[] = [];
        const payload: number[] = [];

        expect(Client.prototype.interactPlayer.call(playerClient(opcodes, payload), 5, 5))
            .toEqual({ success: true, routed: true });
        expect(opcodes).toEqual([ClientProt.OPPLAYER5]);
    });
});

describe('npc ap-range dispatch', () => {
    function npcClient(opcodes: number[], payload: number[], routable: boolean) {
        return {
            ingame: true,
            out: { p2: (value: number) => payload.push(value) },
            localPlayer: { routeX: [1], routeZ: [1] },
            npc: { 42: { routeX: [5], routeZ: [6], type: { size: 1 } } },
            tryMove: () => routable,
            writePacketOpcode: (opcode: number) => opcodes.push(opcode)
        };
    }

    test('interactNpc dispatches OPNPC even when routing fails', () => {
        // Wormbrain behind the Port Sarim jail bars: apnpc1 + p_aprange(3) is
        // the intended talk-through-the-bars mechanic, but the tile is never
        // routable. Aborting on the failed route made the interaction
        // impossible from the SDK while a human click worked.
        const opcodes: number[] = [];
        const payload: number[] = [];

        expect(Client.prototype.interactNpc.call(npcClient(opcodes, payload, false), 42, 1))
            .toEqual({ success: true, routed: false });
        expect(opcodes).toEqual([ClientProt.OPNPC1]);
        expect(payload).toEqual([42]);
    });

    test('talkToNpc dispatches OPNPC1 even when routing fails', () => {
        const opcodes: number[] = [];
        const payload: number[] = [];

        expect(Client.prototype.talkToNpc.call(npcClient(opcodes, payload, false), 42))
            .toEqual({ success: true, routed: false });
        expect(opcodes).toEqual([ClientProt.OPNPC1]);
    });

    test('routed stays true when the route succeeds', () => {
        const opcodes: number[] = [];
        const payload: number[] = [];

        expect(Client.prototype.interactNpc.call(npcClient(opcodes, payload, true), 42, 2))
            .toEqual({ success: true, routed: true });
        expect(opcodes).toEqual([ClientProt.OPNPC2]);
    });
});

describe('clickComponent', () => {
    test('closes the modal for a close-type button instead of sending IF_BUTTON', () => {
        // shop_template:com_77 ("Close Window"). The server has no if_button
        // trigger for it and answers "No trigger for [if_button,...]", leaving
        // the modal open and silently swallowing every following action.
        defineComponent(3902, { buttonType: BUTTON_CLOSE, text: 'Close Window' });

        const opcodes: number[] = [];
        let closed = 0;
        const client = {
            ingame: true,
            out: { p2: () => {} },
            writePacketOpcode: (opcode: number) => opcodes.push(opcode),
            closeModal: () => { closed++; }
        };

        expect(Client.prototype.clickComponent.call(client, 3902)).toBe(true);
        expect(closed).toBe(1);
        expect(opcodes).toEqual([]);
    });

    test('still sends IF_BUTTON for ordinary buttons', () => {
        defineComponent(3903, { buttonType: BUTTON_OK, buttonText: 'Buy 10' });

        const opcodes: number[] = [];
        const payload: number[] = [];
        const client = {
            ingame: true,
            out: { p2: (value: number) => payload.push(value) },
            writePacketOpcode: (opcode: number) => opcodes.push(opcode),
            closeModal: () => { throw new Error('should not close the modal'); }
        };

        expect(Client.prototype.clickComponent.call(client, 3903)).toBe(true);
        expect(opcodes).toEqual([ClientProt.IF_BUTTON]);
        expect(payload).toEqual([3903]);
    });
});

describe('getDialogOptions', () => {
    test('flattens the layout newlines skill dialogs pad product labels with', () => {
        // skill_multi3, as fletching opens it: Make X / Make 10 / Make 5 /
        // <product>, and only the make-1 button carries a name.
        defineComponent(9000, { children: [9001, 9002, 9003, 9004] });
        defineComponent(9001, { buttonType: BUTTON_OK, buttonText: 'Make X', text: '' });
        defineComponent(9002, { buttonType: BUTTON_OK, buttonText: 'Make 10', text: '' });
        defineComponent(9003, { buttonType: BUTTON_OK, buttonText: 'Make 5', text: '' });
        defineComponent(9004, { buttonType: BUTTON_OK, buttonText: 'Make 1', text: '\n\n\n\n15 Arrow Shafts' });

        const options = Client.prototype.getDialogOptions.call({ chatModalId: 9000 });

        expect(options.map(o => o.text)).toEqual(['Make X', 'Make 10', 'Make 5', '15 Arrow Shafts']);
        expect(options[3].index).toBe(4);
    });

    test('falls back to the button text when the label is only padding', () => {
        defineComponent(9100, { children: [9101] });
        defineComponent(9101, { buttonType: BUTTON_OK, buttonText: 'Make 5', text: '\n\n\n\n' });

        const options = Client.prototype.getDialogOptions.call({ chatModalId: 9100 });

        expect(options.map(o => o.text)).toEqual(['Make 5']);
    });
});

describe('loc routing', () => {
    type MoveArgs = {
        destX: number; destZ: number;
        locWidth: number; locLength: number;
        locAngle: number; locShape: number;
        forceapproach: number;
    };

    /** Back a stub with the real prototype so routeToLoc's private helpers resolve. */
    function asClient(stub: Record<string, unknown>): { routeToLoc(x: number, z: number, locId: number): boolean } {
        return Object.assign(Object.create(Client.prototype), stub);
    }

    /** Register a loc definition LocType.list() will hand back untouched. */
    function defineLoc(id: number, props: Partial<{ width: number; length: number; forceapproach: number }>): void {
        const loc = Object.assign(Object.create(LocType.prototype), {
            id, width: 1, length: 1, forceapproach: 0, ...props
        });
        LocType.recent = [loc];
        LocType.idx = new Int32Array(id + 1) as never;
        LocType.dat = {} as never;
    }

    /**
     * Route to a loc sitting on one tile, reporting the args tryMove received.
     * `typecode2` packs shape in the low 5 bits and angle at bit 6, as the scene does.
     */
    function route(locId: number, shape: number, angle: number): MoveArgs {
        let args: MoveArgs | null = null;
        const client = asClient({
            localPlayer: { routeX: [10], routeZ: [10] },
            minusedlevel: 0,
            world: {
                wallType: () => (shape <= 3 || shape === 9 ? (locId << 14) : 0),
                decorType: () => (shape >= 4 && shape <= 8 ? (locId << 14) : 0),
                sceneType: () => (shape >= 10 && shape <= 21 ? (locId << 14) : 0),
                gdType: () => (shape === 22 ? (locId << 14) : 0),
                typeCode2: () => shape | (angle << 6)
            },
            tryMove: (
                _srcX: number, _srcZ: number, destX: number, destZ: number, _tryNearest: boolean,
                locWidth: number, locLength: number, locAngle: number, locShape: number,
                forceapproach: number
            ) => {
                args = { destX, destZ, locWidth, locLength, locAngle, locShape, forceapproach };
                return true;
            }
        });

        client.routeToLoc(20, 30, locId);
        expect(args).not.toBeNull();
        return args!;
    }

    test('routes to a gate with the wall reach rule, not the rectangle one', () => {
        // Lumbridge chicken coop gate: shape 0 (WALL_STRAIGHT), angle 2 (EAST).
        // The rectangle rule accepts the tile west of the gate, which the server
        // rejects with "I can't reach that!" — the wall rule does not.
        defineLoc(1553, { width: 1, length: 1 });

        expect(route(1553, 0, 2)).toEqual({
            destX: 20, destZ: 30,
            locWidth: 0, locLength: 0,
            locAngle: 2, locShape: 1, // shape + 1, as tryMove expects
            forceapproach: 0
        });
    });

    test('routes to a wall decoration with the decor reach rule', () => {
        defineLoc(1234, { width: 1, length: 1 });

        expect(route(1234, 6, 3)).toMatchObject({ locWidth: 0, locLength: 0, locAngle: 3, locShape: 7 });
    });

    test('keeps the rotated rectangle footprint for centrepieces', () => {
        // A 3x1 loc rotated north swaps its footprint, and forceapproach rotates with it.
        defineLoc(4321, { width: 3, length: 1, forceapproach: 1 });

        expect(route(4321, 10, 1)).toEqual({
            destX: 20, destZ: 30,
            locWidth: 1, locLength: 3,
            locAngle: 0, locShape: 0,
            forceapproach: 2
        });
    });

    test('falls back to the rectangle footprint when the tile holds no such loc', () => {
        defineLoc(999, { width: 2, length: 2 });

        let args: MoveArgs | null = null;
        const client = asClient({
            localPlayer: { routeX: [1], routeZ: [1] },
            minusedlevel: 0,
            world: {
                wallType: () => 0, decorType: () => 0, sceneType: () => 0, gdType: () => 0,
                typeCode2: () => -1
            },
            tryMove: (
                _sx: number, _sz: number, destX: number, destZ: number, _tn: boolean,
                locWidth: number, locLength: number, locAngle: number, locShape: number, forceapproach: number
            ) => {
                args = { destX, destZ, locWidth, locLength, locAngle, locShape, forceapproach };
                return true;
            }
        });

        client.routeToLoc(5, 6, 999);

        expect(args).toMatchObject({ locWidth: 2, locLength: 2, locAngle: 0, locShape: 0 });
    });

    test('interactLoc dispatches OPLOC even when routing fails', () => {
        // Waterfall's "Swim to" rock is an aploc op: the trigger tile is never
        // routable, so aborting on a failed route strands the bot with no packet
        // sent and no game message. The server owns the reach check.
        defineLoc(1996, {});
        const opcodes: number[] = [];
        const payload: number[] = [];
        const client = {
            ingame: true,
            out: { p2: (value: number) => payload.push(value) },
            localPlayer: { routeX: [12], routeZ: [8] },
            mapBuildBaseX: 2500,
            mapBuildBaseZ: 3400,
            routeToLoc: () => false,
            writePacketOpcode: (opcode: number) => opcodes.push(opcode)
        };

        const result = Client.prototype.interactLoc.call(client as never, 2512, 3468, 1996, 1);

        expect(result).toEqual({ success: true, routed: false });
        expect(opcodes).toEqual([ClientProt.OPLOC1]);
        expect(payload).toEqual([2512, 3468, 1996]);
    });

    test('useItemOnLoc dispatches OPLOCU even when routing fails', () => {
        // Rope-on-rock, same aplocu shape as above.
        defineLoc(1996, {});
        defineObj(954, 'Rope');
        defineComponent(3214, { linkObjType: [955] });
        const opcodes: number[] = [];
        const payload: number[] = [];
        const client = {
            ingame: true,
            out: { p2: (value: number) => payload.push(value) },
            localPlayer: { routeX: [12], routeZ: [8] },
            mapBuildBaseX: 2500,
            mapBuildBaseZ: 3400,
            routeToLoc: () => false,
            writePacketOpcode: (opcode: number) => opcodes.push(opcode)
        };

        const result = Client.prototype.useItemOnLoc.call(client as never, 0, 2512, 3468, 1996, 3214);

        expect(result).toEqual({ success: true, routed: false });
        expect(opcodes).toEqual([ClientProt.OPLOCU]);
        expect(payload).toEqual([2512, 3468, 1996, 954, 0, 3214]);
    });
});

describe('held-object ops on modal inventories', () => {
    // The Monkey Madness hangar puzzle (reinitialisation_puzzle:com_3) moves a
    // tile in [opheld5,_mm_reinit]; INV_BUTTON5 there finds no trigger. The
    // lite twin of this test is in src/lite/action-encoding.test.ts.
    const REINIT_PUZZLE_GRID = 11130;
    const BANK_SIDE_INV = 2006;

    function recorder() {
        const opcodes: number[] = [];
        const payload: number[] = [];
        const iops: number[][] = [];
        const client = Object.assign(Object.create(Client.prototype), {
            ingame: true,
            out: { p2: (value: number) => payload.push(value) },
            writePacketOpcode: (opcode: number) => opcodes.push(opcode),
            clickInterfaceIop: (com: number, op: number, slot: number) => {
                iops.push([com, op, slot]);
                return true;
            }
        });
        return { client, opcodes, payload, iops };
    }

    test('the overlay sends OPHELD5 on the sliding-puzzle grid, not INV_BUTTON', () => {
        defineObj(385, 'Puzzle piece');
        const linkObjType = new Array(25).fill(0);
        linkObjType[24] = 386; // obj id + 1, as the client stores it
        defineComponent(REINIT_PUZZLE_GRID, { objOps: true, linkObjType });
        const { client, opcodes, payload, iops } = recorder();

        // The path an SDK sendUseItem(24, 5, 11130) takes through the overlay.
        const result = new ActionExecutor(client).execute({
            type: 'useInventoryItem', slot: 24, optionIndex: 5, interfaceId: REINIT_PUZZLE_GRID, reason: 'slide'
        });

        expect(result).toMatchObject({ success: true });
        expect(opcodes).toEqual([ClientProt.OPHELD5]);
        expect(payload).toEqual([385, 24, REINIT_PUZZLE_GRID]);
        expect(iops).toEqual([]);

        // An empty tile slot has nothing to move: nothing is written.
        expect(client.useInventoryItem(23, 5, REINIT_PUZZLE_GRID)).toBe(false);
        expect(opcodes).toEqual([ClientProt.OPHELD5]);
    });

    test('a component without objOps still gets its own iop as INV_BUTTON', () => {
        defineComponent(BANK_SIDE_INV, { objOps: false, linkObjType: [0, 386] });
        const { client, opcodes, iops } = recorder();

        expect(client.useInventoryItem(1, 4, BANK_SIDE_INV)).toBe(true);

        expect(iops).toEqual([[BANK_SIDE_INV, 4, 1]]);
        expect(opcodes).toEqual([]);
    });
});

describe('loc changes on bridged tiles', () => {
    // The browser twin of src/lite/zone-bridge.test.ts, through the authentic
    // path rather than a stub: ClientBuild places a map-level-1 door on a
    // LinkBelow tile into collision[0], finishBuild pushes the tile's scene down
    // to level 0, and the server's open-door packets are decoded by zonePacket
    // and applied by the game loop's loc-change queue at the player's level.
    // That is where the lite client once dropped the change (rs/54).
    const ZONE_X = 48;
    const ZONE_Z = 48;
    const DOOR_X = ZONE_X + 2;
    const DOOR_Z = ZONE_Z + 2;
    const CLOSED_DOOR = 1533;
    const OPEN_DOOR = 1534;

    const originalLocList = LocType.list;
    afterAll(() => {
        (LocType as unknown as { list: typeof originalLocList }).list = originalLocList;
    });

    /** A loc file with one loc, in ClientBuild.loadLocations' smart-delta format. */
    function locFile(locId: number, level: number, x: number, z: number, shape: number, angle: number): Uint8Array {
        const buf = new Packet(new Uint8Array(16));
        buf.p2(0x8000 + locId + 1);
        buf.p2(0x8000 + ((level << 12) | (x << 6) | z) + 1);
        buf.p1((shape << 2) | angle);
        buf.p1(0); // end of this loc's positions
        buf.p1(0); // end of locs
        return buf.data.subarray(0, buf.pos);
    }

    function bridgedScene() {
        // Every loc here is a 1x1 door that blocks walking. The scene keeps a
        // wall only when it has a model, so each gets a placeholder.
        (LocType as unknown as { list: (id: number) => unknown }).list = (id: number) =>
            Object.assign(new LocType(), {
                id, blockwalk: true, blockrange: true, active: true, width: 1, length: 1,
                getModel: () => ({})
            });

        const size = BuildArea.SIZE;
        const groundh = Array.from({ length: 4 }, () => Array.from({ length: size + 1 }, () => new Int32Array(size + 1)));
        const mapl = Array.from({ length: 4 }, () => Array.from({ length: size }, () => new Uint8Array(size)));
        for (let x = ZONE_X; x < ZONE_X + 8; x++) {
            for (let z = ZONE_Z; z < ZONE_Z + 8; z++) {
                mapl[1][x][z] = MapFlag.LinkBelow; // the fishing platform's floor
            }
        }
        const world = new World(groundh, size, 4, size);
        const collision = Array.from({ length: 4 }, () => {
            const map = new CollisionMap();
            map.reset();
            return map;
        });

        const build = new ClientBuild(size, size, groundh, mapl);
        build.loadLocations(locFile(CLOSED_DOOR, 1, DOOR_X, DOOR_Z, LocShape.WALL_STRAIGHT, LocAngle.WEST), 0, 0, world, collision);
        build.finishBuild(world, collision);

        const client = Object.assign(Object.create(Client.prototype), {
            world, collision, mapl, groundh,
            minusedlevel: 0,
            sceneState: 2,
            locChanges: new LinkList(),
            localPlayer: { routeX: [DOOR_X], routeZ: [DOOR_Z] }
        });
        return { client, collision };
    }

    /** What the server sends to open the door: delete it, add the swung-open leaf beside it. */
    function openDoor(client: any): void {
        client.zoneUpdateX = ZONE_X;
        client.zoneUpdateZ = ZONE_Z;
        client.zonePacket(new Packet(Uint8Array.from([(2 << 4) | 2, (LocShape.WALL_STRAIGHT << 2) | LocAngle.WEST])), ServerProt.LOC_DEL);
        client.zonePacket(
            new Packet(Uint8Array.from([(1 << 4) | 2, (LocShape.WALL_STRAIGHT << 2) | LocAngle.NORTH, OPEN_DOOR >> 8, OPEN_DOOR & 0xff])),
            ServerProt.LOC_ADD_CHANGE
        );
        client.locChangeDoQueue(); // the next game-loop cycle
    }

    function expectedCollision(walls: Array<[number, number, number]>) {
        const map = new CollisionMap();
        map.reset();
        for (const [x, z, angle] of walls) {
            map.addWall(x, z, LocShape.WALL_STRAIGHT, angle, true);
        }
        return map;
    }

    function differingTiles(actual: { flags: Int32Array }, expected: { flags: Int32Array }): number {
        let n = 0;
        for (let i = 0; i < expected.flags.length; i++) {
            if (actual.flags[i] !== expected.flags[i]) {
                n++;
            }
        }
        return n;
    }

    /**
     * Wall off everything around the door tile and the tile west of it, so the
     * only way from one to the other is through the doorway.
     */
    function enclose(map: { blockGround(x: number, z: number): void }): void {
        for (let x = DOOR_X - 2; x <= DOOR_X + 1; x++) {
            for (let z = DOOR_Z - 1; z <= DOOR_Z + 1; z++) {
                if (z !== DOOR_Z || (x !== DOOR_X && x !== DOOR_X - 1)) {
                    map.blockGround(x, z);
                }
            }
        }
    }

    test('a bridged loc is in the player-level scene and routes as closed', () => {
        const { client, collision } = bridgedScene();

        expect(client.locSceneInfo(DOOR_X, DOOR_Z, CLOSED_DOOR)).toEqual({ shape: LocShape.WALL_STRAIGHT, angle: LocAngle.WEST });
        expect(differingTiles(collision[0], expectedCollision([[DOOR_X, DOOR_Z, LocAngle.WEST]]))).toBe(0);
        expect(differingTiles(collision[1], expectedCollision([]))).toBe(0);

        enclose(collision[0]);
        expect(new ReachProbe(client).canReachTile(DOOR_X - 1, DOOR_Z)).toBe(false);
    });

    test('a door the server opens on a bridged floor opens for routing', () => {
        const { client, collision } = bridgedScene();
        expect(collision[0].flags[CollisionMap.index(DOOR_X, DOOR_Z)] & CollisionFlag.W_W).not.toBe(0);

        openDoor(client);

        // The closed leaf is gone from both the scene and the router; the open
        // leaf is in both.
        expect(client.locSceneInfo(DOOR_X, DOOR_Z, CLOSED_DOOR)).toBeNull();
        expect(client.locSceneInfo(DOOR_X - 1, DOOR_Z, OPEN_DOOR)).toEqual({ shape: LocShape.WALL_STRAIGHT, angle: LocAngle.NORTH });
        expect(differingTiles(collision[0], expectedCollision([[DOOR_X - 1, DOOR_Z, LocAngle.NORTH]]))).toBe(0);

        enclose(collision[0]);
        expect(new ReachProbe(client).canReachTile(DOOR_X - 1, DOOR_Z)).toBe(true);
    });
});

describe('config lookups outside the table', () => {
    /**
     * A config archive whose byte 0 is a payload-free opcode (17, blockwalk=false
     * for locs): a decode stuck at a NaN position re-reads it forever. The guard
     * on g1 turns that would-be hang into a failing assertion.
     */
    function guardedDat(bytes: number[]) {
        const dat = new Packet(Uint8Array.from(bytes));
        const g1 = dat.g1.bind(dat);
        dat.g1 = () => {
            if (!Number.isInteger(dat.pos)) {
                throw new Error(`decode read at pos ${dat.pos}`);
            }
            return g1();
        };
        return dat;
    }

    function installLocTable(): void {
        LocType.recent = Array.from({ length: 10 }, () => new LocType());
        LocType.recentPos = 0;
        LocType.idx = Int32Array.from([1]); // loc 0 is the bare terminator at pos 1
        LocType.dat = guardedDat([17, 0]);
    }

    test('LocType.list still decodes an id inside the table', () => {
        installLocTable();

        expect(LocType.list(0)).toMatchObject({ id: 0, blockwalk: true });
    });

    test.each([undefined, Number.NaN, -1, 1, 0.5])('LocType.list(%p) throws instead of decoding forever', id => {
        installLocTable();

        expect(() => LocType.list(id as number)).toThrow(RangeError);
    });

    test('NpcType.list rejects an id outside the table', () => {
        NpcType.recent = Array.from({ length: 20 }, () => new NpcType());
        NpcType.idx = Int32Array.from([1]);
        NpcType.dat = guardedDat([17, 0]);

        expect(() => NpcType.list(undefined as never)).toThrow(RangeError);
        expect(() => NpcType.list(-1)).toThrow(RangeError);
        expect(() => NpcType.list(1)).toThrow(RangeError);
    });

    test('ObjType.list rejects an id outside the table', () => {
        ObjType.recent = Array.from({ length: 10 }, () => new ObjType());
        ObjType.idx = Int32Array.from([1]);
        ObjType.dat = guardedDat([17, 0]);

        expect(() => ObjType.list(undefined as never)).toThrow(RangeError);
        expect(() => ObjType.list(-1)).toThrow(RangeError);
        expect(() => ObjType.list(1)).toThrow(RangeError);
    });

    test('browser interactLoc with no locId fails instead of hanging', () => {
        // sdk.sendInteractLoc(loc, 'chop') - the loc object lands in x, 'chop'
        // in z and locId is undefined. Every bounds check compares false on NaN.
        installLocTable();
        const client = {
            ingame: true,
            out: { p2() {} },
            localPlayer: { routeX: [12], routeZ: [8] },
            mapBuildBaseX: 2500,
            mapBuildBaseZ: 3400,
            routeToLoc: () => true,
            writePacketOpcode() {}
        };

        expect(() => Client.prototype.interactLoc.call(client as never, { x: 2512 } as never, 'chop' as never, undefined as never, 1))
            .toThrow(RangeError);
    });
});
