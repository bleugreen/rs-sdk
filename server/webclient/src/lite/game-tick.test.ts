// A game tick is published once, after the whole tick has been decoded.
//
// The engine writes PLAYER_INFO early in each tick's message and the things a bot
// reacts to (npc moves, doors, items, the dialogue page) after it. Publishing
// from the PLAYER_INFO handler shows observers a half-applied tick and makes
// every reaction a tick late, so LiteClient.pumpPackets publishes after the
// drain instead.
//
// And it is published when it arrives. The session's packet loop drains on the
// socket's message event rather than on its 20ms cycle, because the engine reads
// input once per tick and a polled drain spent up to a cycle of the gap a
// reaction has to land in. The cycle itself (frame counter, keepalive, idle
// watchdog) keeps its 20ms cadence however often the socket wakes the loop.
//
// Drives the real framing path (handlePacket via pumpPackets over a fake socket).
// Needs no network: the interface baseline is this suite's own stub.

import { describe, expect, test } from 'bun:test';

import './dom-shim.js';

import Packet from '#/io/Packet.js';
import { ServerProt } from '#/io/ServerProt.js';

import type { BotWorldState } from '#/bot/types.js';

import { LiteClient } from './LiteClient.js';
import { runPacketLoop, type PacketSocket } from './session.js';
import { stubComponent, useStubBaseline } from './test-support/stub-baseline.js';

/** A socket that hands back a byte script, which tests can extend between pumps. */
class FakeStream {
    readonly bytes: number[] = [];

    get available(): number {
        return this.bytes.length;
    }

    async readBytes(dst: Uint8Array, off: number, len: number): Promise<void> {
        for (let i = 0; i < len; i++) {
            dst[off + i] = this.bytes.shift() ?? 0;
        }
    }
}

/**
 * PLAYER_INFO with no local update and no other players: one 0 bit, an 8-bit
 * count of 0, padded to two bytes. Two-byte length prefix (ServerProtSizes -2).
 * `randomIn.nextInt` is stubbed to 0, so opcodes need no ISAAC offset.
 */
const PLAYER_INFO_EMPTY = [ServerProt.PLAYER_INFO, 0, 2, 0, 0];

/** IF_OPENCHAT: the engine opening a dialogue page, written after PLAYER_INFO. */
function openChat(comId: number): number[] {
    return [ServerProt.IF_OPENCHAT, (comId >> 8) & 0xff, comId & 0xff];
}

/** A world index with nothing in it, for tests that collect the whole state (the scene reads it). */
const EMPTY_WORLD = new Proxy({}, { get: () => () => 0 });

function makeClient(name: string, locIndex: object = {}): { client: LiteClient; stream: FakeStream } {
    const stream = new FakeStream();
    const client = new LiteClient({
        connection: {
            stream,
            in: Packet.alloc(1),
            out: Object.assign(Packet.alloc(1), { random: { nextInt: 0 } }),
            randomIn: { nextInt: 0 },
            isClosed: false,
            flush() {}
        } as never,
        locIndex: locIndex as never,
        username: name,
        password: 'x'
    });
    return { client, stream };
}

// The components the quest state reads: questlist:doric, the journal (8134),
// its title (8144) and qj1..qj50 (8145, 8147..8195).
useStubBaseline(
    [7336, 8134, 8144, 8145, ...Array.from({ length: 49 }, (_, i) => 8147 + i)].map(id => stubComponent(id, { colour: 0xff0000, text: '' }))
);

describe('game tick publication', () => {
    test('observers see packets written after PLAYER_INFO in the same tick', async () => {
        const { client, stream } = makeClient('tick1');
        const seen: { ticks: number; chatModalId: number }[] = [];
        client.setOnGameTickCallback(ticks => {
            seen.push({ ticks, chatModalId: client.chatModalId });
        });

        stream.bytes.push(...PLAYER_INFO_EMPTY, ...openChat(4882));
        await client.pumpPackets();

        expect(seen).toEqual([{ ticks: 1, chatModalId: 4882 }]);
    });

    test('a drain with no PLAYER_INFO publishes nothing', async () => {
        const { client, stream } = makeClient('tick2');
        let calls = 0;
        client.setOnGameTickCallback(() => {
            calls++;
        });

        stream.bytes.push(...openChat(4882));
        await client.pumpPackets();
        await client.pumpPackets();

        expect(calls).toBe(0);
    });

    test('a varp, quest-tab colour and journal sent after PLAYER_INFO are in that tick\'s published state', async () => {
        const { client, stream } = makeClient('quest1', EMPTY_WORLD);
        const published: BotWorldState[] = [];
        client.setOnGameTickCallback(ticks => {
            published.push(client.collectBotState(ticks));
        });

        const varpSmall = (id: number, value: number) => [ServerProt.VARP_SMALL, id >> 8, id & 0xff, value & 0xff];
        const varpLarge = (id: number, value: number) => [ServerProt.VARP_LARGE, id >> 8, id & 0xff, (value >>> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
        const setColour = (com: number, rgb15: number) => [ServerProt.IF_SETCOLOUR, com >> 8, com & 0xff, rgb15 >> 8, rgb15 & 0xff];
        const setText = (com: number, text: string) => {
            const body = [com >> 8, com & 0xff, ...Buffer.from(text, 'latin1'), 10];
            return [ServerProt.IF_SETTEXT, body.length >> 8, body.length & 0xff, ...body];
        };
        const openMain = (com: number) => [ServerProt.IF_OPENMAIN, com >> 8, com & 0xff];

        stream.bytes.push(
            ...PLAYER_INFO_EMPTY,
            ...varpSmall(101, 1), // qp, as ~send_quest_complete's ~update_questpoints sends it
            ...varpLarge(173, 1), // option_run
            ...setColour(7336, 31 << 5), // questlist:doric, ^green_rgb
            ...setText(8144, "@dre@Dorics' Quest"),
            // ~quest_journal sets all 50 lines, empty ones included: the cache's
            // own text for an unset line is its name ("qj3").
            ...setText(8145, '@str@I have spoken to Doric.'),
            ...setText(8147, '@dbl@Doric rewarded me for all my hard work'),
            ...Array.from({ length: 48 }, (_, i) => setText(8148 + i, '')).flat(),
            ...openMain(8134)
        );
        await client.pumpPackets();

        expect(published).toHaveLength(1);
        const s = published[0]!;
        expect(s.varps).toEqual({ qp: 1, option_run: 1, bankcert: 0 });
        expect(s.questPoints).toBe(1);
        expect(s.quests).toEqual({ doric: 'complete' });
        expect(s.questJournal).toEqual({
            title: "Dorics' Quest",
            lines: ['@str@I have spoken to Doric.', '@dbl@Doric rewarded me for all my hard work'],
            open: true,
            tick: 1
        });
    });

    test('queued ticks publish once, counted, and are not replayed', async () => {
        const { client, stream } = makeClient('tick3');
        const seen: number[] = [];
        client.setOnGameTickCallback(ticks => {
            seen.push(ticks);
        });

        // The loop fell behind: two ticks' messages are waiting in one drain.
        stream.bytes.push(...PLAYER_INFO_EMPTY, ...openChat(4882), ...PLAYER_INFO_EMPTY);
        await client.pumpPackets();
        expect(seen).toEqual([2]);

        stream.bytes.push(...PLAYER_INFO_EMPTY);
        await client.pumpPackets();
        expect(seen).toEqual([2, 1]);
    });
});

/** Stands in for GameConnection: delivering bytes fires the receive listener, as the socket does. */
class FakeSocket implements PacketSocket {
    private listener: (() => void) | null = null;
    closed = false;

    constructor(private readonly stream: FakeStream) {}

    onReceive(listener: () => void): void {
        this.listener = listener;
    }

    close(): void {
        this.closed = true;
    }

    deliver(bytes: number[]): void {
        this.stream.bytes.push(...bytes);
        this.listener?.();
    }
}

function startLoop(name: string): { client: LiteClient; socket: FakeSocket; loop: ReturnType<typeof runPacketLoop> } {
    const { client, stream } = makeClient(name);
    client.ingame = true;
    const socket = new FakeSocket(stream);
    return { client, socket, loop: runPacketLoop(client, socket, { username: name }) };
}

describe('session packet loop', () => {
    test('a tick is published when it arrives, not on the next 20ms cycle', async () => {
        const { client, socket, loop } = startLoop('loop1');
        const delays: number[] = [];
        let sentAt = 0;
        client.setOnGameTickCallback(() => {
            delays.push(performance.now() - sentAt);
        });

        try {
            // Land frames at assorted phases of the cycle. A polled drain would
            // publish each one 0-20ms late (median ~10); an event-driven one at once.
            for (let i = 0; i < 15; i++) {
                await Bun.sleep(7 + ((i * 5) % 13));
                sentAt = performance.now();
                socket.deliver(PLAYER_INFO_EMPTY);
            }
            await Bun.sleep(25);
        } finally {
            loop.stop();
            await loop.stopped;
        }

        expect(delays.length).toBe(15);
        const median = [...delays].sort((a, b) => a - b)[7];
        expect(median).toBeLessThan(4);
    });

    test('the client cycle keeps its 20ms cadence however often the socket wakes the loop', async () => {
        const { client, socket, loop } = startLoop('loop2');

        try {
            const start = performance.now();
            while (performance.now() - start < 200) {
                socket.deliver([]);
                await Bun.sleep(1);
            }
        } finally {
            loop.stop();
            await loop.stopped;
        }

        // ~11 cycles in 200ms (one at start, then every 20ms), not one per wake.
        expect(client.loopCycle).toBeGreaterThanOrEqual(6);
        expect(client.loopCycle).toBeLessThanOrEqual(13);
    });

    test('stop ends the loop with reason stopped and closes the socket', async () => {
        const { socket, loop } = startLoop('loop3');
        await Bun.sleep(5);

        loop.stop();
        const end = await loop.stopped;

        expect(end.reason).toBe('stopped');
        expect(socket.closed).toBe(true);
    });
});
