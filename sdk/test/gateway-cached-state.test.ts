// A bot's state on the gateway belongs to the client that published it, and is current only while
// that client is connected (rs/668). Attempt 3's 04:2xZ start: the run's controller connected for
// the account after a lite one-off had published and gone, was handed that one-off's last in-game
// state as if it were live, and waited 120 s for it to advance. These tests run the real gateway as
// a subprocess with scripted clients on both sides.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'path';

const PORT = 20000 + Math.floor(Math.random() * 10000);
const BASE = `http://127.0.0.1:${PORT}`;
const WS = `ws://127.0.0.1:${PORT}`;
const REPO_ROOT = join(import.meta.dir, '..', '..');

let gateway: ReturnType<typeof Bun.spawn> | null = null;
let seq = 0;

const state = (tick: number, extra: Record<string, unknown> = {}) => ({ tick, inGame: true, player: { name: 'x', worldX: 3222, worldZ: 3218 }, gameMessages: [], ...extra });

async function until(check: () => boolean | Promise<boolean>, ms: number, what: string) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
        if (await check()) return;
        await Bun.sleep(50);
    }
    throw new Error(`timed out waiting for ${what}`);
}

/** A client registered as `bot`'s publisher. */
async function publisher(bot: string): Promise<WebSocket> {
    const ws = new WebSocket(WS);
    await new Promise<void>(resolve => (ws.onopen = () => resolve()));
    ws.send(JSON.stringify({ type: 'connected', username: bot, clientId: `${bot}-${++seq}` }));
    await until(async () => (await status(bot)).status !== 'dead', 3_000, `${bot}'s publisher to register`);
    return ws;
}

/** A controller for `bot`: every state it is sent, from sdk_connected on. */
async function controller(bot: string): Promise<{ states: { tick: number }[]; close(): void }> {
    const ws = new WebSocket(WS);
    const states: { tick: number }[] = [];
    await new Promise<void>(resolve => {
        ws.onopen = () => ws.send(JSON.stringify({ type: 'sdk_connect', username: bot, clientId: 'test', mode: 'control' }));
        ws.onmessage = e => {
            const msg = JSON.parse(String(e.data)) as { type: string; state?: { tick: number } };
            if (msg.type === 'sdk_connected') resolve();
            if (msg.type === 'sdk_state' && msg.state) states.push(msg.state);
        };
    });
    return { states, close: () => ws.close() };
}

async function status(bot: string): Promise<{ status: string; inGame: boolean }> {
    return (await fetch(`${BASE}/status/${bot}`)).json() as Promise<{ status: string; inGame: boolean }>;
}

async function gone(ws: WebSocket, bot: string) {
    ws.close();
    await until(async () => (await status(bot)).status === 'dead', 3_000, `${bot}'s publisher to go`);
}

beforeAll(async () => {
    gateway = Bun.spawn({
        cmd: ['bun', join(REPO_ROOT, 'server', 'gateway', 'gateway.ts')],
        env: { ...process.env, AGENT_PORT: String(PORT), GATEWAY_HOSTNAME: '127.0.0.1', LOGIN_SERVER: 'false', ENGINE_MANAGEMENT_URL: 'http://127.0.0.1:1' },
        stdout: 'ignore',
        stderr: 'ignore',
    });
    await until(() => fetch(`${BASE}/status`, { signal: AbortSignal.timeout(500) }).then(r => r.ok, () => false), 15_000, 'the gateway to boot');
});

afterAll(() => {
    gateway?.kill();
});

describe("the gateway hands a controller a bot's last state only while its client is connected", () => {
    test('a controller connecting to a live client is handed its last state', async () => {
        const pub = await publisher('cs_live');
        pub.send(JSON.stringify({ type: 'state', state: state(10) }));
        await until(async () => (await status('cs_live')).inGame, 3_000, 'the state to land');
        const c = await controller('cs_live');
        await until(() => c.states.length > 0, 3_000, 'the handed state');
        expect(c.states.map(s => s.tick)).toEqual([10]);
        c.close();
        pub.close();
    });

    test('once the client has gone, a new controller is handed nothing; GET /state still shows the last one, marked dead', async () => {
        const pub = await publisher('cs_gone');
        pub.send(JSON.stringify({ type: 'state', state: state(5000) }));
        await until(async () => (await status('cs_gone')).inGame, 3_000, 'the state to land');
        await gone(pub, 'cs_gone');
        const c = await controller('cs_gone');
        await Bun.sleep(300);
        expect(c.states).toEqual([]);
        const read = (await (await fetch(`${BASE}/state/cs_gone`)).json()) as { state: { tick: number }; botStatus: string };
        expect(read).toMatchObject({ state: { tick: 5000 }, botStatus: 'dead' });
        c.close();
    });

    test("a new client never inherits the old one's state: a controller sees only what the new one publishes", async () => {
        const lite = await publisher('cs_next');
        lite.send(JSON.stringify({ type: 'state', state: state(5000) }));
        await until(async () => (await status('cs_next')).inGame, 3_000, 'the state to land');
        await gone(lite, 'cs_next');
        const page = await publisher('cs_next');
        // Connected, but nothing of its own yet: not in game, and nothing to hand over.
        expect(await status('cs_next')).toMatchObject({ status: 'active', inGame: false });
        const c = await controller('cs_next');
        await Bun.sleep(300);
        expect(c.states).toEqual([]);
        page.send(JSON.stringify({ type: 'state', state: state(1, { launch: 'L1' }) }));
        await until(() => c.states.length > 0, 3_000, "the new client's state");
        expect(c.states.map(s => s.tick)).toEqual([1]);
        c.close();
        page.close();
    });
});
