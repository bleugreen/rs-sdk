import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { LOGIN_TOKEN_TTL_MS, LoginTokens, loginTokenProof } from './login-token';
import { createProxyHandler, type PeerAddress } from './proxy';

const PASSWORD = 'hunter2secret';
const loopback: PeerAddress = { requestIP: () => ({ address: '127.0.0.1' }) };
const remote: PeerAddress = { requestIP: () => ({ address: '10.0.0.7' }) };

let botsDir: string;
beforeAll(() => {
    botsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-test-'));
    for (const [name, mode] of [['srtok', 0o600], ['srloose', 0o644]] as const) {
        fs.mkdirSync(path.join(botsDir, name));
        const file = path.join(botsDir, name, 'bot.env');
        fs.writeFileSync(file, `BOT_USERNAME=${name}\nPASSWORD=${PASSWORD}\nSERVER=localhost:9300\n`);
        fs.chmodSync(file, mode);
    }
});
afterAll(() => fs.rmSync(botsDir, { recursive: true, force: true }));

function setup(opts: { insecureQueryLogin?: boolean } = {}) {
    let now = 1_000_000;
    const clock = { advance: (ms: number) => (now += ms) };
    const upstream: URL[] = [];
    const upstreamHeaders: Headers[] = [];
    const handler = createProxyHandler({
        world: new URL('https://world.example'),
        gateway: 'ws://127.0.0.1:7780',
        bundleDir: botsDir, // no client.js here: every page request goes upstream
        botsDir,
        insecureQueryLogin: opts.insecureQueryLogin ?? false,
        tokens: new LoginTokens(LOGIN_TOKEN_TTL_MS, () => now),
        upstreamFetch: async (url, init) => {
            upstream.push(url);
            upstreamHeaders.push(new Headers(init.headers));
            return new Response('page', { status: 200 });
        },
    });
    const post = (p: string, body: unknown, peer = loopback) =>
        handler(new Request(`http://127.0.0.1:8899${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), peer);
    const mint = async (bot = 'srtok', proof = loginTokenProof(bot, PASSWORD), peer = loopback) => post('/bot/login-token', { bot, proof }, peer);
    const redeem = (token: string, bot = 'srtok', peer = loopback) => post('/bot/login', { token, bot }, peer);
    const get = (p: string, headers: Record<string, string> = {}) => handler(new Request(`http://127.0.0.1:8899${p}`, { headers }), loopback);
    return { clock, upstream, upstreamHeaders, mint, redeem, get };
}

async function tokenOf(res: Response): Promise<string> {
    expect(res.status).toBe(200);
    return ((await res.json()) as { token: string }).token;
}

describe('login tokens', () => {
    test('a token is redeemed once for the bot.env credentials, and never again', async () => {
        const p = setup();
        const token = await tokenOf(await p.mint());
        expect(token).not.toContain(PASSWORD);
        const first = await p.redeem(token);
        expect(first.status).toBe(200);
        expect(first.headers.get('cache-control')).toBe('no-store');
        expect(await first.json()).toEqual({ bot: 'srtok', password: PASSWORD });
        const second = await p.redeem(token);
        expect(second.status).toBe(403);
        expect(await second.text()).not.toContain(PASSWORD);
    });

    test('a token expires after 60 s, and an expired one is spent', async () => {
        const p = setup();
        const late = await tokenOf(await p.mint());
        const inTime = await tokenOf(await p.mint());
        p.clock.advance(LOGIN_TOKEN_TTL_MS - 1);
        expect((await p.redeem(inTime)).status).toBe(200);
        p.clock.advance(1);
        const res = await p.redeem(late);
        expect(res.status).toBe(403);
        expect(((await res.json()) as { error: string }).error).toMatch(/expired/);
    });

    test('a token is bound to its account and spent by a wrong guess', async () => {
        const p = setup();
        const token = await tokenOf(await p.mint());
        expect((await p.redeem(token, 'other')).status).toBe(403);
        expect((await p.redeem(token)).status).toBe(403);
    });

    test('minting needs the password-derived proof', async () => {
        const p = setup();
        expect((await p.mint('srtok', loginTokenProof('srtok', 'wrong'))).status).toBe(403);
        expect((await p.mint('srtok', '')).status).toBe(403);
        expect((await p.mint('nobody')).status).toBe(404);
        expect((await p.mint('../srtok')).status).toBe(400);
    });

    test('loopback clients only, for minting and redeeming', async () => {
        const p = setup();
        expect((await p.mint('srtok', undefined, remote)).status).toBe(403);
        const token = await tokenOf(await p.mint());
        expect((await p.redeem(token, 'srtok', remote)).status).toBe(403);
        // The refused remote attempt never reached the token.
        expect((await p.redeem(token)).status).toBe(200);
    });

    test('a bot.env other users can read is refused', async () => {
        const res = await setup().mint('srloose');
        expect(res.status).toBe(403);
        expect(((await res.json()) as { error: string }).error).toMatch(/chmod 600/);
    });
});

describe('the page', () => {
    test('?password= is refused without --insecure-query-login and goes nowhere', async () => {
        const p = setup();
        const res = await p.get(`/bot?bot=srtok&password=${PASSWORD}&server=world.example`);
        expect(res.status).toBe(400);
        expect(res.headers.get('location')).toBeNull();
        expect(p.upstream).toEqual([]);
    });

    test('with --insecure-query-login the page loads, but the password is still not forwarded', async () => {
        const p = setup({ insecureQueryLogin: true });
        expect((await p.get(`/bot?bot=srtok&password=${PASSWORD}&server=world.example`)).status).toBe(200);
        expect(p.upstream.map(String)).toEqual(['https://world.example/bot?bot=srtok&server=world.example']);
    });

    test('the token stays between the tab and this server: not in the upstream URL or Referer', async () => {
        const p = setup();
        const bare = await p.get('/bot?bot=srtok&token=abc');
        expect(bare.status).toBe(302);
        expect(bare.headers.get('location')).toBe('http://127.0.0.1:8899/bot?bot=srtok&token=abc&server=world.example&gateway=ws%3A%2F%2F127.0.0.1%3A7780');
        await p.get('/bot?bot=srtok&token=abc&server=world.example');
        await p.get('/crc', { Referer: 'http://127.0.0.1:8899/bot?bot=srtok&token=abc&server=world.example' });
        expect(p.upstream.map(String)).toEqual(['https://world.example/bot?bot=srtok&server=world.example', 'https://world.example/crc']);
        expect(p.upstreamHeaders[1]!.get('referer')).toBeNull();
    });
});
