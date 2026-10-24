// A stand-in for Chrome's DevTools port with one bot's page behind it, for unit tests.
//
// /json/list lists the tab, and any other pages a test adds (`page.others`); /json/close/<id>
// closes one. Its websocket answers Runtime.evaluate by running the expression against a fake
// `window.gameClient` and `document`, so the page scripts in lib/tab.ts execute for real, and it
// records Page.navigate and every other method. /json/version names a browser websocket on the
// same server, which answers Browser.getWindowForTarget and Browser.setWindowBounds for the tab's
// one window (`page.window`). The same server plays the page server's one-time token endpoints
// (server/webclient/proxy.ts: POST /bot/login-token mints against the account's proof, POST
// /bot/login redeems once), so a test sees every token minted and redeemed.

import { loginTokenProof } from '../../server/webclient/login-token';

/** The members of the webclient's Client that the page scripts read or call. */
export interface FakeGameClient {
    ingame: boolean;
    loginInProgress: boolean;
    /** The client finished loading; the title screen's auto-login waits for it. */
    loadingComplete: boolean;
    /** The title screen made its one auto-login (Client.botAutoLoginAttempted). */
    botAutoLoginAttempted: boolean;
    loginMes1: string;
    loginMes2: string;
    botOverlay: { serverTick: number; gateway: { connected: boolean; preventReconnect?: boolean; disconnect?: () => void } } | null;
    autoLogin(username: string, password: string): Promise<void>;
    /** Client.clickComponent: false out of game; else recorded in `page.clicks` and passed to `hooks.onClickComponent`. */
    clickComponent(componentId: number): boolean;
    flushNow(): void;
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
        /** Components the page's client clicked (clickComponent), in order. */
        clicks: number[];
        /** The tab's URL: the last navigation's, with the token taken out as the page does. */
        url: string;
        /** Other page targets on the same Chrome, listed after the tab. */
        others: { id: string; url: string }[];
        /** Target ids closed through /json/close. */
        closed: string[];
        /** Every websocket method received, page and browser alike, in order. */
        methods: string[];
        /** What the page's `document` answers. */
        document: { title: string; visibilityState: string; focused: boolean };
        /** The tab's window state, and every state Browser.setWindowBounds set, in order. */
        window: 'normal' | 'minimized' | 'maximized' | 'fullscreen';
        windowStates: string[];
        /** URLs opened through PUT /json/new (each becomes one of `others`). */
        opened: string[];
        /** What Page.captureScreenshot returns, and the page's window size. */
        screenshot: Uint8Array;
        viewport: { innerWidth: number; innerHeight: number; devicePixelRatio: number };
    };
    client: FakeGameClient;
    /**
     * Test hooks. `onAutoLogin` runs when the client accepts an autoLogin, with loginInProgress
     * already set, as Client.autoLogin does before its first await; `onNavigate` on Page.navigate.
     */
    hooks: { onAutoLogin: (username: string, password: string) => void; onNavigate: (url: string) => void; onClickComponent: (componentId: number) => void };
    /** Chrome's DevTools origin (CDP_URL). */
    origin: string;
    /** The page server's page URL (CLIENT_URL). */
    clientUrl: string;
    stop(): void;
}

export function fakeCdp(bot: string, password = 'x'): FakeCdp {
    const hooks: FakeCdp['hooks'] = { onAutoLogin: () => {}, onNavigate: () => {}, onClickComponent: () => {} };
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
        clicks: [],
        get url() {
            return pageUrl;
        },
        set url(v: string) {
            pageUrl = v;
        },
        others: [],
        closed: [],
        methods: [],
        document: { title: '2004Scape Bot Client', visibilityState: 'visible', focused: true },
        window: 'maximized',
        windowStates: [],
        opened: [],
        screenshot: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
        viewport: { innerWidth: 1920, innerHeight: 978, devicePixelRatio: 1 },
    };
    const client: FakeGameClient = {
        ingame: true,
        loginInProgress: false,
        loadingComplete: true,
        botAutoLoginAttempted: true,
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
        clickComponent(componentId: number) {
            if (!client.ingame) return false;
            page.clicks.push(componentId);
            hooks.onClickComponent(componentId);
            return true;
        },
        flushNow() {},
    };

    let pageUrl = '';
    async function evaluate(expression: string): Promise<Record<string, unknown>> {
        const window = { gameClient: page.hasClient ? client : undefined, ...page.viewport };
        const location = { href: pageUrl };
        const document = {
            get title() {
                return page.document.title;
            },
            set title(v: string) {
                page.document.title = v;
            },
            get visibilityState() {
                return page.document.visibilityState;
            },
            hasFocus: () => page.document.focused,
        };
        try {
            const value = await new Function('window', 'location', 'fetch', 'document', `return (${expression});`)(window, location, fetch, document);
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
                const target = (id: string, url: string) => ({ id, type: 'page', url, webSocketDebuggerUrl: `ws://127.0.0.1:${srv.port}/devtools/page/${id}` });
                return Response.json([...(page.tab ? [target('t1', pageUrl)] : []), ...page.others.map(o => target(o.id, o.url))]);
            }
            if (path === '/json/version') {
                return Response.json({ Browser: 'FakeChrome/1', webSocketDebuggerUrl: `ws://127.0.0.1:${srv.port}/devtools/browser/b1` });
            }
            if (path === '/json/new' && req.method === 'PUT') {
                const url = decodeURIComponent(new URL(req.url).search.slice(1));
                const id = `n${page.opened.length + 1}`;
                page.opened.push(url);
                page.others.push({ id, url });
                return Response.json({ id, type: 'page', url });
            }
            const close = path.match(/^\/json\/close\/(.+)$/);
            if (close) {
                const id = close[1]!;
                const known = (id === 't1' && page.tab) || page.others.some(o => o.id === id);
                if (!known) return new Response(`No such target id: ${id}`, { status: 404 });
                page.closed.push(id);
                if (id === 't1') page.tab = false;
                else page.others = page.others.filter(o => o.id !== id);
                return new Response('Target is closing');
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
                page.methods.push(msg.method);
                if (msg.method === 'Browser.getWindowForTarget') {
                    ws.send(JSON.stringify({ id: msg.id, result: { windowId: 1, bounds: { windowState: page.window } } }));
                    return;
                }
                if (msg.method === 'Page.captureScreenshot') {
                    ws.send(JSON.stringify({ id: msg.id, result: { data: Buffer.from(page.screenshot).toString('base64') } }));
                    return;
                }
                if (msg.method === 'Browser.setWindowBounds') {
                    const state = (msg.params?.bounds as { windowState?: FakeCdp['page']['window'] } | undefined)?.windowState;
                    if (state) {
                        page.window = state;
                        page.windowStates.push(state);
                    }
                    ws.send(JSON.stringify({ id: msg.id, result: {} }));
                    return;
                }
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
                    try {
                        const u = new URL(url);
                        u.searchParams.delete('token');
                        pageUrl = u.toString();
                    } catch {}
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
