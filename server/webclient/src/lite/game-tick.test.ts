// A game tick is published once, after the whole tick has been decoded.
//
// The engine writes PLAYER_INFO early in each tick's message and the things a bot
// reacts to (npc moves, doors, items, the dialogue page) after it. Publishing
// from the PLAYER_INFO handler shows observers a half-applied tick and makes
// every reaction a tick late, so LiteClient.pumpPackets publishes after the
// drain instead.
//
// Drives the real framing path (handlePacket via pumpPackets over a fake socket).
// Needs no network: the interface baseline is stubbed empty when no earlier
// suite loaded the cache.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import './dom-shim.js';

import IfType from '#/config/IfType.js';
import Packet from '#/io/Packet.js';
import { ServerProt } from '#/io/ServerProt.js';

import { captureBaseInterfaces, resetBaseInterfaces } from './interfaces.js';
import { LiteClient } from './LiteClient.js';

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

function makeClient(name: string): { client: LiteClient; stream: FakeStream } {
    const stream = new FakeStream();
    const client = new LiteClient({
        connection: {
            stream,
            in: Packet.alloc(1),
            out: Packet.alloc(1),
            randomIn: { nextInt: 0 },
            isClosed: false
        } as never,
        locIndex: {} as never,
        username: name,
        password: 'x'
    });
    return { client, stream };
}

let stubbedBase = false;

beforeAll(() => {
    try {
        makeClient('probe');
    } catch {
        IfType.list = [];
        captureBaseInterfaces();
        stubbedBase = true;
    }
});

afterAll(() => {
    if (stubbedBase) {
        resetBaseInterfaces();
    }
});

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
