// A stand-in for Chrome's DevTools port with one bot's page behind it, for unit tests.
//
// /json/list lists the tab. Its websocket answers Runtime.evaluate by running the expression
// against a fake `window.gameClient`, so the page scripts in lib/tab.ts execute for real, and it
// records Page.navigate. The same server plays the page server's one-time token endpoints
// (server/webclient/proxy.ts: POST /bot/login-token mints against the account's proof, POST
// /bot/login redeems once), so a test sees every token minted and redeemed.

import { loginTokenProof } from '../../server/webclient/login-token';

/** The members of the webclient's Client that the page scripts read or call. */
export interface FakeGameClient {
    ingame: boolean;
    loginInProgress: boolean;
    loginMes1: string;
    loginMes2: string;
    botOverlay: { serverTick: number; gateway: { connected: boolean; preventReconnect?: boolean; disconnect?: () => void } } | null;
    autoLogin(username: string, password: string): Promise<void>;
}

export interface FakeCdp {
    /** Shared view of the page; `inGame` is the client's own flag. */
    page: {
        tab: boolean;
        /** False: the page has no window.gameClient (still loading, or not a client page). */
        hasClient: boolean;
        inGame: boolean;
        evaluations: number;
        expressions: string[];
        navigations: string[];
        minted: string[];
        redeemed: string[];
        autoLogins: { username: string; password: string }[];
    };
    client: FakeGameClient;
    /**
     * Test hooks. `onAutoLogin` runs when the client accepts an autoLogin, with loginInProgress
     * already set, as Client.autoLogin does before its first await; `onNavigate` on Page.navigate.
     */
    hooks: { onAutoLogin: (username: string, password: string) => void; onNavigate: (url: string) => void };
    /** Chrome's DevTools origin (CDP_URL). */
    origin: string;
    /** The page server's page URL (CLIENT_URL). */
    clientUrl: string;
    stop(): void;
}

export function fakeCdp(bot: string, password = 'x'): FakeCdp {
    const hooks: FakeCdp['hooks'] = { onAutoLogin: () => {}, onNavigate: () => {} };
    const page: FakeCdp['page'] = {
        tab: true,
        hasClient: true,
        get inGame() {
            return client.ingame;
        },
        set inGame(v: boolean) {
            client.ingame = v;
        },
        evaluations: 0,
        expressions: [],
        navigations: [],
        minted: [],
        redeemed: [],
        autoLogins: [],
    };
    const client: FakeGameClient = {
        ingame: true,
        loginInProgress: false,
        loginMes1: '',
        loginMes2: '',
        botOverlay: {
            serverTick: 0,
            gateway: {
                connected: true,
                disconnect() {
                    client.botOverlay!.gateway.connected = false;
                },
            },
        },
        async autoLogin(username: string, pw: string) {
            if (client.ingame || client.loginInProgress) return;
            page.autoLogins.push({ username, password: pw });
            client.loginInProgress = true;
            client.loginMes1 = '';
            client.loginMes2 = 'Connecting to server...';
            hooks.onAutoLogin(username, pw);
        },
    };

    let pageUrl = '';
    async function evaluate(expression: string): Promise<Record<string, unknown>> {
        const window = { gameClient: page.hasClient ? client : undefined };
        const location = { href: pageUrl };
        try {
            const value = await new Function('window', 'location', 'fetch', `return (${expression});`)(window, location, fetch);
            return value === undefined ? { result: { type: 'undefined' } } : { result: { type: typeof value, value: JSON.parse(JSON.stringify(value)) } };
        } catch (err) {
            return { result: { type: 'object' }, exceptionDetails: { text: 'Uncaught', exception: { description: String(err) } } };
        }
    }

    const server = Bun.serve({
        port: 0,
        hostname: '127.0.0.1',
        async fetch(req, srv) {
            const path = new URL(req.url).pathname;
            if (path === '/json/list') {
                return Response.json(page.tab ? [{ id: 't1', type: 'page', url: pageUrl, webSocketDebuggerUrl: `ws://127.0.0.1:${srv.port}/devtools/page/t1` }] : []);
            }
            if (path === '/bot/login-token' && req.method === 'POST') {
                const body = (await req.json()) as { bot?: string; proof?: string };
                if (body.bot !== bot || body.proof !== loginTokenProof(bot, password)) return Response.json({ error: 'proof does not match' }, { status: 403 });
                const token = `tok-${page.minted.length + 1}-${Math.random().toString(36).slice(2)}`;
                page.minted.push(token);
                return Response.json({ token });
            }
            if (path === '/bot/login' && req.method === 'POST') {
                const body = (await req.json()) as { bot?: string; token?: string };
                const ok = body.bot === bot && typeof body.token === 'string' && page.minted.includes(body.token) && !page.redeemed.includes(body.token);
                if (!ok) return Response.json({ error: 'login token unknown' }, { status: 403 });
                page.redeemed.push(body.token!);
                return Response.json({ bot, password });
            }
            return srv.upgrade(req) ? undefined : new Response('not found', { status: 404 });
        },
        websocket: {
            async message(ws, m) {
                const msg = JSON.parse(String(m)) as { id: number; method: string; params?: Record<string, unknown> };
                if (msg.method === 'Runtime.evaluate') {
                    page.evaluations++;
                    const expression = String(msg.params?.expression ?? '');
                    page.expressions.push(expression);
                    ws.send(JSON.stringify({ id: msg.id, result: await evaluate(expression) }));
                    return;
                }
                if (msg.method === 'Page.navigate') {
                    const url = String(msg.params?.url ?? '');
                    page.navigations.push(url);
                    hooks.onNavigate(url);
                    ws.send(JSON.stringify({ id: msg.id, result: { frameId: 't1' } }));
                    return;
                }
                ws.send(JSON.stringify({ id: msg.id, result: {} }));
            },
        },
    });
    const origin = `http://127.0.0.1:${server.port}`;
    pageUrl = `${origin}/bot?server=localhost:9300&bot=${encodeURIComponent(bot)}`;
    return { page, client, hooks, origin, clientUrl: `${origin}/bot?server=localhost:9300`, stop: () => server.stop(true) };
}
